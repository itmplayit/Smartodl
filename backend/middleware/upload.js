'use strict';
/** Multer file uploads with type + size validation (never trusts the client). */
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ApiError, randomToken } = require('../utils/helpers');

// path.resolve: an absolute UPLOAD_DIR (e.g. a mounted volume /data/uploads)
// must win; path.join would silently nest it under backend/.
const UPLOAD_ROOT = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
const MAX_MB = Number(process.env.MAX_FILE_SIZE_MB || 25);

const NOTE_TYPES = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.txt', '.md'];
const IMAGE_TYPES = ['.png', '.jpg', '.jpeg', '.webp'];
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }

function makeStorage(subdir) {
  const dest = ensureDir(path.join(UPLOAD_ROOT, subdir));
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dest),
    filename: (req, file, cb) => {
      const safeBase = path.basename(file.originalname, path.extname(file.originalname))
        .toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'file';
      cb(null, `${safeBase}-${Date.now()}-${randomToken(4)}${path.extname(file.originalname).toLowerCase()}`);
    },
  });
}

function makeUploader(subdir, allowed, maxMb = MAX_MB, allowedMimeTypes = null) {
  return multer({
    storage: makeStorage(subdir),
    limits: { fileSize: maxMb * 1024 * 1024, files: 5 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const validExtension = allowed.includes(ext);
      const validMime = !allowedMimeTypes || allowedMimeTypes.includes(String(file.mimetype || '').toLowerCase());
      if (!validExtension || !validMime) {
        return cb(ApiError.badRequest(`File type ${ext || 'unknown'} is not allowed. Allowed: ${allowed.join(', ')}`));
      }
      cb(null, true);
    },
  });
}

const notesUpload = makeUploader('notes', NOTE_TYPES);
const imageUpload = makeUploader('thumbnails', IMAGE_TYPES, 5, IMAGE_MIME_TYPES);
const avatarUpload = makeUploader('avatars', IMAGE_TYPES, 3, IMAGE_MIME_TYPES);
const bannerUpload = makeUploader(
  'banners',
  ['.png', '.jpg', '.jpeg', '.webp'],
  8,
  ['image/png', 'image/jpeg', 'image/webp'],
);
const landingMediaUpload = makeUploader(
  'landing',
  ['.png', '.jpg', '.jpeg', '.webp'],
  10,
  ['image/png', 'image/jpeg', 'image/webp'],
);

async function hasValidNoteSignature(file) {
  const handle = await fs.promises.open(file.path, 'r');
  try {
    const size = Math.min(file.size || 0, 1024 * 1024);
    const bytes = Buffer.alloc(Math.max(size, 16));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const data = bytes.subarray(0, bytesRead);
    const ext = path.extname(file.originalname).toLowerCase();
    const starts = (...values) => values.every((value, index) => data[index] === value);
    if (ext === '.pdf') return data.subarray(0, 5).toString('ascii') === '%PDF-';
    if (ext === '.png') return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    if (['.jpg', '.jpeg'].includes(ext)) return starts(0xff, 0xd8, 0xff);
    if (['.doc', '.ppt'].includes(ext)) return starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    if (['.docx', '.pptx'].includes(ext)) {
      if (!starts(0x50, 0x4b, 0x03, 0x04)) return false;
      const header = data.toString('latin1');
      return header.includes('[Content_Types].xml') && header.includes(ext === '.docx' ? 'word/' : 'ppt/');
    }
    if (['.txt', '.md'].includes(ext)) return !data.includes(0);
    return false;
  } finally { await handle.close(); }
}

async function validateNoteFile(req, res, next) {
  if (!req.file) return next();
  try {
    if (await hasValidNoteSignature(req.file)) return next();
    await fs.promises.unlink(req.file.path).catch(() => {});
    return next(ApiError.badRequest('The uploaded study document does not match its file extension'));
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return next(error);
  }
}

async function hasValidRasterSignature(file) {
  const handle = await fs.promises.open(file.path, 'r');
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

async function validateRasterImage(req, res, next) {
  if (!req.file) return next();
  try {
    if (await hasValidRasterSignature(req.file)) return next();
    await fs.promises.unlink(req.file.path).catch(() => {});
    return next(ApiError.badRequest('The uploaded file is not a valid JPG, PNG or WebP image'));
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return next(error);
  }
}

const publicUrl = (file) => (file ? `/uploads/${path.relative(UPLOAD_ROOT, file.path).split(path.sep).join('/')}` : null);

module.exports = {
  notesUpload, imageUpload, avatarUpload, bannerUpload, landingMediaUpload,
  validateRasterImage, hasValidRasterSignature, validateNoteFile, hasValidNoteSignature,
  publicUrl, UPLOAD_ROOT, ensureDir,
};
