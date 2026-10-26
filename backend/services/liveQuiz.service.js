'use strict';
/**
 * Live-quiz schema helpers.
 *
 * Students in the lobby are told to "wait for the host" but were never shown
 * who that is. The creator is not always the host — an admin can open the host
 * panel for a quiz somebody else built — so the person who actually pressed
 * Start is recorded on the quiz row and shown to the learners.
 */
const { q, q1, exec } = require('../config/db');

async function ensureColumn(table, column, ddl) {
  const row = await q1(
    'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  );
  if (!Number(row.c)) {
    await exec(`ALTER TABLE \`${table}\` ${ddl}`);
    console.log(`[live-quiz] column added: ${table}.${column}`);
    return true;
  }
  return false;
}

async function ensureIndex(table, index, ddl) {
  const row = await q1(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index],
  );
  if (!Number(row.c)) {
    await exec(ddl);
    return true;
  }
  return false;
}

async function ensureSchema() {
  await ensureColumn('quizzes', 'live_host_id', 'ADD COLUMN live_host_id INT NULL AFTER created_by');

  /* One running attempt per student per quiz — enforced by the DATABASE.
     startAttempt() checks for an existing in_progress row and inserts if there
     is none, which is a check-then-act race: six parallel "Start" clicks
     produced three live attempts in testing, and with re-attempts switched off
     that quietly defeats the one-attempt rule.
     MySQL has no partial indexes, so a virtual column holds the user id only
     while the attempt is running (NULL otherwise, and NULLs never collide in a
     unique key). */
  /* The column and the unique key are added in SEPARATE statements, each
     guarded on its own existence. The original code combined them into one
     ALTER (ADD COLUMN ..., ADD UNIQUE KEY (... active_slot)), which older
     MySQL/MariaDB builds (including the ones bundled with XAMPP) reject with
     "Key column 'active_slot' doesn't exist in table" because the column is
     not visible to the index spec within the same statement. Guarding only
     on the column also meant a half-applied state (column present, key
     missing) could never heal on a re-run. */
  await ensureColumn(
    'quiz_attempts',
    'active_slot',
    "ADD COLUMN active_slot INT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status = 'in_progress' THEN user_id ELSE NULL END) VIRTUAL",
  );
  // Any pre-existing duplicates have to go first or the ADD UNIQUE KEY is
  // rejected. The newest row is kept; older strays are marked abandoned,
  // never deleted.
  await exec(
    `UPDATE quiz_attempts a
       JOIN (SELECT quiz_id, user_id, MAX(id) AS keep_id
               FROM quiz_attempts WHERE status = 'in_progress'
              GROUP BY quiz_id, user_id HAVING COUNT(*) > 1) d
         ON d.quiz_id = a.quiz_id AND d.user_id = a.user_id
      SET a.status = 'abandoned'
     WHERE a.status = 'in_progress' AND a.id <> d.keep_id`,
  );
  const keyAdded = await ensureIndex(
    'quiz_attempts',
    'uq_attempt_active',
    'ALTER TABLE `quiz_attempts` ADD UNIQUE KEY `uq_attempt_active` (`quiz_id`, `active_slot`)',
  );
  if (keyAdded) console.log('[quiz] one-running-attempt-per-student constraint added');
}

/** Stamps whoever opened/started the live session as the host for this run. */
async function setHost(quizId, userId) {
  if (!quizId || !userId) return;
  await exec('UPDATE quizzes SET live_host_id = ? WHERE id = ?', [userId, quizId]);
}

module.exports = { ensureSchema, ensureColumn, setHost };
