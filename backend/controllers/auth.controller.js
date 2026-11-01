'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { q, q1, exec, tx } = require('../config/db');
const { ApiError, asyncHandler, ok, created, randomToken } = require('../utils/helpers');
const { clientBase: resolveClientBase } = require('../utils/clientUrl');
const { signAccess, signRefresh, findUserWithRole, setRefreshCookie, clearRefreshCookie, readRefreshToken } = require('../middleware/auth');
const { deviceLabel } = require('../utils/deviceLabel');
const { notify } = require('../services/notification.service');
const { readBool } = require('../services/settings.service');
const { sendMail } = require('../services/mail.service');
const loginGuard = require('../services/loginGuard.service');

const tokenDigest = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function publicUser(user) {
  if (!user) return user;
  const clean = { ...user };
  delete clean.password_changed_at;
  return clean;
}

function assertStrongPassword(password, label = 'Password') {
  // Policy: minimum 10 characters, while preserving bcrypt's 72-byte ceiling.
  if (typeof password !== 'string' || password.length < 10 || Buffer.byteLength(password, 'utf8') > 72) {
    throw ApiError.badRequest(`${label} must be at least 10 characters long (maximum 72 bytes)`);
  }
}

/** Update a password hash and stamp password_changed_at (tolerant of old schemas). */
async function storeNewPassword(userId, hash, extraClears = '') {
  try {
    await exec(`UPDATE users SET password_hash = ?, password_changed_at = NOW()${extraClears} WHERE id = ?`, [hash, userId]);
  } catch (e) {
    if (!e || e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    await exec(`UPDATE users SET password_hash = ?${extraClears} WHERE id = ?`, [hash, userId]);
  }
}

async function persistRefresh(user, req, token) {
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await exec(
    `INSERT INTO user_sessions (user_id, refresh_token, user_agent, ip_address, expires_at) VALUES (?,?,?,?,?)`,
    [user.id, tokenDigest(token), (req.headers['user-agent'] || '').slice(0, 250), req.ip, expires],
  );
}

/** POST /api/auth/register */
const register = asyncHandler(async (req, res) => {
  const { password, confirm_password, role = 'student' } = req.body;
  const fullName = String(req.body.full_name || '').trim().replace(/\s+/g, ' ');
  const email = String(req.body.email || '').trim().toLowerCase();
  const college = String(req.body.college || '').trim().slice(0, 160) || null;
  if (fullName.length < 2 || fullName.length > 120) throw ApiError.badRequest('Full name must be between 2 and 120 characters');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) throw ApiError.badRequest('A valid email address is required');
  assertStrongPassword(password);
  if (confirm_password !== undefined && password !== confirm_password) throw ApiError.badRequest('Passwords do not match');
  if (!['student', 'developer'].includes(role)) throw ApiError.badRequest('Role must be student or developer');

  if (!(await readBool('registration_enabled', false))) throw ApiError.forbidden('New registrations are currently disabled by the administrator');
  if (role === 'student' && !(await readBool('student_registration', false))) throw ApiError.forbidden('Student registration is disabled');
  if (role === 'developer' && !(await readBool('developer_registration', false))) throw ApiError.forbidden('Developer registration is disabled');

  const exists = await q1('SELECT id FROM users WHERE email = ?', [email]);
  if (exists) throw ApiError.conflict('An account with this email already exists');
  const roleRow = await q1('SELECT id FROM roles WHERE slug = ?', [role]);
  if (!roleRow) throw new ApiError(503, 'Account roles are not configured');

  const hash = await bcrypt.hash(password, 12);
  const status = role === 'developer' ? 'pending' : 'active';
  let result;
  try {
    result = await exec(
      `INSERT INTO users (full_name, email, password_hash, role_id, college, status, email_verified)
       VALUES (?,?,?,?,?,?,0)`,
      [fullName, email, hash, roleRow.id, college, status],
    );
  } catch (e) {
    // The SELECT above cannot make this safe on its own: two requests for the
    // same address (a double-clicked button, a retried request, two tabs) both
    // pass the check and the second one hits uq_users_email. Without this the
    // student saw a 500 "Service temporarily unavailable" instead of being
    // told the account already exists.
    if (e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062)) {
      throw ApiError.conflict('An account with this email already exists');
    }
    throw e;
  }

  await notify({
    userId: result.insertId, audience: 'user', type: 'system', link: role === 'developer' ? '/developer' : '/student',
    title: 'Welcome to SmartODL 🎉',
    message: role === 'developer'
      ? 'Your developer account is created and awaiting admin approval. You will be notified once permissions are granted.'
      : 'Your student account is ready. Start with a course, attempt a quiz or jump into the coding arena!',
  });
  if (role === 'developer') {
    await notify({
      audience: 'admin', type: 'system', link: '/admin/users',
      title: 'New developer registration',
      message: `${fullName} (${email}) registered as a developer and needs permission approval.`,
    });
  }

  const user = await findUserWithRole(result.insertId);
  // A pending (unapproved developer) account must not receive a usable
  // session: approval happens first, login afterwards.
  if (status === 'pending') {
    return created(res, { user: publicUser(user), requires_approval: true });
  }
  const access_token = signAccess(user);
  const refresh_token = signRefresh(user);
  await persistRefresh(user, req, refresh_token);
  setRefreshCookie(res, refresh_token);
  created(res, { user: publicUser(user), access_token, requires_approval: false });
});

/** POST /api/auth/login */
const login = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password || email.length > 160 || Buffer.byteLength(password, 'utf8') > 72) throw ApiError.badRequest('Email and password are required');

  // Per-account backoff (services/loginGuard.service.js). The IP limiter stays
  // generous for campus NAT; this is what actually stops password guessing.
  const guard = loginGuard.check(email, req.ip);
  if (guard.blocked) {
    const mins = Math.ceil(guard.retryAfterSeconds / 60);
    throw ApiError.tooMany(`Too many failed sign-in attempts for this account. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.`);
  }

  const row = await q1(
    `SELECT u.*, r.slug AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?`,
    [email],
  );
  // One message builder for both cases: an unknown email must not get a
  // different answer than a wrong password, otherwise the screen becomes an
  // account-enumeration oracle ("this email exists but the password is wrong").
  const badCredentials = (state) => ApiError.unauthorized(state.blocked
    ? `Too many failed sign-in attempts. This account is paused for about ${Math.ceil(state.retryAfterSeconds / 60)} minute(s).`
    : `Invalid email or password. ${state.failsLeft} attempt${state.failsLeft === 1 ? '' : 's'} left before the account pauses.`);

  if (!row || !row.password_hash) throw badCredentials(loginGuard.fail(email, req.ip));
  if (!(await bcrypt.compare(password, row.password_hash))) throw badCredentials(loginGuard.fail(email, req.ip));
  loginGuard.reset(email, req.ip);
  if (row.status === 'suspended') throw ApiError.forbidden('Your account has been suspended. Please contact the administrator.');
  if (row.status === 'pending') throw ApiError.forbidden('Your account is awaiting admin approval. You will be able to sign in once it is approved.');

  await exec('UPDATE users SET last_login_at = NOW() WHERE id = ?', [row.id]);
  const user = await findUserWithRole(row.id);
  const access_token = signAccess(user);
  const refresh_token = signRefresh(user);
  await persistRefresh(user, req, refresh_token);
  setRefreshCookie(res, refresh_token);
  ok(res, { user: publicUser(user), access_token });
});

/** POST /api/auth/refresh */
const refresh = asyncHandler(async (req, res) => {
  const token = readRefreshToken(req);
  if (!token) throw ApiError.badRequest('refresh token is required');
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }); }
  catch (e) { throw ApiError.unauthorized('Invalid or expired refresh token'); }
  if (!payload || payload.type !== 'refresh' || !payload.id) {
    throw ApiError.unauthorized('Invalid refresh token');
  }

  const rawUser = await findUserWithRole(payload.id);
  if (!rawUser || rawUser.status === 'suspended' || rawUser.status === 'pending') {
    throw ApiError.unauthorized('Account is unavailable');
  }
  if (rawUser.password_changed_at && payload.iat
      && payload.iat * 1000 < new Date(rawUser.password_changed_at).getTime() - 1000) {
    throw ApiError.unauthorized('Your password was changed — please log in again');
  }
  const user = publicUser(rawUser);

  const oldDigest = tokenDigest(token);
  const refresh_token = signRefresh(user);
  const newDigest = tokenDigest(refresh_token);
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  let outcome;

  try {
    // Lock the session row while rotating. The immediately previous token is
    // accepted only for a 15-second grace window (two browser requests can
    // race one cookie rotation); replaying it after that is treated as token
    // theft and revokes the session. Unique-digest storage means the raw
    // 30-day credential never appears in the database.
    outcome = await tx(async (conn) => {
      const [rows] = await conn.execute(
        `SELECT id, user_id, refresh_token, previous_refresh_token, refresh_rotated_at,
                revoked, expires_at
           FROM user_sessions
          WHERE refresh_token = ? OR previous_refresh_token = ?
          LIMIT 1 FOR UPDATE`,
        [oldDigest, oldDigest],
      );
      const session = rows && rows[0];
      if (!session || Number(session.user_id) !== Number(payload.id)
          || Number(session.revoked) !== 0 || new Date(session.expires_at).getTime() <= Date.now()) {
        return { ok: false };
      }
      const isPrevious = session.previous_refresh_token === oldDigest
        && session.refresh_token !== oldDigest;
      if (isPrevious) {
        const rotatedAt = session.refresh_rotated_at
          ? new Date(session.refresh_rotated_at).getTime() : NaN;
        if (!Number.isFinite(rotatedAt) || Date.now() - rotatedAt > 15000) {
          await conn.execute(
            'UPDATE user_sessions SET revoked = 1 WHERE id = ?',
            [session.id],
          );
          return { ok: false, reuse: true };
        }
      }
      const [result] = await conn.execute(
        `UPDATE user_sessions
            SET previous_refresh_token = refresh_token,
                refresh_token = ?, refresh_rotated_at = NOW(), expires_at = ?
          WHERE id = ? AND revoked = 0`,
        [newDigest, expires, session.id],
      );
      return { ok: Number(result.affectedRows) === 1 };
    });
  } catch (e) {
    if (!e || e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    // A not-yet-migrated database has no previous-token columns. Preserve the
    // compare-and-swap property against competing rotations until migrate runs.
    const result = await exec(
      `UPDATE user_sessions SET refresh_token = ?, expires_at = ?
        WHERE refresh_token = ? AND user_id = ? AND revoked = 0 AND expires_at > NOW()`,
      [newDigest, expires, oldDigest, payload.id],
    );
    outcome = { ok: Number(result.affectedRows) === 1 };
  }

  if (!outcome || !outcome.ok) {
    throw ApiError.unauthorized(outcome && outcome.reuse
      ? 'Session was revoked because an old refresh token was reused. Please log in again.'
      : 'Session not found or revoked');
  }
  setRefreshCookie(res, refresh_token);
  ok(res, { user, access_token: signAccess(user) });
});

/** POST /api/auth/logout */
const logout = asyncHandler(async (req, res) => {
  // Default: sign out THIS device only. { all_devices: true } revokes every
  // session (previously every logout silently signed the user out everywhere).
  const token = readRefreshToken(req);
  if (req.body && req.body.all_devices === true && req.user) {
    await exec('UPDATE user_sessions SET revoked = 1 WHERE user_id = ?', [req.user.id]);
  } else if (token) {
    await exec('UPDATE user_sessions SET revoked = 1 WHERE refresh_token = ?', [tokenDigest(token)]);
  }
  clearRefreshCookie(res);
  ok(res, { logged_out: true });
});

/** GET /api/auth/me */
const me = asyncHandler(async (req, res) => ok(res, req.user));

/**
 * The reset token is included in the HTTP response only when DEV_SHOW_RESET_LINK
 * is explicitly set to 'true' AND the build is not production. It is disabled by default because,
 * once this flag is enabled, a password can be reset without access to email.
 */
function devResetLinkEnabled() {
  if (process.env.NODE_ENV === 'production') return false;
  return String(process.env.DEV_SHOW_RESET_LINK || '').trim().toLowerCase() === 'true';
}

/** POST /api/auth/forgot-password */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await q1('SELECT id, full_name, email FROM users WHERE email = ?', [String(email || '').toLowerCase()]);
  // Always answer identically to avoid account enumeration.
  const generic = 'If that email exists, a reset link has been sent.';
  if (!user) return ok(res, { message: generic });

  const clientBase = resolveClientBase();
  const token = randomToken(24);
  await exec('UPDATE users SET reset_token = ?, reset_token_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?', [tokenDigest(token), user.id]);
  const link = `${clientBase}/reset-password?token=${token}`;

  if (process.env.MAIL_MODE !== 'smtp') {
    // SMTP is disabled, so this link will never be delivered by email. For development, write it
    // to the server console. Only someone who already has server access can read that console,
    // so this is not an additional disclosure.
    // Log WHAT is misconfigured — never the token.
    //
    // A reset link is a full account-takeover credential. Writing it to the
    // console used to be justified with "only someone with server access can
    // read it", but server logs routinely flow to files, journald, Docker log
    // drivers and centralised aggregators — all of which are readable by far
    // more people and processes than the database. Anyone with log access could
    // take over any account, including the owner's, without touching the DB.
    console.warn(
      `[auth] MAIL_MODE=${process.env.MAIL_MODE || 'disabled'} — a password reset was requested for `
      + `${user.email} but no mail was sent. Configure SMTP (MAIL_MODE=smtp) so users receive reset `
      + 'links by email, or set DEV_SHOW_RESET_LINK=true to return the link in the API response '
      + '(rejected in production). The token itself is deliberately NOT logged.',
    );

    // Send the token in the HTTP response ONLY when the operator has explicitly requested it.
    // Previously this depended only on NODE_ENV, which was dangerous:
    // most self-hosted installations run in development mode, so if the app is exposed through
    // a tunnel or public IP, anyone could request another user's reset token without logging in —
    // including an owner-account takeover in only a few requests.
    if (devResetLinkEnabled()) {
      return ok(res, { message: generic, dev_reset_link: link });
    }
    return ok(res, { message: generic });
  }

  await sendMail({
    to: user.email, subject: 'SmartODL password reset',
    text: `Hi ${user.full_name},\n\nReset your SmartODL password using this link (valid for 1 hour):\n${link}\n\nIf you did not request this, ignore this email.`,
  });
  ok(res, { message: generic });
});

/** POST /api/auth/reset-password */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password, confirm_password } = req.body;
  if (typeof token !== 'string' || !token || token.length > 256 || !password) throw ApiError.badRequest('token and password are required');
  assertStrongPassword(password);
  if (confirm_password !== undefined && password !== confirm_password) throw ApiError.badRequest('Passwords do not match');
  // Suspended accounts must not be able to take over a fresh session through
  // the reset flow; the answer stays identical to "expired" so nothing about
  // the account's existence or status is revealed.
  const user = await q1(
    "SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > NOW() AND status <> 'suspended'",
    [tokenDigest(token)],
  );
  if (!user) throw ApiError.badRequest('Reset link is invalid or has expired');
  const hash = await bcrypt.hash(password, 12);
  await storeNewPassword(user.id, hash, ', reset_token = NULL, reset_token_expires = NULL');
  await exec('UPDATE user_sessions SET revoked = 1 WHERE user_id = ?', [user.id]);
  ok(res, { message: 'Password updated. Please log in with your new password.' });
});

/** POST /api/auth/change-password */
const changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (typeof current_password !== 'string' || Buffer.byteLength(current_password, 'utf8') > 72) throw ApiError.badRequest('Current password is invalid');
  const row = await q1('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (row.password_hash && !(await bcrypt.compare(current_password || '', row.password_hash))) {
    throw ApiError.badRequest('Current password is incorrect');
  }
  assertStrongPassword(new_password, 'New password');
  await storeNewPassword(req.user.id, await bcrypt.hash(new_password, 12));
  clearRefreshCookie(res);
  await exec('UPDATE user_sessions SET revoked = 1 WHERE user_id = ?', [req.user.id]);
  ok(res, { message: 'Password changed successfully. Sign in again on your other devices.' });
});

/** GET /api/auth/providers — which social logins the admin has enabled */
const providers = asyncHandler(async (req, res) => ok(res, {
  google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) && await readBool('google_login_enabled', false),
  github: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) && await readBool('github_login_enabled', false),
  registration_enabled: await readBool('registration_enabled', false),
  student_registration: await readBool('student_registration', false),
  developer_registration: await readBool('developer_registration', false),
}));


/**
 * GET /api/auth/sessions
 *
 * Lists the caller's *live* sessions so they can see every device that is
 * currently signed in and revoke the ones they do not recognise. Until now the
 * app stored `user_agent` + `ip_address` per session but never surfaced them,
 * so a stolen-but-valid refresh token was invisible to the user.
 *
 * Notes:
 *  - Expired/revoked rows are purged first; without that the table grows
 *    forever and the list fills up with sessions the user cannot use.
 *  - `refresh_token` is read to work out which row is the *current* one, then
 *    dropped — the token digest is never sent to the client.
 */
const mySessions = asyncHandler(async (req, res) => {
  try {
    await exec('DELETE FROM user_sessions WHERE revoked = 1 OR expires_at < NOW()');
  } catch (_err) {
    /* best-effort housekeeping: never fail the read because of a sweep */
  }

  const rows = await q(
    `SELECT id, refresh_token, user_agent, ip_address, created_at, expires_at, refresh_rotated_at
       FROM user_sessions
      WHERE user_id = ? AND revoked = 0 AND expires_at > NOW()
      ORDER BY created_at DESC`,
    [req.user.id],
  );

  const token = readRefreshToken(req);
  const currentDigest = token ? tokenDigest(token) : null;

  ok(res, {
    sessions: rows.map((r) => ({
      id: r.id,
      device: deviceLabel(r.user_agent),
      ip: r.ip_address,
      created_at: r.created_at,
      // Rotation only moves on refresh, so this is the best "last seen" we have.
      last_used_at: r.refresh_rotated_at || r.created_at,
      expires_at: r.expires_at,
      current: !!currentDigest && r.refresh_token === currentDigest,
    })),
  });
});

/**
 * DELETE /api/auth/sessions/:id
 *
 * Revokes exactly one of the caller's sessions. Scoped by `user_id` so a
 * guessed id can only ever hit the caller's own rows. `logoutAll` already
 * covers the "nuke everything" case.
 */
const revokeSession = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw ApiError.badRequest('Invalid session id');

  const token = readRefreshToken(req);
  const currentDigest = token ? tokenDigest(token) : null;
  const currentRows = currentDigest
    ? await q('SELECT id FROM user_sessions WHERE refresh_token = ? AND user_id = ? AND revoked = 0', [currentDigest, req.user.id])
    : [];
  const currentId = currentRows.length ? currentRows[0].id : null;

  const result = await exec(
    'UPDATE user_sessions SET revoked = 1 WHERE id = ? AND user_id = ? AND revoked = 0',
    [id, req.user.id],
  );
  if (!Number(result && result.affectedRows)) throw ApiError.notFound('Session not found');

  // If the user just killed the session they are sitting on, clear their cookie
  // too — otherwise the browser keeps presenting a token that no longer works.
  if (currentId !== null && Number(currentId) === id) clearRefreshCookie(res);

  ok(res, { revoked: true });
});

module.exports = { register, login, refresh, logout, me, forgotPassword, resetPassword, changePassword, providers, mySessions, revokeSession };
