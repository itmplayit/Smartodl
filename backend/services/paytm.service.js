'use strict';
/**
 * Paytm Business (Paytm Payment Gateway) integration.
 *
 * Replaces the old Razorpay path. Implemented directly against Paytm's
 * documented checksum scheme with Node's `crypto`, because this project takes
 * no new npm dependencies (the official `paytmchecksum` package does exactly
 * what `generateSignature`/`verifySignature` below do).
 *
 * Checksum spec (Paytm):
 *   salt   = 4 random alphanumerics
 *   hash   = sha256(payload + '|' + salt) + salt
 *   cipher = AES-128-CBC(hash, key = merchantKey, iv = '@@@@&&&&####$$$$'), base64
 *
 * Flow: initiateTransaction (S2S) -> txnToken -> browser posts to the Paytm
 * checkout page -> Paytm calls our callback -> we verify the checksum AND
 * re-query the Transaction Status API before granting anything.
 */
const crypto = require('crypto');
const { q1 } = require('../config/db');
const settings = require('./settings.service');
const { ApiError } = require('../utils/helpers');

const IV = '@@@@&&&&####$$$$';
const HOSTS = {
  test: 'https://securegw-stage.paytm.in',
  live: 'https://securegw.paytm.in',
};

const SEED = [
  ['paytm_enabled', '0', 'boolean', 'Accept Paytm Business payments'],
  ['paytm_mid', '', 'text', 'Paytm MID (merchant ID from the dashboard)'],
  ['paytm_merchant_key', '', 'text', 'Paytm Merchant Key (keep secret)'],
  ['paytm_website', 'DEFAULT', 'text', 'Paytm WEBSITE value (WEBSTAGING for test)'],
  ['paytm_env', 'test', 'text', 'Paytm environment: test or live'],
];

async function ensureSchema() {
  const added = [];
  for (const [key, value, inputType, label] of SEED) {
    // eslint-disable-next-line no-await-in-loop
    if (await q1('SELECT id FROM settings WHERE setting_key = ?', [key])) continue;
    // eslint-disable-next-line no-await-in-loop
    await require('../config/db').exec(
      'INSERT INTO settings (setting_key, setting_value, group_name, input_type, label) VALUES (?,?,?,?,?)',
      [key, value, 'payments', inputType, label],
    );
    added.push(key);
  }
  if (added.length) console.log(`[paytm] settings seeded: ${added.join(', ')}`);
  return added;
}

/* ------------------------------- checksum ------------------------------- */

const randomSalt = (n = 4) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  // crypto.randomInt keeps the salt unbiased; Math.random() would be fine too
  for (let i = 0; i < n; i += 1) out += chars[crypto.randomInt(0, chars.length)];
  return out;
};

function encrypt(plain, key) {
  const cipher = crypto.createCipheriv('AES-128-CBC', key, IV);
  return Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]).toString('base64');
}

function decrypt(encoded, key) {
  const decipher = crypto.createDecipheriv('AES-128-CBC', key, IV);
  return Buffer.concat([decipher.update(String(encoded), 'base64'), decipher.final()]).toString('utf8');
}

/** Paytm signs the JSON body (or a param string); salt is embedded in the hash. */
function generateSignature(payload, merchantKey) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const salt = randomSalt(4);
  const hash = `${crypto.createHash('sha256').update(`${body}|${salt}`).digest('hex')}${salt}`;
  return encrypt(hash, merchantKey);
}

/** Constant-time compare so a bad signature cannot be probed byte by byte. */
function verifySignature(payload, merchantKey, signature) {
  if (!signature) return false;
  let decrypted;
  try { decrypted = decrypt(signature, merchantKey); } catch (_) { return false; }
  const salt = decrypted.slice(-4);
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const expected = `${crypto.createHash('sha256').update(`${body}|${salt}`).digest('hex')}${salt}`;
  const a = Buffer.from(decrypted);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* -------------------------------- config -------------------------------- */

async function config({ force = false } = {}) {
  const all = await settings.loadSettings(force);
  const get = (k, d = '') => {
    const row = all[k];
    if (row === undefined || row === null) return d;
    const raw = (typeof row === 'object' && 'setting_value' in row) ? row.setting_value : row;
    return raw === undefined || raw === null ? d : String(raw).trim();
  };
  const mid = get('paytm_mid');
  const key = get('paytm_merchant_key');
  const env = get('paytm_env', 'test') === 'live' ? 'live' : 'test';
  return {
    enabled: get('paytm_enabled', '0') === '1' && !!mid && key.length === 16,
    configured: !!mid && key.length === 16,
    keyLooksWrong: !!key && key.length !== 16,
    mid,
    key,
    website: get('paytm_website', 'DEFAULT') || 'DEFAULT',
    env,
    host: HOSTS[env],
  };
}

/* ------------------------------ Paytm calls ------------------------------ */

async function post(url, body, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return await resp.json();
  } catch (e) {
    throw ApiError.serviceUnavailable('Paytm could not be reached — this appears to be an internet or service problem. Please try again shortly.');
  } finally { clearTimeout(timer); }
}

/**
 * Step 1 of the Paytm flow — exchange order details for a txnToken.
 * `callbackUrl` must be publicly reachable; Paytm POSTs the result to it.
 */
async function initiateTransaction({ orderId, amountPaise, customerId, callbackUrl, cfg }) {
  const amount = (Number(amountPaise) / 100).toFixed(2);
  const body = {
    requestType: 'Payment',
    mid: cfg.mid,
    websiteName: cfg.website,
    orderId: String(orderId),
    callbackUrl,
    txnAmount: { value: amount, currency: 'INR' },
    userInfo: { custId: String(customerId) },
  };
  const signature = generateSignature(body, cfg.key);
  const res = await post(
    `${cfg.host}/theia/api/v1/initiateTransaction?mid=${encodeURIComponent(cfg.mid)}&orderId=${encodeURIComponent(orderId)}`,
    { body, head: { signature } },
  );
  const result = res?.body?.resultInfo || {};
  const token = res?.body?.txnToken;
  if (!token) {
    throw new ApiError(502, `Paytm did not start the transaction: ${result.resultMsg || 'unknown error'} (${result.resultCode || '-'}) — check the MID, Merchant Key, and WEBSITE values in Website Settings`, { code: 'PAYTM_REJECTED' });
  }
  return {
    txnToken: token,
    amount,
    // the browser posts to this page with mid + orderId + txnToken
    checkoutUrl: `${cfg.host}/theia/api/v1/showPaymentPage?mid=${encodeURIComponent(cfg.mid)}&orderId=${encodeURIComponent(orderId)}`,
  };
}

/**
 * Step 3 — never trust the callback body alone. This asks Paytm directly what
 * the real state of the order is.
 */
async function fetchStatus({ orderId, cfg }) {
  const body = { mid: cfg.mid, orderId: String(orderId) };
  const signature = generateSignature(body, cfg.key);
  const res = await post(`${cfg.host}/v3/order/status`, { body, head: { signature } });
  const b = res?.body || {};
  return {
    raw: b,
    status: b.resultInfo?.resultStatus || 'TXN_FAILURE', // TXN_SUCCESS | PENDING | TXN_FAILURE
    txnId: b.txnId || null,
    amount: b.txnAmount || null,
    message: b.resultInfo?.resultMsg || '',
  };
}

module.exports = {
  ensureSchema, config, initiateTransaction, fetchStatus,
  generateSignature, verifySignature, encrypt, decrypt, SEED, HOSTS,
};
