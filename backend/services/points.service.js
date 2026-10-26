'use strict';
/**
 * Points, achievements and leaderboard recalculation.
 * Everything is derived from real rows in the database — no hardcoded ranks.
 *
 * ── How a user's points are made up ───────────────────────────────────────
 *   coding score   x  points_coding_multiplier
 * + quiz marks     x  points_quiz_multiplier
 * + courses done   x  points_course_completed
 * + perfect quizzes x points_perfect_quiz_bonus
 * + achievement rewards (achievements.points_reward)
 * + manual adjustments (point_adjustments ledger)
 * = users.points            (floored at 0)
 *
 * The earning rates live in the `settings` table so admins can retune them
 * from Points Management without a deploy. `recalcUser` is a full recompute,
 * which is why manual awards have to be a ledger: anything written straight
 * into users.points would be erased by the next submission.
 */
const { q, q1, exec, tx } = require('../config/db');
const { notify } = require('./notification.service');
const { assignRanks } = require('../utils/helpers');
const { readSetting } = require('./settings.service');

/** Fallbacks used when the settings rows are missing (fresh/old database). */
const POINTS = {
  problemAcceptedMultiplier: 2,   // each accepted submission's score is worth 2 points
  quizScoreMultiplier: 3,         // each quiz mark is worth 3 points
  courseCompleted: 50,
  perfectQuizBonus: 10,
};

/** setting key -> { default, label, hint } — also drives the admin UI. */
const RULES = {
  points_coding_multiplier: {
    dflt: POINTS.problemAcceptedMultiplier,
    label: 'Coding score multiplier',
    hint: 'Every point scored on a coding submission is worth this many platform points.',
  },
  points_quiz_multiplier: {
    dflt: POINTS.quizScoreMultiplier,
    label: 'Quiz mark multiplier',
    hint: 'Every mark earned in a quiz is worth this many platform points.',
  },
  points_course_completed: {
    dflt: POINTS.courseCompleted,
    label: 'Course completion bonus',
    hint: 'Flat points granted each time a student completes a course.',
  },
  points_perfect_quiz_bonus: {
    dflt: POINTS.perfectQuizBonus,
    label: 'Perfect quiz bonus',
    hint: 'Extra points for every quiz attempt scored 100%.',
  },
};

const RULE_KEYS = Object.keys(RULES);

/* ------------------------------------------------------------------ schema */

/**
 * The manual-adjustment ledger. Created on boot so an existing install picks
 * it up without a migration step — the same approach the rest of the codebase
 * uses (there is no migration framework here).
 */
/**
 * Bump this whenever computeBreakdown() changes how a total is worked out.
 * Boot compares it against the value stored in app_meta and, when they differ,
 * recomputes every stored total once — otherwise users keep showing the number
 * the OLD formula produced until something happens to recalculate them, and an
 * admin has to know to press "Recalculate everyone" by hand.
 */
const POINTS_FORMULA_VERSION = '2';

async function readMeta(key) {
  const row = await q1('SELECT meta_value FROM app_meta WHERE meta_key = ?', [key]).catch(() => null);
  return row ? row.meta_value : null;
}

async function writeMeta(key, value) {
  await exec(
    `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
    [key, String(value)],
  );
}

/**
 * Runs detached: a full recompute is O(users) queries and must never hold up
 * the HTTP listener. If the process dies midway the version marker is simply
 * not written, so the next boot picks the job up again.
 */
async function recalcIfFormulaChanged() {
  if (await readMeta('points_formula_version') === POINTS_FORMULA_VERSION) return;
  setImmediate(async () => {
    try {
      console.log('[points] earning formula changed — recalculating every stored total once…');
      const n = await recalcAll(false);
      await writeMeta('points_formula_version', POINTS_FORMULA_VERSION);
      console.log(`[points] done: ${n} users recalculated, stored totals now match the current rules.`);
    } catch (error) {
      console.error('[points] automatic recalculation failed:', error.message,
        '— run it by hand from Admin > Points Management > Recalculate everyone.');
    }
  });
}

async function ensureColumn(table, column, ddl) {
  const row = await q1(
    'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  );
  if (!Number(row.c)) { await exec(`ALTER TABLE \`${table}\` ${ddl}`); return true; }
  return false;
}

async function ensureIndex(table, index, ddl) {
  const row = await q1(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index],
  );
  if (!Number(row.c)) { await exec(ddl); return true; }
  return false;
}

async function ensureLeaderboardUniqueness() {
  // UNIQUE(scope, scope_ref, user_id) does not dedupe global/weekly/monthly
  // rows in MySQL because their scope_ref is NULL and NULLs never conflict.
  // A generated 0-for-NULL key gives those scopes the uniqueness the original
  // index appeared to promise. Existing duplicate snapshots are disposable;
  // keep the newest row per (scope, ref, user), then enforce it in the DB.
  await ensureColumn(
    'leaderboard', 'scope_ref_key',
    'ADD COLUMN scope_ref_key INT UNSIGNED GENERATED ALWAYS AS (COALESCE(scope_ref, 0)) VIRTUAL AFTER scope_ref',
  );
  await exec(
    `DELETE l FROM leaderboard l
       JOIN (
         SELECT scope, scope_ref_key, user_id, MAX(id) AS keep_id
           FROM leaderboard
          GROUP BY scope, scope_ref_key, user_id
          HAVING COUNT(*) > 1
       ) d ON d.scope = l.scope AND d.scope_ref_key = l.scope_ref_key
          AND d.user_id = l.user_id AND l.id <> d.keep_id`,
  );
  await ensureIndex(
    'leaderboard', 'uq_lb_scope_ref_key',
    'ALTER TABLE `leaderboard` ADD UNIQUE KEY `uq_lb_scope_ref_key` (`scope`,`scope_ref_key`,`user_id`)',
  );
}

async function ensureSchema() {
  await ensureLeaderboardUniqueness();
  await exec(
    `CREATE TABLE IF NOT EXISTS point_adjustments (
       id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
       user_id INT NOT NULL,
       delta INT NOT NULL,
       reason VARCHAR(255) NOT NULL DEFAULT '',
       created_by INT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       KEY idx_pa_user (user_id),
       KEY idx_pa_created (created_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );

  const { ensureFlag } = require('./featureFlags.service');
  const created = [];
  for (const key of RULE_KEYS) {
    const made = await ensureFlag({
      key,
      label: RULES[key].label,
      dflt: String(RULES[key].dflt),
      group: 'points',
      inputType: 'number',
    });
    if (made) created.push(key);
  }
  if (created.length) {
    require('./settings.service').invalidate();
    console.log(`[points] earning rules seeded: ${created.join(', ')}`);
  }

  // Tiny internal key/value store. Deliberately NOT the `settings` table: that
  // one is rendered as editable rows in Admin > Settings, and this marker is
  // not a knob anybody should turn.
  await exec(
    `CREATE TABLE IF NOT EXISTS app_meta (
       meta_key VARCHAR(64) NOT NULL PRIMARY KEY,
       meta_value VARCHAR(255) NOT NULL DEFAULT '',
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  await recalcIfFormulaChanged();
}

/* ------------------------------------------------------------------- rules */

/** Current earning rates, falling back to the built-in defaults. */
async function readRules() {
  const out = {};
  for (const key of RULE_KEYS) {
    const raw = await readSetting(key, null);
    const num = Number(raw);
    out[key] = raw === null || raw === '' || !Number.isFinite(num) ? RULES[key].dflt : num;
  }
  return out;
}

/* --------------------------------------------------------------- recompute */

/**
 * Recomputes one user's points from scratch and returns the full breakdown,
 * which is what the admin panel renders. `persist: false` lets the UI preview
 * a rule change without writing anything.
 */
async function computeBreakdown(userId, rules = null) {
  const r = rules || await readRules();

  const counts = await q1(
    `SELECT
       (SELECT COUNT(DISTINCT problem_id) FROM coding_submissions WHERE user_id = ? AND status='accepted') AS problems_solved,
       (SELECT COUNT(DISTINCT quiz_id) FROM quiz_attempts WHERE user_id = ? AND status='evaluated') AS quizzes_completed,
       (SELECT COUNT(*) FROM enrollments WHERE user_id = ? AND status='completed') AS courses_completed`,
    [userId, userId, userId],
  );
  // BEST score per problem, not the sum of every attempt. Summing every row
  // let a student re-submit the same solution (or even a wrong one, which also
  // carries a partial score) over and over and bank the points each time.
  // A problem can therefore never be worth more than its own `points` value.
  const codingScore = await q1(
    `SELECT COALESCE(SUM(best),0) AS s FROM (
       SELECT MAX(score) AS best FROM coding_submissions
        WHERE user_id = ? AND status NOT IN ('queued','running')
        GROUP BY problem_id
     ) t`, [userId],
  );
  // Same rule for quizzes: best *evaluated* attempt per quiz. The old query had
  // no status filter at all, so an abandoned or still-in-progress paper paid
  // out, and every re-attempt stacked on top of the previous one.
  const quizScore = await q1(
    `SELECT COALESCE(FLOOR(SUM(best)),0) AS s FROM (
       SELECT MAX(score) AS best FROM quiz_attempts
        WHERE user_id = ? AND status = 'evaluated'
        GROUP BY quiz_id
     ) t`, [userId],
  );
  const rewards = await q1(
    `SELECT COALESCE(SUM(a.points_reward),0) AS s FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id WHERE ua.user_id = ?`, [userId],
  );
  // Perfect papers were part of the original design but never actually paid
  // out; now that the bonus is configurable it is wired up for real.
  // DISTINCT: the bonus is for acing a quiz, not for acing it repeatedly.
  const perfect = await q1(
    `SELECT COUNT(DISTINCT quiz_id) AS n FROM quiz_attempts
      WHERE user_id = ? AND status = 'evaluated' AND total_marks > 0 AND score >= total_marks`, [userId],
  );
  const manual = await q1('SELECT COALESCE(SUM(delta),0) AS s FROM point_adjustments WHERE user_id = ?', [userId]);

  const parts = {
    coding: Number(codingScore.s) * r.points_coding_multiplier,
    quiz: Number(quizScore.s) * r.points_quiz_multiplier,
    courses: Number(counts.courses_completed) * r.points_course_completed,
    perfect_quiz: Number(perfect.n) * r.points_perfect_quiz_bonus,
    achievements: Number(rewards.s),
    manual: Number(manual.s),
  };
  const raw = Object.values(parts).reduce((a, b) => a + b, 0);

  return {
    parts,
    raw,
    // A penalty must never drag the leaderboard below zero.
    points: Math.max(0, Math.round(raw)),
    counts: {
      problems_solved: Number(counts.problems_solved),
      quizzes_completed: Number(counts.quizzes_completed),
      courses_completed: Number(counts.courses_completed),
      perfect_quizzes: Number(perfect.n),
      coding_score: Number(codingScore.s),
      quiz_score: Number(quizScore.s),
    },
    rules: r,
  };
}

async function recalcUser(userId) {
  const b = await computeBreakdown(userId);
  await exec(
    `UPDATE users SET points = ?, problems_solved = ?, quizzes_completed = ?, courses_completed = ? WHERE id = ?`,
    [b.points, b.counts.problems_solved, b.counts.quizzes_completed, b.counts.courses_completed, userId],
  );
  await refreshLeaderboard();
  return { points: b.points, ...b.counts };
}

/** Recompute everyone. Used by the admin panel after a rule change. */
async function recalcAll(onlyStudents = true) {
  const rows = await q(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      ${onlyStudents ? "WHERE r.slug = 'student'" : ''}`,
  );
  const rules = await readRules();
  for (const row of rows) {
    const b = await computeBreakdown(row.id, rules);
    await exec(
      `UPDATE users SET points = ?, problems_solved = ?, quizzes_completed = ?, courses_completed = ? WHERE id = ?`,
      [b.points, b.counts.problems_solved, b.counts.quizzes_completed, b.counts.courses_completed, row.id],
    );
  }
  // One rebuild at the end instead of one per user — the per-user path is
  // O(users) queries already and refreshLeaderboard truncates every time.
  await refreshLeaderboard();
  return rows.length;
}

/* ------------------------------------------------------- manual ledger API */

async function addAdjustment({ userId, delta, reason, actorId }) {
  await exec(
    'INSERT INTO point_adjustments (user_id, delta, reason, created_by) VALUES (?, ?, ?, ?)',
    [userId, Math.round(delta), String(reason || '').slice(0, 255), actorId || null],
  );
  const result = await recalcUser(userId);
  if (delta !== 0) {
    await notify({
      userId,
      audience: 'user',
      type: 'system',
      link: '/leaderboard',
      title: delta > 0 ? `+${delta} bonus points awarded` : `${delta} points deducted`,
      message: reason
        ? `${reason} — your total is now ${result.points} points.`
        : `Your total is now ${result.points} points.`,
    }).catch(() => { /* a failed notification must not undo the award */ });
  }
  return result;
}

async function removeAdjustment(id) {
  const row = await q1('SELECT user_id FROM point_adjustments WHERE id = ?', [id]);
  if (!row) return null;
  await exec('DELETE FROM point_adjustments WHERE id = ?', [id]);
  await recalcUser(row.user_id);
  return row.user_id;
}

/* --------------------------------------------------------------- leaderboard */

/** Recompute the global / weekly / monthly leaderboards from submissions. */
async function rebuildLeaderboard() {
  // Weekly/monthly used to be a raw SUM(score) over every submission in the
  // window, taken straight from coding_submissions with no role or status
  // filter. That put staff accounts and suspended students on a board the
  // global scope correctly excludes them from, and showed an un-multiplied
  // number next to the multiplied one on the Global tab. Both scopes now use
  // the same population and the same earning rule as `computeBreakdown`.
  const rules = await readRules();
  const codingMul = rules.points_coding_multiplier;

  await tx(async (conn) => {
    const connQ = async (sql, params = []) => (await conn.query(sql, params))[0];
    const connExec = async (sql, params = []) => (await conn.execute(sql, params))[0];
    const periodBoard = (scope, since, periodStart) => connExec(
      `INSERT INTO leaderboard (user_id, scope, problems_solved, points, submissions, accuracy, period_start)
       SELECT s.user_id, ?,
              COUNT(DISTINCT CASE WHEN s.status='accepted' THEN s.problem_id END),
              ROUND(COALESCE(MAX(bp.pts),0) * ?),
              COUNT(*),
              ROUND(100*SUM(s.status='accepted')/COUNT(*),2),
              ${periodStart}
         FROM coding_submissions s
         JOIN users u ON u.id = s.user_id
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN (
           SELECT user_id, SUM(best) AS pts FROM (
             SELECT user_id, problem_id, MAX(score) AS best
               FROM coding_submissions
              WHERE submitted_at >= ${since} AND status NOT IN ('queued','running')
              GROUP BY user_id, problem_id
           ) x GROUP BY user_id
         ) bp ON bp.user_id = s.user_id
        WHERE s.submitted_at >= ${since}
          AND r.slug = 'student' AND u.status <> 'suspended'
        GROUP BY s.user_id`,
      [scope, codingMul],
    );

    await connExec(`DELETE FROM leaderboard WHERE scope IN ('global','weekly','monthly')`);
    await connExec(
      `INSERT INTO leaderboard (user_id, scope, problems_solved, points, submissions, accuracy)
       SELECT u.id, 'global', u.problems_solved, u.points,
              (SELECT COUNT(*) FROM coding_submissions s WHERE s.user_id = u.id),
              COALESCE((SELECT ROUND(100*SUM(s.status='accepted')/COUNT(*),2) FROM coding_submissions s WHERE s.user_id = u.id),0)
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE r.slug = 'student' AND u.status <> 'suspended'`,
    );
    await periodBoard('weekly', 'NOW() - INTERVAL 7 DAY', 'CURDATE() - INTERVAL 7 DAY');
    await periodBoard('monthly', "DATE_FORMAT(CURDATE(),'%Y-%m-01')", "DATE_FORMAT(CURDATE(),'%Y-%m-01')");
    for (const scope of ['global', 'weekly', 'monthly']) {
      await assignRanks({ q: connQ, exec: connExec }, 'leaderboard',
        'points DESC, problems_solved DESC, submissions ASC', 'scope = ?', [scope]);
    }
    const contestScopes = await connQ(
      "SELECT DISTINCT scope_ref FROM leaderboard WHERE scope = 'contest' AND scope_ref IS NOT NULL",
    );
    for (const row of contestScopes) {
      await assignRanks({ q: connQ, exec: connExec }, 'leaderboard',
        'points DESC, problems_solved DESC', "scope = 'contest' AND scope_ref = ?", [row.scope_ref]);
    }
  });
}

let leaderboardRefreshPromise = null;
let leaderboardRefreshQueued = false;

/**
 * recalcUser() runs after ordinary submissions, so refresh requests can
 * arrive in bursts. Serialize them and coalesce a burst into at most one
 * follow-up rebuild; concurrent DELETE+INSERT sequences used to interleave
 * into duplicate/empty boards.
 */
function refreshLeaderboard() {
  if (leaderboardRefreshPromise) {
    leaderboardRefreshQueued = true;
    return leaderboardRefreshPromise;
  }
  leaderboardRefreshPromise = (async () => {
    try {
      do {
        leaderboardRefreshQueued = false;
        await rebuildLeaderboard();
      } while (leaderboardRefreshQueued);
    } finally {
      leaderboardRefreshPromise = null;
      leaderboardRefreshQueued = false;
    }
  })();
  return leaderboardRefreshPromise;
}

/** Award every achievement whose criteria the user now satisfies. */
async function awardAchievements(userId) {
  const before = await q('SELECT achievement_id FROM user_achievements WHERE user_id = ?', [userId]);
  const beforeIds = new Set(before.map((b) => b.achievement_id));

  await exec(
    `INSERT IGNORE INTO user_achievements (user_id, achievement_id)
     SELECT u.id, a.id FROM users u JOIN achievements a
      WHERE u.id = ? AND a.is_active = 1 AND (
        (a.criteria_type='problems_solved'       AND u.problems_solved   >= a.criteria_value) OR
        (a.criteria_type='quiz_count'            AND u.quizzes_completed >= a.criteria_value) OR
        (a.criteria_type='points'                AND u.points            >= a.criteria_value) OR
        (a.criteria_type='course_completed'      AND u.courses_completed >= a.criteria_value) OR
        (a.criteria_type='quiz_score'            AND EXISTS (SELECT 1 FROM quiz_attempts qa WHERE qa.user_id=u.id AND qa.total_marks>0 AND (qa.score/qa.total_marks)*100 >= a.criteria_value)) OR
        (a.criteria_type='contest_participation' AND EXISTS (SELECT 1 FROM contest_participants cp WHERE cp.user_id=u.id))
      )`, [userId],
  );

  const after = await q(
    `SELECT a.id, a.title, a.icon, a.points_reward FROM user_achievements ua
       JOIN achievements a ON a.id = ua.achievement_id WHERE ua.user_id = ?`, [userId],
  );
  const fresh = after.filter((a) => !beforeIds.has(a.id));
  for (const a of fresh) {
    await notify({
      userId, audience: 'user', type: 'achievement', link: '/student/achievements',
      title: `Achievement unlocked: ${a.title} ${a.icon || ''}`.trim(),
      message: `Congratulations! You unlocked "${a.title}"${a.points_reward ? ` and earned +${a.points_reward} bonus points` : ''}.`,
    });
  }
  if (fresh.length) await recalcUser(userId);

  // Auto-issue coding milestone certificates (idempotent) for key thresholds
  try {
    const { issueMilestone } = require('../controllers/certificate.controller');
    const me = await q1('SELECT problems_solved, quizzes_completed, courses_completed FROM users WHERE id=?', [userId]);
    if (me) {
      if ((me.problems_solved || 0) >= 1)   await issueMilestone(userId, 'first_accept', 'First Problem Accepted');
      if ((me.problems_solved || 0) >= 10)  await issueMilestone(userId, '10_problems',  '10 Problems Solved');
      if ((me.problems_solved || 0) >= 50)  await issueMilestone(userId, '50_problems',  '50 Problems Solved');
      if ((me.problems_solved || 0) >= 100) await issueMilestone(userId, '100_problems', '100 Problems Solved');
      if ((me.courses_completed || 0) >= 5) await issueMilestone(userId, '5_courses',    '5 Courses Completed');
    }
  } catch (_) { /* cert issuance must never block achievement awarding */ }

  return fresh;
}

module.exports = {
  recalcUser, refreshLeaderboard, awardAchievements, POINTS,
  ensureSchema, readRules, computeBreakdown, recalcAll,
  addAdjustment, removeAdjustment, RULES, RULE_KEYS,
  POINTS_FORMULA_VERSION, recalcIfFormulaChanged,
};
