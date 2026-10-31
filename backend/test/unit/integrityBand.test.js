'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bandForScore, summarizeIntegrity } = require('../../utils/integrityBand');

test('bands are green at 80+, yellow 50-79, red below 50', () => {
  assert.equal(bandForScore(100).band, 'green');
  assert.equal(bandForScore(80).band, 'green');
  assert.equal(bandForScore(79.9).band, 'yellow');
  assert.equal(bandForScore(50).band, 'yellow');
  assert.equal(bandForScore(49.9).band, 'red');
  assert.equal(bandForScore(0).band, 'red');
  assert.equal(bandForScore(null).band, null);
  assert.equal(bandForScore('junk').label, 'Insufficient data');
});

test('no monitoring evidence is insufficient data, never a green all-clear', () => {
  const result = summarizeIntegrity([], { tabPenalty: 5, proctorPenalty: 10 });
  assert.equal(result.available, false);
  assert.equal(result.band, null);
  assert.equal(result.score, null);
  assert.equal(result.label, 'Insufficient data');

  // An attempt that ran with no monitored sensors has no score at all.
  const unmonitored = summarizeIntegrity([{ tab_violations: 0, proctor_violations: 0 }], {});
  assert.equal(unmonitored.available, false);
  assert.equal(unmonitored.total_attempts, 1);
});

test('a clean monitored attempt is green and a heavily flagged one is red', () => {
  const clean = summarizeIntegrity([
    { tab_violations: 0, proctor_violations: 0, has_monitoring_evidence: true },
  ], { tabPenalty: 5, proctorPenalty: 10 });
  assert.equal(clean.available, true);
  assert.equal(clean.band, 'green');
  assert.equal(clean.score, 100);

  const borderline = summarizeIntegrity([
    { tab_violations: 4, proctor_violations: 3, has_monitoring_evidence: true },
  ], { tabPenalty: 5, proctorPenalty: 10 });
  assert.equal(borderline.score, 50);
  assert.equal(borderline.band, 'yellow');

  const flagged = summarizeIntegrity([
    { tab_violations: 5, proctor_violations: 3, has_monitoring_evidence: true },
  ], { tabPenalty: 5, proctorPenalty: 10 });
  assert.equal(flagged.score, 45);
  assert.equal(flagged.band, 'red');
  assert.equal(flagged.tab_violations, 5);
  assert.equal(flagged.proctor_violations, 3);
});

test('several attempts average into one band and report the lowest score', () => {
  const result = summarizeIntegrity([
    { tab_violations: 0, proctor_violations: 0, has_monitoring_evidence: true }, // 100
    { tab_violations: 2, proctor_violations: 1, has_monitoring_evidence: true }, // 100-10-10 = 80
  ], { tabPenalty: 5, proctorPenalty: 10 });
  assert.equal(result.assessed_attempts, 2);
  assert.equal(result.score, 90);
  assert.equal(result.band, 'green');
  assert.equal(result.lowest_score, 80);
});

test('penalty weights of zero mean violations cannot drag a score down', () => {
  const result = summarizeIntegrity([
    { tab_violations: 9, proctor_violations: 9, has_monitoring_evidence: true },
  ], { tabPenalty: 0, proctorPenalty: 0 });
  assert.equal(result.score, 100);
  assert.equal(result.band, 'green');
});

test('the band carries no punishment semantics', () => {
  const result = summarizeIntegrity([{ tab_violations: 9, proctor_violations: 9, has_monitoring_evidence: true }], {});
  assert.equal(result.band, 'red');
  // No field may imply a verdict, block or revocation.
  assert.deepEqual(Object.keys(result).filter((key) => /revoke|block|fail|cheat|penalt/i.test(key)), []);
});

// ---------------------------------------------------------------------------
// tone must mirror band (green / yellow / red). Yellow used to be emitted as
// 'amber', and every consumer (certificate HTML, student certificates, public
// verify page) maps only green/yellow/red — so the yellow band printed grey.
test('tone mirrors the band name so certificates can colour all three', () => {
  const { bandForScore } = require('../../utils/integrityBand');
  assert.deepEqual(
    [bandForScore(100), bandForScore(80), bandForScore(79), bandForScore(50), bandForScore(49), bandForScore(0)]
      .map((b) => `${b.band}/${b.tone}`),
    ['green/green', 'green/green', 'yellow/yellow', 'yellow/yellow', 'red/red', 'red/red'],
  );
});

test('no score at all is "insufficient data" (muted), never green', () => {
  const { bandForScore } = require('../../utils/integrityBand');
  for (const empty of [null, undefined, '']) {
    const band = bandForScore(empty);
    assert.equal(band.tone, 'muted');
    assert.equal(band.label, 'Insufficient data');
  }
});

test('certificate renderer has a colour for every tone (no grey fallback)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..', '..', '..');
  const src = fs.readFileSync(path.join(root, 'backend/controllers/certificate.controller.js'), 'utf8');
  const map = src.match(/const INTEGRITY_TONE = \{([^}]*)\}/);
  assert.ok(map, 'INTEGRITY_TONE map not found');
  for (const tone of ['green', 'yellow', 'red', 'muted']) {
    assert.match(map[1], new RegExp(`${tone}:\\s*'#[0-9a-f]{6}'`, 'i'), `missing colour for ${tone}`);
  }
});
