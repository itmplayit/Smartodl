'use strict';
/**
 * Per-developer anti-cheat settings.
 *
 * Anti-cheat used to be ONE global set of switches in `settings`: a developer
 * holding `manage_anticheat` who turned the webcam off for a low-stakes class
 * quiz turned it off for every instructor on the platform, and two teachers
 * running exams at the same time could not disagree. The owner asked for the
 * control to be separate per developer, so resolution is now layered:
 *
 *   1. the content creator's own overrides (this module), then
 *   2. the global admin values in `settings` (Feature Control).
 *
 * Overrides apply ONLY to content that user created — their quizzes (live
 * and normal) and their Coding Arena problems. A developer who never touches
 * this screen simply inherits the platform defaults, so existing installs
 * behave exactly as before until someone deliberately overrides a switch.
 *
 * Only the 13 exam-integrity keys below are overridable. Platform features
 * (quiz_system_enabled, coding_system_enabled, ...) deliberately stay global:
 * they are the administrator's kill switches, not per-teacher preferences.
 */
const { q1, exec } = require('../config/db');
const { ApiError } = require('../utils/helpers');
const settingsService = require('./settings.service');

/** The complete overridable surface — the same list the anti-cheat API exposes. */
const ANTI_CHEAT_KEYS = [
  'tab_guard_enabled',
  'tab_guard_auto_submit',
  'tab_guard_max_violations',
  'quiz_lockdown_enabled',
  'quiz_cp_block',
  'screenshot_block_enabled',
  'exam_safe_mode',
  'ai_classifier_quiz_enabled',
  'coding_arena_cp_block',
  'ai_classifier_arena_enabled',
  'proctor_camera_enabled',
  'proctor_screen_enabled',
  'proctor_max_violations',
];

/** Numeric keys and their accepted ranges (mirrors Feature Control). */
const NUMBER_KEYS = {
  tab_guard_max_violations: { min: 1, max: 20 },
  proctor_max_violations: { min: 0, max: 20 },
};

const BOOL_TRUE = ['1', 'true', 'yes', 'on'];
const BOOL_FALSE = ['0', 'false', 'no', 'off'];

async function ensureSchema() {
  await exec(
    `CREATE TABLE IF NOT EXISTS user_anticheat_settings (
       user_id INT UNSIGNED NOT NULL PRIMARY KEY,
       settings_json LONGTEXT NULL,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       CONSTRAINT fk_uac_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
}

function parseOverrides(raw) {
  if (!raw) return {};
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    for (const key of ANTI_CHEAT_KEYS) {
      if (obj[key] !== undefined && obj[key] !== null) out[key] = String(obj[key]);
    }
    return out;
  } catch (_) {
    return {};
  }
}

/** The stored overrides for one user ({} when they inherit everything). */
async function getOverrides(userId) {
  const uid = Number(userId) || 0;
  if (!uid) return {};
  const row = await q1('SELECT settings_json FROM user_anticheat_settings WHERE user_id = ?', [uid]);
  return row ? parseOverrides(row.settings_json) : {};
}

/** The 13 global (admin) values, keyed exactly like the overrides. */
async function globalValues() {
  const all = await settingsService.loadSettings();
  const out = {};
  for (const key of ANTI_CHEAT_KEYS) {
    if (all[key]) out[key] = String(all[key].setting_value);
  }
  return out;
}

/**
 * The effective anti-cheat configuration for content created by `userId`:
 * their overrides layered over the global defaults. A null/unknown creator
 * (legacy rows) resolves to the globals alone.
 */
async function resolveForUser(userId) {
  const [globals, overrides] = await Promise.all([globalValues(), getOverrides(userId)]);
  return { ...globals, ...overrides };
}

async function resolveBoolForUser(userId, key, dflt = false) {
  const resolved = await resolveForUser(userId);
  const v = resolved[key];
  if (v === undefined || v === null || v === '') return dflt;
  return BOOL_TRUE.includes(String(v).toLowerCase());
}

async function resolveNumForUser(userId, key, dflt = 0) {
  const resolved = await resolveForUser(userId);
  const n = Number(resolved[key]);
  return Number.isFinite(n) ? n : dflt;
}

/** Who created a quiz (null-safe single lookup used by the runner paths). */
async function quizCreatorId(quizId) {
  if (!quizId) return null;
  const row = await q1('SELECT created_by FROM quizzes WHERE id = ?', [quizId]);
  return row ? row.created_by : null;
}

function normalizeValue(key, raw) {
  if (raw === null) return null; // null clears the override → inherit global
  if (NUMBER_KEYS[key]) {
    const n = Number(raw);
    const { min, max } = NUMBER_KEYS[key];
    if (!Number.isInteger(n) || n < min || n > max) {
      throw ApiError.badRequest(`${key} must be an integer between ${min} and ${max}`);
    }
    return String(n);
  }
  if (raw === true) return '1';
  if (raw === false) return '0';
  const v = String(raw).trim().toLowerCase();
  if (BOOL_TRUE.includes(v)) return '1';
  if (BOOL_FALSE.includes(v)) return '0';
  throw ApiError.badRequest(`${key} must be a boolean value`);
}

/**
 * Apply a patch to one user's overrides. Unknown keys are rejected loudly
 * (same contract as the anti-cheat API); a null value removes that override.
 * Returns the resulting stored overrides.
 */
async function setOverrides(userId, patch) {
  const uid = Number(userId) || 0;
  if (!uid) throw ApiError.badRequest('A valid user is required');
  if (!patch || typeof patch !== 'object') throw ApiError.badRequest('settings object is required');
  const rejected = Object.keys(patch).filter((k) => !ANTI_CHEAT_KEYS.includes(k));
  if (rejected.length) {
    throw ApiError.forbidden(`Not an anti-cheat setting: ${rejected.join(', ')}. Use Website Settings for that.`);
  }
  if (!Object.keys(patch).length) throw ApiError.badRequest('No anti-cheat settings were supplied');

  const next = { ...(await getOverrides(uid)) };
  for (const [key, raw] of Object.entries(patch)) {
    const value = normalizeValue(key, raw);
    if (value === null) delete next[key];
    else next[key] = value;
  }

  if (!Object.keys(next).length) {
    // Back to fully inheriting the globals — no row needed at all.
    await exec('DELETE FROM user_anticheat_settings WHERE user_id = ?', [uid]);
    return {};
  }
  await exec(
    `INSERT INTO user_anticheat_settings (user_id, settings_json) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json)`,
    [uid, JSON.stringify(next)],
  );
  return next;
}

module.exports = {
  ANTI_CHEAT_KEYS,
  NUMBER_KEYS,
  ensureSchema,
  getOverrides,
  globalValues,
  resolveForUser,
  resolveBoolForUser,
  resolveNumForUser,
  quizCreatorId,
  setOverrides,
};
