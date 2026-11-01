'use strict';
/**
 * Small cache-aside helper over Redis.
 *
 * WHY THIS EXISTS
 * ---------------
 * Redis was already wired into the project (REDIS_URL) but used only for rate
 * limiting and SSE fan-out. Several read-heavy endpoints re-ran their queries on
 * every request even though the underlying data changes rarely.
 *
 * WHAT IS DELIBERATELY NOT CACHED
 * -------------------------------
 * Settings are NOT cached here. `settings.service.js` already keeps a 15-second
 * in-process TTL cache and refreshes it with `loadSettings(true)` inside
 * updateSettings(), so a Redis layer on top would add a hop and a second
 * stale-data window without removing a single query. I checked this before
 * adding anything — the assumption "every request hits the database" was wrong
 * for settings, and caching something that is already cached only adds risk.
 *
 * Anything a specific user owns (their submissions, attempts, notifications)
 * must not go through a shared cache without the user id in the key.
 *
 * WITHOUT REDIS
 * -------------
 * Every function is a no-op and `cached()` simply calls the producer, so the
 * single-instance deployment (the common case) behaves exactly as before.
 */
const { getRedisClient } = require('./redis.service');

const PREFIX = 'sodl:cache:';
const DEFAULT_TTL = 60; // seconds

// Cheap in-process observability: without it there is no way to tell whether a
// cache is earning its keep or just adding a network hop.
const stats = { hits: 0, misses: 0, errors: 0, writes: 0, invalidations: 0 };

const client = () => getRedisClient();

const fullKey = (key) => `${PREFIX}${key}`;

/** Read a cached value. Returns null on a miss, on error, or with Redis off. */
async function get(key) {
  const redis = client();
  if (!redis) return null;
  try {
    const raw = await redis.get(fullKey(key));
    if (raw == null) { stats.misses += 1; return null; }
    stats.hits += 1;
    return JSON.parse(raw);
  } catch (_) {
    stats.errors += 1;
    return null;                      // a broken cache must never break a request
  }
}

/** Write a value. `ttl` is seconds. */
async function set(key, value, ttl = DEFAULT_TTL) {
  const redis = client();
  if (!redis) return false;
  try {
    const seconds = Math.max(1, Math.floor(Number(ttl) || DEFAULT_TTL));
    await redis.set(fullKey(key), JSON.stringify(value), 'EX', seconds);
    stats.writes += 1;
    return true;
  } catch (_) {
    stats.errors += 1;
    return false;
  }
}

/** Drop one key. */
async function del(key) {
  const redis = client();
  if (!redis) return false;
  try {
    await redis.del(fullKey(key));
    stats.invalidations += 1;
    return true;
  } catch (_) {
    stats.errors += 1;
    return false;
  }
}

/**
 * Drop every key sharing a prefix — the safe way to invalidate a family
 * (languages, landing page drafts) without tracking each individual key.
 *
 * Uses SCAN rather than KEYS: KEYS blocks the whole Redis instance and is a
 * classic way to take production down on a large keyspace.
 */
async function delPrefix(prefix) {
  const redis = client();
  if (!redis) return 0;
  let removed = 0;
  try {
    let cursor = '0';
    do {
      // eslint-disable-next-line no-await-in-loop
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${fullKey(prefix)}*`, 'COUNT', 200);
      cursor = next;
      if (keys && keys.length) {
        // eslint-disable-next-line no-await-in-loop
        await redis.del(...keys);
        removed += keys.length;
      }
    } while (cursor !== '0');
    stats.invalidations += removed;
  } catch (_) {
    stats.errors += 1;
  }
  return removed;
}

/**
 * Cache-aside: return the cached value, or produce it, store it, and return it.
 *
 * `produce` runs on a miss only. If it throws, nothing is cached and the error
 * propagates — a cached failure would be much worse than a slow query.
 */
async function cached(key, ttl, produce) {
  if (!client()) return produce();
  const hit = await get(key);
  if (hit !== null) return hit;
  const value = await produce();
  // A false/null result is still a result; cache it so the query is not retried
  // on every request. Only `undefined` (a producer that returned nothing) is skipped.
  if (value !== undefined) await set(key, value, ttl);
  return value;
}

function snapshot() {
  const total = stats.hits + stats.misses;
  return {
    ...stats,
    hit_rate: total ? Math.round((stats.hits / total) * 1000) / 10 : 0,
    enabled: Boolean(client()),
  };
}

function _resetStats() {
  Object.keys(stats).forEach((k) => { stats[k] = 0; });
}

module.exports = {
  get, set, del, delPrefix, cached, snapshot, _resetStats,
  PREFIX, DEFAULT_TTL,
};
