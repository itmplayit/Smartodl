'use strict';
/**
 * Per-account login backoff.
 *
 * The IP limiter (middleware/rateLimit.js) has to stay generous — a campus lab
 * sits behind one NAT address, so a tight per-IP ceiling locks out a whole
 * classroom. Brute force therefore has to be stopped per ACCOUNT, which is what
 * this module does:
 *
 *   • key = email + IP. Keying on the email alone would let anyone lock a
 *     victim out of their own account (a trivial DoS), keying on the IP alone
 *     punishes the whole lab.
 *   • 8 failed attempts inside 15 minutes → that email+IP pair is blocked for
 *     5 minutes with a 429 that says how long is left.
 *   • a successful login clears the counter.
 *
 * Storage is in-process on purpose: SmartODL normally runs as one API process,
 * so this needs no Redis and no schema change. With several API replicas each
 * replica keeps its own budget — weaker, never wrong: a legitimate user is
 * never locked out by another replica's counter.
 *
 * Pure functions (no express, no DB) so they can be unit-tested directly.
 */

const WINDOW_MS = Number(process.env.LOGIN_FAIL_WINDOW_MS || 15 * 60 * 1000);
const BLOCK_MS = Number(process.env.LOGIN_BLOCK_MS || 5 * 60 * 1000);
const MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS || 8);

/** email+ip → { fails, first, until } */
const buckets = new Map();
let lastSweep = 0;

const keyOf = (email, ip) => `${String(email || '').trim().toLowerCase()}|${String(ip || 'unknown')}`;

/** Drop expired buckets so a long-running server does not grow forever. */
function sweep(now) {
  if (now - lastSweep < 60 * 1000) return;
  lastSweep = now;
  for (const [k, v] of buckets) {
    const dead = (!v.until || v.until <= now) && now - v.first > WINDOW_MS;
    if (dead) buckets.delete(k);
  }
}

/**
 * @returns {{blocked: boolean, retryAfterSeconds: number}}
 */
function check(email, ip, now = Date.now()) {
  sweep(now);
  const b = buckets.get(keyOf(email, ip));
  if (!b || !b.until || b.until <= now) return { blocked: false, retryAfterSeconds: 0 };
  return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((b.until - now) / 1000)) };
}

/**
 * Record one failed password check.
 * @returns {{blocked: boolean, retryAfterSeconds: number, failsLeft: number}}
 */
function fail(email, ip, now = Date.now()) {
  const key = keyOf(email, ip);
  const b = buckets.get(key) || { fails: 0, first: now, until: 0 };
  if (now - b.first > WINDOW_MS) { b.fails = 0; b.first = now; b.until = 0; }
  b.fails += 1;
  if (b.fails >= MAX_FAILS) b.until = now + BLOCK_MS;
  buckets.set(key, b);
  return {
    blocked: b.until > now,
    retryAfterSeconds: b.until > now ? Math.ceil((b.until - now) / 1000) : 0,
    failsLeft: Math.max(0, MAX_FAILS - b.fails),
  };
}

/** A good password wipes the slate for that email+IP. */
function reset(email, ip) {
  buckets.delete(keyOf(email, ip));
}

/** Test hook. */
function _clear() { buckets.clear(); lastSweep = 0; }

module.exports = { check, fail, reset, _clear, MAX_FAILS, WINDOW_MS, BLOCK_MS, keyOf };
