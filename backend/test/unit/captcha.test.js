'use strict';
/**
 * The self-hosted CAPTCHA is the default provider, so it must be correct even
 * though it is the "simple" one. Two properties matter most:
 *   1. A challenge is single-use — otherwise a bot can brute-force the answer
 *      against one long-lived id.
 *   2. A wrong answer is rejected AND consumes the challenge.
 */
const test = require('node:test');
const assert = require('node:assert');

const SVC = '../../services/captcha.service';

function freshService() {
  delete require.cache[require.resolve(SVC)];
  // eslint-disable-next-line global-require
  const captcha = require(SVC);
  captcha._challenges.clear();
  return captcha;
}

test.beforeEach(() => {
  delete process.env.CAPTCHA_ENABLED;
  delete process.env.CAPTCHA_PROVIDER;
  delete process.env.CAPTCHA_SECRET_KEY;
});

test('disabled by default — verify() is a no-op pass', async (t) => {
  const captcha = freshService();
  assert.strictEqual(captcha.enabled(), false);
  const r = await captcha.verify({});
  assert.strictEqual(r.ok, true, 'with CAPTCHA off nothing should be blocked');
});

test('publicConfig hides the site key when disabled', (t) => {
  const captcha = freshService();
  process.env.CAPTCHA_SITE_KEY = 'secret-site-key';
  const cfg = captcha.publicConfig();
  assert.strictEqual(cfg.enabled, false);
  assert.strictEqual(cfg.provider, null);
  assert.strictEqual(cfg.siteKey, null, 'site key must not leak while disabled');
});

test('image challenge: correct answer passes exactly once', async (t) => {
  const captcha = freshService();
  process.env.CAPTCHA_ENABLED = 'true';
  process.env.CAPTCHA_PROVIDER = 'image';

  const c = captcha.createChallenge();
  assert.ok(c.id, 'challenge must carry an id');
  assert.ok(String(c.svg).startsWith('data:image/svg+xml;base64,'), 'must render as an inline data URL');

  // Pull the answer back out of the store (white-box: this is our own map).
  const answer = captcha._challenges.get(c.id).answer;

  const good = await captcha.verify({ captchaId: c.id, captchaToken: answer });
  assert.strictEqual(good.ok, true, 'correct answer must pass');

  const replay = await captcha.verify({ captchaId: c.id, captchaToken: answer });
  assert.strictEqual(replay.ok, false, 'a consumed challenge must not pass again');
  assert.match(replay.reason, /expired/i);
});

test('image challenge: wrong answer fails and burns the challenge', async (t) => {
  const captcha = freshService();
  process.env.CAPTCHA_ENABLED = 'true';
  process.env.CAPTCHA_PROVIDER = 'image';

  const c = captcha.createChallenge();
  const real = captcha._challenges.get(c.id).answer;
  const wrong = String(Number(real) + 1);

  const bad = await captcha.verify({ captchaId: c.id, captchaToken: wrong });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.reason, /incorrect/i);

  // The correct answer must NOT work afterwards — one shot per challenge.
  const after = await captcha.verify({ captchaId: c.id, captchaToken: real });
  assert.strictEqual(after.ok, false, 'failed attempt must still consume the challenge');
});

test('missing token is rejected when CAPTCHA is enabled', async (t) => {
  const captcha = freshService();
  process.env.CAPTCHA_ENABLED = 'true';
  process.env.CAPTCHA_PROVIDER = 'image';
  const r = await captcha.verify({ captchaId: 'whatever' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /required/i);
});

test('hosted provider without a secret key fails closed', async (t) => {
  const captcha = freshService();
  process.env.CAPTCHA_ENABLED = 'true';
  process.env.CAPTCHA_PROVIDER = 'recaptcha';
  delete process.env.CAPTCHA_SECRET_KEY;
  const r = await captcha.verify({ 'g-recaptcha-response': 'token' });
  assert.strictEqual(r.ok, false, 'must fail closed, never open');
  assert.match(r.reason, /secret key/i);
});
