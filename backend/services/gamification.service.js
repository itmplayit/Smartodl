'use strict';
/**
 * Gamification service — streaks, XP levels and activity heatmap.
 * Streaks count consecutive calendar days with at least one graded activity
 * (a code submission or a quiz submission). Dates are compared in UTC so the
 * judge, the API and MySQL always agree on what "today" is.
 */
const { q, q1, exec } = require('../config/db');

const dateOnly = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/* XP levels — thresholds are cumulative points. Titles show on profile/cards. */
const LEVELS = [
  { level: 1, title: 'Rookie', min: 0 },
  { level: 2, title: 'Learner', min: 100 },
  { level: 3, title: 'Coder', min: 300 },
  { level: 4, title: 'Problem Slayer', min: 700 },
  { level: 5, title: 'Pro', min: 1500 },
  { level: 6, title: 'Expert', min: 3000 },
  { level: 7, title: 'Master', min: 6000 },
  { level: 8, title: 'Grandmaster', min: 12000 },
  { level: 9, title: 'Legend', min: 25000 },
];

function levelOf(points) {
  const p = Number(points) || 0;
  let current = LEVELS[0];
  for (const lv of LEVELS) if (p >= lv.min) current = lv;
  const idx = LEVELS.indexOf(current);
  const next = LEVELS[idx + 1] || null;
  const span = next ? next.min - current.min : 1;
  const into = next ? p - current.min : 0;
  return {
    level: current.level,
    title: current.title,
    points: p,
    next_level: next ? next.level : null,
    next_title: next ? next.title : null,
    next_at: next ? next.min : null,
    progress_percent: next ? Math.min(100, Math.round((into / span) * 100)) : 100,
  };
}

/**
 * Record that the user did something gradable today and advance the streak.
 * Idempotent per day — multiple submissions on the same date never double-count.
 */
async function touchActivity(userId) {
  // One atomic statement, anchored to the database's UTC_DATE(). The older
  // SELECT-in-JS/UPDATE pair could double-advance under concurrent submits
  // and depended on how the driver decoded a DATE column into a JS Date.
  await exec(
    `UPDATE users
        SET streak_best = GREATEST(
              COALESCE(streak_best, 0),
              CASE WHEN last_activity_date = DATE_SUB(UTC_DATE(), INTERVAL 1 DAY)
                   THEN COALESCE(streak_days, 0) + 1 ELSE 1 END
            ),
            streak_days = CASE
              WHEN last_activity_date = DATE_SUB(UTC_DATE(), INTERVAL 1 DAY)
              THEN COALESCE(streak_days, 0) + 1 ELSE 1 END,
            last_activity_date = UTC_DATE()
      WHERE id = ?
        AND (last_activity_date IS NULL OR last_activity_date <> UTC_DATE())`,
    [userId],
  );
}

/** Activity counts for the last `days` days (heatmap data). */
async function heatmap(userId, days = 84) {
  const span = Math.max(1, Math.min(366, Number(days) || 84));
  const todayRow = await q1("SELECT DATE_FORMAT(UTC_DATE(), '%Y-%m-%d') AS today");
  const today = dateOnly(todayRow && todayRow.today) || new Date().toISOString().slice(0, 10);
  const [subs, attempts] = await Promise.all([
    q(
      `SELECT DATE_FORMAT(submitted_at, '%Y-%m-%d') AS d, COUNT(*) AS c
         FROM coding_submissions
        WHERE user_id = ? AND submitted_at >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
        GROUP BY DATE_FORMAT(submitted_at, '%Y-%m-%d')`,
      [userId, span - 1],
    ),
    q(
      `SELECT DATE_FORMAT(submitted_at, '%Y-%m-%d') AS d, COUNT(*) AS c
         FROM quiz_attempts
        WHERE user_id = ? AND status = 'evaluated' AND submitted_at IS NOT NULL
          AND submitted_at >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
        GROUP BY DATE_FORMAT(submitted_at, '%Y-%m-%d')`,
      [userId, span - 1],
    ),
  ]);
  const counts = new Map();
  for (const r of [...subs, ...attempts]) {
    const key = dateOnly(r.d);
    if (key) counts.set(key, (counts.get(key) || 0) + Number(r.c));
  }
  const out = [];
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  for (let i = span - 1; i >= 0; i -= 1) {
    const d = new Date(todayMs - i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d, count: counts.get(d) || 0 });
  }
  return out;
}

/** Full gamification snapshot for the signed-in user. */
async function summaryFor(userId) {
  const user = await q1(
    `SELECT points, streak_days, streak_best,
            DATE_FORMAT(last_activity_date, '%Y-%m-%d') AS last_activity_date,
            DATE_FORMAT(UTC_DATE(), '%Y-%m-%d') AS today,
            DATE_FORMAT(DATE_SUB(UTC_DATE(), INTERVAL 1 DAY), '%Y-%m-%d') AS yesterday
       FROM users WHERE id = ?`,
    [userId],
  );
  if (!user) return null;
  const last = dateOnly(user.last_activity_date);
  const liveStreak = last === user.today || last === user.yesterday;
  return {
    ...levelOf(user.points),
    streak_days: liveStreak ? Number(user.streak_days || 0) : 0,
    streak_best: Number(user.streak_best || 0),
    last_activity_date: last,
    heatmap: await heatmap(userId),
  };
}

module.exports = { LEVELS, levelOf, touchActivity, heatmap, summaryFor };
