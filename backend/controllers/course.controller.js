'use strict';
/** Courses, modules, lessons and enrollments. */
const fs = require('fs');
const { q, q1, exec, tx } = require('../config/db');
const { ApiError, asyncHandler, ok, created, slugify, parsePagination, sorting, toBool, safeExternalUrl } = require('../utils/helpers');
const { publicUrl } = require('../middleware/upload');
const { notify } = require('../services/notification.service');
const subs = require('../services/subscription.service');
const lessonOpens = require('../services/lessonOpens.service');
const { assertLessonAccess } = require('../services/lessonAccess.service');
const lessonWatch = require('../services/lessonWatch.service');
const {
  evaluateCompletion, normalisePolicy, requiresQuiz, requiredQuizForModule, POLICIES, POLICY_LABELS,
} = require('../utils/completionPolicy');
const moduleQuiz = require('../services/moduleQuiz.service');
const lessonMedia = require('../services/lessonMedia.service');
const { summarizeCourseAnalytics, describeCourseHealth } = require('../utils/courseInsights');
const { recommendCourses, skillTokens } = require('../utils/recommendations');
const { buildXlsx } = require('../utils/xlsx');

const COURSE_STATUSES = ['draft', 'published', 'unpublished'];
const COURSE_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const isCourseManager = (user, course) => !!user && (
  ['owner', 'admin'].includes(user.role)
  || (user.role === 'developer' && course && Number(course.instructor_id) === Number(user.id))
);
const boundedDecimal = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

async function validatedCategoryId(value) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw ApiError.badRequest('category_id is invalid');
  const category = await q1('SELECT id FROM categories WHERE id = ?', [id]);
  if (!category) throw ApiError.badRequest('category_id does not exist');
  return id;
}

async function assertInstructor(instructorId) {
  const instructor = await q1(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = ? AND u.status = 'active' AND r.slug IN ('owner','admin','developer')`,
    [instructorId],
  );
  if (!instructor) throw ApiError.badRequest('instructor_id must be an active owner, admin or developer account');
}

async function refreshCourseProgress(courseId) {
  // Curriculum edits change the denominator. Recompute materialised progress
  // immediately instead of leaving a course marked complete after a new
  // lesson is added (certificates already issued stay as historical awards).
  await exec(
    `UPDATE enrollments e
        SET e.completed_lessons = (
              SELECT COUNT(*) FROM lesson_progress lp
                JOIN lessons l ON l.id = lp.lesson_id
               WHERE lp.user_id = e.user_id AND lp.course_id = e.course_id
            ),
            e.progress_percent = CASE
              WHEN (SELECT COUNT(*) FROM lessons l WHERE l.course_id = e.course_id) = 0 THEN 0
              ELSE ROUND(100 * (
                SELECT COUNT(*) FROM lesson_progress lp
                  JOIN lessons l ON l.id = lp.lesson_id
                 WHERE lp.user_id = e.user_id AND lp.course_id = e.course_id
              ) / (SELECT COUNT(*) FROM lessons l WHERE l.course_id = e.course_id), 2)
            END,
            e.status = CASE
              WHEN (SELECT COUNT(*) FROM lessons l WHERE l.course_id = e.course_id) > 0
               AND (SELECT COUNT(*) FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id
                     WHERE lp.user_id = e.user_id AND lp.course_id = e.course_id)
                   >= (SELECT COUNT(*) FROM lessons l WHERE l.course_id = e.course_id)
              THEN 'completed' ELSE 'active' END,
            e.completed_at = CASE
              WHEN (SELECT COUNT(*) FROM lessons l WHERE l.course_id = e.course_id) > 0
               AND (SELECT COUNT(*) FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id
                     WHERE lp.user_id = e.user_id AND lp.course_id = e.course_id)
                   >= (SELECT COUNT(*) FROM lessons l WHERE l.course_id = e.course_id)
              THEN COALESCE(e.completed_at, NOW()) ELSE NULL END
      WHERE e.course_id = ?`,
    [courseId],
  );
}

const COURSE_SELECT = `c.*, cat.name AS category_name, cat.slug AS category_slug,
  u.full_name AS instructor_name, u.avatar AS instructor_avatar`;

/** GET /api/courses — public catalogue with filters + sorting */
const listCourses = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const where = [], params = [];
  const isStaff = req.user && ['owner', 'admin', 'developer'].includes(req.user.role);
  const userId = req.user ? req.user.id : null;
  if (!isStaff) where.push("c.status = 'published'");
  else if (req.user.role === 'developer') {
    where.push("(c.status = 'published' OR c.instructor_id = ?)");
    params.push(userId);
    if (req.query.status) { where.push('c.status = ?'); params.push(req.query.status); }
  }
  else if (req.query.status) { where.push('c.status = ?'); params.push(req.query.status); }
  if (req.query.category) { where.push('(cat.slug = ? OR c.category_id = ?)'); params.push(req.query.category, Number(req.query.category) || 0); }
  if (req.query.difficulty) { where.push('c.difficulty = ?'); params.push(req.query.difficulty); }
  if (req.query.instructor_id) { where.push('c.instructor_id = ?'); params.push(req.query.instructor_id); }
  // Role-scoped management lists (staff only): ?mine=1 returns only courses created by the caller
  // (developer panel); ?creator_role=developer|admin|owner -> admin panel filters.
  if (isStaff && req.query.mine === '1' && userId) { where.push('c.instructor_id = ?'); params.push(userId); }
  const creatorRoleFilter = isStaff && ['developer', 'admin', 'owner'].includes(String(req.query.creator_role || '')) ? String(req.query.creator_role) : null;
  if (creatorRoleFilter) { where.push('ur.slug = ?'); params.push(creatorRoleFilter); }
  const creatorJoin = isStaff ? ' LEFT JOIN roles ur ON ur.id = u.role_id' : '';
  if (req.query.featured) where.push('c.is_featured = 1');
  if (req.query.search) { where.push('(c.title LIKE ? OR c.summary LIKE ? OR c.description LIKE ?)'); params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { sort, order } = sorting(req.query, ['created_at', 'title', 'rating', 'total_students', 'duration_hours'], 'created_at');
  // LEFT JOIN enrollments so signed-in students see their enrolled flag on every
  // card without a second N+1 round-trip. This is the fix for "Enroll now"
  // staying on screen right after a successful enrol.
  const enrollJoin = userId
    ? `LEFT JOIN enrollments en ON en.course_id = c.id AND en.user_id = ${Number(userId)}`
    : '';
  const enrollCol = userId
    ? `, CASE WHEN en.id IS NULL THEN 0 ELSE 1 END AS enrolled`
    : ', 0 AS enrolled';
  const rows = await q(
    `SELECT ${COURSE_SELECT}${isStaff ? ', ur.slug AS instructor_role' : ''}${enrollCol} FROM courses c
       LEFT JOIN categories cat ON cat.id = c.category_id
       LEFT JOIN users u ON u.id = c.instructor_id${creatorJoin}
       ${enrollJoin}
       ${whereSql} ORDER BY c.${sort} ${order} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [{ total }] = await q(`SELECT COUNT(*) AS total FROM courses c LEFT JOIN categories cat ON cat.id = c.category_id${creatorRoleFilter ? ' LEFT JOIN users u ON u.id = c.instructor_id LEFT JOIN roles ur ON ur.id = u.role_id' : ''} ${whereSql}`, params);
  ok(res, rows.map((r) => ({ ...r, enrolled: !!r.enrolled })), { page, limit, total, pages: Math.ceil(total / limit) });
});

/** GET /api/courses/:idOrSlug */
const getCourse = asyncHandler(async (req, res) => {
  const key = req.params.id;
  const course = await q1(
    `SELECT ${COURSE_SELECT} FROM courses c
       LEFT JOIN categories cat ON cat.id = c.category_id
       LEFT JOIN users u ON u.id = c.instructor_id
      WHERE c.id = ? OR c.slug = ? LIMIT 1`, [Number(key) || 0, key],
  );
  if (!course) throw ApiError.notFound('Course not found');
  // Draft/archived courses are staff-only; the public catalog filtered them,
  // but a direct id/slug used to reveal the full curriculum to anyone.
  const canManage = isCourseManager(req.user, course);
  if (!canManage && course.status !== 'published') throw ApiError.notFound('Course not found');

  const modules = await q('SELECT * FROM course_modules WHERE course_id = ? ORDER BY position, id', [course.id]);
  const lessons = await q('SELECT id, module_id, title, description, duration_minutes, position, is_preview, video_url FROM lessons WHERE course_id = ? ORDER BY position, id', [course.id]);
  const enrolled = req.user
    ? await q1('SELECT * FROM enrollments WHERE course_id = ? AND user_id = ?', [course.id, req.user.id])
    : null;
  const notes = await q("SELECT id, title, slug, file_type, pages, download_count FROM notes WHERE course_id = ? AND status = 'published'", [course.id]);

  // Monetization is intentionally an OR at the course-access boundary:
  //   * price > 0             -> a paid one-off order grants this course; OR
  //   * is_premium + price=0  -> an active subscription grants this course.
  // A course that is both premium AND priced therefore does NOT charge twice.
  // A subscription alone still does not waive a one-off course price.
  const pricePaise = Math.round(Number(course.price || 0) * 100);
  const purchased = (pricePaise > 0 && req.user && !enrolled)
    ? !!(await q1(
      "SELECT id FROM subscription_orders WHERE user_id = ? AND kind='course' AND course_id = ? AND status='paid' LIMIT 1",
      [req.user.id, course.id],
    ))
    : false;
  const premiumLock = Number(course.is_premium) && pricePaise <= 0 && !canManage
    ? !(await subs.hasPremiumAccess(req.user)) : false;
  const purchaseRequired = pricePaise > 0 && !enrolled && !purchased && !canManage;

  // lesson content is only revealed to enrolled students (or staff)
  const canSeeContent = (enrolled || canManage) && !premiumLock;
  if (!canSeeContent) lessons.forEach((l) => { if (!l.is_preview) { l.video_url = null; } });

  const modulesWithLessons = modules.map((m) => ({
    ...m,
    lessons: lessons.filter((l) => l.module_id === m.id).map((l) => ({
      ...l,
      locked: !canSeeContent && !l.is_preview,
    })),
  }));

  // Quizzes attached to this course: a learner starts/practises them right here
  // instead of hunting for them in the quiz catalogue. Access rules unchanged —
  // the attempt endpoint still enforces enrolment, premium and privacy rules.
  // Only the learner's MOST RECENT attempt is joined, otherwise a learner who has
  // tried the quiz twice would see the same quiz twice on the course page.
  // Managers see every status; learners only see quizzes that are actually open.
  const courseQuizzes = await q(
    `SELECT z.id, z.title, z.slug, z.description, z.quiz_type, z.difficulty, z.total_marks,
            z.question_count, z.time_limit_minutes, z.passing_score, z.status, z.is_premium,
            la.id AS attempt_id, la.status AS attempt_status, la.score AS attempt_score,
            la.total_marks AS attempt_total_marks, la.submitted_at AS attempt_submitted_at
       FROM quizzes z
       LEFT JOIN quiz_attempts la
              ON la.id = (
                   SELECT a2.id FROM quiz_attempts a2
                    WHERE a2.quiz_id = z.id AND a2.user_id = ?
                    ORDER BY a2.id DESC LIMIT 1
                 )
      WHERE z.course_id = ? AND z.module_id IS NULL
        AND (z.status IN ('published','completed') OR ? = 1)
      ORDER BY z.id`,
    [req.user ? req.user.id : 0, course.id, canManage ? 1 : 0],
  );

  // Module quizzes: one assessment per module, shown inside that module on the
  // course page. Only when the admin switch is on — the switch is a real gate,
  // not just a CSS trick, so the API stops advertising them too.
  let moduleQuizzes = [];
  const moduleQuizzesEnabled = await moduleQuiz.featureEnabled();
  if (moduleQuizzesEnabled) {
    moduleQuizzes = await q(
      `SELECT z.id, z.title, z.module_id, z.total_marks, z.question_count, z.passing_score,
              z.time_limit_minutes, z.status, z.allow_reattempt,
              la.id AS attempt_id, la.status AS attempt_status, la.score AS attempt_score,
              la.total_marks AS attempt_total_marks
         FROM quizzes z
         LEFT JOIN quiz_attempts la
                ON la.id = (
                     SELECT a2.id FROM quiz_attempts a2
                      WHERE a2.quiz_id = z.id AND a2.user_id = ?
                      ORDER BY a2.id DESC LIMIT 1
                   )
        WHERE z.course_id = ? AND z.module_id IS NOT NULL
          AND (z.status IN ('published','completed') OR ? = 1)
        ORDER BY z.module_id, z.id`,
      [req.user ? req.user.id : 0, course.id, canManage ? 1 : 0],
    );
  }
  const modulePayloadQuiz = (quiz) => ({
    id: quiz.id,
    title: quiz.title,
    status: quiz.status,
    visible: quiz.status === 'published' || quiz.status === 'completed',
    question_count: quiz.question_count,
    total_marks: quiz.total_marks,
    passing_score: quiz.passing_score,
    time_limit_minutes: quiz.time_limit_minutes,
    allow_reattempt: !!Number(quiz.allow_reattempt),
    attempt_id: quiz.attempt_id,
    attempt_status: quiz.attempt_status,
    attempt_score: quiz.attempt_score,
    attempt_total_marks: quiz.attempt_total_marks,
    passed: quiz.attempt_total_marks
      ? ((Number(quiz.attempt_score) || 0) / Number(quiz.attempt_total_marks)) * 100 >= Number(quiz.passing_score)
      : false,
  });
  const modulesPayload = modulesWithLessons.map((module) => {
    // A module may carry more than one quiz (a teacher can attach a second one).
    // `quiz` stays for older callers, `quizzes` is the full list so nothing is
    // silently invisible on the course page.
    const quizzes = moduleQuizzes
      .filter((row) => Number(row.module_id) === Number(module.id))
      .map(modulePayloadQuiz);
    return { ...module, quiz: quizzes[0] || null, quizzes };
  });

  ok(res, {
    ...course, modules: modulesPayload, enrolled: !!enrolled, enrollment: enrolled, notes,
    quizzes: courseQuizzes,
    module_quizzes_enabled: moduleQuizzesEnabled,
    premium_lock: premiumLock, purchase_required: purchaseRequired, purchased,
  });
});

/**
 * GET /api/courses/recommended — signed-in learners only.
 *
 * Explainable suggestions from categories/skills of courses the learner already
 * completed. A suggested course is never pre-enrolled and never unlocks
 * anything: opening it goes through the normal enrolment/payment flow.
 */
const recommendedCourses = asyncHandler(async (req, res) => {
  if (!req.user) return ok(res, []);
  if (req.user.role !== 'student') return ok(res, []);

  const completedCategories = await q(
    `SELECT cat.name AS name, COUNT(*) AS n
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       JOIN categories cat ON cat.id = c.category_id
      WHERE e.user_id = ? AND e.status = 'completed'
      GROUP BY cat.id, cat.name ORDER BY n DESC LIMIT 5`,
    [req.user.id],
  );
  const completedIds = await q(
    "SELECT course_id FROM enrollments WHERE user_id = ? AND status IN ('active','completed')",
    [req.user.id],
  );

  const rows = await q(
    `SELECT c.id, c.title, c.slug, c.summary, c.thumbnail, c.difficulty, c.duration_hours,
            c.price, c.is_premium, c.total_students, c.rating, c.category_id,
            cat.name AS category_name, GROUP_CONCAT(DISTINCT cat.name) AS category_names,
            u.full_name AS instructor_name
       FROM courses c
       LEFT JOIN categories cat ON cat.id = c.category_id
       LEFT JOIN users u ON u.id = c.instructor_id
      WHERE c.status = 'published'
      GROUP BY c.id, cat.name, u.full_name
      ORDER BY c.total_students DESC, c.id DESC
      LIMIT 60`,
  );

  const candidates = rows.map((row) => ({
    ...row,
    enrollment_count: Number(row.total_students || 0),
    categories: String(row.category_names || '').split(',').map((name) => name.trim()).filter(Boolean),
    skills: '',
  }));

  const suggestions = recommendCourses({
    candidates,
    interests: {
      categories: completedCategories.map((row) => ({ name: row.name, count: Number(row.n) })),
      skills: [],
      enrolled_ids: completedIds.map((row) => Number(row.course_id)),
    },
    limit: 6,
  });
  ok(res, suggestions.map(({ category_names: _ignored, skills: _skills, ...rest }) => rest));
});

/** Shared loader for course analytics + export (manager only). */
async function collectCourseAnalytics(course) {
  const modules = await q('SELECT id, title, position FROM course_modules WHERE course_id = ? ORDER BY position, id', [course.id]);
  const lessons = await q('SELECT id, module_id FROM lessons WHERE course_id = ? ORDER BY position, id', [course.id]);
  const learners = await q(
    `SELECT e.user_id, e.status, e.progress_percent, e.enrolled_at AS started_at,
            e.last_accessed_at, e.completed_at, u.full_name, u.email
       FROM enrollments e JOIN users u ON u.id = e.user_id
      WHERE e.course_id = ? ORDER BY e.enrolled_at DESC`,
    [course.id],
  );
  const progress = await q(
    'SELECT user_id, lesson_id FROM lesson_progress WHERE course_id = ?', [course.id],
  );
  const certificates = await q(
    "SELECT user_id FROM certificates WHERE course_id = ? AND cert_type='course' AND revoked_at IS NULL",
    [course.id],
  );
  const summary = summarizeCourseAnalytics({
    modules: modules.map((module) => ({
      module_id: module.id,
      title: module.title,
      position: module.position,
      lesson_ids: lessons.filter((lesson) => Number(lesson.module_id) === Number(module.id)).map((lesson) => lesson.id),
    })),
    learners, progress, certificates,
  });
  return { modules, lessons, learners, summary };
}

/** GET /api/courses/:id/analytics — owner/admin insights for one course. */
const courseAnalytics = asyncHandler(async (req, res) => {
  const course = await q1('SELECT id, title, slug, instructor_id, status FROM courses WHERE id = ?', [req.params.id]);
  if (!course) throw ApiError.notFound('Course not found');
  if (!isCourseManager(req.user, course)) {
    throw ApiError.forbidden('Only the course owner or an administrator can see course insights.');
  }
  const { summary } = await collectCourseAnalytics(course);
  ok(res, { ...summary, health: describeCourseHealth(summary) });
});

/** GET /api/courses/:id/analytics.xlsx — three-sheet workbook. */
const courseAnalyticsXlsx = asyncHandler(async (req, res) => {
  const course = await q1('SELECT id, title, slug, instructor_id, status FROM courses WHERE id = ?', [req.params.id]);
  if (!course) throw ApiError.notFound('Course not found');
  if (!isCourseManager(req.user, course)) {
    throw ApiError.forbidden('Only the course owner or an administrator can export course insights.');
  }
  const { learners, summary } = await collectCourseAnalytics(course);
  const stamp = (value) => (value ? new Date(value).toISOString().slice(0, 19).replace('T', ' ') : '');

  const moduleRows = summary.modules.map((module) => [
    module.position, module.title, module.lessons, module.reached, module.not_reached,
    { value: module.drop_rate, format: 'decimal' },
  ]);

  const learnerRows = learners.map((learner) => [
    learner.full_name || '', learner.email || '',
    String(learner.status || '').replace('_', ' '),
    { value: Number(learner.progress_percent) || 0, format: 'decimal' },
    stamp(learner.started_at), stamp(learner.last_accessed_at), stamp(learner.completed_at),
  ]);

  const workbook = buildXlsx({
    sheets: [
      {
        name: 'Course summary',
        columns: [{ header: 'Metric', width: 34 }, { header: 'Value', width: 30 }],
        rows: [
          ['Course', course.title],
          ['Status', course.status],
          ['Learners enrolled', summary.enrolled],
          ['Completed', summary.completed],
          ['In progress', summary.in_progress],
          ['Completion rate %', { value: summary.completion_rate, format: 'decimal' }],
          ['Average progress %', { value: summary.avg_progress, format: 'decimal' }],
          ['Certificates issued', summary.certificates],
          ['Inactive learners', `${summary.stalled} (no access for ${summary.stall_days}+ days)`],
          ['Modules', summary.modules.length],
          ['Lessons', summary.total_lessons],
          ['Health', describeCourseHealth(summary)],
          ['Exported at', stamp(new Date())],
          ['Exported by', req.user ? (req.user.full_name || req.user.email || '') : ''],
          ['Note', 'Progress comes from the course’s own lesson completion; it is not a measure of time spent.'],
        ],
      },
      {
        name: 'Module funnel',
        columns: [
          { header: 'Position', width: 10 }, { header: 'Module', width: 42 },
          { header: 'Lessons', width: 10 }, { header: 'Learners finished', width: 18 },
          { header: 'Not finished', width: 14 }, { header: 'Drop %', width: 12 },
        ],
        rows: moduleRows,
      },
      {
        name: 'Learners',
        columns: [
          { header: 'Learner', width: 30 }, { header: 'Email', width: 32 },
          { header: 'Status', width: 14 }, { header: 'Progress %', width: 12 },
          { header: 'Enrolled', width: 20 }, { header: 'Last accessed', width: 20 },
          { header: 'Completed', width: 20 },
        ],
        rows: learnerRows,
      },
    ],
  });

  const filename = `course-${course.slug || course.id}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('Content-Length', workbook.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(workbook);
});

/** POST /api/courses (developer with create_course | admin) */
const createCourse = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 180);
  if (!title) throw ApiError.badRequest('Course title is required');
  const status = b.status === undefined ? 'draft' : b.status;
  if (!COURSE_STATUSES.includes(status)) throw ApiError.badRequest('Invalid course status');
  const difficulty = b.difficulty === undefined ? 'beginner' : b.difficulty;
  if (!COURSE_DIFFICULTIES.includes(difficulty)) throw ApiError.badRequest('Invalid course difficulty');
  const slugBase = b.slug ? slugify(b.slug) : slugify(title);
  if (b.slug && !slugBase) throw ApiError.badRequest('Slug must contain letters or numbers');
  // A Devanagari/other non-Latin title is valid content even though the
  // ASCII slugifier cannot transliterate it. Rejecting the whole course was
  // wrong; use a stable generic URL root and preserve the real title.
  const slug = b.slug ? slugBase : `${slugBase || 'course'}-${Date.now().toString().slice(-4)}`;
  const categoryId = await validatedCategoryId(b.category_id);
  const instructor = ['owner', 'admin'].includes(req.user.role) && b.instructor_id ? Number(b.instructor_id) : req.user.id;
  await assertInstructor(instructor);
  const thumbnail = safeExternalUrl(b.thumbnail, { label: 'thumbnail', allowRelative: true });
  const result = await exec(
    `INSERT INTO courses (title, slug, summary, description, thumbnail, category_id, difficulty, language,
       duration_hours, instructor_id, price, is_featured, status, is_premium, completion_policy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [title, slug, b.summary || null, b.description || null, thumbnail, categoryId,
      difficulty, b.language || null, boundedDecimal(b.duration_hours, 0, 0, 9999.9), instructor,
      boundedDecimal(b.price, 0, 0, 999999.99), b.is_featured ? 1 : 0, status,
      ['owner', 'admin'].includes(req.user.role) && b.is_premium ? 1 : 0,
      POLICIES.includes(b.completion_policy) ? normalisePolicy(b.completion_policy) : 'click'],
  );
  const course = await q1(`SELECT ${COURSE_SELECT} FROM courses c LEFT JOIN categories cat ON cat.id = c.category_id LEFT JOIN users u ON u.id = c.instructor_id WHERE c.id = ?`, [result.insertId]);
  if (course.status === 'published') {
    await notify({ audience: 'student', type: 'course', link: `/courses/${course.id}`, title: `New course published: ${course.title}`, message: course.summary || 'A new course is now available on SmartODL.', createdBy: req.user.id });
  }
  created(res, course);
});

/** PUT /api/courses/:id */
const updateCourse = asyncHandler(async (req, res) => {
  const course = await q1('SELECT * FROM courses WHERE id = ?', [req.params.id]);
  if (!course) throw ApiError.notFound('Course not found');
  if (req.user.role === 'developer' && Number(course.instructor_id) !== Number(req.user.id)) {
    throw ApiError.forbidden('This course belongs to an administrator or another creator — a developer may edit only courses they created.');
  }
  if (req.body.is_premium !== undefined && !['owner', 'admin'].includes(req.user.role)) {
    throw ApiError.forbidden('⭐ Only an ADMIN may mark content as premium or remove that marking');
  }

  const allowed = ['title', 'summary', 'description', 'thumbnail', 'category_id', 'difficulty', 'language',
    'duration_hours', 'instructor_id', 'price', 'is_featured', 'status', 'completion_policy'];
  const data = {};
  allowed.forEach((key) => { if (req.body[key] !== undefined) data[key] = req.body[key]; });
  if (req.body.is_premium !== undefined) data.is_premium = req.body.is_premium ? 1 : 0;
  if (req.body.slug) {
    data.slug = slugify(req.body.slug);
    if (!data.slug) throw ApiError.badRequest('Slug must contain letters or numbers');
  }

  if (data.title !== undefined) {
    data.title = String(data.title || '').trim().slice(0, 180);
    if (!data.title) throw ApiError.badRequest('Course title cannot be empty');
  }
  if (data.thumbnail !== undefined) {
    data.thumbnail = safeExternalUrl(data.thumbnail, { label: 'thumbnail', allowRelative: true });
  }
  if (data.status !== undefined && !COURSE_STATUSES.includes(data.status)) {
    throw ApiError.badRequest('Invalid course status');
  }
  if (data.completion_policy !== undefined) {
    if (!POLICIES.includes(data.completion_policy)) {
      throw ApiError.badRequest(`completion_policy must be one of: ${POLICIES.join(', ')}`);
    }
    data.completion_policy = normalisePolicy(data.completion_policy);
  }
  if (data.difficulty !== undefined && !COURSE_DIFFICULTIES.includes(data.difficulty)) {
    throw ApiError.badRequest('Invalid course difficulty');
  }
  if (data.category_id !== undefined) data.category_id = await validatedCategoryId(data.category_id);
  if (data.duration_hours !== undefined) data.duration_hours = boundedDecimal(data.duration_hours, course.duration_hours, 0, 9999.9);
  if (data.price !== undefined) data.price = boundedDecimal(data.price, course.price, 0, 999999.99);
  if (data.is_featured !== undefined) data.is_featured = data.is_featured ? 1 : 0;
  if (data.instructor_id !== undefined) {
    data.instructor_id = Number(data.instructor_id);
    if (data.instructor_id !== Number(course.instructor_id)) {
      if (!['owner', 'admin'].includes(req.user.role)) {
        throw ApiError.forbidden('Only an administrator can transfer a course to another instructor');
      }
      await assertInstructor(data.instructor_id);
    }
  }

  const keys = Object.keys(data);
  if (!keys.length) throw ApiError.badRequest('Nothing to update');
  await exec(`UPDATE courses SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), req.params.id]);

  // Announce only after the write succeeds; notifying before the UPDATE used
  // to publish a phantom announcement when validation/the DB rejected it.
  if (data.status === 'published' && course.status !== 'published') {
    await notify({
      audience: 'student', type: 'course', link: `/courses/${course.id}`,
      title: `New course published: ${data.title || course.title}`,
      message: 'A new course is now available on SmartODL.', createdBy: req.user.id,
    });
  }
  ok(res, await q1(`SELECT ${COURSE_SELECT} FROM courses c LEFT JOIN categories cat ON cat.id = c.category_id LEFT JOIN users u ON u.id = c.instructor_id WHERE c.id = ?`, [req.params.id]));
});

/** DELETE /api/courses/:id */
const removeCourse = asyncHandler(async (req, res) => {
  const course = await q1('SELECT id, instructor_id FROM courses WHERE id = ?', [req.params.id]);
  if (!course) throw ApiError.notFound('Course not found');
  if (req.user.role === 'developer' && Number(course.instructor_id) !== Number(req.user.id)) {
    throw ApiError.forbidden('This course belongs to an administrator or another creator — a developer may delete only courses they created.');
  }
  await exec('DELETE FROM courses WHERE id = ?', [req.params.id]);
  ok(res, { id: Number(req.params.id), deleted: true });
});

/** POST /api/courses/:id/thumbnail */
const uploadThumbnail = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No image uploaded');
  const courseRow = await q1('SELECT id, instructor_id FROM courses WHERE id = ?', [req.params.id]);
  if (!courseRow || (req.user.role === 'developer' && Number(courseRow.instructor_id) !== Number(req.user.id))) {
    // Multer has already stored the file; don't leave an orphan behind when
    // the target/ownership check rejects the request.
    if (req.file.path) fs.unlink(req.file.path, () => {});
    if (!courseRow) throw ApiError.notFound('Course not found');
    throw ApiError.forbidden('This course belongs to an administrator or another creator — a developer may edit only courses they created.');
  }
  const url = publicUrl(req.file);
  await exec('UPDATE courses SET thumbnail = ? WHERE id = ?', [url, req.params.id]);
  ok(res, { thumbnail: url });
});

/** POST /api/courses/:id/enroll */
const enroll = asyncHandler(async (req, res) => {
  const course = await q1('SELECT id, title, status, price, is_premium FROM courses WHERE id = ?', [req.params.id]);
  if (!course) throw ApiError.notFound('Course not found');

  // Check existing enrolment first so the paid/premium gate cannot block a student who is already enrolled.
  const existing = await q1('SELECT id FROM enrollments WHERE course_id = ? AND user_id = ?', [course.id, req.user.id]);
  if (existing) return ok(res, { enrolled: true, already: true });

  // Enrolment must not be allowed in a draft or archived course; previously the status was selected but never checked.
  if (course.status !== 'published') {
    throw ApiError.badRequest('This course has not been published yet, so enrolment is not available.');
  }

  // Access matrix (never charge twice for the same course):
  //   price>0               -> paid one-off course order is sufficient
  //   is_premium=1, price=0 -> active subscription is sufficient
  //   both are 0            -> free enrolment
  // A subscription does NOT waive the price of a paid course, and a paid order is not gated again
  // by the premium flag through a subscription check.
  const pricePaise = Math.round(Number(course.price || 0) * 100);
  if (pricePaise > 0) {
    const paid = await q1(
      `SELECT id FROM subscription_orders
        WHERE user_id = ? AND kind='course' AND course_id = ? AND status='paid' LIMIT 1`,
      [req.user.id, course.id],
    );
    if (!paid) {
      throw new ApiError(
        402,
        `💳 This is a paid course (₹${Number(course.price).toFixed(2)}) — complete the payment first, and enrolment will then happen automatically.`,
        { code: 'PAYMENT_REQUIRED', price: Number(course.price), course_id: course.id },
      );
    }
  } else if (Number(course.is_premium) && !(await subs.hasPremiumAccess(req.user))) {
    throw subs.premiumError('course (enroll)');
  }
  const result = await exec('INSERT IGNORE INTO enrollments (course_id, user_id) VALUES (?,?)', [course.id, req.user.id]);
  if (Number(result.affectedRows) === 0) return ok(res, { enrolled: true, already: true });
  await exec('UPDATE courses SET total_students = (SELECT COUNT(*) FROM enrollments WHERE course_id = ?) WHERE id = ?', [course.id, course.id]);
  await notify({
    userId: req.user.id, audience: 'user', type: 'course', link: `/student/courses/${course.id}`,
    title: `Enrolled in ${course.title}`, message: 'Your learning journey starts now — open the course to see the first lesson.',
  });
  created(res, await q1('SELECT * FROM enrollments WHERE id = ?', [result.insertId]));
});

/** GET /api/enrollments/my — student's enrolled courses with progress */
const myEnrollments = asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT e.*, c.title, c.slug, c.thumbnail, c.difficulty, c.duration_hours, c.lessons_count,
            cat.name AS category_name, u.full_name AS instructor_name
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN categories cat ON cat.id = c.category_id
       LEFT JOIN users u ON u.id = c.instructor_id
      WHERE e.user_id = ? ORDER BY e.enrolled_at DESC`, [req.user.id],
  );
  ok(res, rows);
});

/** GET /api/enrollments/course/:id — admin/instructor view of enrolled students */
const courseEnrollments = asyncHandler(async (req, res) => {
  const course = await q1('SELECT id, instructor_id FROM courses WHERE id = ?', [req.params.id]);
  if (!course) throw ApiError.notFound('Course not found');
  if (!isCourseManager(req.user, course)) {
    throw ApiError.forbidden('A developer may view enrolled students only for their own courses.');
  }
  const rows = await q(
    `SELECT e.*, u.full_name, u.email, u.college, u.avatar FROM enrollments e
       JOIN users u ON u.id = e.user_id WHERE e.course_id = ? ORDER BY e.progress_percent DESC`, [req.params.id],
  );
  ok(res, rows);
});

/** POST /api/enrollments/:id/progress — mark a lesson complete, recompute % */
/**
 * Has this learner passed any quiz linked to the course?
 * Same rule the quiz result page uses: best score >= passing_score percent.
 */
async function hasPassedLinkedQuiz(userId, courseId, moduleId = null) {
  // A module's OWN quiz is the requirement when that module has one — a passed
  // course-level quiz must not stand in for it. Only when the module has no quiz
  // do we fall back to the course-level quizzes.
  // Only quizzes a learner can actually attempt may gate completion: a draft or
  // archived quiz is invisible in the course page, so counting it would leave the
  // student permanently blocked with no way to satisfy the requirement.
  const OPEN = "z.status IN ('published','completed')";
  const moduleQuizzes = moduleId
    ? await q(
      `SELECT z.id, z.passing_score, z.total_marks FROM quizzes z
        WHERE z.course_id = ? AND z.module_id = ? AND ${OPEN}`,
      [courseId, moduleId],
    )
    : [];
  const scope = moduleQuizzes.length
    ? moduleQuizzes
    : (await q(
      `SELECT z.id, z.passing_score, z.total_marks FROM quizzes z
        WHERE z.course_id = ? AND z.module_id IS NULL AND ${OPEN}`,
      [courseId],
    ));
  if (!scope.length) return false;

  const ids = scope.map((row) => Number(row.id));
  const attempts = await q(
    `SELECT a.quiz_id, MAX(a.score) AS best
       FROM quiz_attempts a
      WHERE a.user_id = ? AND a.status IN ('submitted','evaluated')
        AND a.quiz_id IN (${ids.map(() => '?').join(',')})
      GROUP BY a.quiz_id`,
    [userId, ...ids],
  );
  const bestByQuiz = new Map(attempts.map((row) => [Number(row.quiz_id), Number(row.best) || 0]));
  return scope.some((quiz) => {
    const total = Number(quiz.total_marks) || 0;
    if (total <= 0) return false;
    const best = bestByQuiz.get(Number(quiz.id));
    if (best === undefined) return false;
    return (best / total) * 100 >= (Number(quiz.passing_score) || 0);
  });
}

/** Watch coverage for one lesson, from the stored 10-second slices. */
async function watchCoverage(userId, lessonId) {
  try {
    return await lessonWatch.readProgress(userId, lessonId);
  } catch (error) {
    // Pre-migration database: no watch tables yet → treat as "not measurable"
    // rather than blocking a completion the course used to allow.
    if (error && error.code === 'ER_NO_SUCH_TABLE') return null;
    throw error;
  }
}

const updateProgress = asyncHandler(async (req, res) => {
  const { lesson_id } = req.body;
  const enrollment = await q1('SELECT * FROM enrollments WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!enrollment) throw ApiError.notFound('Enrollment not found');
  // module_id matters: a module's own quiz is the assessment that gates completion.
  const lesson = await q1('SELECT id, title, module_id FROM lessons WHERE id = ? AND course_id = ?', [lesson_id, enrollment.course_id]);
  if (!lesson) throw ApiError.badRequest('Lesson does not belong to this course');

  // Dwell-time gate (see services/lessonOpens.service.js): the lesson content
  // must have been opened, and the open must be old enough. A missing stamp
  // means the student skipped straight to "complete" — or scripted it.
  const dwellMs = await lessonOpens.requiredDwellMs();
  if (dwellMs > 0) {
    let opened = null;
    try {
      opened = await q1('SELECT opened_at FROM lesson_opens WHERE user_id = ? AND lesson_id = ?', [req.user.id, lesson.id]);
    } catch (e) {
      // Pre-migration database (SMARTODL_SKIP_MIGRATIONS on an old schema):
      // degrade to the old behaviour instead of failing lesson completion.
      if (e && e.code === 'ER_NO_SUCH_TABLE') opened = { opened_at: new Date(0) };
      else throw e;
    }
    if (!opened) {
      throw ApiError.badRequest('Open the lesson and read it before marking it complete.');
    }
    const waited = Date.now() - new Date(opened.opened_at).getTime();
    if (waited < dwellMs) {
      throw ApiError.badRequest(
        `This lesson just needs a bit of time open — you can mark it complete in about ${Math.ceil((dwellMs - waited) / 1000)}s.`,
      );
    }
  }

  // Course-level completion policy (watch coverage / quiz pass). Measured only
  // for uploaded video: an external embed cannot be verified, so it is graded
  // like "no video" instead of pretending we know it was watched.
  const coursePolicy = await q1('SELECT completion_policy FROM courses WHERE id = ?', [enrollment.course_id]);
  const policy = normalisePolicy(coursePolicy && coursePolicy.completion_policy);
  if (policy !== 'click') {
    const media = await lessonMedia.readLessonMedia(lesson.id);
    const coverage = await watchCoverage(req.user.id, lesson.id);
    const moduleQuizRow = requiresQuiz(policy) && lesson.module_id
      ? await q1(
        `SELECT z.title FROM quizzes z
          WHERE z.course_id = ? AND z.module_id = ? AND z.status IN ('published','completed')
          ORDER BY z.id LIMIT 1`,
        [enrollment.course_id, lesson.module_id],
      )
      : null;
    const verdict = evaluateCompletion({
      policy,
      hasMeasurableVideo: !!(media && media.video_path),
      coveragePercent: coverage ? coverage.coverage_percent : 0,
      quizPassed: requiresQuiz(policy)
        ? await hasPassedLinkedQuiz(req.user.id, enrollment.course_id, lesson.module_id)
        : false,
      quizLabel: moduleQuizRow ? `Is module ka quiz (“${moduleQuizRow.title}”)` : '',
    });
    if (!verdict.allowed) throw ApiError.badRequest(verdict.reason);
  }

  await exec('INSERT IGNORE INTO lesson_progress (user_id, course_id, lesson_id) VALUES (?,?,?)', [req.user.id, enrollment.course_id, lesson_id]);
  const [{ total }] = await q('SELECT COUNT(*) AS total FROM lessons WHERE course_id = ?', [enrollment.course_id]);
  const [{ done }] = await q('SELECT COUNT(*) AS done FROM lesson_progress WHERE course_id = ? AND user_id = ?', [enrollment.course_id, req.user.id]);
  const percent = total ? Math.round((done / total) * 10000) / 100 : 0;
  const completed = total > 0 && done >= total;
  await exec(
    `UPDATE enrollments SET completed_lessons = ?, progress_percent = ?, status = ?, last_accessed_at = NOW(),
       completed_at = ${completed ? 'COALESCE(completed_at, NOW())' : 'NULL'} WHERE id = ?`,
    [done, percent, completed ? 'completed' : 'active', enrollment.id],
  );
  let certId = null;
  if (completed) {
    // Issue a certificate of completion (idempotent: existing cert is reused)
    const { issueIfEarned } = require('./certificate.controller');
    certId = await issueIfEarned(enrollment.id);
    await notify({
      userId: req.user.id, audience: 'user', type: 'achievement', link: certId ? `/certificate/${certId}` : '/student/achievements',
      title: 'Course completed 🎓',
      message: certId
        ? 'Congratulations! Your certificate of completion is ready to view and download.'
        : 'Congratulations on finishing the course. +50 points added!',
    });
    const { recalcUser, awardAchievements } = require('../services/points.service');
    await recalcUser(req.user.id);
    await awardAchievements(req.user.id);
  }
  const cert = certId ? await q1('SELECT public_token, certificate_no FROM certificates WHERE id = ?', [certId]) : null;
  ok(res, {
    progress_percent: percent, completed_lessons: done, total_lessons: total,
    status: completed ? 'completed' : 'active',
    certificate: cert ? { id: certId, certificate_no: cert.certificate_no, token: cert.public_token } : null,
  });
});

/* ------------------------- modules + lessons ------------------------- */

/** Developers may only restructure their own courses (same rule as course edit). */
async function assertCanEditCourse(req, courseId) {
  const course = await q1('SELECT instructor_id FROM courses WHERE id = ?', [courseId]);
  if (!course) throw ApiError.notFound('Course not found');
  if (!req.user || req.user.role !== 'developer') return;
  if (Number(course.instructor_id) !== Number(req.user.id)) {
    throw ApiError.forbidden('This course belongs to an administrator or another creator — a developer may change modules and lessons only in courses they created.');
  }
}

const listModules = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query, { limit: 50 });
  const where = [], params = [];
  if (req.user.role === 'developer') {
    where.push('c.instructor_id = ?');
    params.push(req.user.id);
  }
  if (req.query.course_id) { where.push('m.course_id = ?'); params.push(Number(req.query.course_id) || 0); }
  if (req.query.search) { where.push('m.title LIKE ?'); params.push(`%${req.query.search}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await q(
    `SELECT m.* FROM course_modules m JOIN courses c ON c.id = m.course_id
      ${whereSql} ORDER BY m.position ASC, m.id ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [{ total }] = await q(
    `SELECT COUNT(*) AS total FROM course_modules m JOIN courses c ON c.id = m.course_id ${whereSql}`,
    params,
  );
  ok(res, rows, { page, limit, total, pages: Math.ceil(total / limit) });
});

const createModule = asyncHandler(async (req, res) => {
  const { course_id, title, description, position } = req.body;
  if (!course_id || !title) throw ApiError.badRequest('course_id and title are required');
  await assertCanEditCourse(req, course_id);
  const result = await exec('INSERT INTO course_modules (course_id, title, description, position) VALUES (?,?,?,?)',
    [course_id, title, description || null, position || 1]);
  created(res, await q1('SELECT * FROM course_modules WHERE id = ?', [result.insertId]));
});

const createLesson = asyncHandler(async (req, res) => {
  const { module_id, title, description, video_url, content, duration_minutes, position, is_preview, resource_url } = req.body;
  if (!module_id || !title) throw ApiError.badRequest('module_id and title are required');
  const module = await q1('SELECT course_id FROM course_modules WHERE id = ?', [module_id]);
  if (!module) throw ApiError.notFound('Module not found');
  await assertCanEditCourse(req, module.course_id);
  const result = await exec(
    `INSERT INTO lessons (module_id, course_id, title, description, video_url, content, resource_url, duration_minutes, position, is_preview)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [module_id, module.course_id, title, description || null,
      safeExternalUrl(video_url, { label: 'video_url', allowRelative: true }), content || null,
      safeExternalUrl(resource_url, { label: 'resource_url', allowRelative: true }),
      duration_minutes || 10, position || 1, is_preview ? 1 : 0],
  );
  await exec('UPDATE courses SET lessons_count = (SELECT COUNT(*) FROM lessons WHERE course_id = ?) WHERE id = ?', [module.course_id, module.course_id]);
  await refreshCourseProgress(module.course_id);
  created(res, await q1('SELECT * FROM lessons WHERE id = ?', [result.insertId]));
});

const updateLesson = asyncHandler(async (req, res) => {
  const existingLesson = await q1('SELECT course_id FROM lessons WHERE id = ?', [req.params.id]);
  if (!existingLesson) throw ApiError.notFound('Lesson not found');
  await assertCanEditCourse(req, existingLesson.course_id);
  const allowed = ['title', 'description', 'video_url', 'content', 'resource_url', 'duration_minutes', 'position', 'is_preview'];
  const data = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) data[k] = req.body[k]; });
  if (data.video_url !== undefined) data.video_url = safeExternalUrl(data.video_url, { label: 'video_url', allowRelative: true });
  if (data.resource_url !== undefined) data.resource_url = safeExternalUrl(data.resource_url, { label: 'resource_url', allowRelative: true });
  if (data.duration_minutes !== undefined) data.duration_minutes = Math.round(boundedDecimal(data.duration_minutes, 10, 1, 100000));
  if (data.position !== undefined) data.position = Math.round(boundedDecimal(data.position, 1, 1, 100000));
  if (data.is_preview !== undefined) data.is_preview = data.is_preview ? 1 : 0;
  const keys = Object.keys(data);
  if (!keys.length) throw ApiError.badRequest('Nothing to update');
  await exec(`UPDATE lessons SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), req.params.id]);
  ok(res, await q1('SELECT * FROM lessons WHERE id = ?', [req.params.id]));
});

/** PUT /api/lessons/reorder — [{id, position}] */
const reorderLessons = asyncHandler(async (req, res) => {
  const items = req.body.items || req.body;
  if (!Array.isArray(items) || items.length > 500) throw ApiError.badRequest('items[] is required (maximum 500)');
  const normalized = items.map((item) => ({
    id: Number(item && item.id),
    position: Number(item && item.position),
  }));
  if (normalized.some((item) => !Number.isInteger(item.id) || item.id <= 0
      || !Number.isFinite(item.position) || item.position < 1 || item.position > 100000)) {
    throw ApiError.badRequest('Every reorder item needs a valid lesson id and positive position');
  }
  if (new Set(normalized.map((item) => item.id)).size !== normalized.length) {
    throw ApiError.badRequest('A lesson cannot appear twice in one reorder request');
  }
  if (!normalized.length) return ok(res, { reordered: 0 });

  await tx(async (conn) => {
    const placeholders = normalized.map(() => '?').join(',');
    const [lessons] = await conn.execute(
      `SELECT id, course_id FROM lessons WHERE id IN (${placeholders}) FOR UPDATE`,
      normalized.map((item) => item.id),
    );
    if (lessons.length !== normalized.length) throw ApiError.badRequest('One or more lessons do not exist');
    const courseIds = [...new Set(lessons.map((lesson) => Number(lesson.course_id)))];
    if (courseIds.length !== 1) throw ApiError.badRequest('Lessons from different courses cannot be reordered together');
    if (req.user.role === 'developer') {
      const [[course]] = await conn.query(
        'SELECT instructor_id FROM courses WHERE id = ?',
        [courseIds[0]],
      );
      if (!course || Number(course.instructor_id) !== Number(req.user.id)) {
        throw ApiError.forbidden('A developer may reorder lessons only in their own courses.');
      }
    }
    for (const item of normalized) {
      await conn.execute(
        'UPDATE lessons SET position = ? WHERE id = ?',
        [Math.round(item.position), item.id],
      );
    }
  });
  ok(res, { reordered: normalized.length });
});

const getLesson = asyncHandler(async (req, res) => {
  // Entitlement lives in lessonAccess.service because the video/PDF routes use
  // the same rule — otherwise a page could hide the text but hand over the
  // recording.
  const { lesson } = await assertLessonAccess(req.user, req.params.id);

  // Stamp the open: updateProgress requires this stamp (plus a short dwell
  // time) before a lesson can be marked complete, so completion certificates
  // and their points can no longer be farmed by blind-firing lesson ids.
  if (req.user) await lessonOpens.recordView(req.user.id, lesson.id);

  // Uploaded media is referenced by flag + name only; the file itself is only
  // reachable through the gated /video and /pdf routes.
  const media = lessonMedia.describeMedia(lesson);
  ok(res, {
    ...lesson,
    video_path: undefined,
    pdf_path: undefined,
    video_upload: media.video_upload,
    pdf_upload: media.pdf_upload,
  });
});

const updateModule = asyncHandler(async (req, res, next) => {
  const module = await q1('SELECT course_id FROM course_modules WHERE id = ?', [req.params.id]);
  if (!module) throw ApiError.notFound('Module not found');
  await assertCanEditCourse(req, module.course_id);
  // Cross-course module moves would orphan lessons/progress under the wrong
  // course_id. Moving modules is not a supported operation.
  delete req.body.course_id;
  return require('./crud.controller').modules.update(req, res, next);
});

const removeModule = asyncHandler(async (req, res, next) => {
  const module = await q1('SELECT course_id FROM course_modules WHERE id = ?', [req.params.id]);
  if (!module) throw ApiError.notFound('Module not found');
  await assertCanEditCourse(req, module.course_id);
  const out = await require('./crud.controller').modules.remove(req, res, next);
  await exec('UPDATE courses SET lessons_count = (SELECT COUNT(*) FROM lessons WHERE course_id = ?) WHERE id = ?', [module.course_id, module.course_id]).catch(() => {});
  await refreshCourseProgress(module.course_id).catch(() => {});
  return out;
});

const removeLesson = asyncHandler(async (req, res, next) => {
  const lesson = await q1('SELECT course_id FROM lessons WHERE id = ?', [req.params.id]);
  if (!lesson) throw ApiError.notFound('Lesson not found');
  await assertCanEditCourse(req, lesson.course_id);
  const out = await require('./crud.controller').lessons.remove(req, res, next);
  await exec('UPDATE courses SET lessons_count = (SELECT COUNT(*) FROM lessons WHERE course_id = ?) WHERE id = ?', [lesson.course_id, lesson.course_id]).catch(() => {});
  await refreshCourseProgress(lesson.course_id).catch(() => {});
  return out;
});

module.exports = {
  listCourses, getCourse, createCourse, updateCourse, removeCourse, uploadThumbnail,
  recommendedCourses, courseAnalytics, courseAnalyticsXlsx,
  enroll, myEnrollments, courseEnrollments, updateProgress,
  listModules, createModule, createLesson, updateLesson, reorderLessons, getLesson,
  updateModule, removeModule, removeLesson,
};
