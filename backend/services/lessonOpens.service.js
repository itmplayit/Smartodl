'use strict';
/**
 * Lesson-view stamp + completion dwell time.
 *
 * updateProgress used to accept `POST /enrollments/:id/progress { lesson_id }`
 * with no proof the lesson was ever opened: a script could mark every lesson
 * complete in seconds and instantly farm the completion certificate and the
 * points tied to it. Now the lesson content must have been fetched (that's
 * what getLesson stamps), and the stamp must be at least
 * `lesson_min_open_seconds` old before the progress write is accepted.
 *
 * This is deliberately a friction control, not a security boundary: an
 * attacker with a browser can still idle for 15 seconds per lesson — but the
 * one-line curl farm is gone, and the setting is admin-tunable (0 disables).
 */
const { q1, exec } = require('../config/db');
const { readSetting } = require('./settings.service');

const TABLE = 'lesson_opens';

async function ensureSchema() {
  const exists = await q1(
    'SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [TABLE],
  );
  if (!Number(exists && exists.c)) {
    await exec(
      `CREATE TABLE \`${TABLE}\` (
         user_id INT UNSIGNED NOT NULL,
         lesson_id INT UNSIGNED NOT NULL,
         opened_at DATETIME NOT NULL,
         PRIMARY KEY (user_id, lesson_id),
         KEY idx_lo_lesson (lesson_id),
         CONSTRAINT fk_lo_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
         CONSTRAINT fk_lo_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    console.log(`[lesson-opens] created the ${TABLE} table`);
  }
  const flag = await q1("SELECT id FROM settings WHERE setting_key = 'lesson_min_open_seconds'");
  if (!flag) {
    await exec(
      `INSERT INTO settings (setting_key, setting_value, group_name, input_type, label)
       VALUES ('lesson_min_open_seconds', '15', 'features', 'number',
               'Seconds a lesson must stay open before it can be marked complete (0 disables)')`,
    );
  }
}

/** Milliseconds a stamped open must be at least as old as; 0 disables the gate. */
async function requiredDwellMs() {
  const raw = await readSetting('lesson_min_open_seconds', '15');
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n * 1000 : 0;
}

/** Fire-and-forget stamp: the LAST fetch refreshes the timer. */
function recordView(userId, lessonId) {
  if (!userId || !lessonId) return Promise.resolve();
  return exec(
    `INSERT INTO ${TABLE} (user_id, lesson_id, opened_at) VALUES (?,?,NOW())
     ON DUPLICATE KEY UPDATE opened_at = NOW()`,
    [userId, lessonId],
  ).catch((e) => {
    // never let a tracking write break the lesson page
    if (e && e.code !== 'ER_NO_SUCH_TABLE') console.warn('[lesson-opens] view stamp failed:', e.message);
  });
}

/**
 * Decide whether a lesson may be marked complete yet.
 *
 * Pure on purpose: this is the rule students actually hit ("Open the lesson…",
 * "…about 15s"), so it is unit-tested instead of only living inside a
 * controller that needs a database.
 *
 * @param {object} input
 * @param {string|Date|null} input.openedAt  the stamp, or null when never opened
 * @param {number} input.dwellMs             required age; 0 disables the gate
 * @param {number} [input.now]               injectable clock (tests)
 * @returns {{allowed: boolean, reason: 'ok'|'not-opened'|'too-early', waitMs: number}}
 */
function dwellVerdict({ openedAt, dwellMs, now = Date.now() }) {
  if (!dwellMs || dwellMs <= 0) return { allowed: true, reason: 'ok', waitMs: 0 };
  if (!openedAt) return { allowed: false, reason: 'not-opened', waitMs: 0 };
  const waited = now - new Date(openedAt).getTime();
  if (!Number.isFinite(waited)) return { allowed: false, reason: 'not-opened', waitMs: 0 };
  if (waited >= dwellMs) return { allowed: true, reason: 'ok', waitMs: 0 };
  return { allowed: false, reason: 'too-early', waitMs: dwellMs - waited };
}

module.exports = { ensureSchema, requiredDwellMs, recordView, dwellVerdict, TABLE };
