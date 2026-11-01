'use strict';

/**
 * CAPTCHA verification — supports Google reCAPTCHA v2/v3, hCaptcha and
 * Cloudflare Turnstile behind one interface, plus a self-hosted image
 * CAPTCHA that works with zero third-party credentials.
 *
 * Why a built-in provider matters: loginGuard already blocks brute force
 * after N failures, but that is *reactive*. A CAPTCHA on the login/register/
 * forgot-password forms cuts the automated traffic before it ever reaches the
 * credential check. Requiring a reCAPTCHA key just to run the app would mean
 * the feature is effectively off on every self-hosted install — so the default
 * provider is self-hosted and needs no signup.
 *
 * Configuration (all optional unless CAPTCHA_PROVIDER says otherwise):
 *   CAPTCHA_ENABLED=false        master switch, default off
 *   CAPTCHA_PROVIDER=image       image | recaptcha | hcaptcha | turnstile
 *   CAPTCHA_SITE_KEY / CAPTCHA_SECRET_KEY
 *   CAPTCHA_MIN_SCORE=0.5        recaptcha v3 / turnstile score floor
 *
 * NOTE ON PRIVACY: the self-hosted provider never contacts a third party, so
 * no user interaction data leaves the server. The hosted providers do — enable
 * them only if that trade-off is acceptable for your deployment.
 */

const crypto = require('crypto');

const PROVIDERS = new Set(['image', 'recaptcha', 'hcaptcha', 'turnstile']);

const VERIFY_URL = {
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
  hcaptcha: 'https://hcaptcha.com/siteverify',
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
};

const TOKEN_FIELD = {
  recaptcha: 'g-recaptcha-response',
  hcaptcha: 'h-captcha-response',
  turnstile: 'cf-turnstile-response',
};

function enabled() {
  return String(process.env.CAPTCHA_ENABLED || '').toLowerCase() === 'true';
}

function provider() {
  const p = String(process.env.CAPTCHA_PROVIDER || 'image').toLowerCase();
  return PROVIDERS.has(p) ? p : 'image';
}

/** The form field name the widget posts its token under. */
function tokenField() {
  return TOKEN_FIELD[provider()] || 'captchaToken';
}

/** Data the frontend needs to render the widget (`GET /api/captcha/config`). */
function publicConfig() {
  const p = provider();
  return {
    enabled: enabled(),
    provider: enabled() ? p : null,
    siteKey: enabled() && p !== 'image' ? (process.env.CAPTCHA_SITE_KEY || '') : null,
  };
}

/* ------------------------------------------------------------------ *
 * Self-hosted image CAPTCHA
 * ------------------------------------------------------------------ */

// id -> { answer, expiresAt }. In-process on purpose: see the caveat below.
const challenges = new Map();
const CHALLENGE_TTL_MS = 3 * 60 * 1000;

/**
 * CAVEAT (single-instance only): challenges live in this process's memory.
 * Behind more than one backend instance a challenge minted by instance A will
 * not be known to instance B, so verification fails. The fix is to back this
 * with Redis using the same pattern as services/redis.service.js; until then
 * leave CAPTCHA_PROVIDER=image only on single-instance deployments, or use one
 * of the hosted providers (stateless, verified over HTTP).
 */
function sweepExpired(now = Date.now()) {
  for (const [id, v] of challenges) {
    if (v.expiresAt <= now) challenges.delete(id);
  }
}

/** Creates a challenge. Returns an SVG data URL — no image files, no canvas dep. */
function createChallenge() {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const answer = String(a + b);
  const id = crypto.randomBytes(24).toString('base64url');

  sweepExpired();
  challenges.set(id, { answer, expiresAt: Date.now() + CHALLENGE_TTL_MS });

  return {
    id,
    // Rendered as vector text with a light warp; enough to stop a dumb script,
    // not enough to survive a determined OCR attack — see the note above on
    // when to prefer a hosted provider.
    svg: svgFor(`${a} + ${b} = ?`),
    expiresInSec: Math.floor(CHALLENGE_TTL_MS / 1000),
  };
}

function svgFor(text) {
  const w = 160;
  const h = 56;
  let noise = '';
  for (let i = 0; i < 5; i += 1) {
    const x1 = Math.floor(Math.random() * w);
    const y1 = Math.floor(Math.random() * h);
    const x2 = Math.floor(Math.random() * w);
    const y2 = Math.floor(Math.random() * h);
    noise += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#cbd5e1" stroke-width="1"/>`;
  }
  const rot = (Math.random() * 8 - 4).toFixed(2);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="#f8fafc"/>` +
    noise +
    `<text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" ` +
    `font-family="monospace" font-size="26" font-weight="700" fill="#334155" ` +
    `transform="rotate(${rot} 80 28)">${text}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/* ------------------------------------------------------------------ *
 * Verification
 * ------------------------------------------------------------------ */

function readToken(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const direct = payload.captchaToken || payload.captcha_token;
  if (direct) return String(direct);
  const f = tokenField();
  return payload[f] ? String(payload[f]) : null;
}

async function verifyHosted(token, remoteIp) {
  const secret = process.env.CAPTCHA_SECRET_KEY || '';
  if (!secret) return { ok: false, reason: 'CAPTCHA secret key is not configured' };

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.append('remoteip', remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(VERIFY_URL[provider()], {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: `CAPTCHA provider returned ${res.status}` };
    const data = await res.json();

    // hCaptcha/Turnstile use `success`; reCAPTCHA v3 adds a `score`.
    if (!data.success) return { ok: false, reason: 'CAPTCHA was not solved' };
    const min = Number(process.env.CAPTCHA_MIN_SCORE || 0.5);
    if (typeof data.score === 'number' && data.score < min) {
      return { ok: false, reason: 'CAPTCHA score too low' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `CAPTCHA verification failed: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

function verifyImage(token, payload) {
  const challengeId = payload && payload.captchaId ? String(payload.captchaId) : '';
  const entry = challengeId ? challenges.get(challengeId) : null;
  if (!entry) return { ok: false, reason: 'CAPTCHA challenge expired — request a new one' };

  // One shot per challenge: consume it whether or not the answer was right, so
  // a bot cannot grind answers against a single long-lived id.
  challenges.delete(challengeId);
  if (entry.expiresAt <= Date.now()) return { ok: false, reason: 'CAPTCHA challenge expired' };

  const given = String(token).trim();
  const expected = entry.answer;
  if (!given) return { ok: false, reason: 'CAPTCHA answer is required' };

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'CAPTCHA answer is incorrect' };
  }
  return { ok: true };
}

/**
 * Verifies a submitted CAPTCHA.
 * Returns `{ ok: true }` immediately when CAPTCHA is disabled, so callers can
 * use this unconditionally without branching on configuration.
 */
async function verify(payload, remoteIp) {
  if (!enabled()) return { ok: true, skipped: true };

  const token = readToken(payload);
  if (!token) return { ok: false, reason: 'CAPTCHA response is required' };

  const p = provider();
  if (p === 'image') return verifyImage(token, payload);
  return verifyHosted(token, remoteIp);
}

module.exports = {
  enabled,
  provider,
  publicConfig,
  createChallenge,
  verify,
  // test seam
  _challenges: challenges,
};
