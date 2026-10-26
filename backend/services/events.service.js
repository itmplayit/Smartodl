'use strict';
/**
 * Server-Sent-Events hub — realtime push.
 * Clients subscribe via GET /events/stream; server-side code calls publish().
 *
 * Single-instance (default): everything stays in this process's memory.
 * With REDIS_URL set, publish() additionally fans the event out over Redis so
 * clients connected to *other* API replicas receive it too (see
 * services/redis.service.js). Delivery counts returned by publish() remain
 * the count of sockets on THIS instance — cross-instance delivery is
 * fire-and-forget, like SSE itself.
 */
const crypto = require('crypto');
const { q1 } = require('../config/db');
const { getRedisClient, duplicateRedisClient } = require('./redis.service');

const clients = new Set();
const INSTANCE_ID = crypto.randomUUID();
const REDIS_CHANNEL = 'smartodl:events';

function send(res, type, data) {
  try { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) { /* socket already gone */ }
}

/** Register a response stream for `user`; auto-cleans on disconnect. */
function subscribe(user, res) {
  const client = { userId: user.id, role: user.role, res };
  clients.add(client);
  send(res, 'hello', { user_id: user.id, at: Date.now() });
  const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);
  // The access token authenticates only connection setup. Re-check the live
  // account every minute so suspension/deletion closes the stream and a role
  // change immediately changes which targeted events this socket receives.
  const revalidate = setInterval(async () => {
    try {
      const row = await q1(
        `SELECT u.status, r.slug AS role
           FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
        [client.userId],
      );
      if (!row || row.status !== 'active') { res.end(); return; }
      client.role = row.role;
    } catch (_) { /* a transient DB error should not sever every stream */ }
  }, 60000);
  if (revalidate.unref) revalidate.unref();
  res.on('close', () => {
    clearInterval(keepAlive);
    clearInterval(revalidate);
    clients.delete(client);
  });
}

/** Deliver to sockets attached to THIS process; returns how many got it. */
function deliverLocal(type, data, audience = 'all') {
  let delivered = 0;
  clients.forEach((c) => {
    const hit = audience === 'all'
      || audience === c.role
      || (audience === 'admin' && c.role === 'owner')
      || (audience && typeof audience === 'object' && audience.userId === c.userId);
    if (hit) { send(c.res, type, data); delivered += 1; }
  });
  return delivered;
}

/* ------------------- optional cross-instance bridge ------------------- */
let publisher = null;
try {
  publisher = getRedisClient();
  if (publisher) {
    const subscriber = duplicateRedisClient();
    subscriber.subscribe(REDIS_CHANNEL).catch((err) => console.warn('[events] Redis subscribe failed:', err.message));
    subscriber.on('message', (channel, raw) => {
      if (channel !== REDIS_CHANNEL) return;
      try {
        const msg = JSON.parse(raw);
        if (!msg || msg.instance === INSTANCE_ID) return; // already delivered locally
        deliverLocal(msg.type, msg.data, msg.audience);
      } catch (_) { /* ignore malformed bus messages */ }
    });
    subscriber.on('error', (err) => console.warn('[events] Redis subscriber error:', err.message));
  }
} catch (err) {
  console.warn('[events] Redis bridge unavailable, continuing single-instance:', err.message);
  publisher = null;
}

/**
 * audience: 'all' | role ('student'|'developer'|'admin'|'owner') | { userId }.
 * Owner also receives events addressed to the administrative audience.
 */
function publish(type, data, audience = 'all') {
  const delivered = deliverLocal(type, data, audience);
  // Callers that need honesty (WebRTC signalling) can now tell "queued to a
  // live socket" apart from "nobody was listening" instead of guessing.
  if (publisher) {
    publisher.publish(REDIS_CHANNEL, JSON.stringify({ instance: INSTANCE_ID, type, data, audience }))
      .catch((_) => { /* local delivery already happened; a bus hiccup must not break callers */ });
  }
  return delivered;
}

module.exports = { subscribe, publish, deliverLocal, clientCount: () => clients.size };
