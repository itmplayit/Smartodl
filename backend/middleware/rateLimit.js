'use strict';
/**
 * Rate limiting to protect auth, code execution and write endpoints.
 * Limits are configurable through environment variables so institutions can tune
 * them for shared campus NAT addresses (RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS)
 * or disable them entirely in local development (RATE_LIMIT_DISABLED=true).
 */
const rateLimit = require('express-rate-limit');
const { getRedisClient } = require('../services/redis.service');

const disabled = () => ['1', 'true', 'yes', 'on'].includes(String(process.env.RATE_LIMIT_DISABLED || '').toLowerCase());
const envMax = (name, fallback) => Number(process.env[name] || fallback);

const json = (message) => (req, res) => res.status(429).json({ success: false, error: message });

/** Shared defaults — generous enough for a whole campus behind one IP. */
const WINDOW_MS = envMax('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
const API_MAX = envMax('RATE_LIMIT_MAX', 5000);

// With REDIS_URL set, every limiter counts through Redis so several API
// replicas share one budget; without it the built-in memory store is used
// (correct for the usual single-instance deployment). The dependency is
// required lazily — a single-instance install never loads it.
let RedisStore = null;
const redisClient = getRedisClient();
if (redisClient) {
  try {
    const rlRedis = require('rate-limit-redis'); // eslint-disable-line global-require
    RedisStore = rlRedis.RedisStore || rlRedis.default || rlRedis;
  } catch (err) {
    console.warn('[ratelimit] REDIS_URL is set but rate-limit-redis is unavailable — falling back to memory store:', err.message);
  }
}
/**
 * Default budget key: the ACCOUNT when the caller is signed in, the IP when not.
 *
 * The built-in default is per-IP, which means a whole computer lab behind one
 * NAT address shares a single budget — the 20 submissions/minute cap is not 20
 * per student, it is 20 for everyone on that address, and one abusive account
 * can spend the entire lab's quota. Per-account keys also stop a single
 * attacker from hiding behind a large pool of addresses.
 *
 * Anonymous traffic must still be counted by IP: there is no account to key on
 * yet, and keying the login endpoint by anything the request carries would let
 * an attacker choose their own bucket.
 */
const accountKey = (req) => {
  const id = req.user && req.user.id;
  return id ? `user:${id}` : `ip:${req.ip}`;
};

const make = ({ prefix = 'api', ...opts }) => rateLimit({
  standardHeaders: true, legacyHeaders: false, skip: disabled,
  // Listed before ...opts so the proctoring and second-camera limiters keep
  // the explicit key generators they already pass.
  keyGenerator: accountKey,
  ...(redisClient && RedisStore
    ? { store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args), prefix: `sodl:rl:${prefix}:` }) }
    : {}),
  ...opts,
});

/**
 * Live-proctoring telemetry is high-frequency by design (snapshot frames,
 * signalling, pairing polls). Counting it against the per-IP API budget
 * makes a whole computer lab behind one NAT address exhaust the limit and
 * start failing ordinary exam calls. Those routes are exempted from the
 * global limiter below and get their own per-user/per-token budgets, which
 * also stops one abusive account from spending everyone else's quota.
 */
const isProctorTelemetry = (req) => {
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  return /^\/api\/quiz-attempts\/[^/]+\/(?:proctor|proctor-frame|proctor-signal|proctor-ice|second-camera\/status)$/.test(path)
    || (req.method === 'POST' && /^\/api\/proctor-recordings\/[^/]+\/(?:camera|screen)\/chunks\/\d+$/.test(path))
    || (req.method === 'POST' && /^\/api\/proctor\/second-camera\/[^/]+$/.test(path));
};
const userKey = (req) => `user:${(req.user && req.user.id) || 'anonymous'}`;
const secondCameraKey = (req) => `second:${String((req.params && req.params.token) || 'missing').slice(0, 96)}`;

const apiLimiter = make({
  windowMs: WINDOW_MS, max: API_MAX,
  skip: (req) => disabled() || isProctorTelemetry(req),
  handler: json('Too many requests from this IP. Please slow down.'),
});

const authLimiter = make({
  prefix: 'auth', windowMs: WINDOW_MS, max: envMax('AUTH_RATE_LIMIT_MAX', 100),
  handler: json('Too many login attempts. Please try again in a few minutes.'),
});

const executionLimiter = make({
  prefix: 'exec', windowMs: 60 * 1000, max: envMax('EXECUTION_RATE_LIMIT_MAX', 60),
  handler: json('Code execution limit reached — wait a moment before running more code.'),
});

const submitLimiter = make({
  prefix: 'submit', windowMs: 60 * 1000, max: envMax('SUBMIT_RATE_LIMIT_MAX', 20),
  handler: json('Submission limit reached. Take a breath and try again shortly.'),
});

const writeLimiter = make({
  prefix: 'write', windowMs: 60 * 1000, max: envMax('WRITE_RATE_LIMIT_MAX', 240),
  handler: json('Too many write requests. Please slow down.'),
});

/* Per-account budgets for the telemetry routes exempted above. Normal use
 * is far below each ceiling (snapshots ≈9/min, pairing polls ≈20/min), so
 * these only bite a looped or abusive client. */
const proctorEventLimiter = make({
  prefix: 'proctor-event', windowMs: 60 * 1000, max: envMax('PROCTOR_EVENT_RATE_LIMIT_MAX', 240), keyGenerator: userKey,
  handler: json('Too many proctoring reports. Please slow down.'),
});
const proctorFrameLimiter = make({
  prefix: 'proctor-frame', windowMs: 60 * 1000, max: envMax('PROCTOR_FRAME_RATE_LIMIT_MAX', 180), keyGenerator: userKey,
  handler: json('Too many live frames. Please slow down.'),
});
const proctorSignalLimiter = make({
  prefix: 'proctor-signal', windowMs: 60 * 1000, max: envMax('PROCTOR_SIGNAL_RATE_LIMIT_MAX', 1800), keyGenerator: userKey,
  handler: json('Too many signalling messages. Please slow down.'),
});
const proctorStatusLimiter = make({
  prefix: 'proctor-status', windowMs: 60 * 1000, max: envMax('PROCTOR_STATUS_RATE_LIMIT_MAX', 240), keyGenerator: userKey,
  handler: json('Too many status checks. Please slow down.'),
});
const secondCameraLimiter = make({
  prefix: 'second-camera', windowMs: 60 * 1000, max: envMax('SECOND_CAMERA_RATE_LIMIT_MAX', 90), keyGenerator: secondCameraKey,
  handler: json('Too many second-camera frames. Please slow down.'),
});

/** Public certificate verification — generous for humans, hostile to scanners
 *  enumerating certificate numbers / tokens. */
const certLimiter = make({
  prefix: 'cert', windowMs: WINDOW_MS, max: envMax('CERT_RATE_LIMIT_MAX', 120),
  handler: json('Too many verification attempts. Please try again later.'),
});

module.exports = {
  apiLimiter, authLimiter, executionLimiter, submitLimiter, writeLimiter, certLimiter,
  proctorEventLimiter, proctorFrameLimiter, proctorSignalLimiter, proctorStatusLimiter,
  secondCameraLimiter, isProctorTelemetry,
};
