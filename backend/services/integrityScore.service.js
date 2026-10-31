'use strict';
const { q } = require('../config/db');
const { readSetting } = require('./settings.service');
const { calculateIntegrityScore } = require('../utils/integrityScore');

async function currentWeights() {
  const [tabPenalty, proctorPenalty] = await Promise.all([
    readSetting('integrity_score_tab_switch_penalty', '5'),
    readSetting('integrity_score_proctor_violation_penalty', '10'),
  ]);
  return {
    tabPenalty: Number(tabPenalty),
    proctorPenalty: Number(proctorPenalty),
  };
}

/** Calculate review scores for an already loaded attempt set (e.g. one live host table). */
async function scoresForAttempts(attempts = []) {
  const list = Array.isArray(attempts) ? attempts : [];
  const ids = [...new Set(list.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return new Map();

  const weights = await currentWeights();
  const placeholders = ids.map(() => '?').join(', ');
  const eventRows = await q(
    `SELECT DISTINCT attempt_id FROM proctor_events WHERE attempt_id IN (${placeholders})`,
    ids,
  );
  const eventAttempts = new Set(eventRows.map((row) => Number(row.attempt_id)));
  return new Map(list.map((row) => {
    const attemptId = Number(row.id);
    const review = calculateIntegrityScore({
      tabViolations: row.tab_violations,
      proctorViolations: row.proctor_violations,
      hasMonitoringEvidence: eventAttempts.has(attemptId)
        || Number(row.proctor_camera) === 1 || Number(row.proctor_screen) === 1,
      ...weights,
    });
    return [attemptId, review];
  }));
}

async function listAdminScores({ limit = 500 } = {}) {
  const weights = await currentWeights();
  const rows = await q(
    `SELECT qa.id AS attempt_id, qa.quiz_id, qa.user_id, qa.status, qa.started_at, qa.submitted_at,
            qa.score AS quiz_score, qa.total_marks, qa.accuracy, qa.tab_violations,
            qa.proctor_violations, qa.proctor_camera, qa.proctor_screen,
            EXISTS(SELECT 1 FROM proctor_events pe WHERE pe.attempt_id=qa.id) AS has_proctor_events,
            u.full_name AS student_name, u.email AS student_email, z.title AS quiz_title,
            z.quiz_type
       FROM quiz_attempts qa
       JOIN users u ON u.id=qa.user_id
       JOIN quizzes z ON z.id=qa.quiz_id
      ORDER BY qa.started_at DESC
      LIMIT ?`,
    [Math.max(1, Math.min(1000, Number(limit) || 500))],
  );
  return rows.map((row) => {
    const hasMonitoringEvidence = !!Number(row.has_proctor_events)
      || Number(row.proctor_camera) === 1 || Number(row.proctor_screen) === 1;
    const score = calculateIntegrityScore({
      tabViolations: row.tab_violations,
      proctorViolations: row.proctor_violations,
      hasMonitoringEvidence,
      ...weights,
    });
    return {
      attempt_id: Number(row.attempt_id),
      quiz_id: Number(row.quiz_id),
      user_id: Number(row.user_id),
      student_name: row.student_name,
      student_email: row.student_email,
      quiz_title: row.quiz_title,
      quiz_type: row.quiz_type,
      status: row.status,
      started_at: row.started_at,
      submitted_at: row.submitted_at,
      quiz_score: Number(row.quiz_score || 0),
      total_marks: Number(row.total_marks || 0),
      accuracy: Number(row.accuracy || 0),
      ...score,
    };
  });
}

module.exports = { currentWeights, scoresForAttempts, listAdminScores };
