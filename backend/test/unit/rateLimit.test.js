'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isProctorTelemetry } = require('../../middleware/rateLimit');

const req = (method, originalUrl) => ({ method, originalUrl, url: originalUrl });

test('high-frequency proctor telemetry is exempted from the per-IP budget', () => {
  assert.equal(isProctorTelemetry(req('POST', '/api/quiz-attempts/12/proctor')), true);
  assert.equal(isProctorTelemetry(req('POST', '/api/quiz-attempts/12/proctor-frame')), true);
  assert.equal(isProctorTelemetry(req('POST', '/api/quiz-attempts/12/proctor-signal')), true);
  assert.equal(isProctorTelemetry(req('GET', '/api/quiz-attempts/12/proctor-ice')), true);
  assert.equal(isProctorTelemetry(req('GET', '/api/quiz-attempts/12/second-camera/status?x=1')), true);
  assert.equal(isProctorTelemetry(req('POST', '/api/proctor/second-camera/abc123')), true);
});

test('ordinary and look-alike routes stay on the global limiter', () => {
  assert.equal(isProctorTelemetry(req('POST', '/api/quiz-attempts/12/submit')), false);
  assert.equal(isProctorTelemetry(req('GET', '/api/proctor/second-camera/abc123')), false);
  assert.equal(isProctorTelemetry(req('POST', '/api/quiz-attempts/12/proctor-action')), false);
  assert.equal(isProctorTelemetry(req('GET', '/api/quizzes/3/proctor-frames')), false);
  assert.equal(isProctorTelemetry(req('POST', '/api/auth/login')), false);
});
