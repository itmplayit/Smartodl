'use strict';
/**
 * Pure Razorpay signature checks — no database, no network, so they can be
 * unit-tested in isolation (see test/unit/razorpayCrypto.test.js).
 * razorpay.service.js re-exports these; nothing else should recompute HMACs.
 */
const crypto = require('crypto');

const timingSafeEqualText = (expectedHex, provided) => {
  const a = Buffer.from(String(expectedHex), 'utf8');
  const b = Buffer.from(String(provided || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** Checkout-return signature: HMAC-SHA256 over "<order_id>|<payment_id>". */
function verifySignature({ orderId, paymentId, signature, keySecret }) {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  const expected = crypto.createHmac('sha256', String(keySecret))
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return timingSafeEqualText(expected, signature);
}

/** Webhook signature: HMAC-SHA256 over the exact raw request body bytes. */
function verifyWebhook({ rawBody, signature, secret }) {
  if (!rawBody || !signature || !secret) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expected = crypto.createHmac('sha256', String(secret)).update(body).digest('hex');
  return timingSafeEqualText(expected, signature);
}

module.exports = { verifySignature, verifyWebhook };
