'use strict';
/** Small shared helpers: responses, errors, slugs, pagination, validation. */

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.isApiError = true;
  }
  static badRequest(m = 'Bad request', d) { return new ApiError(400, m, d); }
  static unauthorized(m = 'Authentication required') { return new ApiError(401, m); }
  static forbidden(m = 'You do not have permission to perform this action') { return new ApiError(403, m); }
  static notFound(m = 'Resource not found') { return new ApiError(404, m); }
  static conflict(m = 'Resource already exists') { return new ApiError(409, m); }
  static tooMany(m = 'Too many requests') { return new ApiError(429, m); }
  static serviceUnavailable(m = 'Service unavailable') { return new ApiError(503, m); }
  static internal(m = 'Internal server error') { return new ApiError(500, m); }
}

/** Wrap async route handlers so rejected promises reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ok = (res, data, meta) => res.json(meta ? { success: true, data, meta } : { success: true, data });
const created = (res, data) => res.status(201).json({ success: true, data });
const noContent = (res) => res.status(204).end();

const slugify = (s) => String(s || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().trim()
  .replace(/[^a-z0-9\s-]/g, '')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 180);

/**
 * Validate a user-supplied URL before it is stored and later rendered as an
 * href/src. Only HTTP(S) (or an explicitly allowed same-origin path) passes;
 * `javascript:`, `data:`, protocol-relative and credential-bearing URLs do not.
 */
function safeExternalUrl(value, {
  label = 'URL', allowRelative = false, httpsOnly = false, maxLength = 255,
} = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw ApiError.badRequest(`${label} must be a valid URL`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw ApiError.badRequest(`${label} is too long`);
  if (allowRelative && /^\/(?![/\\])/.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    const protocols = httpsOnly ? ['https:'] : ['http:', 'https:'];
    if (!protocols.includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('protocol');
    }
    return parsed.toString();
  } catch (_) {
    throw ApiError.badRequest(`${label} must be a valid ${httpsOnly ? 'HTTPS' : 'HTTP/HTTPS'} URL${allowRelative ? ' or site-relative path' : ''}`);
  }
}

function parsePagination(query, defaults = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaults.limit || 12));
  return { page, limit, offset: (page - 1) * limit };
}

function sorting(query, allowed, fallback) {
  const sort = allowed.includes(String(query.sort)) ? String(query.sort) : fallback;
  const order = String(query.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return { sort, order };
}

const fullUrl = (req, path) => (path ? `${req.protocol}://${req.get('host')}${path.startsWith('/') ? path : '/' + path}` : null);

function toBool(v, dflt = false) {
  if (v === undefined || v === null || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

/** Normalise text output for judge comparisons (used for short answers). */
const normaliseText = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const x = [...a].map((v) => String(v).trim().toLowerCase()).sort();
  const y = [...b].map((v) => String(v).trim().toLowerCase()).sort();
  return x.every((v, i) => v === y[i]);
}

/** mysql2 returns JSON columns already parsed; tolerate both raw text and parsed values. */
function fromJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return value; }
}

/**
 * Portable rank assignment.
 *
 * Window functions (ROW_NUMBER() OVER …) only exist in MySQL 8+ / MariaDB 10.2+,
 * and plenty of XAMPP installs are older than that. This helper computes the ranks
 * in JavaScript and writes them back in one statement, so leaderboards work on any
 * MySQL/MariaDB version the platform supports.
 *
 * @param {string} table    table to rank (whitelisted by the caller)
 * @param {string} orderSql ORDER BY clause, without the keyword
 * @param {string} whereSql optional WHERE clause, without the keyword
 * @param {Array}  params   parameters for the WHERE clause
 */
async function assignRanks({ q, exec }, table, orderSql, whereSql = '', params = []) {
  const rows = await q(
    `SELECT \`id\` FROM \`${table}\` ${whereSql ? `WHERE ${whereSql}` : ''} ORDER BY ${orderSql}`,
    params,
  );
  if (!rows.length) return 0;

  // one UPDATE with a CASE expression instead of N round-trips
  const ids = rows.map((r) => Number(r.id)).filter(Number.isFinite);
  const cases = ids.map((id, i) => `WHEN ${id} THEN ${i + 1}`).join(' ');
  await exec(
    `UPDATE \`${table}\` SET \`rank_position\` = CASE \`id\` ${cases} END WHERE \`id\` IN (${ids.join(',')})`,
  );
  return ids.length;
}

function randomToken(bytes = 32) {
  return require('crypto').randomBytes(bytes).toString('hex');
}

module.exports = {
  ApiError, asyncHandler, ok, created, noContent, slugify, parsePagination, sorting,
  fullUrl, toBool, normaliseText, arraysEqual, randomToken, fromJson, assignRanks, safeExternalUrl,
};
