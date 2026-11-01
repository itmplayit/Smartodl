'use strict';
/**
 * Quiz code answers: binding a completed run to what it actually proved.
 *
 * `quiz_answers.verified` is cleared when the student's own answer changes, but
 * NOT when an instructor edits a test case. Edit a case's expected output while
 * keeping the case count the same and a stale "passed 3 of 3" survived, so the
 * student was awarded full marks for code that never passed the corrected case.
 *
 * `verification_hash` is SHA-256 over (question id, language, submitted source,
 * the content of every test case). It is written when the run completes and
 * re-checked at grading time and on the submit gate, so any later edit to the
 * code or the cases invalidates the verdict instead of silently keeping it.
 *
 * Deliberately non-destructive: no row is rewritten. Answers stored before this
 * column existed simply have no hash, so if their attempt is still open the
 * student is asked to run the test cases again. Already-evaluated attempts keep
 * the score they were given — re-evaluation is refused anyway.
 */
const { q1, exec } = require('../config/db');

const TABLE = 'quiz_answers';
const COLUMN = 'verification_hash';

async function ensureSchema() {
  const row = await q1(
    'SELECT COUNT(*) AS c FROM information_schema.COLUMNS '
    + 'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [TABLE, COLUMN],
  );
  if (Number(row && row.c)) return false;

  await exec(
    `ALTER TABLE \`${TABLE}\` ADD COLUMN \`${COLUMN}\` CHAR(64) NULL AFTER \`tests_total\``,
  );
  return true;
}

module.exports = { ensureSchema, TABLE, COLUMN };
