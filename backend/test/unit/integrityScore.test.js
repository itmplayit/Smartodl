'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateIntegrityScore } = require('../../utils/integrityScore');

test('integrity score is transparent, configurable and bounded', () => {
  const result = calculateIntegrityScore({
    tabViolations: 2,
    proctorViolations: 3,
    hasMonitoringEvidence: true,
    tabPenalty: 4,
    proctorPenalty: 7,
  });
  assert.equal(result.available, true);
  assert.equal(result.score, 71);
  assert.deepEqual(result.deductions.map((item) => item.points), [8, 21]);
});

test('no monitoring evidence yields insufficient data rather than a perfect score', () => {
  const result = calculateIntegrityScore({ tabViolations: 0, proctorViolations: 0 });
  assert.equal(result.available, false);
  assert.equal(result.score, null);
});

test('score excludes deductions when configured weight is zero and never drops below zero', () => {
  assert.equal(calculateIntegrityScore({ tabViolations: 4, tabPenalty: 0 }).score, 100);
  assert.equal(calculateIntegrityScore({ proctorViolations: 20, hasMonitoringEvidence: true, proctorPenalty: 10 }).score, 0);
});
