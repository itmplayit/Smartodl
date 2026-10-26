'use strict';
/** Study notes: upload (admin/developer), list, download-protection */
const path = require('path');
const fs = require('fs');
const { q, q1, exec } = require('../config/db');
const { ApiError, asyncHandler, ok, created, slugify, parsePagination, sorting } = require('../utils/helpers');
const { publicUrl, UPLOAD_ROOT } = require('../middleware/upload');
const { notify } = require('../services/notification.service');
const { readBool } = require('../services/settings.service');

const NOTE_SELECT = `n.*, c.title AS course_title, cat.name AS category_name, u.full_name AS uploaded_by_name`;
const NOTE_STATUSES = ['draft', 'published', 'unpublished'];
const NOTE_FILE_TYPES = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'image', 'zip', 'txt', 'md'];
const isNoteManager = (user, note) => !!user && (
  ['owner', 'admin'].includes(user.role)
  || (user.role === 'developer' && Number(note && note.uploaded_by) === Number(user.id))
);
const canViewNote = (user, note) => !!note && (note.status === 'published' || isNoteManager(user, note));
const cleanupUploadedFile = async (req) => {
  if (req.file && req.file.path) await fs.promises.unlink(req.file.path).catch(() => {});
};
const noteFileType = (file) => {
  const ext = path.extname((file && (file.originalname || file.filename)) || '').toLowerCase().replace('.', '');
  const type = ({ jpg: 'image', jpeg: 'image', png: 'image' })[ext] || ext;
  if (!NOTE_FILE_TYPES.includes(type)) throw ApiError.badRequest('Unsupported note file type');
  return type;
};
const optionalReferenceId = async (value, table, label) => {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest(`${label} is invalid`);
  const row = await q1(`SELECT id FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw ApiError.badRequest(`${label} does not exist`);
  return id;
};

async function removeNoteFile(url) {
  if (!String(url || '').startsWith('/uploads/notes/')) return;
  const root = path.resolve(UPLOAD_ROOT, 'notes');
  const file = path.resolve(UPLOAD_ROOT, String(url).slice('/uploads/'.length));
  if (!file.startsWith(`${root}${path.sep}`)) return;
  await fs.promises.unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}

const list = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const where = [], params = [];
  const status = req.query.status ? String(req.query.status) : '';
  if (status && !NOTE_STATUSES.includes(status)) throw ApiError.badRequest('Invalid note status');
  if (req.query.file_type && !NOTE_FILE_TYPES.includes(String(req.query.file_type))) {
    throw ApiError.badRequest('Invalid note file_type');
  }
  const isAdmin = req.user && ['owner', 'admin'].includes(req.user.role);
  const isDeveloper = req.user && req.user.role === 'developer';
  if (isAdmin) {
    if (status) { where.push('n.status = ?'); params.push(status); }
  } else if (isDeveloper) {
    // A developer sees public material plus only their own drafts.
    where.push("(n.status = 'published' OR n.uploaded_by = ?)");
    params.push(req.user.id);
    if (status) { where.push('n.status = ?'); params.push(status); }
  } else {
    where.push("n.status = 'published'");
  }
  if (req.query.mine === '1') {
    if (!req.user) throw ApiError.unauthorized('Login required');
    where.push('n.uploaded_by = ?'); params.push(req.user.id);
  }
  if (req.query.course_id) { where.push('n.course_id = ?'); params.push(Number(req.query.course_id) || 0); }
  if (req.query.subject) { where.push('n.subject = ?'); params.push(req.query.subject); }
  if (req.query.file_type) { where.push('n.file_type = ?'); params.push(req.query.file_type); }
  if (req.query.search) { where.push('(n.title LIKE ? OR n.description LIKE ? OR n.subject LIKE ?)'); params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { sort, order } = sorting(req.query, ['created_at', 'download_count', 'view_count', 'title'], 'created_at');
  const rows = await q(
    `SELECT ${NOTE_SELECT} FROM notes n
       LEFT JOIN courses c ON c.id = n.course_id
       LEFT JOIN categories cat ON cat.id = n.category_id
       LEFT JOIN users u ON u.id = n.uploaded_by
       ${whereSql} ORDER BY n.${sort} ${order} LIMIT ? OFFSET ?`, [...params, limit, offset],
  );
  const [{ total }] = await q(`SELECT COUNT(*) AS total FROM notes n ${whereSql}`, params);
  ok(res, rows, { page, limit, total, pages: Math.ceil(total / limit) });
});

const getOne = asyncHandler(async (req, res) => {
  const note = await q1(
    `SELECT ${NOTE_SELECT} FROM notes n LEFT JOIN courses c ON c.id = n.course_id
       LEFT JOIN categories cat ON cat.id = n.category_id LEFT JOIN users u ON u.id = n.uploaded_by
      WHERE n.id = ? OR n.slug = ? LIMIT 1`, [Number(req.params.id) || 0, req.params.id],
  );
  if (!note) throw ApiError.notFound('Note not found');
  if (!canViewNote(req.user, note)) throw ApiError.notFound('Note not found');
  await exec('UPDATE notes SET view_count = view_count + 1 WHERE id = ?', [note.id]);
  ok(res, note);
});

/** POST /api/notes (multipart: file) */
const create = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('A file is required (PDF, Office document, JPG/PNG image, TXT or Markdown)');
  const b = req.body || {};
  let result;
  try {
    const title = String(b.title || '').trim().slice(0, 200);
    if (!title) throw ApiError.badRequest('Note title is required');
    const status = b.status || 'published';
    if (!NOTE_STATUSES.includes(status)) throw ApiError.badRequest('Invalid note status');
    const fileType = noteFileType(req.file);
    const courseId = await optionalReferenceId(b.course_id, 'courses', 'course_id');
    const categoryId = await optionalReferenceId(b.category_id, 'categories', 'category_id');
    let pages = null;
    if (b.pages !== undefined && b.pages !== '') {
      pages = Number(b.pages);
      if (!Number.isInteger(pages) || pages < 1 || pages > 100000) {
        throw ApiError.badRequest('pages must be a positive integer');
      }
    }
    const slugRoot = slugify(title) || 'note';
    const slug = `${slugRoot}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 220);
    result = await exec(
      `INSERT INTO notes (title, slug, description, subject, course_id, category_id, file_path, file_name,
          file_type, file_size, pages, uploaded_by, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [title, slug, String(b.description || '').slice(0, 400) || null,
        String(b.subject || '').slice(0, 120) || null, courseId, categoryId,
        publicUrl(req.file), String(req.file.originalname || '').slice(0, 255), fileType,
        req.file.size, pages, req.user.id, status],
    );
    if (status === 'published') {
      try {
        await notify({
          audience: 'student', type: 'note', link: '/notes', title: `New notes: ${title}`,
          message: String(b.description || '').slice(0, 400) || 'New study material is available for download.',
          createdBy: req.user.id,
        });
      } catch (error) {
        console.error('[notes] publish notification failed:', error.message);
      }
    }
  } catch (error) {
    if (!result) await cleanupUploadedFile(req);
    throw error;
  }
  created(res, await q1('SELECT * FROM notes WHERE id = ?', [result.insertId]));
});

const update = asyncHandler(async (req, res) => {
  const note = await q1('SELECT * FROM notes WHERE id = ?', [req.params.id]);
  if (!note) { await cleanupUploadedFile(req); throw ApiError.notFound('Note not found'); }
  if (!isNoteManager(req.user, note)) {
    await cleanupUploadedFile(req);
    throw ApiError.forbidden('These notes were uploaded by someone else — a developer may edit only their own material.');
  }
  try {
    const data = {};
    if (req.body.title !== undefined) {
      data.title = String(req.body.title || '').trim().slice(0, 200);
      if (!data.title) throw ApiError.badRequest('Note title cannot be empty');
    }
    if (req.body.description !== undefined) data.description = String(req.body.description || '').slice(0, 400) || null;
    if (req.body.subject !== undefined) data.subject = String(req.body.subject || '').slice(0, 120) || null;
    if (req.body.course_id !== undefined) data.course_id = await optionalReferenceId(req.body.course_id, 'courses', 'course_id');
    if (req.body.category_id !== undefined) data.category_id = await optionalReferenceId(req.body.category_id, 'categories', 'category_id');
    if (req.body.pages !== undefined) {
      if (req.body.pages === '' || req.body.pages === null) data.pages = null;
      else {
        data.pages = Number(req.body.pages);
        if (!Number.isInteger(data.pages) || data.pages < 1 || data.pages > 100000) {
          throw ApiError.badRequest('pages must be a positive integer');
        }
      }
    }
    if (req.body.status !== undefined) {
      if (!NOTE_STATUSES.includes(req.body.status)) throw ApiError.badRequest('Invalid note status');
      data.status = req.body.status;
    }
    if (req.file) {
      data.file_path = publicUrl(req.file);
      data.file_name = String(req.file.originalname || '').slice(0, 255);
      data.file_size = req.file.size;
      data.file_type = noteFileType(req.file);
    }
    const keys = Object.keys(data);
    if (!keys.length) throw ApiError.badRequest('Nothing to update');
    await exec(`UPDATE notes SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), note.id]);
    if (req.file && note.file_path !== data.file_path) {
      try { await removeNoteFile(note.file_path); }
      catch (error) { console.error('[notes] old file cleanup failed:', error.message); }
    }
    return ok(res, await q1('SELECT * FROM notes WHERE id = ?', [note.id]));
  } catch (error) {
    await cleanupUploadedFile(req);
    throw error;
  }
});

const remove = asyncHandler(async (req, res) => {
  const note = await q1('SELECT * FROM notes WHERE id = ?', [req.params.id]);
  if (!note) throw ApiError.notFound('Note not found');
  if (!isNoteManager(req.user, note)) {
    throw ApiError.forbidden('These notes were uploaded by someone else — a developer may delete only their own material.');
  }
  await exec('DELETE FROM notes WHERE id = ?', [note.id]);
  try { await removeNoteFile(note.file_path); }
  catch (error) { console.error('[notes] deleted note file cleanup failed:', error.message); }
  ok(res, { id: Number(note.id), deleted: true });
});

/**
 * GET /api/notes/:id/download
 * Login-protected download. When the admin setting `download_login_required`
 * is on, anonymous visitors receive 401 with a clear message so the UI can
 * send them to the login page.
 */
const download = asyncHandler(async (req, res) => {
  const note = await q1('SELECT * FROM notes WHERE id = ?', [req.params.id]);
  if (!note) throw ApiError.notFound('Note not found');
  const loginRequired = await readBool('download_login_required', true);
  if (loginRequired && !req.user) {
    throw ApiError.unauthorized('Please login to download this material.');
  }
  if (!canViewNote(req.user, note)) throw ApiError.notFound('Note not found');
  const rel = String(note.file_path || '').replace(/^\/?uploads\//, '');
  const root = path.resolve(UPLOAD_ROOT, 'notes');
  const abs = path.resolve(UPLOAD_ROOT, rel);
  if (!abs.startsWith(`${root}${path.sep}`)) throw ApiError.badRequest('Invalid note file path');
  if (!fs.existsSync(abs)) throw ApiError.notFound('The uploaded file is no longer available');
  await exec('UPDATE notes SET download_count = download_count + 1 WHERE id = ?', [note.id]);
  res.download(abs, note.file_name || path.basename(abs));
});

module.exports = { list, getOne, create, update, remove, download };
