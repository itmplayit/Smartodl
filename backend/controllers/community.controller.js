'use strict';
/**
 * Community & engagement controllers — Feature Pack v2:
 *  - gamification summary (streak / XP level / heatmap)
 *  - problem of the day
 *  - hint unlocks (costs points)
 *  - course reviews
 *  - discussions (Q&A threads on problems & courses) with replies
 */
const { q, q1, exec, tx } = require('../config/db');
const { ApiError, asyncHandler, ok, created } = require('../utils/helpers');
const gamification = require('../services/gamification.service');
const { refreshLeaderboard } = require('../services/points.service');

const HINT_COST = (() => {
  const value = Number(process.env.HINT_COST_POINTS || 10);
  return Number.isFinite(value) ? Math.min(10000, Math.max(0, Math.floor(value))) : 10;
})();

/* ------------------------------ gamification ------------------------------ */
const myGamification = asyncHandler(async (req, res) => {
  const data = await gamification.summaryFor(req.user.id);
  if (!data) throw ApiError.notFound('User not found');
  ok(res, data);
});

const levelTable = asyncHandler(async (req, res) => ok(res, gamification.LEVELS));

/* ---------------------------- problem of the day ---------------------------- */
const problemOfDay = asyncHandler(async (req, res) => {
  // deterministic per calendar day: pick among published problems by day-of-year
  const published = await q("SELECT id FROM coding_problems WHERE status = 'published' ORDER BY id");
  // an empty platform is a normal state (fresh install) — return null, not an error,
  // so the browser console stays clean
  if (!published.length) return ok(res, null);
  const now = new Date();
  const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayOfYear = Math.floor((utcToday - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000);
  const pick = published[dayOfYear % published.length];
  const problem = await q1(
    `SELECT p.id, p.title, p.slug, p.difficulty, p.points, p.time_limit_ms, cat.name AS category_name,
            (SELECT COUNT(*) FROM coding_submissions s WHERE s.problem_id = p.id) AS total_submissions,
            (SELECT COUNT(*) FROM coding_submissions s WHERE s.problem_id = p.id AND s.status = 'accepted') AS accepted_submissions
       FROM coding_problems p LEFT JOIN categories cat ON cat.id = p.category_id WHERE p.id = ?`,
    [pick.id],
  );
  let solved = false;
  if (req.user) {
    solved = !!(await q1(
      "SELECT id FROM coding_submissions WHERE user_id = ? AND problem_id = ? AND status = 'accepted' LIMIT 1",
      [req.user.id, pick.id],
    ));
  }
  ok(res, { ...problem, solved, date: now.toISOString().slice(0, 10), hint_cost: HINT_COST });
});

/* -------------------------------- hint unlock -------------------------------- */
const unlockHint = asyncHandler(async (req, res) => {
  const problem = await q1(
    'SELECT id, hints, status, is_premium, created_by FROM coding_problems WHERE id = ?',
    [req.params.id],
  );
  if (!problem) throw ApiError.notFound('Problem not found');
  if (!problem.hints || !String(problem.hints).trim()) throw ApiError.badRequest('This problem has no hint yet');

  const canManage = ['owner', 'admin'].includes(req.user.role)
    || (req.user.role === 'developer' && Number(problem.created_by) === Number(req.user.id));
  if (canManage) return ok(res, { unlocked: true, already: true, cost: 0, hints: problem.hints });
  if (problem.status !== 'published') throw ApiError.forbidden('This problem is not published yet');
  if (Number(problem.is_premium)) {
    const subscriptions = require('../services/subscription.service');
    if (!(await subscriptions.hasPremiumAccess(req.user))) {
      throw subscriptions.premiumError('coding problem hint');
    }
  }

  // Lock the user row first, then re-check the unlock inside the same
  // transaction. Checking before the lock let a concurrent double-click
  // reach the INSERT and fail with a duplicate-key 500.
  const result = await tx(async (conn) => {
    const [[user]] = await conn.query('SELECT points FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
    if (!user) throw ApiError.notFound('User not found');
    const [[already]] = await conn.query(
      'SELECT 1 AS x FROM user_hint_unlocks WHERE user_id = ? AND problem_id = ?',
      [req.user.id, problem.id],
    );
    if (already) return { unlocked: true, already: true, cost: 0, hints: problem.hints };
    if (Number(user.points || 0) < HINT_COST) {
      throw ApiError.forbidden(`Unlocking a hint costs ${HINT_COST} points — you have ${Number(user.points || 0)}. Solve more problems first!`);
    }
    await conn.query('INSERT INTO user_hint_unlocks (user_id, problem_id) VALUES (?,?)', [req.user.id, problem.id]);
    // The spend has to go through the point_adjustments ledger. users.points is
    // a materialised total that recalcUser() recomputes from scratch on the next
    // submission / quiz / course completion, so a bare `points = points - cost`
    // was silently refunded and the hint ended up free.
    await conn.query(
      'INSERT INTO point_adjustments (user_id, delta, reason, created_by) VALUES (?,?,?,?)',
      [req.user.id, -HINT_COST, `Hint unlocked — problem #${problem.id}`, null],
    );
    // Keep the materialised total in step so the balance is right immediately;
    // the ledger row is what makes it survive the next recompute.
    await conn.query('UPDATE users SET points = GREATEST(points - ?, 0) WHERE id = ?', [HINT_COST, req.user.id]);
    return { unlocked: true, already: false, cost: HINT_COST, hints: problem.hints };
  });
  if (!result.already) {
    // Rebuild only after the spending transaction commits: leaderboard tables
    // are materialized separately from users.points. A rebuild failure should
    // not turn a successful, persisted unlock into a misleading API failure.
    try {
      await refreshLeaderboard();
    } catch (error) {
      console.error('[points] leaderboard refresh after hint unlock failed:', error.message);
    }
  }
  ok(res, result);
});

/** Adds hint availability info to a problem payload (used by coding.controller). */
async function hintInfo(userId, problemId, hasHints) {
  if (!hasHints) return { has_hint: false, hint_unlocked: false, hint_cost: HINT_COST };
  if (!userId) return { has_hint: true, hint_unlocked: false, hint_cost: HINT_COST };
  const unlocked = await q1('SELECT 1 AS x FROM user_hint_unlocks WHERE user_id = ? AND problem_id = ?', [userId, problemId]);
  return { has_hint: true, hint_unlocked: !!unlocked, hint_cost: HINT_COST };
}

/* -------------------------------- course reviews -------------------------------- */
async function visibleCourse(req, courseRef) {
  // The public course page lives at /courses/<slug>, so every course-scoped
  // endpoint has to accept a slug as well as a numeric id. It used to accept
  // only ids, which turned the course page's own review call into a 404.
  const course = await q1(
    'SELECT id, status, instructor_id FROM courses WHERE id = ? OR slug = ? LIMIT 1',
    [Number(courseRef) || 0, String(courseRef)],
  );
  if (!course) throw ApiError.notFound('Course not found');
  const canManage = !!req.user && (
    ['owner', 'admin'].includes(req.user.role)
    || (req.user.role === 'developer' && Number(course.instructor_id) === Number(req.user.id))
  );
  if (course.status !== 'published' && !canManage) throw ApiError.notFound('Course not found');
  return { course, canManage };
}

const listReviews = asyncHandler(async (req, res) => {
  const { course } = await visibleCourse(req, req.params.id);
  const rows = await q(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.full_name, u.avatar,
            (SELECT slug FROM roles ro WHERE ro.id = u.role_id) AS role
       FROM course_reviews r JOIN users u ON u.id = r.user_id
      WHERE r.course_id = ? ORDER BY r.created_at DESC LIMIT 50`,
    [course.id],
  );
  // Same trap as the row query above: the aggregate and "my review" lookups used
  // the raw URL param, so on a slug URL the page showed "0 reviews" while the
  // list right underneath was full.
  const agg = await q1('SELECT COUNT(*) AS count, COALESCE(AVG(rating),0) AS average FROM course_reviews WHERE course_id = ?', [course.id]);
  let mine = null;
  if (req.user) mine = await q1('SELECT id, rating, comment FROM course_reviews WHERE course_id = ? AND user_id = ?', [course.id, req.user.id]);
  ok(res, { reviews: rows, count: Number(agg.count), average: Math.round(Number(agg.average) * 10) / 10, mine });
});

const upsertReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const stars = Number(rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw ApiError.badRequest('Rating must be a whole number between 1 and 5 stars');
  }
  const { course } = await visibleCourse(req, req.params.id);
  if (course.status !== 'published') throw ApiError.forbidden('Reviews open after the course is published');
  const enrolled = await q1(
    'SELECT id FROM enrollments WHERE course_id = ? AND user_id = ?',
    [course.id, req.user.id],
  );
  if (!enrolled) throw ApiError.forbidden('Enroll in this course before reviewing it');
  await exec(
    `INSERT INTO course_reviews (course_id, user_id, rating, comment) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment)`,
    [course.id, req.user.id, stars, comment ? String(comment).trim().slice(0, 1000) || null : null],
  );
  ok(res, { saved: true });
});

const removeReview = asyncHandler(async (req, res) => {
  const row = await q1('SELECT id, user_id FROM course_reviews WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Review not found');
  if (Number(row.user_id) !== Number(req.user.id) && !['owner', 'admin'].includes(req.user.role)) {
    throw ApiError.forbidden('You can only delete your own review');
  }
  await exec('DELETE FROM course_reviews WHERE id = ?', [row.id]);
  ok(res, { deleted: true });
});

/* -------------------------------- discussions -------------------------------- */
const PARENT_TYPES = ['problem', 'course'];

async function assertDiscussionParentVisible(req, parentType, parentId) {
  if (!PARENT_TYPES.includes(parentType)) {
    throw ApiError.badRequest('parent_type must be problem or course');
  }
  // A course page lives at /courses/<slug>, so a slug is a legal parent_id for
  // course discussions. Resolve it to the numeric id BEFORE validating, instead
  // of answering 400 to a perfectly valid course.
  let id = Number(parentId);
  if (parentType === 'course' && (!Number.isInteger(id) || id <= 0)) {
    const bySlug = await q1('SELECT id FROM courses WHERE slug = ? LIMIT 1', [String(parentId || '')]);
    id = bySlug ? Number(bySlug.id) : NaN;
  }
  if (!Number.isInteger(id) || id <= 0) {
    throw ApiError.badRequest('parent_type (problem|course) and parent_id are required');
  }

  if (parentType === 'problem') {
    const problem = await q1(
      'SELECT id, status, is_premium, created_by FROM coding_problems WHERE id = ?',
      [id],
    );
    if (!problem) throw ApiError.notFound('Problem not found');
    const canManage = !!req.user && (
      ['owner', 'admin'].includes(req.user.role)
      || (req.user.role === 'developer' && Number(problem.created_by) === Number(req.user.id))
    );
    if (problem.status !== 'published' && !canManage) throw ApiError.notFound('Problem not found');
    if (Number(problem.is_premium) && !canManage) {
      const subscriptions = require('../services/subscription.service');
      if (!(await subscriptions.hasPremiumAccess(req.user))) throw subscriptions.premiumError('problem discussion');
    }
    return problem;
  }

  const { course, canManage } = await visibleCourse(req, id);
  const fullCourse = await q1('SELECT is_premium FROM courses WHERE id = ?', [course.id]);
  if (Number(fullCourse.is_premium) && !canManage) {
    const subscriptions = require('../services/subscription.service');
    if (!(await subscriptions.hasPremiumAccess(req.user))) throw subscriptions.premiumError('course discussion');
  }
  return course;
}

const listDiscussions = asyncHandler(async (req, res) => {
  const { parent_type: parentType, parent_id: parentId } = req.query;
  const parent = await assertDiscussionParentVisible(req, parentType, parentId);
  const rows = await q(
    `SELECT d.id, d.title, d.body, d.created_at, u.full_name, u.avatar,
            (SELECT COUNT(*) FROM discussion_replies r WHERE r.discussion_id = d.id) AS reply_count,
            (SELECT MAX(r2.created_at) FROM discussion_replies r2 WHERE r2.discussion_id = d.id) AS last_reply_at
       FROM discussions d JOIN users u ON u.id = d.user_id
      WHERE d.parent_type = ? AND d.parent_id = ?
      ORDER BY GREATEST(d.created_at, COALESCE((SELECT MAX(r3.created_at) FROM discussion_replies r3 WHERE r3.discussion_id = d.id), d.created_at)) DESC
      LIMIT 50`,
    [parentType, parent.id],
  );
  ok(res, rows);
});

const createDiscussion = asyncHandler(async (req, res) => {
  const { parent_type: parentType, parent_id: parentId, title, body } = req.body;
  const parent = await assertDiscussionParentVisible(req, parentType, parentId);
  const cleanTitle = String(title || '').trim().slice(0, 200);
  if (!cleanTitle) throw ApiError.badRequest('A title is required');
  const cleanBody = body ? String(body).trim().slice(0, 4000) || null : null;
  const result = await exec(
    'INSERT INTO discussions (parent_type, parent_id, user_id, title, body) VALUES (?,?,?,?,?)',
    [parentType, parent.id, req.user.id, cleanTitle, cleanBody],
  );
  const row = await q1(
    `SELECT d.id, d.title, d.body, d.created_at, u.full_name, u.avatar, 0 AS reply_count, NULL AS last_reply_at
       FROM discussions d JOIN users u ON u.id = d.user_id WHERE d.id = ?`,
    [result.insertId],
  );
  created(res, row);
});

async function visibleDiscussion(req, discussionId) {
  const disc = await q1(
    `SELECT d.id, d.parent_type, d.parent_id, d.title, d.body, d.created_at, u.full_name, u.avatar
       FROM discussions d JOIN users u ON u.id = d.user_id WHERE d.id = ?`,
    [discussionId],
  );
  if (!disc) throw ApiError.notFound('Discussion not found');
  await assertDiscussionParentVisible(req, disc.parent_type, disc.parent_id);
  return disc;
}

const discussionReplies = asyncHandler(async (req, res) => {
  const disc = await visibleDiscussion(req, req.params.id);
  const replies = await q(
    `SELECT r.id, r.body, r.created_at, u.full_name, u.avatar,
            (SELECT slug FROM roles ro WHERE ro.id = u.role_id) AS role
       FROM discussion_replies r JOIN users u ON u.id = r.user_id
      WHERE r.discussion_id = ? ORDER BY r.created_at ASC LIMIT 200`,
    [disc.id],
  );
  ok(res, { discussion: disc, replies });
});

const addReply = asyncHandler(async (req, res) => {
  const { body } = req.body;
  const cleanBody = String(body || '').trim().slice(0, 4000);
  if (!cleanBody) throw ApiError.badRequest('Reply cannot be empty');
  const disc = await visibleDiscussion(req, req.params.id);
  // Insert only if the discussion still exists, and fetch *this* inserted row.
  // The old "latest reply in the whole table" read-back could return another
  // user's simultaneous reply as the response to this request.
  const result = await exec(
    `INSERT INTO discussion_replies (discussion_id, user_id, body)
     SELECT id, ?, ? FROM discussions WHERE id = ?`,
    [req.user.id, cleanBody, disc.id],
  );
  if (Number(result.affectedRows) !== 1) throw ApiError.notFound('Discussion not found');
  const row = await q1(
    `SELECT r.id, r.body, r.created_at, u.full_name, u.avatar,
            (SELECT slug FROM roles ro WHERE ro.id = u.role_id) AS role
       FROM discussion_replies r JOIN users u ON u.id = r.user_id WHERE r.id = ?`,
    [result.insertId],
  );
  created(res, row);
});

module.exports = {
  HINT_COST, hintInfo,
  myGamification, levelTable, problemOfDay, unlockHint,
  listReviews, upsertReview, removeReview,
  listDiscussions, createDiscussion, discussionReplies, addReply,
};
