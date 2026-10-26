'use strict';
/**
 * Authentication + role/permission based authorization.
 *  - JWT access tokens (Bearer header) signed with JWT_ACCESS_SECRET
 *  - roles: owner | admin | developer | student
 *  - fine-grained developer permissions stored in user_permissions
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { q, q1 } = require('../config/db');
const { ApiError } = require('../utils/helpers');

const ROLE = { OWNER: 'owner', ADMIN: 'admin', DEVELOPER: 'developer', STUDENT: 'student' };
const isAdminRole = (role) => role === ROLE.OWNER || role === ROLE.ADMIN;

function signAccess(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.full_name },
    process.env.JWT_ACCESS_SECRET,
    // Short-lived by default (matches .env.example). The old '1d' fallback
    // silently issued day-long access tokens whenever the env was incomplete.
    { algorithm: 'HS256', expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' },
  );
}

/* ------------------- refresh-token cookie transport -------------------
 * The refresh token is a 30-day credential, so the web client never sees it
 * in JavaScript: it travels in an httpOnly cookie scoped to /api/auth.
 * SameSite=Lax + the CORS allow-list keep cross-site abuse out; the JSON
 * content-type requirement on POSTs forces a preflight for cross-origin
 * calls. A body-carried token is still accepted for non-browser clients. */
const REFRESH_COOKIE = 'smartodl_refresh';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
  };
}

function setRefreshCookie(res, token) {
  if (!res || !token) return;
  res.cookie(REFRESH_COOKIE, token, { ...refreshCookieOptions(), maxAge: 30 * 24 * 3600 * 1000 });
}

function clearRefreshCookie(res) {
  if (!res) return;
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}

function readRefreshToken(req) {
  return (req.cookies && req.cookies[REFRESH_COOKIE])
    || (req.body && req.body.refresh_token)
    || null;
}

function signRefresh(user) {
  return jwt.sign(
    // jti makes every refresh token unique — without it two logins of the same
    // user inside the same second produce an identical JWT and the second INSERT
    // into user_sessions violates the UNIQUE key uq_session_token (login crash).
    { id: user.id, email: user.email, type: 'refresh', jti: crypto.randomBytes(8).toString('hex') },
    process.env.JWT_REFRESH_SECRET,
    { algorithm: 'HS256', expiresIn: process.env.JWT_REFRESH_EXPIRES || '30d' },
  );
}

async function findUserWithRole(id) {
  const cols = `u.id, u.full_name, u.email, u.avatar, u.college, u.bio, u.status, u.points,
            u.problems_solved, u.quizzes_completed, u.courses_completed, u.provider, u.role_id,
            r.slug AS role, r.name AS role_name, u.created_at`;
  try {
    return await q1(
      `SELECT ${cols.replace('u.created_at', 'u.password_changed_at, u.created_at')}
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?`, [id],
    );
  } catch (e) {
    // Pre-migration database (SMARTODL_SKIP_MIGRATIONS + old schema): auth
    // must degrade, not die. Password-change token invalidation simply
    // stays inactive until the column exists.
    if (e && e.code === 'ER_BAD_FIELD_ERROR') {
      return q1(
        `SELECT ${cols}
           FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.id = ?`, [id],
      );
    }
    throw e;
  }
}

/**
 * A password change/reset must kill outstanding access tokens, not just
 * refresh sessions — otherwise a stolen access token survives the very
 * action the victim took to lock the attacker out. 1s tolerance covers
 * the iat (seconds) vs stored timestamp (datetime) granularity mismatch.
 */
function tokenIssuedBeforePasswordChange(payload, user) {
  if (!payload || !payload.iat || !user || !user.password_changed_at) return false;
  return payload.iat * 1000 < new Date(user.password_changed_at).getTime() - 1000;
}

async function attachPermissionCache(user) {
  if (!user) return user;
  if (isAdminRole(user.role)) { user.permissions = ['*']; return user; }
  if (user.role !== ROLE.DEVELOPER) { user.permissions = []; return user; }
  const rows = await q(
    `SELECT p.code, up.allowed FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id
      WHERE up.user_id = ?`, [user.id],
  );
  user.permissions = rows.filter((r) => r.allowed).map((r) => r.code);
  return user;
}

/** Require a valid access token. */
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    // Header-only by design. There is no access-token cookie flow in the web
    // app; accepting one would add a CSRF-shaped credential path for nothing.
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthorized('Missing authentication token');
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    } catch (e) {
      throw ApiError.unauthorized(e.name === 'TokenExpiredError' ? 'Session expired, please log in again' : 'Invalid authentication token');
    }
    const user0 = await findUserWithRole(payload.id);
    if (!user0) throw ApiError.unauthorized('Account no longer exists');
    if (tokenIssuedBeforePasswordChange(payload, user0)) {
      throw ApiError.unauthorized('Your password was changed — please log in again');
    }
    const user = await attachPermissionCache(user0);
    delete user.password_changed_at; // internal, the web app doesn't need it
    if (user.status === 'suspended') throw ApiError.forbidden('Your account has been suspended. Contact the administrator.');
    if (user.status === 'pending') throw ApiError.forbidden('Your account is awaiting admin approval.');
    req.user = user;
    next();
  } catch (err) { next(err); }
};

/** Attach the user when a token is present, but never block the request. */
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return next();
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    const user0 = await findUserWithRole(payload.id);
    if (user0 && tokenIssuedBeforePasswordChange(payload, user0)) return next();
    const user = await attachPermissionCache(user0);
    if (user) delete user.password_changed_at;
    if (user && user.status !== 'suspended' && user.status !== 'pending') req.user = user;
  } catch (_) { /* ignore invalid tokens on public routes */ }
  next();
};

/** Restrict a route to one of the given roles. */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  const allowed = roles.includes(req.user.role) || (req.user.role === ROLE.OWNER && roles.includes(ROLE.ADMIN));
  if (!allowed) return next(ApiError.forbidden(`This action requires one of: ${roles.join(', ')}`));
  next();
};

/** Restrict a route to developers holding a specific permission (admins always pass). */
const requirePermission = (code) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (isAdminRole(req.user.role)) return next();
  if (req.user.role !== ROLE.DEVELOPER) return next(ApiError.forbidden('Developer access required'));
  if (!(req.user.permissions || []).includes(code)) {
    return next(ApiError.forbidden(`Your account does not have the "${code}" permission. Ask an admin to enable it.`));
  }
  next();
};

module.exports = { ROLE, isAdminRole, signAccess, signRefresh, authenticate, optionalAuth, authorize, requirePermission, findUserWithRole, REFRESH_COOKIE, setRefreshCookie, clearRefreshCookie, readRefreshToken };
