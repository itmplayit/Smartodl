'use strict';
/**
 * Quiz attempt lifecycle helpers.
 *
 * A student who closes the tab leaves a `in_progress` attempt behind. The old
 * housekeeping in server.js only touched attempts older than **24 hours**, so
 * for a whole day:
 *  - the course page kept showing "in_progress" for a paper that was over,
 *  - pressing "Try again"/"Continue" re-opened the same dead paper whose writes
 *    are already rejected ("Time is over …"), and
 *  - a LIVE quiz's `max_participants` seats stayed occupied by ghosts.
 *
 * This module settles those attempts much sooner, and settles them the FAIR
 * way: it grades whatever answers were saved (`evaluateAttempt`) instead of
 * flat-marking them abandoned. Only attempts that cannot be graded fall back
 * to `abandoned`.
 *
 * Live sessions are never settled here while their window is still open — the
 * host ends those.
 */
const { q, exec } = require('../config/db');

/** Extra room on top of the quiz's own time limit before an attempt is settled. */
const DEADLINE_GRACE_MINUTES = 30;
/** Total silence that marks an attempt as gone when the quiz has no time limit. */
const IDLE_LIMIT_MINUTES = 24 * 60;
/** Never look at attempts younger than this. */
const MIN_AGE_MINUTES = 15;

/**
 * Pure decision function (unit-tested): is this attempt past saving?
 *
 * @param {{started_at: Date|string, last_seen_at?: Date|string|null, time_limit_minutes?: number|string|null}} row
 * @param {number} now epoch ms
 * @returns {boolean}
 */
function isExpiredAttempt(row, now = Date.now()) {
  const started = new Date(row.started_at).getTime();
  if (!Number.isFinite(started)) return false;
  const lastSeenRaw = row.last_seen_at ? new Date(row.last_seen_at).getTime() : NaN;
  const seen = Number.isFinite(lastSeenRaw) ? Math.max(started, lastSeenRaw) : started;
  const limit = Math.max(0, Number(row.time_limit_minutes) || 0);

  // 1. Past the quiz deadline (+ grace): the runner can no longer save answers.
  if (limit > 0 && now > started + (limit + DEADLINE_GRACE_MINUTES) * 60000) return true;
  // 2. Quiet for a whole day even though the quiz has no time limit.
  return now > seen + IDLE_LIMIT_MINUTES * 60000;
}

/** Mark one attempt abandoned (never a score, so it cannot hurt the learner). */
async function abandonOne(attemptId) {
  try {
    await exec(
      "UPDATE quiz_attempts SET status = 'abandoned', submitted_at = COALESCE(submitted_at, NOW()) WHERE id = ? AND status = 'in_progress'",
      [attemptId],
    );
    return true;
  } catch (_) { return false; }
}

/**
 * Settle one attempt. Returns 'graded' | 'abandoned' | 'skipped'.
 *
 * Nuance that matters: an attempt where the student never saved a single answer
 * is NOT graded to 0 — that would put a fake "evaluated 0/10" in their history
 * for a paper they never really sat. It is marked 'abandoned' instead. Anything
 * with saved work is graded exactly like a late submit would be.
 */
async function settleOne(attempt) {
  const { q1 } = require('../config/db');
  const saved = await q1(
    'SELECT COUNT(*) AS c FROM quiz_answers WHERE attempt_id = ? AND selected_answer IS NOT NULL',
    [attempt.id],
  ).catch(() => ({ c: 0 }));
  if (!Number(saved && saved.c)) {
    return (await abandonOne(attempt.id)) ? 'abandoned' : 'skipped';
  }
  const { evaluateAttempt } = require('../controllers/quiz.controller');
  try {
    await evaluateAttempt(attempt.id);
    return 'graded';
  } catch (_) {
    return (await abandonOne(attempt.id)) ? 'abandoned' : 'skipped';
  }
}

/**
 * Settle expired in-progress attempts. Scope it to one quiz/user for an instant
 * fix when the learner presses "Try again".
 */
async function settleExpiredAttempts({ quizId = null, userId = null, now = Date.now(), limit = 200 } = {}) {
  const where = [
    "qa.status = 'in_progress'",
    'qa.started_at < NOW() - INTERVAL ? MINUTE',
    // A live session with an open window is the host's business, never ours.
    "(z.status <> 'live' OR (z.end_at IS NOT NULL AND z.end_at < NOW()))",
  ];
  const params = [MIN_AGE_MINUTES];
  if (quizId) { where.push('qa.quiz_id = ?'); params.push(quizId); }
  if (userId) { where.push('qa.user_id = ?'); params.push(userId); }

  const rows = await q(
    `SELECT qa.id, qa.started_at, qa.last_seen_at, z.time_limit_minutes
       FROM quiz_attempts qa JOIN quizzes z ON z.id = qa.quiz_id
      WHERE ${where.join(' AND ')}
      ORDER BY qa.id LIMIT ?`,
    [...params, limit],
  );

  let graded = 0; let abandoned = 0;
  for (const row of rows) {
    if (!isExpiredAttempt(row, now)) continue;
    const outcome = await settleOne(row);
    if (outcome === 'graded') graded += 1;
    else if (outcome === 'abandoned') abandoned += 1;
  }
  return { graded, abandoned, checked: rows.length };
}

/** Boot + periodic sweep, unref'd so tests/CLI can exit. */
function startAttemptSweeper({ intervalMs = 15 * 60 * 1000 } = {}) {
  const run = (label) => settleExpiredAttempts()
    .then(({ graded, abandoned }) => {
      if (graded || abandoned) {
        console.log(`[quiz-attempts] ${label}: ${graded} expired attempt(s) graded from saved answers, ${abandoned} abandoned`);
      }
    })
    .catch((error) => console.warn('[quiz-attempts] sweep failed:', error.message));
  run('boot sweep').finally(() => {
    const timer = setInterval(() => run('periodic sweep'), intervalMs);
    if (timer.unref) timer.unref();
  });
}

module.exports = {
  isExpiredAttempt,
  settleExpiredAttempts,
  startAttemptSweeper,
  DEADLINE_GRACE_MINUTES,
  IDLE_LIMIT_MINUTES,
};
