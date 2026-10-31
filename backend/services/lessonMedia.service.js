'use strict';
/**
 * Lesson media files (course video + PDF) on disk.
 *
 * Files live under `uploads/lesson-media/<lessonId>/` and are never served by
 * express.static: a paid course's video must not be downloadable by anyone who
 * guesses the URL. Readers go through /api/lessons/:id/video|pdf, which checks
 * entitlement (preview, enrolled, staff, premium) on every request.
 */
const fs = require('fs');
const path = require('path');
const { q1, exec } = require('../config/db');
const { UPLOAD_ROOT, ensureDir } = require('../middleware/upload');

const SUBDIR = 'lesson-media';
const ROOT = path.join(UPLOAD_ROOT, SUBDIR);

const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.webm', '.ogv', '.ogg'];
const PDF_EXTENSIONS = ['.pdf'];

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.pdf': 'application/pdf',
};

/** Columns added by the lesson-media upgrade (base schema predates them). */
async function ensureSchema() {
  const columns = [
    ['video_path', 'VARCHAR(255) NULL AFTER resource_url'],
    ['video_name', 'VARCHAR(180) NULL AFTER video_path'],
    ['pdf_path', 'VARCHAR(255) NULL AFTER video_name'],
    ['pdf_name', 'VARCHAR(180) NULL AFTER pdf_path'],
  ];
  for (const [name, definition] of columns) {
    const existing = await q1(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lessons' AND COLUMN_NAME = ?`,
      [name],
    );
    if (Number(existing && existing.c)) continue;
    await exec(`ALTER TABLE lessons ADD COLUMN \`${name}\` ${definition}`);
    console.log(`[lesson-media] added lessons.${name}`);
  }
}

const sanitizeName = (name) => String(name || 'file')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .replace(/[\\/]/g, '-')
  .slice(0, 180) || 'file';

function mimeFor(filePath) {
  return MIME_BY_EXT[path.extname(String(filePath || '')).toLowerCase()] || 'application/octet-stream';
}

/**
 * Resolves a stored relative path to an absolute one, refusing anything that
 * escapes the lesson-media directory (`../../.env` and friends).
 */
function resolveStoredPath(relative) {
  const rel = String(relative || '').replace(/^\/+/, '');
  if (!rel) return null;
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(`${ROOT}${path.sep}`)) return null;
  return abs;
}

/** Moves a freshly uploaded temp file into place and returns the stored path. */
function storeFile(lessonId, tempPath, originalName) {
  const dir = ensureDir(path.join(ROOT, String(Number(lessonId))));
  const ext = path.extname(originalName || tempPath).toLowerCase();
  const base = path.basename(originalName || 'file', ext)
    .toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'file';
  const target = path.join(dir, `${base}-${Date.now()}${ext}`);
  fs.renameSync(tempPath, target);
  return path.relative(ROOT, target).split(path.sep).join('/');
}

async function removeFile(relative) {
  const abs = resolveStoredPath(relative);
  if (!abs) return false;
  try { await fs.promises.unlink(abs); return true; } catch { return false; }
}

/** Current stored media for a lesson. */
async function readLessonMedia(lessonId) {
  const row = await q1(
    'SELECT id, video_path, video_name, pdf_path, pdf_name FROM lessons WHERE id = ?',
    [lessonId],
  );
  if (!row) return null;
  return {
    video_path: row.video_path || null,
    video_name: row.video_name || null,
    pdf_path: row.pdf_path || null,
    pdf_name: row.pdf_name || null,
  };
}

/** What the lesson payload exposes — file paths never leave the server. */
function describeMedia(row) {
  if (!row) return { video_upload: null, pdf_upload: null };
  return {
    video_upload: row.video_path
      ? { name: row.video_name || path.basename(row.video_path), mime: mimeFor(row.video_path) }
      : null,
    pdf_upload: row.pdf_path
      ? { name: row.pdf_name || path.basename(row.pdf_path), mime: 'application/pdf' }
      : null,
  };
}

module.exports = {
  SUBDIR, ROOT, VIDEO_EXTENSIONS, PDF_EXTENSIONS,
  ensureSchema, sanitizeName, mimeFor, resolveStoredPath, storeFile, removeFile,
  readLessonMedia, describeMedia,
};
