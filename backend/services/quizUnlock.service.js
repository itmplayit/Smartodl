'use strict';
/**
 * Private-quiz unlock tokens.
 *
 * An unlock token is a JWT, but it is NOT an access token. It used to be
 * signed with JWT_ACCESS_SECRET itself, so the two credential types shared
 * one key and were separated only by payload checks (`kind`, `uid`, `qid`).
 * Those checks were correct, but sharing a key means a future endpoint that
 * verifies "a JWT" carelessly could accept the wrong kind.
 *
 * Unlock tokens are now signed with a purpose-derived key:
 *   HMAC-SHA256(JWT_ACCESS_SECRET, "smartodl:quiz_unlock:v1")
 * Deriving (instead of requiring a third env secret) keeps existing installs
 * working with no new configuration, while making cross-kind verification
 * cryptographically impossible: an unlock token can never verify as an
 * access token and vice versa. Outstanding unlocks issued before this change
 * (8-hour lifetime) simply stop working and the student re-enters the quiz
 * password — no data is affected.
 *
 * The token stays bound to the *current* password hash via a fingerprint:
 * rotating/removing the quiz password revokes every outstanding unlock.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ALGORITHMS = ['HS256'];
const PURPOSE = 'smartodl:quiz_unlock:v1';

function unlockSecret(env = process.env) {
  const base = String(env.JWT_ACCESS_SECRET || '');
  return crypto.createHmac('sha256', base).update(PURPOSE).digest('hex');
}

/** Short, non-reversible fingerprint of the current bcrypt hash. */
const passwordFingerprint = (hash) => crypto.createHash('sha256').update(String(hash || '')).digest('hex').slice(0, 32);

function signQuizUnlock({ userId, quizId, accessPasswordHash }, env = process.env) {
  return jwt.sign(
    { uid: userId, qid: quizId, kind: 'quiz_unlock', pfp: passwordFingerprint(accessPasswordHash) },
    unlockSecret(env),
    { algorithm: 'HS256', expiresIn: '8h' },
  );
}

/** True only for a live unlock that matches this user, quiz and password. */
function verifyQuizUnlock(token, { userId, quizId, accessPasswordHash } = {}, env = process.env) {
  if (!token) return false;
  try {
    const p = jwt.verify(String(token), unlockSecret(env), { algorithms: ALGORITHMS });
    return Boolean(p && p.kind === 'quiz_unlock'
      && Number(p.qid) === Number(quizId)
      && Number(p.uid) === Number(userId)
      && p.pfp === passwordFingerprint(accessPasswordHash));
  } catch (_) {
    return false; // invalid / expired / wrong kind — all just "locked"
  }
}

module.exports = { passwordFingerprint, signQuizUnlock, verifyQuizUnlock, unlockSecret };
