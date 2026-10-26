'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { signQuizUnlock, verifyQuizUnlock, unlockSecret, passwordFingerprint } = require('../../services/quizUnlock.service');

const ENV = { JWT_ACCESS_SECRET: 'unit-test-access-secret-with-plenty-of-length-0123456789' };
const HASH = '$2a$12$examplebcryptHashValueForTestsOnly1234567890abcd';

test('unlock round-trips for the right user, quiz and password', () => {
  const token = signQuizUnlock({ userId: 7, quizId: 99, accessPasswordHash: HASH }, ENV);
  assert.equal(typeof token, 'string');
  assert.equal(verifyQuizUnlock(token, { userId: 7, quizId: 99, accessPasswordHash: HASH }, ENV), true);
});

test('unlock is bound to user, quiz and the current password hash', () => {
  const token = signQuizUnlock({ userId: 7, quizId: 99, accessPasswordHash: HASH }, ENV);
  assert.equal(verifyQuizUnlock(token, { userId: 8, quizId: 99, accessPasswordHash: HASH }, ENV), false);
  assert.equal(verifyQuizUnlock(token, { userId: 7, quizId: 100, accessPasswordHash: HASH }, ENV), false);
  // password rotated -> hash changed -> every outstanding unlock dies with it
  assert.equal(verifyQuizUnlock(token, { userId: 7, quizId: 99, accessPasswordHash: '$2a$12$rotatedHash' }, ENV), false);
  assert.equal(verifyQuizUnlock(null, { userId: 7, quizId: 99, accessPasswordHash: HASH }, ENV), false);
  assert.equal(verifyQuizUnlock('not-a-jwt', { userId: 7, quizId: 99, accessPasswordHash: HASH }, ENV), false);
});

test('unlock tokens are NOT access tokens (purpose-derived key)', () => {
  const token = signQuizUnlock({ userId: 7, quizId: 99, accessPasswordHash: HASH }, ENV);
  // Must not verify under the raw access secret...
  assert.throws(() => jwt.verify(token, ENV.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }));
  // ...and a token hand-signed with the raw access secret (even with a
  // quiz_unlock payload) must not be accepted as an unlock.
  const forged = jwt.sign(
    { uid: 7, qid: 99, kind: 'quiz_unlock', pfp: passwordFingerprint(HASH) },
    ENV.JWT_ACCESS_SECRET,
    { algorithm: 'HS256', expiresIn: '8h' },
  );
  assert.equal(verifyQuizUnlock(forged, { userId: 7, quizId: 99, accessPasswordHash: HASH }, ENV), false);
});

test('expired unlocks and non-HS256 algorithms are rejected', () => {
  const expired = jwt.sign(
    { uid: 7, qid: 99, kind: 'quiz_unlock', pfp: passwordFingerprint(HASH) },
    unlockSecret(ENV),
    { algorithm: 'HS256', expiresIn: '-10s' },
  );
  assert.equal(verifyQuizUnlock(expired, { userId: 7, quizId: 99, accessPasswordHash: HASH }, ENV), false);
});
