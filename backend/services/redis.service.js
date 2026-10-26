'use strict';
/**
 * Optional shared Redis — OFF unless REDIS_URL is set.
 *
 * A single API instance (the common SmartODL deployment: one VPS/PC) needs
 * none of this; in-memory state is simpler and has no moving parts. Redis
 * exists for the day someone runs 2+ API replicas: rate limiting and the SSE
 * event hub then share state through Redis instead of each process having
 * its own counters/audience. (The live-proctor frame relay is deliberately
 * still per-process — pin proctoring sessions to one instance, e.g. via
 * sticky sessions, or keep a single API instance for live exams.)
 *
 * The driver is required lazily so installs without Redis never load it.
 */
let client = null;
let warned = false;

const redisEnabled = () => Boolean(String(process.env.REDIS_URL || '').trim());

function getRedisClient() {
  if (!redisEnabled()) return null;
  if (client) return client;
  // eslint-disable-next-line global-require
  const Redis = require('ioredis');
  client = new Redis(process.env.REDIS_URL, {
    // Rate limiting sits in the request path: fail fast rather than queueing
    // commands forever behind a dead Redis.
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    commandTimeout: 2000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  client.on('error', (err) => {
    if (!warned) { console.warn('[redis] connection error:', err.message); warned = true; }
  });
  client.on('ready', () => { console.log('[redis] connected — shared rate limits + cross-instance events active'); });
  return client;
}

/** A second connection for pub/sub (a subscribed client cannot publish). */
function duplicateRedisClient() {
  const base = getRedisClient();
  return base ? base.duplicate() : null;
}

module.exports = { redisEnabled, getRedisClient, duplicateRedisClient };
