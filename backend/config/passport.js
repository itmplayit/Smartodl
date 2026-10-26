'use strict';
/**
 * OAuth 2.0 social login (Google + GitHub).
 * If client credentials are not configured the routes respond with a helpful
 * message instead of crashing, so local development keeps working.
 */
const passport = require('passport');
const crypto = require('crypto');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const { q1, exec } = require('./db');
const { signAccess, signRefresh, setRefreshCookie } = require('../middleware/auth');
const { notify } = require('../services/notification.service');
const { readBool } = require('../services/settings.service');
const { ApiError } = require('../utils/helpers');

async function upsertOAuthUser({ provider, providerId, email, name, avatar, emailVerified = false }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedProviderId = String(providerId || '').trim();
  if (!normalizedProviderId || !normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw ApiError.badRequest('The provider did not return a usable account email');
  }

  // Provider identity is authoritative and must be resolved first. A single
  // `provider-id OR email LIMIT 1` query could return the wrong row when a
  // provider profile's email has changed and now belongs to someone else.
  let user = await q1(
    `SELECT u.*, r.slug AS role FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.provider = ? AND u.provider_id = ? LIMIT 1`,
    [provider, normalizedProviderId],
  );

  if (!user) {
    const emailUser = await q1(
      `SELECT u.*, r.slug AS role FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.email = ? LIMIT 1`,
      [normalizedEmail],
    );
    if (emailUser) {
      if (!emailVerified) {
        throw ApiError.forbidden('An account with this email already exists, but the provider did not verify the address. Sign in with your password instead.');
      }
      if (emailUser.provider_id && String(emailUser.provider_id) !== normalizedProviderId) {
        throw ApiError.conflict('This email is already linked to a different social account. Sign in with your password instead.');
      }
      user = emailUser;
    }
  }

  if (user) {
    if (!user.provider_id) {
      await exec(
        'UPDATE users SET provider = ?, provider_id = ?, avatar = COALESCE(?, avatar) WHERE id = ?',
        [provider, normalizedProviderId, avatar || null, user.id],
      );
    }
    await exec(
      `UPDATE users
          SET last_login_at = NOW(),
              email_verified = CASE WHEN ? AND email = ? THEN 1 ELSE email_verified END
        WHERE id = ?`,
      [emailVerified ? 1 : 0, normalizedEmail, user.id],
    );
    return q1(
      `SELECT u.*, r.slug AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [user.id],
    );
  }

  if (!(await readBool('registration_enabled', false)) || !(await readBool('student_registration', false))) {
    throw ApiError.forbidden('New account registration is disabled');
  }
  const studentRole = await q1('SELECT id FROM roles WHERE slug = ?', ['student']);
  if (!studentRole) throw new Error('Student role is not configured');

  let result;
  try {
    result = await exec(
      `INSERT INTO users (full_name, email, role_id, avatar, provider, provider_id, status, email_verified)
       VALUES (?,?,?,?,?,?,'active',?)`,
      [
        name || normalizedEmail.split('@')[0], normalizedEmail, studentRole.id,
        avatar || null, provider, normalizedProviderId, emailVerified ? 1 : 0,
      ],
    );
  } catch (e) {
    if (!e || (e.code !== 'ER_DUP_ENTRY' && e.errno !== 1062)) throw e;
    // A concurrent first login won the unique-provider/email race.
    const winner = await q1(
      `SELECT u.*, r.slug AS role FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.provider = ? AND u.provider_id = ? LIMIT 1`,
      [provider, normalizedProviderId],
    );
    if (winner) return winner;
    throw ApiError.conflict('An account with this email already exists');
  }

  await notify({
    userId: result.insertId, audience: 'user', type: 'system', link: '/student',
    title: 'Welcome to SmartODL 🎉',
    message: `Your account was created with ${provider === 'google' ? 'Google' : 'GitHub'}. Explore courses, quizzes and the coding arena!`,
  });
  return q1(
    `SELECT u.*, r.slug AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [result.insertId],
  );
}

const OAUTH_STATE_COOKIE = 'smartodl_oauth_state';

function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
  };
}

/** Create and persist the CSRF state for one provider login attempt. */
function beginOAuthState(res, provider) {
  const state = crypto.randomBytes(32).toString('hex');
  res.cookie(OAUTH_STATE_COOKIE, `${provider}.${state}`, {
    ...oauthStateCookieOptions(), maxAge: 10 * 60 * 1000,
  });
  return state;
}

/** Constant-time state check; state is single-use whether it matches or not. */
function verifyOAuthState(req, res, provider) {
  const stored = String((req.cookies && req.cookies[OAUTH_STATE_COOKIE]) || '');
  res.clearCookie(OAUTH_STATE_COOKIE, oauthStateCookieOptions());
  const presented = String((req.query && req.query.state) || '');
  const prefix = `${provider}.`;
  if (!stored.startsWith(prefix) || !presented) return false;
  const expected = Buffer.from(stored.slice(prefix.length));
  const actual = Buffer.from(presented);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function issueTokensAndRedirect(req, res, user) {
  const client = require('../utils/clientUrl').clientBase();
  if (user.status === 'suspended') return res.redirect(`${client}/login?error=account_suspended`);
  if (user.status === 'pending') return res.redirect(`${client}/login?error=account_pending`);
  const access = signAccess({ ...user, role: user.role });
  const refresh = signRefresh(user);
  const refreshDigest = crypto.createHash('sha256').update(refresh).digest('hex');
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await exec(
    'INSERT INTO user_sessions (user_id, refresh_token, user_agent, ip_address, expires_at) VALUES (?,?,?,?,?)',
    [user.id, refreshDigest, (req.headers['user-agent'] || '').slice(0, 250), req.ip, expires],
  );
  // Refresh token -> httpOnly cookie only. The short-lived access token
  // travels in the URL fragment (never sent to servers or proxy logs).
  setRefreshCookie(res, refresh);
  const params = new URLSearchParams({ access_token: access });
  res.redirect(`${client}/auth/callback#${params.toString()}`);
}

function configurePassport() {
  const hasGoogle = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const hasGithub = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

  if (hasGoogle) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback',
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails && profile.emails[0] && profile.emails[0].value;
        const avatar = profile.photos && profile.photos[0] && profile.photos[0].value;
        const emailVerified = !!(profile._json && profile._json.email_verified);
        const user = await upsertOAuthUser({ provider: 'google', providerId: profile.id, email, name: profile.displayName, avatar, emailVerified });
        done(null, user);
      } catch (err) { if (err && err.isApiError) done(null, false, { message: err.message }); else done(err); }
    }));
  }

  if (hasGithub) {
    passport.use(new GitHubStrategy({
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: process.env.GITHUB_CALLBACK_URL || 'http://localhost:5000/api/auth/github/callback',
      scope: ['user:email'],
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        let email = profile.emails && profile.emails[0] && profile.emails[0].value;
        if (!email) email = `${profile.username}@users.noreply.github.com`;
        const emailVerified = !!(profile.emails && profile.emails[0] && profile.emails[0].verified);
        const user = await upsertOAuthUser({
          provider: 'github', providerId: profile.id, email,
          name: profile.displayName || profile.username,
          avatar: profile.photos && profile.photos[0] && profile.photos[0].value,
          emailVerified,
        });
        done(null, user);
      } catch (err) { if (err && err.isApiError) done(null, false, { message: err.message }); else done(err); }
    }));
  }

  return { hasGoogle, hasGithub };
}

/**
 * Is a provider's strategy actually registered? The callback routes need this:
 * passport.authenticate('google') throws `Unknown authentication strategy` when
 * the credentials were never configured, and that raw Error surfaced to the
 * browser as a blank 500 "Service temporarily unavailable".
 */
function strategyReady(name) {
  return !!(passport._strategies && passport._strategies[name]);
}

module.exports = {
  configurePassport, upsertOAuthUser, issueTokensAndRedirect, passport, strategyReady, beginOAuthState, verifyOAuthState,
};
