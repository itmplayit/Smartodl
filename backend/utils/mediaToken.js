'use strict';
/**
 * Short-lived media tickets.
 *
 * `<video src>` and the PDF `<iframe>` cannot send an Authorization header, so
 * a browser cannot call the lesson media endpoints the way the rest of the API
 * is called. Putting the JWT in the URL is worse: it is long-lived, ends up in
 * history, logs and Referer headers.
 *
 * So the lesson page asks an authenticated endpoint for a ticket: an HMAC over
 * (lesson, user, kind, expiry), valid for a few minutes. The media route
 * verifies the ticket AND re-checks entitlement, so a leaked ticket only ever
 * exposes one lesson, to one user, for a few minutes.
 *
 * Preview lessons are public by design and need no ticket.
 */
const crypto = require('crypto');

const DEFAULT_TTL_SECONDS = 300;

function secret() {
  // A dedicated secret is nicer, but falling back to the access-token secret
  // means an existing install needs no new configuration. The ticket format is
  // deliberately different from a JWT (no header, no alg field), so a media
  // ticket can never be mistaken for, or replayed as, an access token.
  const value = process.env.MEDIA_TOKEN_SECRET
    || process.env.JWT_ACCESS_SECRET
    || process.env.JWT_SECRET
    || '';
  if (!value) throw new Error('MEDIA_TOKEN_SECRET (or JWT_ACCESS_SECRET) must be configured to sign media tickets');
  return value;
}

const b64url = (buffer) => Buffer.from(buffer).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (text) => Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function ttlSeconds(override) {
  const value = Number(override || process.env.MEDIA_TICKET_TTL_SECONDS || DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(value) || value < 30) return DEFAULT_TTL_SECONDS;
  return Math.min(3600, Math.round(value));
}

/** Signs a ticket for one user, one lesson, one media kind. */
function signMediaTicket({ lessonId, userId, kind, ttl, now = Date.now() }) {
  const id = Number(lessonId);
  const uid = Number(userId);
  if (!Number.isInteger(id) || id < 1) throw new Error('lessonId is required to sign a media ticket');
  if (!Number.isInteger(uid) || uid < 1) throw new Error('userId is required to sign a media ticket');
  if (!['video', 'pdf'].includes(kind)) throw new Error('kind must be video or pdf');

  const expires = Math.floor(now / 1000) + ttlSeconds(ttl);
  const payload = b64url(JSON.stringify({ l: id, u: uid, k: kind, e: expires }));
  const mac = b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
  return `${payload}.${mac}`;
}

/**
 * Verifies a ticket. Returns { lessonId, userId, kind, expires } or null.
 * Never throws on malformed input: the caller turns null into a 401.
 */
function verifyMediaTicket(ticket, { kind, now = Date.now() } = {}) {
  if (!ticket || typeof ticket !== 'string' || !ticket.includes('.')) return null;
  const [payload, mac] = ticket.split('.');
  if (!payload || !mac) return null;

  let expected;
  try {
    expected = b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
  } catch { return null; }
  // Constant-time compare, and equal lengths first (timingSafeEqual throws otherwise).
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let data;
  try { data = JSON.parse(unb64url(payload).toString('utf8')); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  if (!Number.isInteger(data.l) || !Number.isInteger(data.u) || !Number.isInteger(data.e)) return null;
  if (!['video', 'pdf'].includes(data.k)) return null;
  if (kind && data.k !== kind) return null;
  if (Math.floor(now / 1000) > data.e) return null;

  return { lessonId: data.l, userId: data.u, kind: data.k, expires: data.e };
}

module.exports = { signMediaTicket, verifyMediaTicket, ttlSeconds, DEFAULT_TTL_SECONDS };
