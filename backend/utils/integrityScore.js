'use strict';

const clampWeight = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
};

/**
 * A transparent review indicator, not a finding or a probability of cheating.
 * Scores are unavailable unless the attempt has some configured or recorded
 * monitoring evidence; advisory detections and AI estimates are intentionally
 * not inputs to this calculation.
 */
function calculateIntegrityScore({
  tabViolations = 0,
  proctorViolations = 0,
  hasMonitoringEvidence = false,
  tabPenalty = 5,
  proctorPenalty = 10,
} = {}) {
  const tabs = Math.max(0, Math.floor(Number(tabViolations) || 0));
  const proctor = Math.max(0, Math.floor(Number(proctorViolations) || 0));
  const tabWeight = clampWeight(tabPenalty, 5);
  const proctorWeight = clampWeight(proctorPenalty, 10);
  const dataAvailable = !!(hasMonitoringEvidence || tabs || proctor);
  if (!dataAvailable) {
    return {
      available: false,
      score: null,
      tab_violations: tabs,
      proctor_violations: proctor,
      tab_penalty: tabWeight,
      proctor_penalty: proctorWeight,
      deductions: [],
    };
  }
  const deductions = [];
  if (tabs > 0 && tabWeight > 0) {
    deductions.push({ key: 'tab_switches', count: tabs, points_each: tabWeight, points: tabs * tabWeight });
  }
  if (proctor > 0 && proctorWeight > 0) {
    deductions.push({ key: 'proctor_violations', count: proctor, points_each: proctorWeight, points: proctor * proctorWeight });
  }
  const totalDeduction = deductions.reduce((sum, row) => sum + row.points, 0);
  return {
    available: true,
    score: Math.max(0, Math.min(100, 100 - totalDeduction)),
    tab_violations: tabs,
    proctor_violations: proctor,
    tab_penalty: tabWeight,
    proctor_penalty: proctorWeight,
    deductions,
  };
}

module.exports = { calculateIntegrityScore, clampWeight };
