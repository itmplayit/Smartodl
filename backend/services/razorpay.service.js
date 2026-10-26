'use strict';
/**
 * Razorpay gateway.
 *
 * Keys live in Website Settings -> Payments (same place as Paytm and UPI) so
 * an admin can switch them without touching .env or restarting. For installs
 * that already had RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env, those are
 * used as a fallback when the settings rows are still blank — nobody's
 * existing setup breaks on upgrade.
 *
 * Security model: the browser is never trusted. Razorpay's checkout returns an
 * order_id/payment_id/signature triple; we recompute the HMAC server-side and
 * additionally re-fetch the payment from Razorpay before activating anything.
 */
const { verifySignature: verifyCheckoutSignature, verifyWebhook } = require('./razorpayCrypto');
const { q1, exec } = require('../config/db');
const settings = require('./settings.service');
const { ApiError } = require('../utils/helpers');

const API = 'https://api.razorpay.com/v1';

const SEED = [
  ['razorpay_enabled', '0', 'boolean', 'Accept Razorpay payments'],
  ['razorpay_key_id', '', 'text', 'Razorpay Key ID (rzp_test_… or rzp_live_…)'],
  ['razorpay_key_secret', '', 'text', 'Razorpay Key Secret (keep secret)'],
  ['razorpay_webhook_secret', '', 'text', 'Razorpay Webhook Secret — set the same value on the /api/subscriptions/razorpay/webhook endpoint in the Razorpay dashboard'],
];

async function ensureSchema() {
  const added = [];
  for (const [key, value, inputType, label] of SEED) {
    // eslint-disable-next-line no-await-in-loop
    if (await q1('SELECT id FROM settings WHERE setting_key = ?', [key])) continue;
    // eslint-disable-next-line no-await-in-loop
    await exec(
      'INSERT INTO settings (setting_key, setting_value, group_name, input_type, label) VALUES (?,?,?,?,?)',
      [key, value, 'payments', inputType, label],
    );
    added.push(key);
  }
  if (added.length) console.log(`[razorpay] settings seeded: ${added.join(', ')}`);
  return added;
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
  // settings win; .env is the legacy fallback so old installs keep working
  const keyId = get('razorpay_key_id') || String(process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = get('razorpay_key_secret') || String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  const webhookSecret = get('razorpay_webhook_secret') || String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  const configured = !!keyId && !!keySecret;
  return {
    enabled: get('razorpay_enabled', '0') === '1' && configured,
    configured,
    keyId,
    keySecret,
    webhookSecret,
    // rzp_live_ keys move real money — the UI warns about this
    live: /^rzp_live_/i.test(keyId),
    fromEnv: !get('razorpay_key_id') && !!process.env.RAZORPAY_KEY_ID,
  };
}

/* ------------------------------ API helpers ------------------------------ */

async function call(path, { method = 'GET', body, cfg, timeoutMs = 20000 }) {
  const auth = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(`${API}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw ApiError.serviceUnavailable('Razorpay could not be reached — this appears to be an internet or service problem. Please try again shortly.');
  } finally { clearTimeout(timer); }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const reason = data?.error?.description || `HTTP ${resp.status}`;
    throw new ApiError(502, `Razorpay rejected the request: ${reason} (check the Key ID and Key Secret under Website Settings → Payments)`, { code: 'RAZORPAY_REJECTED' });
  }
  return data;
}

/** Step 1 — create the Razorpay order the checkout widget will open. */
async function createOrder({ amountPaise, receipt, cfg, notes = {} }) {
  const order = await call('/orders', {
    method: 'POST',
    cfg,
    body: { amount: Number(amountPaise), currency: 'INR', receipt: String(receipt).slice(0, 40), notes },
  });
  return order;
}

/** Step 2 — HMAC over "<order_id>|<payment_id>" with the key secret. */
function verifySignature({ orderId, paymentId, signature, cfg }) {
  return verifyCheckoutSignature({ orderId, paymentId, signature, keySecret: cfg && cfg.keySecret });
}

/** Step 3 — ask Razorpay what really happened (never trust the client alone). */
async function fetchPayment({ paymentId, cfg }) {
  const p = await call(`/payments/${encodeURIComponent(paymentId)}`, { cfg });
  return {
    raw: p,
    status: p.status, // created | authorized | captured | refunded | failed
    amountPaise: Number(p.amount || 0),
    orderId: p.order_id || null,
    method: p.method || null,
  };
}

module.exports = {
  ensureSchema, config, createOrder, verifySignature, fetchPayment, verifyWebhook, SEED,
};
