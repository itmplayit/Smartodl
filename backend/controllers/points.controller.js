'use strict';
/**
 * Points Management — the admin-side control surface for the points economy.
 *
 * Three things live here:
 *   1. the earning rules (multipliers/bonuses, stored in `settings`)
 *   2. a per-user breakdown of where someone's points came from
 *   3. the manual-adjustment ledger (award / deduct / revoke) + recalculation
 *
 * Manual awards are deliberately a ledger rather than a write to users.points:
 * recalcUser() is a full recompute and would otherwise wipe them.
 */
const { q, q1 } = require('../config/db');
const { ApiError, asyncHandler, ok, parsePagination } = require('../utils/helpers');
const points = require('../services/points.service');
const { updateSettings } = require('../services/settings.service');

/* -------------------------------------------------------------- the rules */

const getRules = asyncHandler(async (req, res) => {
  const values = await points.readRules();
  ok(res, {
    rules: points.RULE_KEYS.map((key) => ({
      key,
      value: values[key],
      label: points.RULES[key].label,
      hint: points.RULES[key].hint,
      default: points.RULES[key].dflt,
    })),
  });
});

const updateRules = asyncHandler(async (req, res) => {
  const incoming = req.body && req.body.rules;
  if (!incoming || typeof incoming !== 'object') throw ApiError.badRequest('rules object is required');

  const payload = {};
  for (const key of points.RULE_KEYS) {
    if (!(key in incoming)) continue;
    const num = Number(incoming[key]);
    if (!Number.isFinite(num)) throw ApiError.badRequest(`${points.RULES[key].label} must be a number`);
    if (num < 0) throw ApiError.badRequest(`${points.RULES[key].label} cannot be negative`);
    if (num > 100000) throw ApiError.badRequest(`${points.RULES[key].label} is unrealistically large`);
    payload[key] = String(num);
  }
  if (!Object.keys(payload).length) throw ApiError.badRequest('No known rule keys were supplied');

  await updateSettings(payload, req.user.id);

  // Rates changed, so every stored total is now stale. Recomputing here keeps
  // the leaderboard honest instead of drifting until the next submission.
  const affected = await points.recalcAll(true);
  ok(res, { updated: Object.keys(payload), recalculated: affected, rules: await points.readRules() });
});

/* ------------------------------------------------------------- user lists */

/** Paginated roster with points, used as the panel's main table. */
const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const search = String(req.query.search || '').trim();
  const role = String(req.query.role || 'student').trim();

  const where = [];
  const params = [];
  if (role && role !== 'all') { where.push('r.slug = ?'); params.push(role); }
  if (search) {
    where.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.college LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await q(
    `SELECT u.id, u.full_name, u.email, u.college, u.avatar, u.status, u.points,
            u.problems_solved, u.quizzes_completed, u.courses_completed, r.slug AS role,
            COALESCE((SELECT SUM(delta) FROM point_adjustments pa WHERE pa.user_id = u.id), 0) AS manual_points,
            (SELECT COUNT(*) FROM point_adjustments pa WHERE pa.user_id = u.id) AS adjustment_count
       FROM users u JOIN roles r ON r.id = u.role_id
       ${clause}
      ORDER BY u.points DESC, u.full_name ASC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = await q1(
    `SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id ${clause}`, params,
  );
  ok(res, rows, { page, limit, total: Number(total.n), pages: Math.ceil(Number(total.n) / limit) });
});

/** Full breakdown for one user + their adjustment history. */
const userDetail = asyncHandler(async (req, res) => {
  const user = await q1(
    `SELECT u.id, u.full_name, u.email, u.college, u.avatar, u.status, u.points, r.slug AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [req.params.id],
  );
  if (!user) throw ApiError.notFound('User not found');

  const breakdown = await points.computeBreakdown(user.id);
  const history = await q(
    `SELECT pa.id, pa.delta, pa.reason, pa.created_at, a.full_name AS actor
       FROM point_adjustments pa LEFT JOIN users a ON a.id = pa.created_by
      WHERE pa.user_id = ? ORDER BY pa.created_at DESC, pa.id DESC LIMIT 100`, [user.id],
  );
  const achievements = await q(
    `SELECT a.title, a.icon, a.points_reward, ua.awarded_at
       FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id
      WHERE ua.user_id = ? ORDER BY ua.awarded_at DESC`, [user.id],
  ).catch(() => []);

  ok(res, {
    user,
    // `stored` can lag `breakdown.points` if a rule changed and nothing has
    // been recalculated yet — the UI surfaces that as a "needs recalc" hint.
    stored_points: Number(user.points || 0),
    breakdown,
    history,
    achievements,
  });
});

/* ------------------------------------------------------ manual adjustments */

const adjust = asyncHandler(async (req, res) => {
  const user = await q1('SELECT id, full_name FROM users WHERE id = ?', [req.params.id]);
  if (!user) throw ApiError.notFound('User not found');

  const mode = String(req.body.mode || 'delta');
  const reason = String(req.body.reason || '').trim();
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount)) throw ApiError.badRequest('amount must be a number');
  if (Math.abs(amount) > 1000000) throw ApiError.badRequest('amount is unrealistically large');
  if (!reason) throw ApiError.badRequest('A reason is required — it is shown in the audit trail');

  let delta = Math.round(amount);
  if (mode === 'set') {
    // "Set total to N": work out the delta that lands the user exactly on N,
    // so the earned component keeps updating normally afterwards. The delta is
    // measured against the *current* total — earlier adjustments stay in the
    // ledger, so subtracting only the earned part would double-count them.
    const b = await points.computeBreakdown(user.id);
    delta = Math.round(amount) - Math.round(b.raw);
  } else if (mode === 'deduct') {
    delta = -Math.abs(Math.round(amount));
  }
  if (delta === 0) throw ApiError.badRequest('That would not change the total');

  const result = await points.addAdjustment({
    userId: user.id, delta, reason, actorId: req.user.id,
  });
  ok(res, { user_id: user.id, delta, points: result.points });
});

const revokeAdjustment = asyncHandler(async (req, res) => {
  const userId = await points.removeAdjustment(req.params.adjustmentId);
  if (!userId) throw ApiError.notFound('Adjustment not found');
  const user = await q1('SELECT points FROM users WHERE id = ?', [userId]);
  ok(res, { user_id: userId, points: Number(user ? user.points : 0) });
});

/** Platform-wide audit trail of every manual award. */
const listAdjustments = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const rows = await q(
    `SELECT pa.id, pa.delta, pa.reason, pa.created_at,
            u.id AS user_id, u.full_name, u.email,
            a.full_name AS actor
       FROM point_adjustments pa
       JOIN users u ON u.id = pa.user_id
       LEFT JOIN users a ON a.id = pa.created_by
      ORDER BY pa.created_at DESC, pa.id DESC
      LIMIT ? OFFSET ?`, [limit, offset],
  );
  const total = await q1('SELECT COUNT(*) AS n FROM point_adjustments');
  ok(res, rows, { page, limit, total: Number(total.n), pages: Math.ceil(Number(total.n) / limit) });
});

/* ------------------------------------------------------------ maintenance */

const recalcOne = asyncHandler(async (req, res) => {
  const user = await q1('SELECT id FROM users WHERE id = ?', [req.params.id]);
  if (!user) throw ApiError.notFound('User not found');
  const result = await points.recalcUser(user.id);
  ok(res, result);
});

const recalcEveryone = asyncHandler(async (req, res) => {
  const onlyStudents = String(req.query.scope || 'students') !== 'all';
  const n = await points.recalcAll(onlyStudents);
  ok(res, { recalculated: n, scope: onlyStudents ? 'students' : 'all users' });
});

/** Headline numbers for the cards at the top of the panel. */
const overview = asyncHandler(async (req, res) => {
  const totals = await q1(
    `SELECT COUNT(*) AS students,
            COALESCE(SUM(u.points),0) AS total_points,
            COALESCE(ROUND(AVG(u.points)),0) AS avg_points,
            COALESCE(MAX(u.points),0) AS top_points
       FROM users u JOIN roles r ON r.id = u.role_id WHERE r.slug = 'student'`,
  );
  const manual = await q1(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END),0) AS awarded,
            COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END),0) AS deducted
       FROM point_adjustments`,
  );
  const top = await q(
    `SELECT u.id, u.full_name, u.avatar, u.points FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.slug = 'student' ORDER BY u.points DESC LIMIT 5`,
  );
  ok(res, {
    students: Number(totals.students),
    total_points: Number(totals.total_points),
    avg_points: Number(totals.avg_points),
    top_points: Number(totals.top_points),
    adjustments: Number(manual.n),
    manual_awarded: Number(manual.awarded),
    manual_deducted: Number(manual.deducted),
    top,
    rules: await points.readRules(),
  });
});

module.exports = {
  getRules, updateRules, listUsers, userDetail,
  adjust, revokeAdjustment, listAdjustments,
  recalcOne, recalcEveryone, overview,
};
