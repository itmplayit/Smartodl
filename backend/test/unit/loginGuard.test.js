'use strict';
/**
 * Per-account login backoff (services/loginGuard.service.js).
 * These are the rules the audit asked for: 8 fails in 15 min → 5 min pause,
 * keyed on email+IP so one student cannot lock out another, and a good login
 * clears the counter.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../../services/loginGuard.service');

const T0 = 1_700_000_000_000;

test('a clean email+IP pair is never blocked', () => {
  guard._clear();
  assert.deepEqual(guard.check('a@x.com', '1.1.1.1', T0), { blocked: false, retryAfterSeconds: 0 });
});

test('8 failures block that pair for 5 minutes, with a countdown', () => {
  guard._clear();
  const email = 'student@x.com';
  const ip = '10.0.0.7';
  for (let i = 0; i < guard.MAX_FAILS; i += 1) guard.fail(email, ip, T0);
  const blocked = guard.check(email, ip, T0 + 1000);
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 300);
  // the pause expires by itself
  assert.equal(guard.check(email, ip, T0 + guard.BLOCK_MS + 2000).blocked, false);
});

test('the counter is per email+IP — a victim cannot be locked out from elsewhere', () => {
  guard._clear();
  for (let i = 0; i < guard.MAX_FAILS + 2; i += 1) guard.fail('victim@x.com', '6.6.6.6', T0);
  assert.equal(guard.check('victim@x.com', '6.6.6.6', T0 + 1000).blocked, true, 'attacker IP is paused');
  assert.equal(guard.check('victim@x.com', '7.7.7.7', T0 + 1000).blocked, false, 'victim still signs in from their own IP');
});

test('one abusive account does not pause its classmates on the same NAT', () => {
  guard._clear();
  for (let i = 0; i < guard.MAX_FAILS + 2; i += 1) guard.fail('noisy@x.com', '192.168.1.5', T0);
  assert.equal(guard.check('quiet@x.com', '192.168.1.5', T0 + 1000).blocked, false);
});

test('failsLeft counts down and a successful login clears the slate', () => {
  guard._clear();
  const first = guard.fail('b@x.com', '2.2.2.2', T0);
  assert.equal(first.failsLeft, guard.MAX_FAILS - 1);
  guard.fail('b@x.com', '2.2.2.2', T0);
  guard.reset('b@x.com', '2.2.2.2');
  assert.equal(guard.check('b@x.com', '2.2.2.2', T0 + 1000).blocked, false);
  assert.equal(guard.fail('b@x.com', '2.2.2.2', T0 + 2000).failsLeft, guard.MAX_FAILS - 1);
});

test('old failures age out of the window instead of accumulating forever', () => {
  guard._clear();
  for (let i = 0; i < guard.MAX_FAILS - 1; i += 1) guard.fail('c@x.com', '3.3.3.3', T0);
  // window passes → the next failure starts a fresh count
  const later = T0 + guard.WINDOW_MS + 5000;
  const state = guard.fail('c@x.com', '3.3.3.3', later);
  assert.equal(state.blocked, false);
  assert.equal(state.failsLeft, guard.MAX_FAILS - 1);
});

test('email keys are case/space insensitive (typing " Stu@X.com " must not dodge the counter)', () => {
  guard._clear();
  for (let i = 0; i < guard.MAX_FAILS; i += 1) guard.fail('Stu@X.com ', '4.4.4.4', T0);
  assert.equal(guard.check('stu@x.com', '4.4.4.4', T0 + 1000).blocked, true);
});
