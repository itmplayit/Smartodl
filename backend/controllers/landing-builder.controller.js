'use strict';
const fs = require('fs/promises');
const path = require('path');
const { q, q1, exec } = require('../config/db');
const { ApiError, asyncHandler, ok, created } = require('../utils/helpers');
const builder = require('../services/landing-builder.service');
const { publicUrl, UPLOAD_ROOT } = require('../middleware/upload');

async function hasValidImageSignature(file) {
  const handle = await fs.open(file.path, 'r');
  try {
    const bytes = Buffer.alloc(12);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const ext = path.extname(file.originalname).toLowerCase();
    const isPng = bytesRead >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = bytesRead >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebp = bytesRead >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    return (ext === '.png' && isPng) || (['.jpg', '.jpeg'].includes(ext) && isJpeg) || (ext === '.webp' && isWebp);
  } finally { await handle.close(); }
}

async function safelyRemoveMediaFile(url) {
  if (!String(url || '').startsWith('/uploads/landing/')) return;
  const root = path.resolve(UPLOAD_ROOT, 'landing');
  const file = path.resolve(UPLOAD_ROOT, String(url).slice('/uploads/'.length));
  if (!file.startsWith(`${root}${path.sep}`)) return;
  try { await fs.unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

const publicPage = asyncHandler(async (req, res) => ok(res, await builder.getPublic()));
const editor = asyncHandler(async (req, res) => ok(res, await builder.getBuilder()));
const saveDraft = asyncHandler(async (req, res) => ok(res, await builder.saveDraft(req.body.document, req.user.id, req.body.base_version)));
const publish = asyncHandler(async (req, res) => ok(res, await builder.publish(req.user.id, req.body.base_version)));
const revertDraft = asyncHandler(async (req, res) => ok(res, await builder.revertDraft(req.user.id)));
const listRevisions = asyncHandler(async (req, res) => ok(res, await builder.revisions()));
const restoreRevision = asyncHandler(async (req, res) => ok(res, await builder.restoreRevision(Number(req.params.id), req.user.id)));

const listMedia = asyncHandler(async (req, res) => {
  const rows = await q('SELECT id, file_name, original_name, url, mime_type, file_size, alt_text, created_at FROM landing_media ORDER BY id DESC LIMIT 250');
  ok(res, rows);
});

const uploadMedia = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('A JPG, PNG or WebP image is required');
  if (!(await hasValidImageSignature(req.file))) {
    await fs.unlink(req.file.path).catch(() => {});
    throw ApiError.badRequest('The uploaded file is not a valid JPG, PNG or WebP image');
  }
  const url = publicUrl(req.file);
  try {
    const result = await exec(
      'INSERT INTO landing_media (file_name, original_name, url, mime_type, file_size, alt_text, uploaded_by) VALUES (?,?,?,?,?,?,?)',
      [req.file.filename, String(req.file.originalname).slice(0, 255), url, req.file.mimetype, req.file.size, String(req.body.alt_text || '').slice(0, 255), req.user.id],
    );
    const row = await q1('SELECT id, file_name, original_name, url, mime_type, file_size, alt_text, created_at FROM landing_media WHERE id=?', [result.insertId]);
    created(res, row);
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => {});
    throw error;
  }
});

const updateMedia = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = await q1('SELECT id FROM landing_media WHERE id=?', [id]);
  if (!row) throw new ApiError(404, 'Media item not found');
  await exec('UPDATE landing_media SET alt_text=? WHERE id=?', [String(req.body.alt_text || '').slice(0, 255), id]);
  ok(res, await q1('SELECT id, file_name, original_name, url, mime_type, file_size, alt_text, created_at FROM landing_media WHERE id=?', [id]));
});

const removeMedia = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = await q1('SELECT * FROM landing_media WHERE id=?', [id]);
  if (!row) throw new ApiError(404, 'Media item not found');
  const page = await builder.getBuilder();
  if (JSON.stringify(page.draft).includes(row.url) || JSON.stringify(page.published).includes(row.url)) {
    throw ApiError.conflict('This image is still used by the draft or published landing page. Replace it there before deleting.');
  }
  await exec('DELETE FROM landing_media WHERE id=?', [id]);
  await safelyRemoveMediaFile(row.url);
  ok(res, { deleted: true });
});

module.exports = { publicPage, editor, saveDraft, publish, revertDraft, listRevisions, restoreRevision, listMedia, uploadMedia, updateMedia, removeMedia };
