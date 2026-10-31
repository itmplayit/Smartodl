'use strict';
/**
 * Traffic-light presentation of the integrity *review* score.
 *
 * The score itself (utils/integrityScore.js) is a transparent deduction from
 * recorded tab-switch and proctor-violation counts. This file only decides how
 * to show it next to a certificate:
 *
 *   green   score >= 80   no deductions, or a minor one
 *   yellow  50 .. 79      some recorded events — look at the attempt log
 *   red     < 50          many recorded events — review before relying on it
 *
 * Two rules that must not be broken:
 *   1. No evidence means "insufficient data" (grey), never green. A clean
 *      signal is only claimed when monitoring actually ran.
 *   2. The band is a review prompt. It never blocks certificate issuance,
 *      never rewrites a grade and never revokes a credential by itself.
 */
const { calculateIntegrityScore } = require('./integrityScore');

const BANDS = {
  green: { band: 'green', label: 'Green', tone: 'green', min: 80 },
  yellow: { band: 'yellow', label: 'Yellow', tone: 'amber', min: 50 },
  red: { band: 'red', label: 'Red', tone: 'red', min: 0 },
};
const UNAVAILABLE = { band: null, label: 'Insufficient data', tone: 'muted' };

function bandForScore(score) {
  // null / undefined / '' mean "no score", not zero — zero would read as red.
  if (score === null || score === undefined || score === '') return { ...UNAVAILABLE };
  const value = Number(score);
  if (!Number.isFinite(value)) return { ...UNAVAILABLE };
  if (value >= BANDS.green.min) return { ...BANDS.green };
  if (value >= BANDS.yellow.min) return { ...BANDS.yellow };
  return { ...BANDS.red };
}

/**
 * @param {Array} attempts  rows with tab_violations, proctor_violations and any
 *                          monitoring-evidence flags (see calculateIntegrityScore)
 * @param {object} weights  { tabPenalty, proctorPenalty }
 */
function summarizeIntegrity(attempts = [], weights = {}) {
  const list = Array.isArray(attempts) ? attempts : [];
  const scored = list
    .map((attempt) => calculateIntegrityScore({
      tabViolations: attempt.tab_violations,
      proctorViolations: attempt.proctor_violations,
      hasMonitoringEvidence: !!attempt.has_monitoring_evidence
        || Number(attempt.proctor_camera) === 1 || Number(attempt.proctor_screen) === 1,
      tabPenalty: weights.tabPenalty,
      proctorPenalty: weights.proctorPenalty,
    }))
    .filter((review) => review.available);

  if (!scored.length) {
    return {
      available: false,
      band: null,
      label: UNAVAILABLE.label,
      tone: UNAVAILABLE.tone,
      score: null,
      assessed_attempts: 0,
      total_attempts: list.length,
      tab_violations: 0,
      proctor_violations: 0,
    };
  }

  const score = Math.round((scored.reduce((sum, row) => sum + Number(row.score), 0) / scored.length) * 10) / 10;
  const band = bandForScore(score);
  return {
    available: true,
    ...band,
    score,
    assessed_attempts: scored.length,
    total_attempts: list.length,
    tab_violations: list.reduce((sum, row) => sum + (Number(row.tab_violations) || 0), 0),
    proctor_violations: list.reduce((sum, row) => sum + (Number(row.proctor_violations) || 0), 0),
    lowest_score: Math.min(...scored.map((row) => Number(row.score))),
  };
}

module.exports = { bandForScore, summarizeIntegrity, BANDS, UNAVAILABLE };
