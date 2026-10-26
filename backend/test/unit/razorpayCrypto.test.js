'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifySignature, verifyWebhook } = require('../../services/razorpayCrypto');

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

test('checkout signature: accepts the genuine HMAC, rejects everything else', () => {
  const keySecret = 'test-key-secret';
  const orderId = 'order_ABC123';
  const paymentId = 'pay_XYZ789';
  const good = hmac(keySecret, `${orderId}|${paymentId}`);
  assert.equal(verifySignature({ orderId, paymentId, signature: good, keySecret }), true);
  // tampered / wrong binding / wrong secret / missing pieces
  assert.equal(verifySignature({ orderId, paymentId, signature: good.replace(/.$/, '0'), keySecret }), false);
  assert.equal(verifySignature({ orderId: 'order_OTHER', paymentId, signature: good, keySecret }), false);
  assert.equal(verifySignature({ orderId, paymentId, signature: good, keySecret: 'wrong' }), false);
  assert.equal(verifySignature({ orderId, paymentId, signature: '', keySecret }), false);
  assert.equal(verifySignature({ orderId, paymentId, signature: good, keySecret: '' }), false);
  assert.equal(verifySignature({}), false);
});

test('webhook signature: HMAC over the exact raw body bytes', () => {
  const secret = 'wh-secret';
  const raw = Buffer.from('{"event":"payment.captured","x":  1 }', 'utf8'); // spacing is part of the bytes
  const good = hmac(secret, raw);
  assert.equal(verifyWebhook({ rawBody: raw, signature: good, secret }), true);
  // Re-serialised JSON (different whitespace) must NOT verify — this is why
  // server.js captures req.rawBody instead of trusting req.body.
  const reserialised = Buffer.from(JSON.stringify(JSON.parse(raw.toString())), 'utf8');
  assert.equal(verifyWebhook({ rawBody: reserialised, signature: good, secret }), false);
  assert.equal(verifyWebhook({ rawBody: raw, signature: good, secret: 'nope' }), false);
  assert.equal(verifyWebhook({ rawBody: raw, signature: '', secret }), false);
  assert.equal(verifyWebhook({ rawBody: null, signature: good, secret }), false);
  // string bodies are accepted too (same bytes)
  assert.equal(verifyWebhook({ rawBody: raw.toString('utf8'), signature: good, secret }), true);
});
