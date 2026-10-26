'use strict';
const { ApiError } = require('../utils/helpers');

const DB_ERROR_CODES = new Set([
  'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE',
  'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET',
  'PROTOCOL_CONNECTION_LOST',
]);

/**
 * Constraint violations the CALLER caused (missing field, duplicate, too long,
 * dangling foreign key). These used to fall through to the generic 500
 * "Service temporarily unavailable", which told an admin nothing — saving a
 * category with a duplicate slug looked like the server had fallen over.
 * They are genuine 4xx conditions, so they get a readable message.
 *
 * Only the offending column/key name is taken out of the driver message; the
 * raw MySQL text is never echoed back, so the schema is not disclosed.
 */
function fieldFrom(message, re) {
  const m = re.exec(String(message || ''));
  return m ? m[1].replace(/[_-]+/g, ' ').trim() : null;
}

function constraintError(error) {
  const msg = error && error.message;
  switch (error && error.code) {
    case 'ER_DUP_ENTRY': {
      const key = fieldFrom(msg, /for key '([^']+)'/);
      return { status: 409, message: key
        ? `That value is already taken (${key.replace(/^uq |^idx /, '')}). Pick another one.`
        : 'A record with these details already exists.' };
    }
    case 'ER_NO_DEFAULT_FOR_FIELD': {
      const f = fieldFrom(msg, /Field '([^']+)'/);
      return { status: 400, message: f ? `"${f}" is required.` : 'A required field is missing.' };
    }
    case 'ER_BAD_NULL_ERROR': {
      const f = fieldFrom(msg, /Column '([^']+)'/);
      return { status: 400, message: f ? `"${f}" cannot be empty.` : 'A required field cannot be empty.' };
    }
    case 'ER_DATA_TOO_LONG': {
      const f = fieldFrom(msg, /column '([^']+)'/);
      return { status: 400, message: f ? `"${f}" is too long.` : 'One of the values is too long.' };
    }
    case 'ER_WARN_DATA_OUT_OF_RANGE':
    case 'ER_DATA_OUT_OF_RANGE': {
      const f = fieldFrom(msg, /column '([^']+)'/);
      return { status: 400, message: f ? `"${f}" is out of the allowed range.` : 'A value is out of the allowed range.' };
    }
    case 'ER_TRUNCATED_WRONG_VALUE':
    case 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD':
    case 'WARN_DATA_TRUNCATED': {
      const f = fieldFrom(msg, /column '([^']+)'/) || fieldFrom(msg, /for column '([^']+)'/);
      return { status: 400, message: f ? `"${f}" has an invalid value.` : 'One of the values has the wrong format.' };
    }
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return { status: 400, message: 'One of the linked records does not exist. Refresh and try again.' };
    case 'ER_ROW_IS_REFERENCED':
    case 'ER_ROW_IS_REFERENCED_2':
      return { status: 409, message: 'This record is still used elsewhere, so it cannot be deleted. Remove the items that depend on it first.' };
    default:
      return null;
  }
}

const MULTIPART_PARSE_ERROR = /Malformed part header|Unexpected end of (form|multipart)|Missing boundary|Boundary not found|Unsupported content type|Malformed content type/i;

function classify(error) {
  if (DB_ERROR_CODES.has(error && error.code)) {
    return { status: 503, message: 'A required data service is temporarily unavailable' };
  }
  const constraint = constraintError(error);
  if (constraint) return constraint;
  if (error && error.code === 'LIMIT_FILE_SIZE') {
    return { status: 413, message: 'The uploaded file is larger than the permitted limit' };
  }
  if (error && ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(error.code)) {
    return { status: 400, message: 'The upload contains an unexpected file count or field name' };
  }
  // Busboy throws a bare Error (no .code) when the multipart body itself is
  // broken — a truncated upload or a hand-crafted request. That is the
  // caller's problem, not a server fault, so it must not read as a 500.
  if (error && MULTIPART_PARSE_ERROR.test(String(error.message || ''))) {
    return { status: 400, message: 'The upload was malformed or incomplete. Please try again.' };
  }
  return null;
}

const notFound = (req, res) => res.status(404).json({
  success: false,
  error: 'Route not found',
});

// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  const known = classify(error);
  const status = known ? known.status : Number(error.status || error.statusCode || 500);
  const internal = status >= 500;
  // Deliberate ApiErrors and flagged upstream errors carry messages meant for the user.
  const expose = error instanceof ApiError || Boolean(error && error.expose);

  if (internal) {
    console.error('[error]', req.method, req.path, '-', error.code || error.name || 'Error', error.message);
  }

  res.status(status).json({
    success: false,
    error: known ? known.message : ((internal && !expose) ? 'Service temporarily unavailable' : (error.message || 'Request failed')),
    details: internal && !expose ? undefined : error.details,
  });
}

module.exports = { notFound, errorHandler, ApiError };
