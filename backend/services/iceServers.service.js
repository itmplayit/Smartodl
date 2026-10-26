'use strict';
/**
 * WebRTC ICE server list for live proctoring.
 *
 * The list is handed ONLY to authenticated participants/hosts of a running
 * attempt — never through the public settings endpoint, where anybody on
 * the internet could harvest a TURN credential and spend the institution's
 * relay bandwidth.
 *
 * Static JSON may still be configured in the `proctor_webrtc_ice_servers`
 * setting (useful for STUN-only deployments). For TURN, prefer the coturn
 * "auth secret" scheme via environment variables:
 *
 *   PROCTOR_TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
 *   PROCTOR_TURN_SECRET=<the coturn static-auth-secret>
 *
 * Each request then receives a username of `<expiry>:<userId>` and a
 * credential of base64(HMAC-SHA1(secret, username)) that is useless after
 * PROCTOR_TURN_TTL_SECONDS (default 10 minutes).
 */
const crypto = require('crypto');

const DEFAULT_STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const ICE_URL_PATTERN = /^(?:stuns?|turns?):[^\s]+$/i;
const MAX_SERVERS = 8;
const MAX_URLS_PER_SERVER = 4;

function cleanUrls(value) {
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((url) => String(url || '').trim())
    .filter((url) => url.length <= 512 && ICE_URL_PATTERN.test(url))
    .slice(0, MAX_URLS_PER_SERVER);
}

/** Parse/validate an administrator-supplied ICE JSON value. Never throws. */
function parseIceServers(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try { parsed = JSON.parse(raw); } catch (_) { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const entry of parsed.slice(0, MAX_SERVERS)) {
    if (!entry || typeof entry !== 'object') continue;
    const urls = cleanUrls(entry.urls || entry.url);
    if (!urls.length) continue;
    const server = { urls: urls.length === 1 ? urls[0] : urls };
    const needsAuth = urls.some((url) => /^turns?:/i.test(url));
    if (needsAuth) {
      const username = String(entry.username || '').trim().slice(0, 256);
      const credential = String(entry.credential || '').trim().slice(0, 512);
      if (username && credential) {
        server.username = username;
        server.credential = credential;
      }
    }
    out.push(server);
  }
  return out;
}

function turnUrlsFromEnv(env = process.env) {
  return String(env.PROCTOR_TURN_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length <= 512 && /^turns?:/i.test(url) && ICE_URL_PATTERN.test(url))
    .slice(0, MAX_URLS_PER_SERVER);
}

/** coturn REST/auth-secret credential for one short-lived username. */
function turnCredential(secret, username) {
  return crypto.createHmac('sha1', String(secret)).update(String(username)).digest('base64');
}

/**
 * Build the ICE list for one authenticated user. When env TURN is configured
 * it replaces any static TURN entries from the setting (whose credentials
 * would otherwise be reusable by every student who ever received them);
 * static STUN entries are kept.
 */
function buildIceServers({ rawSetting = '', env = process.env, userId = 0, now = Date.now() } = {}) {
  const configured = parseIceServers(rawSetting);
  const envTurnUrls = turnUrlsFromEnv(env);
  const secret = String(env.PROCTOR_TURN_SECRET || '').trim();

  let servers = configured;
  let expiresAt = null;
  if (envTurnUrls.length && secret) {
    const ttlSeconds = Math.max(60, Math.min(3600, Number(env.PROCTOR_TURN_TTL_SECONDS) || 600));
    const expiry = Math.floor(now / 1000) + ttlSeconds;
    const username = `${expiry}:${Number(userId) || 0}`;
    servers = configured.filter((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return !urls.some((url) => /^turns?:/i.test(String(url)));
    });
    servers.push({
      urls: envTurnUrls.length === 1 ? envTurnUrls[0] : envTurnUrls,
      username,
      credential: turnCredential(secret, username),
    });
    expiresAt = new Date(expiry * 1000).toISOString();
  }

  if (!servers.length) servers = DEFAULT_STUN.map((s) => ({ ...s }));
  return { ice_servers: servers.slice(0, MAX_SERVERS), expires_at: expiresAt };
}

module.exports = {
  DEFAULT_STUN,
  parseIceServers,
  turnUrlsFromEnv,
  turnCredential,
  buildIceServers,
};
