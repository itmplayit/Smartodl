'use strict';
/**
 * Module quizzes: a quiz attached to ONE module of a course.
 *
 * Why a column on `quizzes` instead of a new table: a module quiz is an
 * ordinary quiz in every other respect (questions, attempts, results,
 * certificates, integrity band). The only extra fact is "which module does this
 * belong to", so `quizzes.module_id` is the whole schema change.
 *
 * Two rules are enforced here:
 *  1. A module quiz is always `quiz_type = 'normal'`. Live quizzes are the only
 *     ones that can demand a webcam or a screen share, so keeping module quizzes
 *     normal is what guarantees "anti-cheat without camera/screen".
 *  2. The module must belong to the same course the quiz is linked to. A quiz
 *     pointing at another course's module would be ungradeable and would let a
 *     learner's completion depend on a module they cannot see.
 */
const { q1, exec } = require('../config/db');
const { ApiError } = require('../utils/helpers');
const { readBool } = require('./settings.service');

const FLAG_MODULE_QUIZZES = 'module_quizzes_enabled';
const FLAG_MODULE_ANTICHEAT = 'module_quiz_anticheat_enabled';

async function ensureSchema() {
  const column = await q1(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quizzes' AND COLUMN_NAME = 'module_id'`,
  );
  if (!Number(column && column.c)) {
    await exec('ALTER TABLE quizzes ADD COLUMN `module_id` INT UNSIGNED NULL AFTER `course_id`');
    console.log('[module-quizzes] added quizzes.module_id');
  }
  const index = await q1(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quizzes' AND INDEX_NAME = 'idx_quizzes_module'`,
  );
  if (!Number(index && index.c)) {
    await exec('ALTER TABLE quizzes ADD INDEX `idx_quizzes_module` (`module_id`)');
  }
}

/** Is the module-quiz feature switched on for this install? */
async function featureEnabled() {
  try {
    return await readBool(FLAG_MODULE_QUIZZES, true);
  } catch { return true; }
}

/** Should module quiz attempts get the institutional anti-cheat floor? */
async function antiCheatFloorEnabled() {
  try {
    return await readBool(FLAG_MODULE_ANTICHEAT, true);
  } catch { return true; }
}

/** Validates a requested module link. Returns the module row or null. */
async function resolveModuleLink(moduleId, courseId) {
  if (moduleId === undefined || moduleId === null || moduleId === '' || Number(moduleId) === 0) return null;
  const id = Number(moduleId);
  if (!Number.isInteger(id) || id < 1) throw ApiError.badRequest('module_id is invalid');
  const module = await q1('SELECT id, course_id, title, position FROM course_modules WHERE id = ?', [id]);
  if (!module) throw ApiError.badRequest('That module does not exist');
  if (!courseId) throw ApiError.badRequest('Link the quiz to a course before linking a module');
  if (Number(module.course_id) !== Number(courseId)) {
    throw ApiError.badRequest('That module belongs to a different course');
  }
  return module;
}

/**
 * The anti-cheat switches a module quiz attempt must run with.
 *
 * These are an institutional floor, not a per-teacher preference: when the
 * admin switch is ON, a module quiz always runs with the tab guard, fullscreen
 * lockdown, copy-paste block and screenshot block — while camera and screen
 * share stay explicitly OFF.
 */
async function moduleAntiCheatFloor() {
  const enabled = await antiCheatFloorEnabled();
  if (!enabled) return null;
  return {
    tab_guard_enabled: true,
    quiz_lockdown_enabled: true,
    quiz_cp_block: true,
    screenshot_block_enabled: true,
    // Never part of the floor — a module quiz must not ask for a camera.
    proctor_camera_enabled: false,
    proctor_screen_enabled: false,
  };
}

/**
 * The anti-cheat payload used to mix types: `tab_guard_enabled` could arrive as
 * `true` (floor applied) or as the string `'1'` (straight out of settings).
 * Every client had to re-guess. These helpers give one contract: flags are real
 * booleans, counts stay numbers.
 */
const FLAG_SUFFIXES = ['_enabled', '_allowed', '_block', '_auto_submit'];
const FLAG_EXACT = new Set(['exam_safe_mode']);

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(text)) return false;
  return null;
}

/** Convert every known boolean switch in a settings payload to a real boolean. */
function normaliseFlags(payload = {}) {
  const out = { ...payload };
  for (const [key, value] of Object.entries(out)) {
    if (!FLAG_EXACT.has(key) && !FLAG_SUFFIXES.some((suffix) => key.endsWith(suffix))) continue;
    const bool = toBool(value);
    if (bool !== null) out[key] = bool;
  }
  return out;
}

/** Merges the floor over the creator's resolved switches. */
function applyAntiCheatFloor(resolved = {}, floor = null) {
  if (!floor) return resolved;
  return { ...resolved, ...floor };
}

module.exports = {
  FLAG_MODULE_QUIZZES, FLAG_MODULE_ANTICHEAT,
  ensureSchema, featureEnabled, antiCheatFloorEnabled, resolveModuleLink,
  moduleAntiCheatFloor, applyAntiCheatFloor, normaliseFlags, toBool,
};
