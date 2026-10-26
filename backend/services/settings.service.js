'use strict';
/** Website settings stored in the DB — the admin panel changes these live, no code edits. */
const { q, exec } = require('../config/db');
const { ApiError } = require('../utils/helpers');
const { parseIceServers } = require('./iceServers.service');

let cache = null;
let cachedAt = 0;
const TTL = 15000;

async function loadSettings(force = false) {
  const now = Date.now();
  if (!force && cache && now - cachedAt < TTL) return cache;
  const rows = await q('SELECT setting_key, setting_value, group_name, input_type, label FROM settings ORDER BY group_name, id');
  cache = rows.reduce((acc, r) => { acc[r.setting_key] = r; return acc; }, {});
  cachedAt = now;
  return cache;
}

async function readSetting(key, dflt = null) {
  const all = await loadSettings();
  return all[key] ? all[key].setting_value : dflt;
}

async function readBool(key, dflt = false) {
  const v = await readSetting(key, dflt ? '1' : '0');
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function cleanSettingValue(key, raw, setting) {
  const value = String(raw == null ? '' : raw).trim().slice(0, 5000);
  const isUrl = setting.input_type === 'url' || ['landing_banner_cta_link', 'landing_banner_image', 'site_logo', 'site_favicon'].includes(key);
  if (isUrl && value) {
    if (value.startsWith('#')) return value;
    // Only a genuinely same-origin path. `//evil.example/...` starts with /
    // but browsers resolve it as a protocol-relative external URL.
    if (/^\/(?![/\\])/.test(value)) return value;
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
      return parsed.toString();
    } catch (_) { throw ApiError.badRequest(`${key} must be an HTTPS/HTTP URL or a site-relative path`); }
  }
  if (key === 'proctor_webrtc_ice_servers' && value) {
    // Reject junk here instead of silently falling back to public STUN in
    // the middle of an exam. parseIceServers also strips non-ICE schemes.
    let parsedJson = null;
    try { parsedJson = JSON.parse(value); } catch (_) { /* handled below */ }
    if (!Array.isArray(parsedJson) || !parseIceServers(value).length) {
      throw ApiError.badRequest('proctor_webrtc_ice_servers must be a JSON array of stun:/turn: server objects');
    }
    return JSON.stringify(parseIceServers(value));
  }
  if (setting.input_type === 'boolean' && !['0', '1', 'true', 'false', 'yes', 'no', 'on', 'off'].includes(value.toLowerCase())) throw ApiError.badRequest(`${key} must be a boolean value`);
  if (setting.input_type === 'number' && (!value || !Number.isFinite(Number(value)))) throw ApiError.badRequest(`${key} must be a number`);
  return value;
}

// These keys are live gateway credentials. Never send them back to the browser;
// the admin interface should know only whether a value is set.
const SECRET_KEYS = new Set(['razorpay_key_secret', 'razorpay_webhook_secret', 'paytm_merchant_key', 'proctor_webrtc_ice_servers']);
// When the UI sends the masked value back unchanged in a PUT request, retain the stored value.
const SECRET_MASK = '••••••••';

function maskSecret(key, value) {
  if (!SECRET_KEYS.has(key)) return value;
  return String(value || '') ? SECRET_MASK : '';
}

async function updateSettings(map, userId) {
  const keys = Object.keys(map || {});
  if (!keys.length) throw ApiError.badRequest('At least one setting is required');
  const known = await loadSettings();
  const unknown = keys.filter((key) => !known[key] || !/^[a-z][a-z0-9_]{0,79}$/.test(key));
  if (unknown.length) throw ApiError.badRequest(`Unknown setting key: ${unknown[0]}`);
  for (const key of keys) {
    // A returned masked value means the administrator did not modify the field.
    if (SECRET_KEYS.has(key) && String(map[key] || '') === SECRET_MASK) continue;
    const clean = cleanSettingValue(key, map[key], known[key]);
    await exec('UPDATE settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?', [clean, userId || null, key]);
  }
  await loadSettings(true);
  return loadSettings();
}

async function allSettingsGrouped() {
  const rows = await q('SELECT * FROM settings ORDER BY group_name, id');
  return rows.reduce((acc, r) => {
    (acc[r.group_name] = acc[r.group_name] || []).push({
      ...r,
      setting_value: maskSecret(r.setting_key, r.setting_value),
    });
    return acc;
  }, {});
}

const invalidate = () => { cache = null; };

module.exports = { loadSettings, readSetting, readBool, updateSettings, allSettingsGrouped, invalidate, SECRET_KEYS, SECRET_MASK };
