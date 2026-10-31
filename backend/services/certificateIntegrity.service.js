'use strict';
/**
 * Integrity band attached to a course certificate.
 *
 * Scope is a deliberate choice, not a guess:
 *   • "course"  — only quizzes an admin linked to that course (quizzes.course_id);
 *                 the honest default, because a course certificate should not
 *                 borrow signals from unrelated exams.
 *   • "overall" — every monitored attempt by that learner in the last year;
 *                 useful where assessments are not linked to courses.
 * With no monitored evidence in scope, the band is "insufficient data" — never
 * a green "all clear". Nothing here gates issuance or revokes anything.
 */
const { q, q1, exec } = require('../config/db');
const { readBool, readSetting } = require('./settings.service');
const { currentWeights } = require('./integrityScore.service');
const { summarizeIntegrity } = require('../utils/integrityBand');

const SCOPES = ['course', 'overall'];

async function ensureSchema() {
  const row = await q1(
    'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
    ['quizzes', 'course_id'],
  );
  if (!Number(row && row.c)) {
    await exec('ALTER TABLE quizzes ADD COLUMN course_id INT UNSIGNED DEFAULT NULL AFTER category_id');
  }
  const index = await q1(
    'SELECT COUNT(*) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?',
    ['quizzes', 'idx_quizzes_course'],
  );
  if (!Number(index && index.c)) {
    await exec('ALTER TABLE quizzes ADD KEY idx_quizzes_course (course_id)');
  }
}

async function settingsForBand() {
  const [enabled, publicOn, scope] = await Promise.all([
    readBool('certificate_integrity_band_enabled', true),
    readBool('certificate_integrity_band_public', false),
    readSetting('certificate_integrity_scope', 'course'),
  ]);
  return {
    enabled,
    isPublic: publicOn,
    scope: SCOPES.includes(String(scope)) ? String(scope) : 'course',
  };
}

/**
 * @param {object} input
 * @param {number} input.userId
 * @param {number} input.courseId
 * @param {boolean} input.publicView  true for anonymous verification by number
 * @returns {Promise<object>} { shown, available, band, label, tone, score, ... }
 */
async function forCertificate({ userId, courseId, publicView = false } = {}) {
  const settings = await settingsForBand();
  if (!settings.enabled) {
    return { shown: false, available: false, band: null, label: 'Not shown', tone: 'muted', score: null, scope: settings.scope };
  }
  // Shared/embeddable verification must not publish a review indicator about a
  // named person unless an administrator has explicitly opted in.
  if (publicView && !settings.isPublic) {
    return { shown: false, available: false, band: null, label: 'Not shown', tone: 'muted', score: null, scope: settings.scope };
  }

  const weights = await currentWeights();
  let attempts = [];
  if (settings.scope === 'overall') {
    attempts = await q(
      `SELECT qa.tab_violations, qa.proctor_violations, qa.proctor_camera, qa.proctor_screen,
              EXISTS(SELECT 1 FROM proctor_events pe WHERE pe.attempt_id = qa.id) AS has_monitoring_evidence
         FROM quiz_attempts qa
        WHERE qa.user_id = ? AND qa.started_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)`,
      [userId],
    );
  } else if (courseId) {
    attempts = await q(
      `SELECT qa.tab_violations, qa.proctor_violations, qa.proctor_camera, qa.proctor_screen,
              EXISTS(SELECT 1 FROM proctor_events pe WHERE pe.attempt_id = qa.id) AS has_monitoring_evidence
         FROM quiz_attempts qa JOIN quizzes z ON z.id = qa.quiz_id
        WHERE qa.user_id = ? AND z.course_id = ?`,
      [userId, courseId],
    );
  }

  const summary = summarizeIntegrity(attempts, weights);
  return {
    shown: true,
    scope: settings.scope,
    public: settings.isPublic,
    ...summary,
    note: 'Integrity review indicator from recorded tab-switch and proctor-violation counts. It is not a finding of misconduct and does not change this certificate.',
  };
}

module.exports = { ensureSchema, forCertificate, settingsForBand, SCOPES };
