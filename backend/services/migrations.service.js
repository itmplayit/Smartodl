'use strict';
/**
 * Idempotent runtime schema/settings upgrades, in one registry, so they can
 * run either at API startup (default) or as an explicit privileged deploy
 * step (`npm run migrate`, see scripts/migrate.js) with
 * SMARTODL_SKIP_MIGRATIONS=1 keeping startup read-only for least-privilege
 * database accounts.
 *
 * When migrations are skipped, startup now VERIFIES the critical schema
 * instead of assuming the deploy step ran (verifyCriticalSchema below):
 * previously `SMARTODL_SKIP_MIGRATIONS=1` on a half-upgraded database booted
 * fine and then failed at request time with "unknown column" errors in the
 * middle of exams/payments. Failing fast at boot with the exact list of
 * missing objects is kinder than either alternative.
 */
const UPGRADES = [
  ['auth-security', () => require('./authSecurity.service').ensureSchema()],
  ['subscriptions', () => require('./subscription.service').ensureSchema()],
  ['ai-detect', () => require('./aiDetection.service').ensureSchema()],
  ['proctor', () => require('./proctoring.service').ensureSchema()],
  ['flags', () => require('./featureFlags.service').ensureFeatureFlags()],
  ['permissions', () => require('./permissions.service').ensurePermissions()],
  ['notifications', () => require('./notification.service').ensureSchema()],
  ['coding-results', () => require('./coding.service').ensureSchema()],
  ['points', () => require('./points.service').ensureSchema()],
  ['certificates', () => require('./certificateTemplates.service').ensureSchema()],
  ['pages', () => require('./sitePages.service').ensureSchema()],
  ['live-quiz', () => require('./liveQuiz.service').ensureSchema()],
  ['anticheat-per-user', () => require('./anticheatSettings.service').ensureSchema()],
  ['upi', () => require('./upi.service').ensureSchema()],
  ['paytm', () => require('./paytm.service').ensureSchema()],
  ['razorpay', () => require('./razorpay.service').ensureSchema()],
  ['lesson-opens', () => require('./lessonOpens.service').ensureSchema()],
];

/**
 * Columns/tables that request-time code assumes exist but which are added by
 * the upgrade registry above rather than by the base schema dump. Keep this
 * list in step with the ensureColumn/CREATE TABLE calls in those services.
 */
const CRITICAL_COLUMNS = [
  ['users', 'password_changed_at'],
  ['user_sessions', 'previous_refresh_token'],
  ['user_sessions', 'refresh_rotated_at'],
  ['courses', 'is_premium'],
  ['quizzes', 'is_premium'],
  ['quizzes', 'live_host_id'],
  ['coding_problems', 'is_premium'],
  ['certificates', 'revoked_at'],
  ['certificates', 'revoked_by'],
  ['certificates', 'revoke_reason'],
  ['quiz_attempts', 'proctor_camera'],
  ['quiz_attempts', 'proctor_screen'],
  ['quiz_attempts', 'proctor_violations'],
  ['quiz_attempts', 'proctor_flags'],
  ['quiz_attempts', 'proctor_policy'],
  ['quiz_attempts', 'ai_style_score'],
  ['quiz_attempts', 'ai_paste_score'],
  ['quiz_attempts', 'ai_timing_score'],
  ['quiz_attempts', 'ai_verdict'],
  ['quiz_attempts', 'ai_trusted'],
  ['quiz_attempts', 'typed_chars'],
  ['quiz_attempts', 'pasted_chars'],
  ['quiz_attempts', 'blocked_pastes'],
  ['quiz_attempts', 'keystrokes'],
  ['quiz_attempts', 'typing_ms'],
  ['quiz_attempts', 'fast_intervals'],
  ['quiz_attempts', 'uniform_ratio'],
  ['coding_submissions', 'ai_style_score'],
  ['coding_submissions', 'ai_paste_score'],
  ['coding_submissions', 'ai_timing_score'],
  ['coding_submissions', 'ai_verdict'],
  ['coding_submissions', 'ai_trusted'],
  ['coding_submissions', 'blocked_pastes'],
  ['coding_submissions', 'keystrokes'],
  ['coding_submissions', 'typing_ms'],
  ['coding_submissions', 'fast_intervals'],
  ['coding_submissions', 'uniform_ratio'],
  ['subscription_orders', 'upi_reference'],
  ['subscription_orders', 'upi_utr'],
  ['subscription_orders', 'upi_payer_vpa'],
  ['subscription_orders', 'upi_submitted_at'],
  ['subscription_orders', 'upi_reviewed_by'],
  ['subscription_orders', 'upi_reviewed_at'],
  ['subscription_orders', 'upi_review_note'],
];

const CRITICAL_TABLES = [
  'app_meta',
  'certificate_templates',
  'coding_submission_results',
  'notification_reads',
  'plans',
  'point_adjustments',
  'proctor_events',
  'site_pages',
  'subscription_orders',
  'subscriptions',
  'user_anticheat_settings',
];

async function runMigrations({ log = console } = {}) {
  const ran = [];
  const failed = [];
  for (const [name, fn] of UPGRADES) {
    try {
      await fn();
      ran.push(name);
    } catch (err) {
      failed.push(name);
      log.error(`[migrations] ${name} FAILED: ${err.message}`);
    }
  }
  return { ran, failed };
}

/**
 * Read-only check that everything the upgrade registry would have created is
 * actually there. `runQuery` is injectable for unit tests; production gets
 * the shared pool. Returns { ok, missing: ['table.column' | 'table (table)'] }.
 */
async function verifyCriticalSchema(runQuery) {
  const query = runQuery || ((sql, params) => require('../config/db').q(sql, params));
  const missing = [];

  const tablesInScope = [...new Set([...CRITICAL_TABLES, ...CRITICAL_COLUMNS.map(([t]) => t)])];
  const placeholders = tablesInScope.map(() => '?').join(', ');
  const tableRows = await query(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`,
    tablesInScope,
  );
  const tablesPresent = new Set((tableRows || []).map((r) => String(r.t)));
  CRITICAL_TABLES.forEach((t) => { if (!tablesPresent.has(t)) missing.push(`${t} (table)`); });

  const colRows = await query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`,
    tablesInScope,
  );
  const colsPresent = new Set((colRows || []).map((r) => `${r.t}.${r.c}`));
  CRITICAL_COLUMNS.forEach(([t, c]) => { if (!colsPresent.has(`${t}.${c}`)) missing.push(`${t}.${c}`); });

  return { ok: missing.length === 0, missing };
}

module.exports = { runMigrations, verifyCriticalSchema, UPGRADES, CRITICAL_COLUMNS, CRITICAL_TABLES };
