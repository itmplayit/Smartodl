'use strict';
/** Normal quizzes, question bank, live quizzes, attempts and automatic evaluation. */
const crypto = require('crypto');
const { q, q1, exec, tx } = require('../config/db');
const { ApiError, asyncHandler, ok, created, slugify, parsePagination, arraysEqual, normaliseText, fromJson, safeExternalUrl } = require('../utils/helpers');
const { notify } = require('../services/notification.service');
const events = require('../services/events.service');
const liveQuiz = require('../services/liveQuiz.service');
const { recalcUser, awardAchievements } = require('../services/points.service');
const { touchActivity } = require('../services/gamification.service');
const { DEFAULT_LANGUAGES, parseLanguages, parseStarter, parseTestCases, codingConfig, judgeCodingAnswer } = require('../utils/quiz-code');
const { buildQuestionOrder } = require('../utils/quiz-question-order');
const { buildXlsx } = require('../utils/xlsx');
const aiDetect = require('../services/aiDetection.service');
const antiCheat = require('../services/anticheatSettings.service');
const { readBool, readSetting } = require('../services/settings.service');
const liveProctor = require('../services/liveProctor.service');
const proctorSvc = require('../services/proctoring.service');
const iceServersSvc = require('../services/iceServers.service');
const bcrypt = require('bcryptjs');
const { signQuizUnlock, verifyQuizUnlock } = require('../services/quizUnlock.service');

function quizPassword(value) {
  if (!value) return null;
  const password = String(value);
  if (password.length < 4 || Buffer.byteLength(password, 'utf8') > 72) {
    throw ApiError.badRequest('Private quiz password must be 4–72 UTF-8 bytes');
  }
  return password;
}

const subs = require('../services/subscription.service');

const QUIZ_STATUSES = ['draft', 'scheduled', 'published', 'live', 'completed', 'unpublished'];
const QUIZ_TYPES = ['normal', 'live', 'practice'];
const QUIZ_DIFFICULTIES = ['easy', 'medium', 'hard'];
const PUBLIC_QUIZ_STATUSES = ['published', 'live', 'completed', 'scheduled'];
const isQuizManager = (user, quiz) => !!user && (
  ['owner', 'admin'].includes(user.role)
  || (user.role === 'developer' && quiz && Number(quiz.created_by) === Number(user.id))
);
const isQuizHost = (user, quiz) => isQuizManager(user, quiz)
  || !!(user && quiz && user.role === 'developer' && Number(quiz.live_host_id || 0) === Number(user.id));
const publicQuiz = (quiz) => {
  if (!quiz) return quiz;
  const row = { ...quiz, has_access_password: !!quiz.access_password };
  delete row.access_password;
  return row;
};
// Private-quiz unlock tokens (fingerprint + purpose-derived signing key) live
// in services/quizUnlock.service.js — they are deliberately not access tokens.

/**
 * Advanced proctoring switches are intentionally global/admin-only: live
 * viewing, identity checks, room scans and a second camera are institutional
 * policy choices, unlike the creator-scoped anti-cheat switches above. The
 * master switch must be on before any individual advanced check can run.
 */
async function advancedProctorSettings() {
  const master = await readBool('proctor_advanced_enabled', false);
  const entries = await Promise.all([
    ['body', 'proctor_body_detection_enabled'],
    ['headPose', 'proctor_head_pose_enabled'],
    ['snapshot', 'proctor_live_snapshot_enabled'],
    ['webrtc', 'proctor_live_webrtc_enabled'],
    ['secondCamera', 'proctor_second_camera_enabled'],
    ['roomScan', 'proctor_room_scan_enabled'],
    ['identity', 'proctor_identity_check_enabled'],
    ['mic', 'proctor_mic_monitoring_enabled'],
    ['dualMonitor', 'proctor_dual_monitor_enabled'],
    ['warnings', 'proctor_live_warnings_enabled'],
  ].map(async ([name, key]) => [name, master && await readBool(key, false)]));
  return { master, ...Object.fromEntries(entries) };
}

/** Advanced features may require sensors even when their basic switch is off. */
function advancedSensorRequirements(settings) {
  return {
    camera: !!(settings.body || settings.headPose || settings.snapshot || settings.webrtc
      || settings.roomScan || settings.identity),
    screen: !!(settings.snapshot || settings.webrtc || settings.dualMonitor),
  };
}

/**
 * Freeze the proctoring rules for one attempt the first time its runner is
 * served. Advanced proctoring is live-quiz only (the runner enforces the
 * same scope), so a normal/practice attempt snapshots an all-off policy and
 * can never collect advanced "missing check" findings at submit. Attempts
 * that already carry a snapshot keep it verbatim — an admin flipping a
 * switch mid-exam must not rewrite the rules under a running student.
 */
async function captureAttemptProctorPolicy(attempt, quiz) {
  if (!attempt || !quiz) return null;
  const existing = proctorSvc.parseProctorPolicy(attempt.proctor_policy);
  if (existing) return existing;
  if (attempt.status && attempt.status !== 'in_progress') return null;

  const live = quiz.quiz_type === 'live';
  let policy;
  if (!live) {
    policy = proctorSvc.buildProctorPolicy({ live: false, capturedAt: new Date().toISOString() });
  } else {
    const creatorId = await antiCheat.quizCreatorId(quiz.id);
    const [creatorCamera, creatorScreen, advanced] = await Promise.all([
      antiCheat.resolveBoolForUser(creatorId, 'proctor_camera_enabled', false),
      antiCheat.resolveBoolForUser(creatorId, 'proctor_screen_enabled', false),
      advancedProctorSettings(),
    ]);
    policy = proctorSvc.buildProctorPolicy({
      live: true, creatorCamera, creatorScreen, advanced, capturedAt: new Date().toISOString(),
    });
  }

  try {
    const updated = await exec(
      "UPDATE quiz_attempts SET proctor_policy = ? WHERE id = ? AND (proctor_policy IS NULL OR proctor_policy = '')",
      [JSON.stringify(policy), attempt.id],
    );
    if (Number(updated.affectedRows) !== 1) {
      const fresh = await q1('SELECT proctor_policy FROM quiz_attempts WHERE id = ?', [attempt.id]);
      const stored = proctorSvc.parseProctorPolicy(fresh && fresh.proctor_policy);
      if (stored) return stored;
    }
    attempt.proctor_policy = JSON.stringify(policy);
  } catch (err) {
    // A missing column (migrations not run) must not break the runner; the
    // in-memory policy still drives this response, and transports fail
    // closed for attempts whose snapshot could not be persisted.
    console.error('[proctor] policy snapshot could not be stored:', err.message);
  }
  return policy;
}

/**
 * Advanced settings as they apply to THIS attempt right now: the frozen
 * policy intersected with the live platform switches. No snapshot means no
 * advanced transport — an attempt that never consented to a check must not
 * start publishing frames because an admin flipped a switch mid-exam.
 */
async function effectiveAdvancedForAttempt(attempt) {
  const current = await advancedProctorSettings();
  const policy = proctorSvc.parseProctorPolicy(attempt && attempt.proctor_policy);
  const eff = proctorSvc.effectiveAdvancedPolicy(policy, current);
  return {
    master: eff.master,
    body: eff.body,
    headPose: eff.head_pose,
    snapshot: eff.snapshot,
    webrtc: eff.webrtc,
    secondCamera: eff.second_camera,
    roomScan: eff.room_scan,
    identity: eff.identity,
    mic: eff.mic,
    dualMonitor: eff.dual_monitor,
    warnings: eff.warnings,
    policy,
    current,
  };
}

async function proctorAttemptRow(attemptId) {
  return q1(
    `SELECT qa.id, qa.quiz_id, qa.user_id, qa.status, qa.proctor_violations, qa.proctor_flags,
            qa.proctor_policy, u.full_name, u.avatar
       FROM quiz_attempts qa JOIN users u ON u.id = qa.user_id
      WHERE qa.id = ?`,
    [attemptId],
  );
}

async function assertStudentProctorAttempt(req) {
  const attempt = await proctorAttemptRow(req.params.id);
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (Number(attempt.user_id) !== Number(req.user.id)) throw ApiError.forbidden('This is not your attempt');
  return attempt;
}

async function assertHostProctorAttempt(req) {
  const attempt = await proctorAttemptRow(req.params.id);
  if (!attempt) throw ApiError.notFound('Attempt not found');
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [attempt.quiz_id]);
  assertCanHostQuiz(req, quiz);
  return { attempt, quiz };
}
const boundedQuizNumber = (value, fallback, min, max) => {
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
function parseQuizDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw ApiError.badRequest(`${label} must be a valid date/time`);
  return date;
}
function effectiveQuizStatus(quiz, now = Date.now()) {
  if (!quiz || quiz.status !== 'scheduled') return quiz && quiz.status;
  if (quiz.end_at && new Date(quiz.end_at).getTime() < now) return 'completed';
  if (quiz.quiz_type !== 'live' && (!quiz.start_at || new Date(quiz.start_at).getTime() <= now)) {
    return 'published';
  }
  return 'scheduled';
}

/**
 * Ownership rule for question-level mutations. The quiz-level update/delete
 * handlers already enforce this; question create/update/delete/reorder used to
 * skip it, so any developer could rewrite another instructor's answer key.
 */
async function assertCanEditQuiz(req, quizId) {
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [quizId]);
  if (!quiz) throw ApiError.notFound('Quiz not found');
  if (!isQuizManager(req.user, quiz)) {
    throw ApiError.forbidden('This quiz belongs to an administrator or another creator — a developer may change questions only in quizzes they created.');
  }
  return quiz;
}

function assertCanHostQuiz(req, quiz) {
  if (!quiz) throw ApiError.notFound('Quiz not found');
  if (isQuizHost(req.user, quiz)) return quiz;
  throw ApiError.forbidden('Only the quiz creator, its assigned host, or an administrator can control this live session.');
}

/** Absolute deadline (ms epoch) for an attempt, or null when untimed. */
function attemptDeadlineMs(attempt, quiz) {
  if (!quiz) return null;
  const candidates = [];
  if (Number(quiz.time_limit_minutes) > 0) {
    // A live attempt is created when the student joins the lobby, which can be
    // minutes before the host presses Start — timing must run from the later
    // of attempt start and the live start, never from the lobby join.
    const started = new Date(attempt.started_at).getTime();
    const liveStarted = quiz.quiz_type === 'live' && quiz.live_started_at
      ? new Date(quiz.live_started_at).getTime() : 0;
    candidates.push(Math.max(started, liveStarted) + Number(quiz.time_limit_minutes) * 60000);
  }
  if (quiz.end_at) candidates.push(new Date(quiz.end_at).getTime());
  return candidates.length ? Math.min(...candidates) : null;
}

/**
 * Live-lobby phase: the session is open (students may take a seat) but the
 * host has NOT pressed "Start for everyone" yet, so nobody may see a single
 * question, save an answer, run code, or submit. The seat itself is a real
 * in_progress attempt, so every runner-facing path must check this — the
 * lobby was previously enforced only by the waiting-room UI, which let
 * students read the whole paper, answer it, and even submit for marks
 * before the synchronized start.
 */
function isLiveLobby(quiz) {
  return !!quiz && quiz.quiz_type === 'live' && quiz.status === 'live' && !quiz.live_started_at;
}
const LIVE_LOBBY_MSG = '⏳ The host has not started this live quiz yet — you are seated in the lobby. Questions open for everyone at the same moment when the host presses "Start for everyone".';

const ATTEMPT_GRACE_MS = 30000; // network/clock slack on top of the hard deadline

/** Reject answer/run writes after the attempt deadline (+grace). */
async function assertAttemptOpen(attempt) {
  const quiz = await q1(
    'SELECT quiz_type, status, time_limit_minutes, live_started_at, end_at FROM quizzes WHERE id = ?',
    [attempt.quiz_id],
  );
  // Lower bound as well as the deadline: a lobby seat accepts no writes at
  // all until the host's synchronized start (gates saveAnswer + run-code).
  if (isLiveLobby(quiz)) throw ApiError.forbidden(LIVE_LOBBY_MSG);
  const deadline = attemptDeadlineMs(attempt, quiz);
  if (deadline && Date.now() > deadline + ATTEMPT_GRACE_MS) {
    throw ApiError.forbidden('Time is over for this attempt — answers can no longer be changed.');
  }
}

const QUIZ_SELECT = `z.*, cat.name AS category_name, u.full_name AS created_by_name,
  COALESCE(hu.full_name, u.full_name) AS host_name, COALESCE(z.live_host_id, z.created_by) AS host_id,
  (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = z.id) AS actual_question_count`;

/* ------------------------------ quizzes ------------------------------ */
const list = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const where = [], params = [];
  const isStaff = req.user && ['owner', 'admin', 'developer'].includes(req.user.role);
  if (!isStaff) where.push("z.status IN ('published','live','completed','scheduled')");
  else if (req.user.role === 'developer') {
    where.push("(z.status IN ('published','live','completed','scheduled') OR z.created_by = ? OR z.live_host_id = ?)");
    params.push(req.user.id, req.user.id);
    if (req.query.status) { where.push('z.status = ?'); params.push(req.query.status); }
  }
  else if (req.query.status) { where.push('z.status = ?'); params.push(req.query.status); }
  if (req.query.quiz_type) { where.push('z.quiz_type = ?'); params.push(req.query.quiz_type); }
  if (req.query.difficulty) { where.push('z.difficulty = ?'); params.push(req.query.difficulty); }
  if (req.query.category_id) { where.push('z.category_id = ?'); params.push(req.query.category_id); }
  if (req.query.search) { where.push('(z.title LIKE ? OR z.description LIKE ?)'); params.push(`%${req.query.search}%`, `%${req.query.search}%`); }
  // Role-scoped management lists (staff only): ?mine=1 returns the developer's own content;
  // ?creator_role=developer|admin|owner applies the admin panel's creator filter.
  if (isStaff && req.query.mine === '1' && req.user) { where.push('z.created_by = ?'); params.push(req.user.id); }
  const creatorRoleFilter = isStaff && ['developer', 'admin', 'owner'].includes(String(req.query.creator_role || '')) ? String(req.query.creator_role) : null;
  if (creatorRoleFilter) { where.push('ur.slug = ?'); params.push(creatorRoleFilter); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await q(
    `SELECT ${QUIZ_SELECT}${isStaff ? ', ur.slug AS created_by_role' : ''} FROM quizzes z LEFT JOIN categories cat ON cat.id = z.category_id
       LEFT JOIN users u ON u.id = z.created_by LEFT JOIN users hu ON hu.id = z.live_host_id${isStaff ? ' LEFT JOIN roles ur ON ur.id = u.role_id' : ''} ${whereSql} ORDER BY z.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  rows.forEach((row, index) => { rows[index] = { ...publicQuiz(row), status: effectiveQuizStatus(row) }; });
  const [{ total }] = await q(`SELECT COUNT(*) AS total FROM quizzes z${creatorRoleFilter ? ' LEFT JOIN users u ON u.id = z.created_by LEFT JOIN users hu ON hu.id = z.live_host_id LEFT JOIN roles ur ON ur.id = u.role_id' : ''} ${whereSql}`, params);
  ok(res, rows, { page, limit, total, pages: Math.ceil(total / limit) });
});

const getOne = asyncHandler(async (req, res) => {
  const quiz = await q1(
    `SELECT ${QUIZ_SELECT} FROM quizzes z LEFT JOIN categories cat ON cat.id = z.category_id
       LEFT JOIN users u ON u.id = z.created_by LEFT JOIN users hu ON hu.id = z.live_host_id WHERE z.id = ? OR z.slug = ? LIMIT 1`,
    [Number(req.params.id) || 0, req.params.id],
  );
  if (!quiz) throw ApiError.notFound('Quiz not found');
  // Draft/unpublished quizzes must not be visible to the public by guessing an
  // id/slug — list() filtered them out, but this handler did not.
  const canManage = isQuizHost(req.user, quiz);
  const effectiveStatus = effectiveQuizStatus(quiz);
  if (!canManage && !PUBLIC_QUIZ_STATUSES.includes(effectiveStatus)) {
    throw ApiError.notFound('Quiz not found');
  }
  const safeQuiz = { ...publicQuiz(quiz), status: effectiveStatus };
  // Premium quiz: an attempt cannot start without an active subscription; this flag is for the UI.
  const premiumLock = Number(quiz.is_premium) && !canManage ? !(await subs.hasPremiumAccess(req.user)) : false;
  const attempt = req.user
    ? await q1('SELECT * FROM quiz_attempts WHERE quiz_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1', [quiz.id, req.user.id])
    : null;
  const live = effectiveStatus === 'live'
    ? {
      participants: (await q1('SELECT COUNT(*) AS c FROM quiz_attempts WHERE quiz_id = ?', [quiz.id])).c,
      ends_at: quiz.end_at,
      live_started_at: quiz.live_started_at,
      server_time: new Date().toISOString(),
    }
    : null;
  ok(res, { ...safeQuiz, last_attempt: attempt, live, premium_lock: premiumLock });
});

const create = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 200);
  if (!title) throw ApiError.badRequest('Quiz title is required');
  const status = b.status === undefined ? 'draft' : b.status;
  if (!QUIZ_STATUSES.includes(status)) throw ApiError.badRequest('Invalid quiz status');
  if (status === 'live') throw ApiError.badRequest('Create the quiz first, then open its live lobby from Live Hosting');
  const quizType = b.quiz_type === undefined ? 'normal' : b.quiz_type;
  if (!QUIZ_TYPES.includes(quizType)) throw ApiError.badRequest('Invalid quiz type');
  const difficulty = b.difficulty === undefined ? 'easy' : b.difficulty;
  if (!QUIZ_DIFFICULTIES.includes(difficulty)) throw ApiError.badRequest('Invalid quiz difficulty');
  const startAt = parseQuizDate(b.start_at, 'start_at');
  const endAt = parseQuizDate(b.end_at, 'end_at');
  if (startAt && endAt && endAt <= startAt) throw ApiError.badRequest('end_at must be after start_at');

  const privatePassword = quizPassword(b.access_password);
  const isPrivate = !!(b.is_private || privatePassword);
  if (isPrivate && !privatePassword) throw ApiError.badRequest('A private quiz requires an access password');
  const privHash = isPrivate ? await bcrypt.hash(privatePassword, 12) : null;
  const slugBase = slugify(title);
  // Non-Latin titles (for example a Hindi quiz name) remain valid; only the
  // generated URL root falls back to a generic ASCII word.
  const slug = `${slugBase || 'quiz'}-${Date.now().toString().slice(-4)}`;
  const categoryId = await validatedCategoryId(b.category_id);

  const result = await exec(
    `INSERT INTO quizzes (title, slug, description, category_id, difficulty, quiz_type, negative_marking,
        time_limit_minutes, passing_score, start_at, end_at, max_participants, status, shuffle_questions,
        show_answers_after, allow_reattempt, is_private, access_password, created_by, is_premium)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [title, slug, b.description || null, categoryId, difficulty, quizType,
      boundedQuizNumber(b.negative_marking, 0, 0, 100),
      Math.round(boundedQuizNumber(b.time_limit_minutes, 15, 1, 1440)),
      Math.round(boundedQuizNumber(b.passing_score, 40, 0, 100)), startAt, endAt,
      b.max_participants === null || b.max_participants === undefined || b.max_participants === ''
        ? null : Math.round(boundedQuizNumber(b.max_participants, 1, 1, 1000000)),
      status, b.shuffle_questions ? 1 : 0, b.show_answers_after === false ? 0 : 1,
      b.allow_reattempt ? 1 : 0, isPrivate ? 1 : 0, privHash, req.user.id,
      ['owner', 'admin'].includes(req.user.role) && b.is_premium ? 1 : 0],
  );
  created(res, publicQuiz(await q1('SELECT * FROM quizzes WHERE id = ?', [result.insertId])));
});

const update = asyncHandler(async (req, res) => {
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [req.params.id]);
  if (!quiz) throw ApiError.notFound('Quiz not found');
  if (!isQuizManager(req.user, quiz)) {
    throw ApiError.forbidden('This quiz belongs to an administrator or another creator — a developer may edit only quizzes they created.');
  }
  if (req.body.is_premium !== undefined && !['owner', 'admin'].includes(req.user.role)) {
    throw ApiError.forbidden('⭐ Only an ADMIN may mark content as premium or remove that marking');
  }

  const allowed = ['title', 'description', 'category_id', 'difficulty', 'quiz_type', 'negative_marking',
    'time_limit_minutes', 'passing_score', 'start_at', 'end_at', 'max_participants', 'status',
    'shuffle_questions', 'show_answers_after', 'allow_reattempt'];
  const data = {};
  allowed.forEach((key) => { if (req.body[key] !== undefined) data[key] = req.body[key]; });
  if (req.body.is_premium !== undefined) data.is_premium = req.body.is_premium ? 1 : 0;
  if (req.body.is_private !== undefined) data.is_private = req.body.is_private ? 1 : 0;

  if (data.title !== undefined) {
    data.title = String(data.title || '').trim().slice(0, 200);
    if (!data.title) throw ApiError.badRequest('Quiz title cannot be empty');
  }
  if (data.status !== undefined) {
    if (!QUIZ_STATUSES.includes(data.status)) throw ApiError.badRequest('Invalid quiz status');
    // Live state has a dedicated lobby -> synchronized-start -> end workflow,
    // guarded by host_quiz. Letting the generic editor flip status='live'
    // bypassed that permission and stamped an already-started timer.
    if ((data.status === 'live') !== (quiz.status === 'live')) {
      throw ApiError.badRequest('Use Live Hosting controls to open, start or end a live quiz');
    }
  }
  if (data.quiz_type !== undefined) {
    if (!QUIZ_TYPES.includes(data.quiz_type)) throw ApiError.badRequest('Invalid quiz type');
    if ((data.quiz_type === 'live') !== (quiz.quiz_type === 'live') && quiz.status === 'live') {
      throw ApiError.badRequest('End the live session before changing this quiz type');
    }
  }
  if (data.difficulty !== undefined && !QUIZ_DIFFICULTIES.includes(data.difficulty)) {
    throw ApiError.badRequest('Invalid quiz difficulty');
  }
  if (data.category_id !== undefined) data.category_id = await validatedCategoryId(data.category_id);
  if (data.negative_marking !== undefined) data.negative_marking = boundedQuizNumber(data.negative_marking, quiz.negative_marking, 0, 100);
  if (data.time_limit_minutes !== undefined) data.time_limit_minutes = Math.round(boundedQuizNumber(data.time_limit_minutes, quiz.time_limit_minutes, 1, 1440));
  if (data.passing_score !== undefined) data.passing_score = Math.round(boundedQuizNumber(data.passing_score, quiz.passing_score, 0, 100));
  if (data.max_participants !== undefined) {
    data.max_participants = data.max_participants === null || data.max_participants === ''
      ? null : Math.round(boundedQuizNumber(data.max_participants, 1, 1, 1000000));
  }
  for (const key of ['shuffle_questions', 'show_answers_after', 'allow_reattempt']) {
    if (data[key] !== undefined) data[key] = data[key] ? 1 : 0;
  }
  if (data.start_at !== undefined || data.end_at !== undefined) {
    const startAt = data.start_at === undefined ? quiz.start_at : parseQuizDate(data.start_at, 'start_at');
    const endAt = data.end_at === undefined ? quiz.end_at : parseQuizDate(data.end_at, 'end_at');
    if (startAt && endAt && new Date(endAt) <= new Date(startAt)) {
      throw ApiError.badRequest('end_at must be after start_at');
    }
    if (data.start_at !== undefined) data.start_at = startAt;
    if (data.end_at !== undefined) data.end_at = endAt;
  }

  const suppliedPassword = req.body.access_password
    ? quizPassword(req.body.access_password) : null;
  if (data.is_private === 0) {
    data.access_password = null;
  } else if (suppliedPassword) {
    data.access_password = await bcrypt.hash(suppliedPassword, 12);
    data.is_private = 1;
  } else if (data.is_private === 1 && !quiz.access_password) {
    throw ApiError.badRequest('A private quiz requires an access password');
  }

  const keys = Object.keys(data);
  if (!keys.length) throw ApiError.badRequest('Nothing to update');
  await exec(`UPDATE quizzes SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), req.params.id]);
  ok(res, publicQuiz(await q1('SELECT * FROM quizzes WHERE id = ?', [req.params.id])));
});

const remove = asyncHandler(async (req, res) => {
  const quiz = await q1('SELECT id, created_by FROM quizzes WHERE id = ?', [req.params.id]);
  if (!quiz) throw ApiError.notFound('Quiz not found');
  if (req.user.role === 'developer' && Number(quiz.created_by) !== Number(req.user.id)) {
    throw ApiError.forbidden('This quiz belongs to an administrator or another creator — a developer may delete only quizzes they created.');
  }
  await exec('DELETE FROM quizzes WHERE id = ?', [req.params.id]);
  ok(res, { deleted: true });
});

/* ----------------------- JSON import / export ----------------------- */
const TRANSFER_SCHEMA = 'smartodl-transfer';
const TRANSFER_VERSION = 1;
const MAX_IMPORT_QUIZZES = 1000;

const transferText = (value, max, fallback = '') => String(value == null ? fallback : value).slice(0, max);
const transferNumber = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const transferArray = (value) => {
  const parsed = fromJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
};
const transferObject = (value) => {
  const parsed = fromJson(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};
const transferValue = (value, fallback = null) => {
  const parsed = fromJson(value, fallback);
  return parsed === undefined ? fallback : parsed;
};

async function quizTransferItems(quizzes) {
  if (!quizzes.length) return [];
  const ids = quizzes.map((quiz) => Number(quiz.id));
  const placeholders = ids.map(() => '?').join(',');
  const questions = await q(
    `SELECT * FROM quiz_questions WHERE quiz_id IN (${placeholders}) ORDER BY quiz_id, position, id`, ids,
  );
  const grouped = questions.reduce((map, question) => {
    (map[question.quiz_id] = map[question.quiz_id] || []).push({
      type: question.type,
      question_text: question.question_text,
      question_image: question.question_image,
      code_snippet: question.code_snippet,
      options: transferArray(question.options),
      correct_answer: transferValue(question.correct_answer),
      marks: Number(question.marks),
      negative_marks: Number(question.negative_marks),
      difficulty: question.difficulty,
      explanation: question.explanation,
      position: Number(question.position),
      coding_languages: transferArray(question.coding_languages),
      starter_code: transferObject(question.starter_code),
      test_cases: transferArray(question.test_cases),
      time_limit_ms: Number(question.time_limit_ms),
      memory_limit_kb: Number(question.memory_limit_kb),
      time_limit_seconds: question.time_limit_seconds == null ? null : Number(question.time_limit_seconds),
    });
    return map;
  }, {});
  return quizzes.map((quiz) => ({
    quiz: {
      title: quiz.title,
      description: quiz.description,
      category: quiz.category_slug || quiz.category_name
        ? { slug: quiz.category_slug || null, name: quiz.category_name || null }
        : null,
      difficulty: quiz.difficulty,
      quiz_type: quiz.quiz_type,
      negative_marking: Number(quiz.negative_marking),
      time_limit_minutes: Number(quiz.time_limit_minutes),
      passing_score: Number(quiz.passing_score),
      start_at: quiz.start_at,
      end_at: quiz.end_at,
      max_participants: quiz.max_participants == null ? null : Number(quiz.max_participants),
      shuffle_questions: !!quiz.shuffle_questions,
      show_answers_after: !!quiz.show_answers_after,
      allow_reattempt: !!quiz.allow_reattempt,
      is_private: !!quiz.is_private,
    },
    questions: grouped[quiz.id] || [],
  }));
}

function makeQuizPackage(items) {
  return {
    schema: TRANSFER_SCHEMA,
    version: TRANSFER_VERSION,
    kind: 'quizzes',
    exported_at: new Date().toISOString(),
    safety: {
      imported_status: 'draft',
      imported_private_state: false,
      excluded: ['ids', 'access passwords', 'attempts', 'answers', 'participants', 'results', 'creator account'],
      contains_correct_answers: true,
    },
    items,
  };
}

const exportQuizzes = asyncHandler(async (req, res) => {
  const scoped = req.user && req.user.role === 'developer';
  const rows = await q(
    `SELECT z.*, cat.name AS category_name, cat.slug AS category_slug
       FROM quizzes z LEFT JOIN categories cat ON cat.id = z.category_id
       ${scoped ? 'WHERE z.created_by = ?' : ''}
       ORDER BY z.created_at DESC`,
    scoped ? [req.user.id] : [],
  );
  ok(res, makeQuizPackage(await quizTransferItems(rows)));
});

const exportQuiz = asyncHandler(async (req, res) => {
  const quiz = await q1(
    `SELECT z.*, cat.name AS category_name, cat.slug AS category_slug
       FROM quizzes z LEFT JOIN categories cat ON cat.id = z.category_id
      WHERE z.id = ?`, [req.params.id],
  );
  if (!quiz) throw ApiError.notFound('Quiz not found');
  if (req.user && req.user.role === 'developer' && Number(quiz.created_by) !== Number(req.user.id)) {
    throw ApiError.forbidden('A developer may export only quizzes they created.');
  }
  ok(res, makeQuizPackage(await quizTransferItems([quiz])));
});

function readQuizPackage(body) {
  const pack = body && body.package ? body.package : body;
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw ApiError.badRequest('A JSON package object is required');
  if (pack.kind === 'coding-problems') {
    throw ApiError.badRequest('This is a Coding Problems package, not a Quiz package. Import it from Coding Arena → Problem Management or Test Case Workbench.');
  }
  if (pack.schema !== TRANSFER_SCHEMA || Number(pack.version) !== TRANSFER_VERSION || pack.kind !== 'quizzes') {
    throw ApiError.badRequest('Unsupported Quiz JSON package. Expected smartodl-transfer version 1 with kind "quizzes".');
  }
  if (!Array.isArray(pack.items) || !pack.items.length) throw ApiError.badRequest('The package contains no quizzes');
  if (pack.items.length > MAX_IMPORT_QUIZZES) throw ApiError.badRequest(`A maximum of ${MAX_IMPORT_QUIZZES} quizzes can be imported at once`);
  return pack.items;
}

const importQuizzes = asyncHandler(async (req, res) => {
  const items = readQuizPackage(req.body);
  let totalQuestions = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object' || !item.quiz || typeof item.quiz !== 'object') throw ApiError.badRequest('Every item must contain a quiz object');
    if (!transferText(item.quiz.title, 200).trim()) throw ApiError.badRequest('Every imported quiz requires a title');
    if (!Array.isArray(item.questions)) throw ApiError.badRequest('Every quiz must contain a questions array');
    totalQuestions += item.questions.length;
    for (const question of item.questions) {
      if (!question || typeof question !== 'object' || !transferText(question.question_text, 200000).trim()) {
        throw ApiError.badRequest('Every imported question requires question_text');
      }
    }
  }
  if (totalQuestions > 10000) throw ApiError.badRequest('A package can contain at most 10000 questions');

  const imported = await tx(async (conn) => {
    const output = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const source = item.quiz;
      const baseTitle = transferText(source.title, 200).trim();
      const [duplicates] = await conn.execute('SELECT id FROM quizzes WHERE title = ? LIMIT 1', [baseTitle]);
      const title = duplicates.length ? `${baseTitle.slice(0, 189)} (Imported)` : baseTitle;
      let categoryId = null;
      if (source.category && typeof source.category === 'object') {
        const [categories] = await conn.execute(
          'SELECT id FROM categories WHERE slug = ? OR name = ? LIMIT 1',
          [transferText(source.category.slug, 180), transferText(source.category.name, 120)],
        );
        if (categories.length) categoryId = categories[0].id;
      }
      const difficulty = ['easy', 'medium', 'hard'].includes(source.difficulty) ? source.difficulty : 'easy';
      const quizType = ['normal', 'live', 'practice'].includes(source.quiz_type) ? source.quiz_type : 'normal';
      const slug = `${slugify(title).slice(0, 175) || 'quiz'}-import-${Date.now().toString(36)}-${index}-${crypto.randomBytes(4).toString('hex')}`;
      const validDate = (value) => {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
      };
      const [result] = await conn.execute(
        `INSERT INTO quizzes (title, slug, description, category_id, difficulty, quiz_type, negative_marking,
           time_limit_minutes, passing_score, start_at, end_at, max_participants, status, shuffle_questions,
           show_answers_after, allow_reattempt, is_private, access_password, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,NULL,?)`,
        [title, slug, transferText(source.description, 65000) || null, categoryId, difficulty, quizType,
          transferNumber(source.negative_marking, 0, 0, 100), Math.round(transferNumber(source.time_limit_minutes, 15, 1, 1440)),
          Math.round(transferNumber(source.passing_score, 40, 0, 100)), validDate(source.start_at), validDate(source.end_at),
          source.max_participants == null ? null : Math.round(transferNumber(source.max_participants, 1, 1, 1000000)),
          source.shuffle_questions ? 1 : 0, source.show_answers_after === false ? 0 : 1,
          source.allow_reattempt ? 1 : 0, 0, req.user.id],
      );
      const quizId = result.insertId;
      for (let questionIndex = 0; questionIndex < item.questions.length; questionIndex += 1) {
        const question = item.questions[questionIndex];
        const type = ['mcq', 'multiple', 'true_false', 'short_answer', 'coding'].includes(question.type) ? question.type : 'mcq';
        const coding = type === 'coding';
        const testCases = coding ? transferArray(question.test_cases).slice(0, 500) : [];
        await conn.execute(
          `INSERT INTO quiz_questions (quiz_id, type, question_text, question_image, code_snippet, options,
             correct_answer, marks, negative_marks, difficulty, explanation, position, coding_languages,
             starter_code, test_cases, time_limit_ms, memory_limit_kb, time_limit_seconds)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [quizId, type, transferText(question.question_text, 200000), transferText(question.question_image, 255) || null,
            transferText(question.code_snippet, 200000) || null, JSON.stringify(transferArray(question.options).slice(0, 100)),
            JSON.stringify(transferValue(question.correct_answer)), Math.round(transferNumber(question.marks, 1, 0, 100000)),
            transferNumber(question.negative_marks, 0, 0, 100),
            ['easy', 'medium', 'hard'].includes(question.difficulty) ? question.difficulty : 'easy',
            transferText(question.explanation, 65000) || null,
            Math.round(transferNumber(question.position, questionIndex + 1, 1, 100000)),
            coding ? JSON.stringify(transferArray(question.coding_languages).length ? transferArray(question.coding_languages).slice(0, 20) : DEFAULT_LANGUAGES) : null,
            coding ? JSON.stringify(transferObject(question.starter_code)) : null,
            coding ? JSON.stringify(testCases) : null,
            coding ? Math.round(transferNumber(question.time_limit_ms, 2000, 100, 60000)) : 2000,
            coding ? Math.round(transferNumber(question.memory_limit_kb, 262144, 16384, 4194304)) : 262144,
            question.time_limit_seconds == null ? null : Math.round(transferNumber(question.time_limit_seconds, 0, 0, 86400))],
        );
      }
      await conn.execute(
        `UPDATE quizzes SET question_count = (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = ?),
           total_marks = (SELECT COALESCE(SUM(marks),0) FROM quiz_questions WHERE quiz_id = ?) WHERE id = ?`,
        [quizId, quizId, quizId],
      );
      output.push({ id: quizId, title, questions: item.questions.length, status: 'draft', private: false });
    }
    return output;
  });
  created(res, {
    imported_count: imported.length,
    items: imported,
    status: 'draft',
    warnings: ['Access passwords and operational attempt/result data are never imported. Imported quizzes are non-private drafts.'],
  });
});

/* --------------------------- live quiz control --------------------------- */
const startLive = asyncHandler(async (req, res) => {
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [req.params.id]);
  assertCanHostQuiz(req, quiz);

  if (quiz.status === 'live' && quiz.quiz_type === 'live' && !quiz.live_started_at) {
    // Re-opening an already-open lobby must be idempotent. Restamping
    // start_at would change every seated student's individualized paper.
    return ok(res, publicQuiz(quiz));
  }
  if (quiz.status === 'live' && quiz.live_started_at) {
    throw ApiError.conflict('This live session has already started — end it before opening a new lobby');
  }

  const [{ c: questionCount }] = await q(
    'SELECT COUNT(*) AS c FROM quiz_questions WHERE quiz_id = ?',
    [quiz.id],
  );
  if (Number(questionCount) < 1) throw ApiError.badRequest('Add at least one question before opening a live quiz');

  // A restart/repurpose cannot leave attempts from a previous mode running
  // underneath the new lobby clock.
  const running = await q(
    "SELECT id FROM quiz_attempts WHERE quiz_id = ? AND status = 'in_progress'",
    [quiz.id],
  );
  for (const attempt of running) {
    try { await evaluateAttempt(attempt.id); liveProctor.removeAttempt(attempt.id); }
    catch (error) { console.error('[live-quiz] closing previous attempt failed:', error.message); }
  }

  const minutes = req.body.time_limit_minutes === undefined
    ? Number(quiz.time_limit_minutes || 10)
    : Math.round(boundedQuizNumber(req.body.time_limit_minutes, quiz.time_limit_minutes, 1, 1440));

  // Conditional transition: if another host request started the session in
  // the meantime, this request cannot reset its clock underneath students.
  const transitioned = await exec(
    `UPDATE quizzes SET status='live', quiz_type='live', shuffle_questions=1,
       time_limit_minutes = ?, live_started_at = NULL, live_ended_at = NULL,
       start_at = NOW(), end_at = NULL
      WHERE id = ? AND NOT (status = 'live' AND live_started_at IS NOT NULL)`,
    [minutes, quiz.id],
  );
  if (Number(transitioned.affectedRows) !== 1) {
    throw ApiError.conflict('This live session has already started — end it before opening a new lobby');
  }

  await liveQuiz.setHost(quiz.id, req.user.id);
  await notify({ audience: 'student', type: 'quiz', link: `/quizzes/${quiz.id}/live`, createdBy: req.user.id,
    title: `Live quiz lobby open: ${quiz.title}`,
    message: 'Join now — the quiz starts for everyone at the same moment the host presses Start.' });
  events.publish('live_quiz', { quiz_id: quiz.id, action: 'lobby' });
  ok(res, publicQuiz(await q1('SELECT * FROM quizzes WHERE id = ?', [quiz.id])));
});

/** POST /api/quizzes/:id/live/start — START FOR EVERYONE (synchronized launch).
 *  Ends the lobby phase: live_started_at stamps the shared start instant, every
 *  seat already taken is re-stamped to that instant, and a realtime event fires
 *  all waiting students into their runners at the same moment. */
const startForAll = asyncHandler(async (req, res) => {
  const outcome = await tx(async (conn) => {
    const [[quiz]] = await conn.query('SELECT * FROM quizzes WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!quiz) return { kind: 'missing' };
    if (!isQuizHost(req.user, quiz)) return { kind: 'forbidden' };
    if (quiz.status !== 'live' || quiz.quiz_type !== 'live') return { kind: 'not_live', quiz };
    if (quiz.live_started_at) return { kind: 'already', quiz };

    const minutes = Math.max(1, Number(quiz.time_limit_minutes || 10));
    await conn.execute(
      'UPDATE quizzes SET live_started_at = NOW(), end_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
      [minutes, quiz.id],
    );
    const [[started]] = await conn.query(
      'SELECT live_started_at FROM quizzes WHERE id = ?',
      [quiz.id],
    );
    await conn.execute(
      "UPDATE quiz_attempts SET started_at = ? WHERE quiz_id = ? AND status = 'in_progress'",
      [started.live_started_at, quiz.id],
    );
    return { kind: 'started', quiz, minutes };
  });

  if (outcome.kind === 'missing') throw ApiError.notFound('Quiz not found');
  if (outcome.kind === 'forbidden') throw ApiError.forbidden('Only the quiz creator, its assigned host, or an administrator can control this live session.');
  if (outcome.kind === 'not_live') throw ApiError.badRequest('This quiz is not in the live lobby right now');
  if (outcome.kind === 'already') throw ApiError.conflict('This live quiz has already started for everyone');

  events.publish('live_quiz', { quiz_id: outcome.quiz.id, action: 'started' });
  await notify({ audience: 'student', type: 'quiz', link: `/quizzes/${outcome.quiz.id}/live`, createdBy: req.user.id,
    title: `🚀 ${outcome.quiz.title} — START!`, message: `The quiz has started for everyone. You have ${outcome.minutes} minutes. Good luck!` });
  ok(res, publicQuiz(await q1('SELECT * FROM quizzes WHERE id = ?', [outcome.quiz.id])));
});

const endLive = asyncHandler(async (req, res) => {
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [req.params.id]);
  assertCanHostQuiz(req, quiz);
  if (quiz.status === 'completed' && quiz.quiz_type === 'live') {
    return ok(res, { ended: true, already: true, auto_submitted: 0, evaluation_failed: 0 });
  }
  if (quiz.status !== 'live' || quiz.quiz_type !== 'live') {
    throw ApiError.badRequest('This quiz does not have a live session to end');
  }

  const transitioned = await exec(
    "UPDATE quizzes SET status='completed', live_ended_at = NOW(), end_at = NOW() WHERE id = ? AND status = 'live'",
    [quiz.id],
  );
  if (Number(transitioned.affectedRows) !== 1) {
    return ok(res, { ended: true, already: true, auto_submitted: 0, evaluation_failed: 0 });
  }

  let autoSubmitted = 0;
  let evaluationFailed = 0;
  // Two passes closes the tiny join-vs-end race without letting one broken
  // attempt prevent every later student from being graded.
  for (let pass = 0; pass < 2; pass += 1) {
    const running = await q(
      "SELECT id FROM quiz_attempts WHERE quiz_id = ? AND status = 'in_progress'",
      [quiz.id],
    );
    if (!running.length) break;
    for (const attempt of running) {
      try {
        await evaluateAttempt(attempt.id);
        liveProctor.removeAttempt(attempt.id);
        autoSubmitted += 1;
      } catch (error) {
        evaluationFailed += 1;
        console.error('[live-quiz] auto-submit evaluation failed:', error.message);
      }
    }
  }

  events.publish('live_quiz', { quiz_id: quiz.id, action: 'ended' });
  ok(res, { ended: true, auto_submitted: autoSubmitted, evaluation_failed: evaluationFailed });
});

/** PUT /api/quiz-attempts/:id/violation — tab-switch guard (anti-cheat).
 *  The runner reports each tab/window switch during a live quiz; the server
 *  keeps an auditable counter the host can see on the monitor screen. */
const recordViolation = asyncHandler(async (req, res) => {
  const attempt = await q1('SELECT id, user_id, status, tab_violations FROM quiz_attempts WHERE id = ?', [req.params.id]);
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (Number(attempt.user_id) !== Number(req.user.id) && !['owner', 'admin'].includes(req.user.role)) throw ApiError.forbidden('This is not your attempt');
  if (attempt.status !== 'in_progress') return ok(res, { violations: Number(attempt.tab_violations || 0), closed: true });
  await exec('UPDATE quiz_attempts SET tab_violations = tab_violations + 1 WHERE id = ?', [attempt.id]);
  const fresh = await q1('SELECT tab_violations FROM quiz_attempts WHERE id = ?', [attempt.id]);
  ok(res, { violations: Number(fresh.tab_violations) });
});

/**
 * POST /api/quiz-attempts/:id/proctor — batched webcam/screen-share events.
 *
 * The browser does all the analysis and posts only event names; no image or
 * video frame is ever uploaded. See services/proctoring.service.js for why.
 */
const recordProctorEvents = asyncHandler(async (req, res) => {
  const attempt = await q1(
    'SELECT id, quiz_id, user_id, status, proctor_violations, proctor_flags FROM quiz_attempts WHERE id = ?',
    [req.params.id],
  );
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (Number(attempt.user_id) !== Number(req.user.id)) throw ApiError.forbidden('This is not your attempt');
  if (attempt.status !== 'in_progress') return ok(res, { closed: true, violations: Number(attempt.proctor_violations || 0) });

  // Source is explicit: this student endpoint may only mint client events.
  // Host/server attestations posted here are dropped inside recordEvents.
  const result = await proctorSvc.recordEvents(attempt, req.body && req.body.events, { source: 'client' });

  // One number now carries the whole auto-submit decision: 0 (the default)
  // means never. Object detections never reach here as violations — they are
  // advisory by design, so a misread remote can't end somebody's exam.
  // The limit is the quiz CREATOR's (their override, else the admin default).
  const max = Math.max(0, await antiCheat.resolveNumForUser(
    await antiCheat.quizCreatorId(attempt.quiz_id), 'proctor_max_violations', 0,
  ));
  return ok(res, { ...result, max, auto_submit: max > 0 && result.violations >= max });
});

/**
 * GET /api/quiz-attempts/:id/proctor — the invigilator's evidence view.
 *
 * Without this the whole proctoring trail was write-only: events landed in
 * proctor_events and nothing could ever read them back, which made the
 * "advisory flag a human reviews" design impossible to actually carry out.
 */
const proctorReport = asyncHandler(async (req, res) => {
  const attempt = await q1(
    `SELECT qa.id, qa.user_id, qa.status, qa.started_at, qa.submitted_at,
            qa.proctor_camera, qa.proctor_screen, qa.proctor_violations, qa.proctor_flags,
            qa.proctor_policy, u.full_name, u.email
       FROM quiz_attempts qa JOIN users u ON u.id = qa.user_id WHERE qa.id = ?`,
    [req.params.id],
  );
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (req.user && req.user.role === 'developer') {
    const owner = await q1(
      'SELECT z.created_by FROM quiz_attempts qa JOIN quizzes z ON z.id = qa.quiz_id WHERE qa.id = ?',
      [attempt.id],
    );
    if (!owner || Number(owner.created_by) !== Number(req.user.id)) {
      throw ApiError.forbidden('Proctoring evidence is visible to the quiz creator and admins only.');
    }
  }
  const [summary, timeline] = await Promise.all([
    proctorSvc.summaryFor(attempt.id),
    proctorSvc.timelineFor(attempt.id),
  ]);
  ok(res, {
    attempt: {
      id: attempt.id, student: attempt.full_name, email: attempt.email,
      status: attempt.status, started_at: attempt.started_at, submitted_at: attempt.submitted_at,
      camera_started: !!Number(attempt.proctor_camera),
      screen_started: !!Number(attempt.proctor_screen),
      violations: Number(attempt.proctor_violations || 0),
      flags: String(attempt.proctor_flags || '').split(',').filter(Boolean),
      // The frozen rules this attempt was actually run under — essential
      // context when an admin changed switches after the paper started.
      policy: proctorSvc.parseProctorPolicy(attempt.proctor_policy),
    },
    summary,
    timeline,
  });
});

/**
 * POST /api/quiz-attempts/:id/proctor-frame — one ephemeral snapshot frame.
 *
 * This is used only when the administrator enables the live snapshot grid.
 * The frame is held in process memory for the host's next poll and expires
 * automatically; it is never written to disk or the database.
 */
const updateProctorFrame = asyncHandler(async (req, res) => {
  const attempt = await assertStudentProctorAttempt(req);
  if (attempt.status !== 'in_progress') return ok(res, { accepted: false, closed: true });
  // Frozen policy ∩ live switches: snapshot must have been part of THIS
  // attempt's consent, and must not have been switched off since.
  const settings = await effectiveAdvancedForAttempt(attempt);
  if (!settings.snapshot) return ok(res, { accepted: false, disabled: true });
  const kind = String((req.body && req.body.kind) || '');
  if (!['camera', 'screen'].includes(kind)) throw ApiError.badRequest('kind must be camera or screen');
  const saved = liveProctor.putFrame(attempt, kind, req.body && req.body.image);
  if (!saved) throw ApiError.badRequest('A small JPEG/WebP frame is required');
  return ok(res, {
    accepted: true, kind, storage: 'memory-only',
    expires_in_ms: liveProctor.FRAME_TTL_BY_KIND[kind] || 45000,
  });
});

/** GET /api/quizzes/:id/proctor-frames — latest ephemeral frames for the host. */
const getQuizProctorFrames = asyncHandler(async (req, res) => {
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [req.params.id]);
  assertCanHostQuiz(req, quiz);
  const settings = await advancedProctorSettings();
  const attempts = await q(
    `SELECT id FROM quiz_attempts
      WHERE quiz_id = ? AND (status = 'in_progress' OR started_at >= COALESCE(?, '1970-01-02'))`,
    [quiz.id, quiz.live_started_at],
  );
  const secondCameras = {};
  attempts.forEach((row) => {
    secondCameras[String(row.id)] = liveProctor.secondCameraStatus(row.id);
  });
  const since = Math.max(0, Number(req.query && req.query.since) || 0);
  const now = Date.now();
  return ok(res, {
    enabled: !!(settings.snapshot || settings.secondCamera),
    storage: 'memory-only',
    // Incremental polling: with `since`, only frames newer than the host's
    // last poll are returned; the host merges and ages out each feed by
    // its own timestamp/TTL below.
    frames: settings.snapshot || settings.secondCamera
      ? liveProctor.framesForQuiz(quiz.id, now, { since }) : {},
    frame_ttl_ms: liveProctor.FRAME_TTL_BY_KIND,
    server_time: now,
    second_cameras: secondCameras,
    stats: liveProctor.stats(now),
  });
});

/** POST /api/quiz-attempts/:id/second-camera/session — phone pairing token. */
const createSecondCameraSession = asyncHandler(async (req, res) => {
  const attempt = await assertStudentProctorAttempt(req);
  if (attempt.status !== 'in_progress') throw ApiError.badRequest('This attempt is already closed');
  const settings = await effectiveAdvancedForAttempt(attempt);
  if (!settings.secondCamera) throw ApiError.forbidden('Mobile second camera is disabled by the administrator');
  const rotate = !!req.body && ['1', 'true', 'yes', 'on'].includes(String(req.body.rotate ?? '').toLowerCase())
    || !!(req.body && req.body.rotate === true);
  const session = liveProctor.createSecondCameraSession(attempt, Date.now(), { rotate });
  return ok(res, {
    session,
    path: `/proctor/second-camera/${session.token}`,
    storage: 'memory-only',
  });
});

/** GET /api/quiz-attempts/:id/second-camera/status — student/host poll. */
const getSecondCameraStatus = asyncHandler(async (req, res) => {
  const attempt = await proctorAttemptRow(req.params.id);
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (Number(attempt.user_id) !== Number(req.user.id)) {
    const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [attempt.quiz_id]);
    assertCanHostQuiz(req, quiz);
  }
  return ok(res, liveProctor.secondCameraStatus(attempt.id));
});

/** Public-by-token phone page metadata. The random attempt-bound token is the credential. */
const secondCameraInfo = asyncHandler(async (req, res) => {
  const session = liveProctor.getSecondCameraSession(req.params.token);
  if (!session) throw ApiError.notFound('This second-camera link has expired');
  const row = await q1(
    `SELECT qa.status, qa.proctor_policy, u.full_name, z.title AS quiz_title
       FROM quiz_attempts qa
       JOIN users u ON u.id = qa.user_id
       JOIN quizzes z ON z.id = qa.quiz_id
      WHERE qa.id = ?`,
    [session.attemptId],
  );
  if (!row) throw ApiError.notFound('Attempt not found');
  const settings = await effectiveAdvancedForAttempt({ proctor_policy: row.proctor_policy });
  return ok(res, {
    quiz_title: row.quiz_title,
    student_name: row.full_name,
    attempt_status: row.status,
    enabled: !!settings.secondCamera,
    ...liveProctor.secondCameraStatus(session.attemptId),
  });
});

/** Public-by-token phone snapshot upload. No image is persisted. */
const updateSecondCameraFrame = asyncHandler(async (req, res) => {
  const session = liveProctor.getSecondCameraSession(req.params.token);
  if (!session) throw ApiError.notFound('This second-camera link has expired');
  const attempt = await proctorAttemptRow(session.attemptId);
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (attempt.status !== 'in_progress') return ok(res, { accepted: false, closed: true });
  const settings = await effectiveAdvancedForAttempt(attempt);
  if (!settings.secondCamera) throw ApiError.forbidden('Mobile second camera is disabled by the administrator');
  // Record a fresh server attestation on first connection AND on reconnect
  // after an outage, so the timeline shows the gap actually closed.
  const wasFresh = !!(session.lastFrameAt && Date.now() - session.lastFrameAt <= 30 * 1000);
  const status = liveProctor.putSecondCameraFrame(req.params.token, req.body && req.body.image);
  if (!status) throw ApiError.badRequest('A small JPEG/WebP frame is required');
  if (!wasFresh) {
    await proctorSvc.recordEvents(attempt, [
      { type: 'second_camera_connected', detail: 'mobile snapshot stream' },
    ], { source: 'server' });
  }
  return ok(res, { accepted: true, ...status, storage: 'memory-only' });
});

/**
 * POST /api/quiz-attempts/:id/proctor-signal — WebRTC signalling relay.
 *
 * Media itself is peer-to-peer and encrypted by WebRTC; this endpoint only
 * exchanges SDP/ICE messages through the authenticated SSE hub. A host
 * registers a random viewer-session id with its first offer, and student
 * answers/candidates are routed back only to that host account.
 */
const proctorSignal = asyncHandler(async (req, res) => {
  const attempt = await proctorAttemptRow(req.params.id);
  if (!attempt) throw ApiError.notFound('Attempt not found');
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [attempt.quiz_id]);
  const fromStudent = Number(attempt.user_id) === Number(req.user.id);
  const fromHost = !fromStudent && isQuizHost(req.user, quiz);
  if (!fromStudent && !fromHost) throw ApiError.forbidden('You cannot signal for this attempt');
  const settings = await effectiveAdvancedForAttempt(attempt);
  if (!settings.webrtc) throw ApiError.forbidden('Live WebRTC proctoring is disabled by the administrator');

  const body = req.body || {};
  const sessionId = String(body.session_id || '');
  const kind = String(body.kind || '');
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(sessionId)) throw ApiError.badRequest('A valid session_id is required');
  if (!['offer', 'answer', 'candidate', 'focus', 'bye'].includes(kind)) throw ApiError.badRequest('Invalid signal kind');
  if (JSON.stringify(body).length > 80 * 1024) throw ApiError.badRequest('Signal is too large');
  if (body.sdp !== undefined && (typeof body.sdp !== 'string' || body.sdp.length > 64 * 1024)) {
    throw ApiError.badRequest('Invalid SDP');
  }
  if (attempt.status !== 'in_progress' && kind !== 'bye') return ok(res, { delivered: false, closed: true });

  let targetUserId = null;
  if (fromHost) {
    const viewer = liveProctor.registerViewer(sessionId, req.user.id, quiz.id, Date.now(), attempt.id);
    if (!viewer) return ok(res, { delivered: false, session_conflict: true });
    targetUserId = Number(attempt.user_id);
    // Per-attempt retire: closing one student's peer must not unregister
    // the host session that the rest of the class grid is still using.
    if (kind === 'bye') liveProctor.forgetViewer(sessionId, req.user.id, attempt.id);
  } else {
    const viewer = liveProctor.viewerFor(sessionId);
    if (!viewer || Number(viewer.quizId) !== Number(quiz.id)
      || !liveProctor.viewerAllowsAttempt(viewer, attempt.id)) {
      return ok(res, { delivered: false, viewer_gone: true });
    }
    targetUserId = Number(viewer.hostUserId);
  }

  const deliveryCount = events.publish('proctor_signal', {
    attempt_id: Number(attempt.id),
    quiz_id: Number(quiz.id),
    session_id: sessionId,
    kind,
    sdp: body.sdp || null,
    candidate: body.candidate || null,
    focus_screen: !!body.focus_screen,
    from: fromHost ? 'host' : 'student',
    at: Date.now(),
  }, { userId: targetUserId });
  // Honest delivery: SSE has no mailbox, so "accepted by the API" and
  // "written to a live browser socket" are different things. The host's
  // retry loop keys off peers that never connect either way.
  return ok(res, { delivered: deliveryCount > 0, delivery_count: deliveryCount });
});

/**
 * GET /api/quiz-attempts/:id/proctor-ice — ICE servers for this attempt's
 * WebRTC peers. Authenticated and attempt-scoped on purpose: the list may
 * carry TURN credentials, so it is never part of public settings. With
 * PROCTOR_TURN_* env configured the credentials are short-lived per user.
 */
const getProctorIceServers = asyncHandler(async (req, res) => {
  const attempt = await proctorAttemptRow(req.params.id);
  if (!attempt) throw ApiError.notFound('Attempt not found');
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [attempt.quiz_id]);
  const isOwner = Number(attempt.user_id) === Number(req.user.id);
  if (!isOwner && !isQuizHost(req.user, quiz)) {
    throw ApiError.forbidden('ICE servers are available to this attempt\'s student and host only');
  }
  const settings = await effectiveAdvancedForAttempt(attempt);
  if (!settings.webrtc || attempt.status !== 'in_progress') {
    return ok(res, { ice_servers: iceServersSvc.DEFAULT_STUN, expires_at: null, disabled: true });
  }
  const raw = await readSetting('proctor_webrtc_ice_servers', '');
  const built = iceServersSvc.buildIceServers({ rawSetting: raw, userId: req.user.id });
  return ok(res, { ...built, disabled: false });
});

/** POST /api/quiz-attempts/:id/proctor-action — host warning / identity verification. */
const proctorHostAction = asyncHandler(async (req, res) => {
  const { attempt, quiz } = await assertHostProctorAttempt(req);
  const settings = await effectiveAdvancedForAttempt(attempt);
  const action = String((req.body && req.body.action) || '');

  if (action === 'warning') {
    if (!settings.warnings) throw ApiError.forbidden('Live host warnings are disabled by the administrator');
    if (attempt.status !== 'in_progress') throw ApiError.badRequest('This attempt is already closed');
    const message = String((req.body && req.body.message) || 'Please follow the proctoring instructions and remain visible on camera.')
      .replace(/\s+/g, ' ').trim().slice(0, 240);
    const deliveryCount = events.publish('proctor_warning', {
      attempt_id: Number(attempt.id),
      quiz_id: Number(quiz.id),
      message,
      at: Date.now(),
    }, { userId: Number(attempt.user_id) });
    await proctorSvc.recordEvents(attempt, [{ type: 'host_warning_sent', detail: message }], { source: 'host' });
    return ok(res, { action, delivered: deliveryCount > 0, delivery_count: deliveryCount });
  }

  if (action === 'verify_identity') {
    if (!settings.identity) throw ApiError.forbidden('Identity checking is disabled by the administrator');
    if (attempt.status !== 'in_progress') throw ApiError.badRequest('This attempt is already closed');
    await proctorSvc.recordEvents(attempt, [
      { type: 'identity_verified', detail: `verified by host user ${req.user.id}` },
    ], { source: 'host' });
    return ok(res, { action, verified: true });
  }

  throw ApiError.badRequest('action must be warning or verify_identity');
});

/** POST /api/quiz-attempts/:id/ping — presence heartbeat.
 *  The runner pings every ~15s while the student is on the quiz and sends
 *  { leaving: 1 } when the page is closed/navigated away. The host monitor
 *  uses this to show who LEFT the quiz without submitting. */
const pingAttempt = asyncHandler(async (req, res) => {
  const attempt = await q1(
    `SELECT id, user_id, status, suspect_questions, paste_questions, suspect_list, paste_list
       FROM quiz_attempts WHERE id = ?`,
    [req.params.id],
  );
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (Number(attempt.user_id) !== Number(req.user.id)) throw ApiError.forbidden('This is not your attempt');
  if (attempt.status !== 'in_progress') return ok(res, { closed: true });

  const body = req.body || {};
  const cleanList = (value) => [...new Set((Array.isArray(value) ? value : [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 999))].sort((a, b) => a - b).slice(0, 60);
  const parseStored = (value) => {
    try { return cleanList(JSON.parse(value || '[]')); } catch (_) { return []; }
  };
  const hasSuspectList = Array.isArray(body.suspect_list);
  const hasPasteList = Array.isArray(body.paste_list);
  const suspectList = hasSuspectList
    ? cleanList([...parseStored(attempt.suspect_list), ...cleanList(body.suspect_list)])
    : parseStored(attempt.suspect_list);
  const pasteList = hasPasteList
    ? cleanList([...parseStored(attempt.paste_list), ...cleanList(body.paste_list)])
    : parseStored(attempt.paste_list);

  const leaving = Number(body.leaving) ? 1 : 0;
  const screenshots = Math.max(0, Math.min(999, Number(body.screenshots || 0)));
  const copies = Math.max(0, Math.min(999, Number(body.copies || 0)));
  const pastes = Math.max(0, Math.min(999, Number(body.pastes || 0)));
  const suspectQ = Math.max(
    Math.max(0, Math.min(999, Number(body.suspect_questions || 0))),
    hasSuspectList ? suspectList.length : 0,
  );
  const pasteQ = Math.max(
    Math.max(0, Math.min(999, Number(body.paste_questions || 0))),
    hasPasteList ? pasteList.length : 0,
  );

  await exec(
    `UPDATE quiz_attempts
        SET last_seen_at = NOW(), left_flag = ?,
            screenshot_events = GREATEST(COALESCE(screenshot_events, 0), ?),
            copy_events = GREATEST(COALESCE(copy_events, 0), ?),
            paste_events = GREATEST(COALESCE(paste_events, 0), ?),
            suspect_questions = GREATEST(COALESCE(suspect_questions, 0), ?),
            paste_questions = GREATEST(COALESCE(paste_questions, 0), ?),
            suspect_list = ?, paste_list = ?
      WHERE id = ?`,
    [leaving, screenshots, copies, pastes, suspectQ, pasteQ,
      JSON.stringify(suspectList), JSON.stringify(pasteList), attempt.id],
  );
  ok(res, { ok: true });
});

/** GET /api/quizzes/:id/live — monitor screen for the host */
const liveMonitor = asyncHandler(async (req, res) => {
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [req.params.id]);
  assertCanHostQuiz(req, quiz);
  const participants = await (async () => {
    try {
      return await q(
        `SELECT qa.id, qa.user_id, qa.score, qa.accuracy, qa.status, qa.time_taken_seconds, qa.started_at,
                qa.tab_violations, qa.left_flag, qa.screenshot_events, qa.copy_events, qa.paste_events,
                qa.suspect_questions, qa.paste_questions, qa.suspect_list, qa.paste_list,
                qa.ai_score, qa.ai_signals, qa.ai_style_score, qa.ai_paste_score,
                qa.ai_timing_score, qa.ai_verdict, qa.ai_trusted,
                qa.proctor_camera, qa.proctor_screen, qa.proctor_violations, qa.proctor_flags,
                qa.proctor_policy,
                CASE WHEN qa.last_seen_at IS NULL THEN 0 ELSE TIMESTAMPDIFF(SECOND, qa.last_seen_at, NOW()) END AS idle_seconds,
u.full_name, u.email, u.college, u.avatar,
                (SELECT COUNT(*) FROM quiz_answers an
                  WHERE an.attempt_id = qa.id
                    AND an.selected_answer IS NOT NULL
                    AND TRIM(an.selected_answer) NOT IN ('', 'null', '\"\"', '[]')) AS answered
           FROM quiz_attempts qa JOIN users u ON u.id = qa.user_id
          WHERE qa.quiz_id = ?
            AND (qa.status = 'in_progress' OR qa.started_at >= COALESCE(?, '1970-01-02'))
          ORDER BY qa.score DESC, qa.started_at ASC`, [quiz.id, quiz.live_started_at],
      );
    } catch (_) {
      // older database without the tab-guard column — degrade gracefully
      return q(
        `SELECT qa.id, qa.user_id, qa.score, qa.accuracy, qa.status, qa.time_taken_seconds, qa.started_at,
                0 AS tab_violations, 0 AS left_flag, 0 AS screenshot_events, 0 AS copy_events, 0 AS paste_events,
                0 AS suspect_questions, 0 AS paste_questions, '[]' AS suspect_list, '[]' AS paste_list,
                0 AS proctor_camera, 0 AS proctor_screen, 0 AS proctor_violations, NULL AS proctor_flags,
                NULL AS proctor_policy,
                NULL AS ai_score, NULL AS ai_signals, NULL AS ai_style_score, NULL AS ai_paste_score,
                NULL AS ai_timing_score, NULL AS ai_verdict, 0 AS ai_trusted,
                0 AS idle_seconds, u.full_name, u.email, u.college, u.avatar,
                (SELECT COUNT(*) FROM quiz_answers an
                  WHERE an.attempt_id = qa.id
                    AND an.selected_answer IS NOT NULL
                    AND TRIM(an.selected_answer) NOT IN ('', 'null', '\"\"', '[]')) AS answered
           FROM quiz_attempts qa JOIN users u ON u.id = qa.user_id
          WHERE qa.quiz_id = ?
            AND (qa.status = 'in_progress' OR qa.started_at >= COALESCE(?, '1970-01-02'))
          ORDER BY qa.score DESC, qa.started_at ASC`, [quiz.id, quiz.live_started_at],
      );
    }
  })();
  // Presence: "left" = student closed/navigated away OR the heartbeat went
  // silent for 45+ seconds — computed on the DB clock (timezone-safe).
  // actual number of questions in this quiz — AI/copy-paste percentages are
  // reported relative to this so hosts can see how many questions involved AI use.
  let totalQuestions = Number(quiz.question_count || 0);
  try {
    const [{ n }] = await q('SELECT COUNT(*) AS n FROM quiz_questions WHERE quiz_id = ?', [quiz.id]);
    if (n > 0) totalQuestions = Number(n);
  } catch (_) { /* fall back to quiz.question_count */ }
  const withPresence = participants.map((p) => {
    let presence = 'active';
    if (p.status !== 'in_progress') presence = 'submitted';
    else if (Number(p.left_flag) === 1 || Number(p.idle_seconds || 0) > 45) presence = 'left';
    /* ------------------------- AI usage estimate -------------------------
       We can't see the student's screen, so we score the behaviour that
       "asking AI" leaves behind: switching away (ChatGPT tab), leaving the
       quiz entirely, and screenshot attempts. Each signal adds weight and the
       total is capped at 100%. Shown to the host on the monitor. */
    const tv = Number(p.tab_violations || 0);
    const se = Number(p.screenshot_events || 0);
    const cp = Number(p.copy_events || 0);
    const pe = Number(p.paste_events || 0);
    /* --------- percentages relative to TOTAL QUESTIONS in this quiz ---------
       We count how many DISTINCT questions the student touched with suspicious
       activity (copy/paste/tab/screenshot while that question was on screen):
       2-question quiz, 1 question via AI → exactly 50%. */
    const qCount = Math.max(1, Number(totalQuestions || quiz.question_count || 1));
    const suspect = Math.min(qCount, Number(p.suspect_questions || 0));
    const pastedQ = Math.min(qCount, Number(p.paste_questions || 0));
    const copyPastePct = Math.min(100, Math.round((pastedQ / qCount) * 100));
    const aiRisk = Math.min(100, Math.round((suspect / qCount) * 100));
    const parseList = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
    return {
      ...p, presence, ai_risk: aiRisk, copy_paste_pct: copyPastePct,
      suspect_list: parseList(p.suspect_list), paste_list: parseList(p.paste_list),
      // Parsed once here so the host monitor can tell which advanced
      // transports THIS attempt actually consented to.
      proctor_policy: proctorSvc.parseProctorPolicy(p.proctor_policy),
    };
  });
  ok(res, {
    quiz: {
      id: quiz.id, title: quiz.title, status: quiz.status, quiz_type: quiz.quiz_type,
      start_at: quiz.start_at, end_at: quiz.end_at, live_started_at: quiz.live_started_at,
      lobby_open: quiz.quiz_type === 'live' && !quiz.live_started_at,
      question_count: quiz.question_count,
      // the authoritative count (quizzes.question_count can drift if questions
      // were added or removed without syncQuizTotals) plus the marks total, so
      // the monitor can render "answered / total" and "score / total"
      total_questions: totalQuestions,
      total_marks: Number(quiz.total_marks) || 0,
      max_participants: quiz.max_participants,
      join_url: `/quizzes/${quiz.id}/live`,
      window_open: !quiz.end_at || new Date(quiz.end_at) > new Date(),
    },
    participants: withPresence,
    participant_count: withPresence.length,
    submitted_count: withPresence.filter((p) => p.status !== 'in_progress').length,
    left_count: withPresence.filter((p) => p.presence === 'left').length,
    server_time: new Date().toISOString(),
  });
});

/** GET /api/quizzes/:id/results — ranking after the quiz */
const results = asyncHandler(async (req, res) => {
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [req.params.id]);
  if (!quiz) throw ApiError.notFound('Quiz not found');
  const canManage = isQuizHost(req.user, quiz);
  const effectiveStatus = effectiveQuizStatus(quiz);
  if (!canManage && !PUBLIC_QUIZ_STATUSES.includes(effectiveStatus)) {
    throw ApiError.notFound('Quiz not found');
  }

  if (!canManage) {
    const ended = effectiveStatus === 'completed'
      || (quiz.end_at && new Date(quiz.end_at).getTime() < Date.now());
    const ownAttempt = req.user
      ? await q1(
        "SELECT id FROM quiz_attempts WHERE quiz_id = ? AND user_id = ? AND status = 'evaluated' LIMIT 1",
        [quiz.id, req.user.id],
      )
      : null;

    if ((Number(quiz.is_private) || Number(quiz.is_premium)) && !ownAttempt) {
      const premiumAllowed = Number(quiz.is_premium) && !Number(quiz.is_private)
        && req.user && await subs.hasPremiumAccess(req.user);
      if (!premiumAllowed) throw ApiError.forbidden('Results for this quiz are available to its participants');
    }
    if (quiz.quiz_type === 'live' && !ended) {
      throw ApiError.forbidden('Live quiz results are released when the session ends');
    }
    if (!Number(quiz.show_answers_after) && !ended && !ownAttempt) {
      throw ApiError.forbidden('Results for this quiz have not been released yet');
    }
  }

  // Public ranking: explicit columns only. `qa.*` used to expose ip_address and
  // the full anti-cheat profile (tab/paste/screenshot/AI signals) of every
  // student to anonymous callers; those stay on the staff-only views.
  const rows = await q(
    `SELECT qa.id, qa.quiz_id, qa.user_id, qa.status, qa.score, qa.total_marks,
            qa.correct_count, qa.wrong_count, qa.unattempted_count, qa.accuracy,
            qa.time_taken_seconds, qa.passed, qa.started_at, qa.submitted_at,
            u.full_name, u.college, u.avatar FROM quiz_attempts qa JOIN users u ON u.id = qa.user_id
      WHERE qa.quiz_id = ? AND qa.status = 'evaluated'
      ORDER BY qa.score DESC, qa.time_taken_seconds ASC`, [quiz.id],
  );
  ok(res, rows.map((r, i) => ({ ...r, rank_position: i + 1 })));
});

/* ------------------------------ questions ------------------------------ */
/* ------------------------- leaderboard -> Excel --------------------------
   Hosts need the final standings outside the browser: attendance registers,
   mark sheets, moderation. `results` already defines the ranking (score desc,
   then fastest), so this reuses exactly that order and simply widens the
   column set with the per-attempt integrity counters the host panel shows.

   Staff-only: it carries student e-mail addresses and anti-cheat numbers. */
const resultsExcel = asyncHandler(async (req, res) => {
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [req.params.id]);
  if (!quiz) throw ApiError.notFound('Quiz not found');
  await assertCanEditQuiz(req, quiz.id);

  // In-progress attempts are included so a sheet pulled mid-session still
  // accounts for everyone in the room; they simply rank last.
  const rows = await q(
    `SELECT qa.*, u.full_name, u.email, u.college,
            (SELECT COUNT(*) FROM quiz_answers an
              WHERE an.attempt_id = qa.id
                AND an.selected_answer IS NOT NULL
                AND TRIM(an.selected_answer) NOT IN ('', 'null', '""', '[]')) AS answered
       FROM quiz_attempts qa JOIN users u ON u.id = qa.user_id
      WHERE qa.quiz_id = ?
      ORDER BY (qa.status = 'in_progress') ASC, qa.score DESC, qa.time_taken_seconds ASC, qa.started_at ASC`,
    [quiz.id],
  );

  let totalQuestions = Number(quiz.question_count || 0);
  try {
    const [{ n }] = await q('SELECT COUNT(*) AS n FROM quiz_questions WHERE quiz_id = ?', [quiz.id]);
    if (n > 0) totalQuestions = Number(n);
  } catch (_) { /* fall back to the denormalised count */ }
  const totalMarks = Number(quiz.total_marks) || 0;

  const stamp = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    // Written as text in the host's local-ish format — a real date serial would
    // need the workbook timezone, and graders only ever read this column.
    return d.toLocaleString('en-GB', { hour12: false }).replace(',', '');
  };
  const duration = (seconds) => {
    const total = Number(seconds || 0);
    if (!total) return '';
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  };
  const dec = (value) => ({ value: Math.round(Number(value || 0) * 10) / 10, format: 'decimal' });

  const columns = [
    { header: 'Rank', width: 7 },
    { header: 'Student', width: 24 },
    { header: 'Email', width: 28 },
    { header: 'College', width: 20 },
    { header: 'Status', width: 13 },
    { header: 'Score', width: 9 },
    { header: 'Out of', width: 9 },
    { header: 'Accuracy %', width: 11 },
    { header: 'Correct', width: 9 },
    { header: 'Wrong', width: 8 },
    { header: 'Unattempted', width: 12 },
    { header: 'Answered', width: 10 },
    { header: 'Questions', width: 10 },
    { header: 'Time taken', width: 12 },
    { header: 'Started', width: 18 },
    { header: 'Submitted', width: 18 },
    { header: 'Tab switches', width: 12 },
    { header: 'Copy', width: 7 },
    { header: 'Paste', width: 7 },
    { header: 'Screenshots', width: 12 },
    { header: 'AI score', width: 9 },
    { header: 'AI verdict', width: 12 },
  ];

  let rank = 0;
  const body = rows.map((r) => {
    const graded = r.status !== 'in_progress';
    if (graded) rank += 1;
    return [
      graded ? rank : '',
      r.full_name || '',
      r.email || '',
      r.college || '',
      r.status === 'in_progress' ? 'in progress' : r.status,
      graded ? Number(r.score || 0) : '',
      totalMarks || '',
      graded ? dec(r.accuracy) : '',
      graded ? Number(r.correct_count || 0) : '',
      graded ? Number(r.wrong_count || 0) : '',
      graded ? Number(r.unattempted_count || 0) : '',
      Number(r.answered || 0),
      totalQuestions || '',
      duration(r.time_taken_seconds),
      stamp(r.started_at),
      stamp(r.submitted_at),
      Number(r.tab_violations || 0),
      Number(r.copy_events || 0),
      Number(r.paste_events || 0),
      Number(r.screenshot_events || 0),
      r.ai_score === null || r.ai_score === undefined ? '' : Number(r.ai_score),
      r.ai_verdict || '',
    ];
  });

  const graded = rows.filter((r) => r.status !== 'in_progress');
  const avg = graded.length
    ? graded.reduce((a, r) => a + Number(r.score || 0), 0) / graded.length
    : 0;
  const summary = {
    name: 'Summary',
    columns: [{ header: 'Field', width: 18 }, { header: 'Value', width: 34 }],
    rows: [
      ['Quiz', quiz.title || ''],
      ['Quiz ID', Number(quiz.id)],
      ['Type', quiz.quiz_type || ''],
      ['Status', quiz.status || ''],
      ['Questions', totalQuestions || ''],
      ['Total marks', totalMarks || ''],
      ['Participants', rows.length],
      ['Submitted', graded.length],
      ['In progress', rows.length - graded.length],
      ['Average score', dec(avg)],
      ['Highest score', graded.length ? Number(graded[0].score || 0) : ''],
      ['Exported at', stamp(new Date())],
      ['Exported by', req.user ? (req.user.full_name || req.user.email || '') : ''],
    ],
  };

  const book = buildXlsx({
    sheets: [{ name: 'Leaderboard', columns, rows: body }, summary],
  });

  const slug = slugify(quiz.title || `quiz-${quiz.id}`) || `quiz-${quiz.id}`;
  const filename = `${slug}-leaderboard-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // The browser fetch reads the name from here, which CORS hides by default.
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('Content-Length', book.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(book);
});

const listQuestions = asyncHandler(async (req, res) => {
  // SECURITY: this endpoint is for the quiz builder (staff) only. Students
  // receive questions exclusively through the attempt payload, which strips
  // correct answers and hidden test data. The previous version returned the
  // full `quiz_questions` rows (correct_answer, explanation, coding
  // test_cases) to anonymous callers for every non-live quiz.
  const isStaff = req.user && ['owner', 'admin', 'developer'].includes(req.user.role);
  if (!isStaff) throw ApiError.forbidden('Questions are available inside an attempt, not as a standalone list.');
  await assertCanEditQuiz(req, req.params.id);
  const rows = await q('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id', [req.params.id]);
  ok(res, rows);
});

const QUESTION_TYPES = ['mcq', 'multiple', 'true_false', 'short_answer', 'coding'];

const createQuestion = asyncHandler(async (req, res) => {
  await assertCanEditQuiz(req, req.params.id);
  const b = req.body || {};
  if (!String(b.question_text || '').trim()) throw ApiError.badRequest('question_text is required');
  const type = b.type || 'mcq';
  if (!QUESTION_TYPES.includes(type)) throw ApiError.badRequest('Invalid question type');
  const difficulty = b.difficulty || 'easy';
  if (!QUIZ_DIFFICULTIES.includes(difficulty)) throw ApiError.badRequest('Invalid question difficulty');
  const questionImage = safeExternalUrl(b.question_image, { label: 'question_image', allowRelative: true });
  const [{ pos }] = await q('SELECT COALESCE(MAX(position),0)+1 AS pos FROM quiz_questions WHERE quiz_id = ?', [req.params.id]);
  const isCoding = type === 'coding';
  const result = await exec(
    `INSERT INTO quiz_questions (quiz_id, type, question_text, question_image, code_snippet, options,
        correct_answer, marks, negative_marks, difficulty, explanation, position,
        coding_languages, starter_code, test_cases, time_limit_ms, memory_limit_kb, time_limit_seconds)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.params.id, type, b.question_text, questionImage, b.code_snippet || null,
      JSON.stringify(Array.isArray(b.options) ? b.options : []), JSON.stringify(b.correct_answer ?? null),
      Math.round(boundedQuizNumber(b.marks, 1, 0, 100000)),
      boundedQuizNumber(b.negative_marks, 0, 0, 100), difficulty, b.explanation || null,
      Math.round(boundedQuizNumber(b.position, pos, 1, 100000)),
      isCoding ? JSON.stringify(Array.isArray(b.coding_languages) && b.coding_languages.length ? b.coding_languages : DEFAULT_LANGUAGES) : null,
      isCoding ? JSON.stringify(b.starter_code && typeof b.starter_code === 'object' ? b.starter_code : {}) : null,
      isCoding ? JSON.stringify(Array.isArray(b.test_cases) ? b.test_cases : []) : null,
      isCoding ? Math.round(boundedQuizNumber(b.time_limit_ms, 2000, 100, 60000)) : 2000,
      isCoding ? Math.round(boundedQuizNumber(b.memory_limit_kb, 262144, 16384, 4194304)) : 262144,
      b.time_limit_seconds ? Math.round(boundedQuizNumber(b.time_limit_seconds, 0, 0, 86400)) : null],
  );
  await syncQuizTotals(req.params.id);
  created(res, await q1('SELECT * FROM quiz_questions WHERE id = ?', [result.insertId]));
});

const updateQuestion = asyncHandler(async (req, res) => {
  const existing = await q1('SELECT quiz_id FROM quiz_questions WHERE id = ?', [req.params.id]);
  if (!existing) throw ApiError.notFound('Question not found');
  await assertCanEditQuiz(req, existing.quiz_id);
  const allowed = ['type', 'question_text', 'question_image', 'code_snippet', 'options', 'correct_answer',
    'marks', 'negative_marks', 'difficulty', 'explanation', 'position',
    'coding_languages', 'starter_code', 'test_cases', 'time_limit_ms', 'memory_limit_kb', 'time_limit_seconds'];
  const JSON_COLUMNS = ['options', 'correct_answer', 'coding_languages', 'starter_code', 'test_cases'];
  const data = {};
  allowed.forEach((k) => {
    if (req.body[k] === undefined) return;
    data[k] = JSON_COLUMNS.includes(k) ? JSON.stringify(req.body[k]) : req.body[k];
  });
  if (data.type !== undefined && !QUESTION_TYPES.includes(data.type)) throw ApiError.badRequest('Invalid question type');
  if (data.difficulty !== undefined && !QUIZ_DIFFICULTIES.includes(data.difficulty)) throw ApiError.badRequest('Invalid question difficulty');
  if (data.question_image !== undefined) {
    data.question_image = safeExternalUrl(data.question_image, { label: 'question_image', allowRelative: true });
  }
  if (data.marks !== undefined) data.marks = Math.round(boundedQuizNumber(data.marks, 1, 0, 100000));
  if (data.negative_marks !== undefined) data.negative_marks = boundedQuizNumber(data.negative_marks, 0, 0, 100);
  if (data.position !== undefined) data.position = Math.round(boundedQuizNumber(data.position, 1, 1, 100000));
  if (data.time_limit_ms !== undefined) data.time_limit_ms = Math.round(boundedQuizNumber(data.time_limit_ms, 2000, 100, 60000));
  if (data.memory_limit_kb !== undefined) data.memory_limit_kb = Math.round(boundedQuizNumber(data.memory_limit_kb, 262144, 16384, 4194304));
  if (data.time_limit_seconds !== undefined && data.time_limit_seconds !== null) {
    data.time_limit_seconds = Math.round(boundedQuizNumber(data.time_limit_seconds, 0, 0, 86400));
  }
  const keys = Object.keys(data);
  if (!keys.length) throw ApiError.badRequest('Nothing to update');
  await exec(`UPDATE quiz_questions SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), req.params.id]);
  const row = await q1('SELECT quiz_id FROM quiz_questions WHERE id = ?', [req.params.id]);
  if (row) await syncQuizTotals(row.quiz_id);
  ok(res, await q1('SELECT * FROM quiz_questions WHERE id = ?', [req.params.id]));
});

const removeQuestion = asyncHandler(async (req, res) => {
  const row = await q1('SELECT quiz_id FROM quiz_questions WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Question not found');
  await assertCanEditQuiz(req, row.quiz_id);
  await exec('DELETE FROM quiz_questions WHERE id = ?', [req.params.id]);
  if (row) await syncQuizTotals(row.quiz_id);
  ok(res, { deleted: true });
});

const reorderQuestions = asyncHandler(async (req, res) => {
  const items = req.body.items;
  if (!Array.isArray(items) || items.length > 1000) {
    throw ApiError.badRequest('items[] is required (maximum 1000)');
  }
  const normalized = items.map((item) => ({
    id: Number(item && item.id),
    position: Number(item && item.position),
  }));
  if (normalized.some((item) => !Number.isInteger(item.id) || item.id <= 0
      || !Number.isFinite(item.position) || item.position < 1 || item.position > 100000)) {
    throw ApiError.badRequest('Every reorder item needs a valid question id and positive position');
  }
  if (new Set(normalized.map((item) => item.id)).size !== normalized.length) {
    throw ApiError.badRequest('A question cannot appear twice in one reorder request');
  }
  if (!normalized.length) return ok(res, { reordered: 0 });

  await tx(async (conn) => {
    const placeholders = normalized.map(() => '?').join(',');
    const [questions] = await conn.execute(
      `SELECT id, quiz_id FROM quiz_questions WHERE id IN (${placeholders}) FOR UPDATE`,
      normalized.map((item) => item.id),
    );
    if (questions.length !== normalized.length) throw ApiError.badRequest('One or more questions do not exist');
    const quizIds = [...new Set(questions.map((question) => Number(question.quiz_id)))];
    if (quizIds.length !== 1) throw ApiError.badRequest('Questions from different quizzes cannot be reordered together');
    const [[quiz]] = await conn.query('SELECT * FROM quizzes WHERE id = ?', [quizIds[0]]);
    if (!isQuizManager(req.user, quiz)) {
      throw ApiError.forbidden('A developer may reorder questions only in quizzes they created.');
    }
    for (const item of normalized) {
      await conn.execute(
        'UPDATE quiz_questions SET position = ? WHERE id = ?',
        [Math.round(item.position), item.id],
      );
    }
  });
  ok(res, { reordered: normalized.length });
});

async function syncQuizTotals(quizId) {
  const row = await q1('SELECT COUNT(*) AS c, COALESCE(SUM(marks),0) AS m FROM quiz_questions WHERE quiz_id = ?', [quizId]);
  await exec('UPDATE quizzes SET question_count = ?, total_marks = ? WHERE id = ?', [row.c, row.m, quizId]);
}

/* ------------------------------ attempts ------------------------------ */
const unlock = asyncHandler(async (req, res) => {
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [req.params.id]);
  if (!quiz) throw ApiError.notFound('Quiz not found');
  if (!Number(quiz.is_private)) return ok(res, { token: null, required: false });
  if (!quiz.access_password) throw ApiError.badRequest('This private quiz does not have an access password yet');
  const provided = String((req.body && req.body.password) || '');
  const good = Buffer.byteLength(provided, 'utf8') <= 72 && await bcrypt.compare(provided, quiz.access_password);
  if (!good) throw ApiError.forbidden('Incorrect quiz password');
  // Bind the unlock to the *current* password hash. Rotating/removing the
  // password therefore revokes every previously issued unlock immediately,
  // instead of leaving it valid for the rest of its 8-hour lifetime.
  const token = signQuizUnlock({ userId: req.user.id, quizId: quiz.id, accessPasswordHash: quiz.access_password });
  ok(res, { token, required: true });
});

const orderSeedValue = (value) => {
  if (!value) return 'session';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return String(value);
};

/**
 * Resolve a stable individualized order for one attempt. Live-session seats are
 * ranked by attempt id inside the current lobby/session. A randomized
 * Latin-square assignment ensures that for the first N seats (where N
 * is the number of questions), no two students see the same question at the
 * same displayed Q number. The order remains unchanged on refresh and review.
 */
async function questionAssignment(questions, attempt, quiz) {
  const live = quiz.quiz_type === 'live';
  const shuffle = live || Number(quiz.shuffle_questions) === 1;
  let seatNumber = 1;
  if (live && questions.length) {
    const sessionStart = quiz.start_at || quiz.live_started_at || attempt.started_at;
    const row = await q1(
      `SELECT COUNT(*) AS c FROM quiz_attempts
        WHERE quiz_id = ? AND id <= ? AND started_at >= COALESCE(?, '1970-01-02')`,
      [quiz.id, attempt.id, sessionStart],
    );
    seatNumber = Math.max(1, Number(row && row.c) || 1);
  }
  return buildQuestionOrder(questions, {
    shuffle,
    live,
    seatNumber,
    quizId: quiz.id,
    attemptId: attempt.id,
    userId: attempt.user_id,
    // start_at is stamped when the lobby opens and does not change when the
    // synchronized start button is pressed, so pre-start and post-start payloads
    // produce exactly the same paper.
    sessionSeed: orderSeedValue(quiz.start_at || quiz.live_started_at || attempt.started_at),
  });
}

const startAttempt = asyncHandler(async (req, res) => {
  // The controller is reachable by any signed-in account so that admins/developers get a
  // readable explanation instead of a generic "requires one of: student".
  if (req.user.role !== 'student') {
    throw ApiError.forbidden('Only student accounts can attempt a quiz — log in with a student account (or use the Live Hosting screen) to test this quiz');
  }
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [req.params.id]);
  if (!quiz) throw ApiError.notFound('Quiz not found');
  if (Number(quiz.is_private)) {
    const unlocked = verifyQuizUnlock(req.headers['x-quiz-unlock'], {
      userId: req.user.id, quizId: quiz.id, accessPasswordHash: quiz.access_password,
    });
    if (!unlocked) throw ApiError.forbidden('🔒 This quiz is private — the password provided by the administrator is required to join');
  }
  if (Number(quiz.is_premium) && !(await subs.getActiveSubscription(req.user.id))) throw subs.premiumError('quiz');
  const effectiveStatus = effectiveQuizStatus(quiz);
  if (quiz.status === 'scheduled' && effectiveStatus === 'published') {
    await exec(
      "UPDATE quizzes SET status = 'published' WHERE id = ? AND status = 'scheduled'",
      [quiz.id],
    );
    quiz.status = 'published';
  } else if (quiz.status === 'scheduled' && effectiveStatus === 'completed') {
    await exec(
      "UPDATE quizzes SET status = 'completed' WHERE id = ? AND status = 'scheduled'",
      [quiz.id],
    );
    quiz.status = 'completed';
  }
  if (!['published', 'live'].includes(quiz.status)) throw ApiError.forbidden('This quiz is not open right now');
  // Scheduled-gate: for published (non-live) quizzes enforce the scheduled start_at.
  // For LIVE quizzes we MUST trust the `status` column alone — the host pressed Start,
  // which is the single source of truth. start_at/live_started_at are NOT checked
  // here because MySQL session time zones (common on XAMPP/Windows setups where
  // SET time_zone='+00:00' silently fails) can cause NOW() to be stored in local
  // wall-clock while Node's Date.now() is in UTC, making a just-started quiz look
  // 5h 30m in the future. The end_at/window check below likewise only uses the
  // time_limit_minutes relative to live_started_at when available.
  if (quiz.status !== 'live' && quiz.start_at && new Date(quiz.start_at).getTime() > Date.now()) {
    throw ApiError.forbidden('This quiz has not started yet');
  }
  // For live quizzes, never block the student with a "not started yet" message —
  // if status flipped to 'live' the session IS open. A closed-window check still
  // applies, but it is computed from live_started_at + time_limit_minutes (which
  // are written by the same NOW() call in the same transaction, so they are in
  // the same time base even when MySQL and Node disagree about UTC).
  if (quiz.status === 'live' && quiz.end_at) {
    let effectiveEnd = new Date(quiz.end_at).getTime();
    if (quiz.live_started_at) {
      const limitMs = Math.max(1, Number(quiz.time_limit_minutes || 10)) * 60000;
      const startedAt = new Date(quiz.live_started_at).getTime();
      // Same-timebase window: end_at written as live_started_at + N minutes, so
      // compare in the DB's own clock by looking at (end_at - live_started_at) vs
      // (Date.now() - live_started_at_in_node_terms). When timezone/offset is
      // wrong, startedAt is shifted the same way endAt is shifted, so this
      // delta-based check always wins.
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < limitMs + 60 * 1000) {
        // within the window (plus a 1-minute grace for late joiners)
        effectiveEnd = Date.now() + 1; // force "not closed"
      }
    }
    if (effectiveEnd < Date.now()) {
      throw ApiError.forbidden('The live window for this quiz has closed — ask your instructor to restart it');
    }
  } else if (quiz.end_at && new Date(quiz.end_at).getTime() < Date.now()) {
    throw ApiError.forbidden('This quiz has already ended');
  }

  const startOutcome = await tx(async (conn) => {
    // Lock the quiz row for the whole join decision. Capacity was formerly
    // COUNT-then-INSERT under no lock, so a burst at the seat limit could
    // admit every simultaneous request. The lock also serializes joins with
    // a host ending the session.
    const [[lockedQuiz]] = await conn.query(
      'SELECT id, status, quiz_type, start_at, live_started_at, max_participants, allow_reattempt, total_marks FROM quizzes WHERE id = ? FOR UPDATE',
      [quiz.id],
    );
    if (!lockedQuiz || !['published', 'live'].includes(lockedQuiz.status)) return { kind: 'closed' };

    const [[existing]] = await conn.query(
      "SELECT * FROM quiz_attempts WHERE quiz_id = ? AND user_id = ? AND status = 'in_progress'",
      [lockedQuiz.id, req.user.id],
    );
    if (existing) return { kind: 'existing', attempt: existing };

    const [[finished]] = await conn.query(
      `SELECT id FROM quiz_attempts
        WHERE quiz_id = ? AND user_id = ? AND status IN ('submitted','evaluated')
        ORDER BY id DESC LIMIT 1`,
      [lockedQuiz.id, req.user.id],
    );
    const sessionStart = lockedQuiz.status === 'live'
      ? (lockedQuiz.live_started_at || lockedQuiz.start_at || null) : null;
    let freshLiveSession = false;
    if (lockedQuiz.status === 'live' && finished) {
      const [[row]] = await conn.query(
        'SELECT COUNT(*) AS c FROM quiz_attempts WHERE quiz_id = ? AND user_id = ? AND started_at >= COALESCE(?, ?)',
        [lockedQuiz.id, req.user.id, sessionStart, '1970-01-02'],
      );
      freshLiveSession = Number(row.c) === 0;
    }
    if (finished && !lockedQuiz.allow_reattempt && !freshLiveSession) {
      return { kind: 'already_finished', live: lockedQuiz.status === 'live' };
    }

    if (lockedQuiz.max_participants) {
      const [[row]] = await conn.query(
        `SELECT COUNT(*) AS c FROM quiz_attempts
          WHERE quiz_id = ? AND status = 'in_progress'
            AND started_at >= COALESCE(?, '1970-01-02')`,
        [lockedQuiz.id, sessionStart],
      );
      if (Number(row.c) >= Number(lockedQuiz.max_participants)) {
        return { kind: 'full', count: Number(row.c), max: Number(lockedQuiz.max_participants) };
      }
    }

    const [result] = await conn.execute(
      'INSERT INTO quiz_attempts (quiz_id, user_id, status, total_marks, ip_address) VALUES (?,?,?,?,?)',
      [lockedQuiz.id, req.user.id, 'in_progress', lockedQuiz.total_marks, req.ip],
    );
    if (lockedQuiz.status === 'live' && lockedQuiz.live_started_at) {
      await conn.execute(
        'UPDATE quiz_attempts SET started_at = ? WHERE id = ?',
        [lockedQuiz.live_started_at, result.insertId],
      );
    }
    return { kind: 'created', attemptId: result.insertId };
  });

  if (startOutcome.kind === 'closed') throw ApiError.forbidden('This quiz is not open right now');
  if (startOutcome.kind === 'already_finished') {
    throw ApiError.conflict(startOutcome.live
      ? 'You have already finished this live session — you will be able to join when the host starts it again'
      : 'You have already attempted this quiz');
  }
  if (startOutcome.kind === 'full') {
    throw ApiError.forbidden(`This live session is full (${startOutcome.count}/${startOutcome.max}) — a seat frees up as soon as someone submits`);
  }
  if (startOutcome.kind === 'existing') return ok(res, await attemptPayload(startOutcome.attempt, quiz));

  const fresh = await q1('SELECT * FROM quiz_attempts WHERE id = ?', [startOutcome.attemptId]);
  created(res, await attemptPayload(fresh, quiz));
});

/**
 * The payload the runner needs: attempt, quiz timing, questions (coding config included,
 * hidden test data stripped) and the answers saved so far.
 */
async function attemptPayload(attempt, quiz) {
  // Taking a lobby seat returns this payload too — it must carry NO paper
  // until the host starts the session for everyone.
  const lobby = isLiveLobby(quiz);
  // Freeze the proctoring rules for this attempt once the paper is really
  // open (never for a lobby seat — the host may still change switches
  // before the synchronized start, and the student has consented to
  // nothing yet).
  const proctorPolicy = !lobby && attempt.status === 'in_progress'
    ? await captureAttemptProctorPolicy(attempt, quiz)
    : proctorSvc.parseProctorPolicy(attempt.proctor_policy);
  const questions = await q(
    `SELECT id, type, question_text, question_image, code_snippet, options, marks, negative_marks, difficulty, position,
            coding_languages, starter_code, test_cases, time_limit_ms, memory_limit_kb
       FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id`,
    [quiz.id],
  );
  const assignment = await questionAssignment(questions, attempt, quiz);
  // Coding questions travel with their compiler configuration, but hidden test cases
  // are reduced to "{ index, hidden: true }" — inputs and expected output never leave the server.
  const safeQuestions = assignment.questions.map((row) => (row.type === 'coding' ? { ...row, ...codingConfig(row) } : row));
  const answers = await q('SELECT question_id, selected_answer, language, verified, tests_passed, tests_total FROM quiz_answers WHERE attempt_id = ?', [attempt.id]);
  // Students are told to "wait for the host" — name them. Whoever started this
  // live run wins; otherwise the quiz creator.
  const host = await q1('SELECT full_name FROM users WHERE id = ? LIMIT 1', [quiz.live_host_id || quiz.created_by]);
  // Anti-cheat resolves per quiz CREATOR, not globally: each developer's
  // own switches govern their quizzes (admin globals are only the fallback).
  const effectiveAntiCheat = await antiCheat.resolveForUser(quiz.created_by);
  return {
    attempt,
    question_assignment: {
      individualized: assignment.individualized,
      seat_number: assignment.seat_number,
      unique_positions_for_first: assignment.unique_positions_for_first,
    },
    // quiz_type / status / live_started_at are REQUIRED by the runner — without
    // them the anti-cheat system (tab guard, fullscreen lockdown, copy-paste
    // blocking, refresh blocking) silently stays OFF for students who join
    // through this payload (e.g. late joiners). Never strip them again.
    quiz: {
      id: quiz.id, title: quiz.title, time_limit_minutes: quiz.time_limit_minutes,
      negative_marking: quiz.negative_marking, end_at: quiz.end_at,
      quiz_type: quiz.quiz_type, status: quiz.status, live_started_at: quiz.live_started_at,
      host_name: host ? host.full_name : null,
    },
    questions: lobby ? [] : safeQuestions,
    lobby,
    anticheat: effectiveAntiCheat,
    proctor_policy: proctorPolicy,
    answers,
  };
}

const saveAnswer = asyncHandler(async (req, res) => {
  const attempt = await q1('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (attempt.status !== 'in_progress') throw ApiError.badRequest('This attempt is already submitted');
  await assertAttemptOpen(attempt);
  const { question_id, selected_answer, time_spent_seconds, language } = req.body;
  if (!question_id) throw ApiError.badRequest('question_id is required');
  const question = await q1('SELECT id FROM quiz_questions WHERE id = ? AND quiz_id = ?', [question_id, attempt.quiz_id]);
  if (!question) throw ApiError.badRequest('That question does not belong to this quiz');

  const payload = JSON.stringify(selected_answer ?? null);
  const prev = await q1('SELECT selected_answer, language, verified FROM quiz_answers WHERE attempt_id = ? AND question_id = ?', [attempt.id, question_id]);
  const unchanged = prev
    && String(prev.selected_answer ?? 'null') === payload
    && (language === undefined || language === prev.language);

  if (unchanged) {
    // typing the same answer again must not throw away a completed test run
    await exec('UPDATE quiz_answers SET time_spent_seconds = ? WHERE attempt_id = ? AND question_id = ?', [time_spent_seconds || 0, attempt.id, question_id]);
    return ok(res, { saved: true, verified: Number(prev.verified) === 1 });
  }

  const lang = language !== undefined ? language : (prev ? prev.language : null);
  if (prev) {
    // the code (or language) changed → the previous full test-case run no longer applies
    await exec(
      `UPDATE quiz_answers SET selected_answer = ?, language = ?, time_spent_seconds = ?,
         verified = 0, tests_passed = NULL, tests_total = NULL WHERE attempt_id = ? AND question_id = ?`,
      [payload, lang, time_spent_seconds || 0, attempt.id, question_id],
    );
  } else {
    await exec(
      'INSERT INTO quiz_answers (attempt_id, question_id, selected_answer, language, time_spent_seconds) VALUES (?,?,?,?,?)',
      [attempt.id, question_id, payload, lang, time_spent_seconds || 0],
    );
  }
  ok(res, { saved: true, verified: false });
});

/**
 * POST /api/quiz-attempts/:id/run-code — run the in-quiz compiler.
 *
 * Every test case of the question is executed (hidden ones included) in the sandbox,
 * so the student knows how many cases pass before submitting. Hidden cases only ever
 * report pass/fail + time + memory — never their input, expected output or stdout.
 * A completed run is remembered on the answer row, which is what unlocks submit.
 */
const runAttemptCode = asyncHandler(async (req, res) => {
  const attempt = await q1('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (attempt.status !== 'in_progress') throw ApiError.badRequest('This attempt is already submitted');
  await assertAttemptOpen(attempt);

  const { question_id, language, source_code } = req.body;
  if (!question_id || !language || !source_code) throw ApiError.badRequest('question_id, language and source_code are required');
  if (String(source_code).length > 100000) throw ApiError.badRequest('Source code is too large (max 100 KB)');

  const question = await q1('SELECT * FROM quiz_questions WHERE id = ? AND quiz_id = ?', [question_id, attempt.quiz_id]);
  if (!question) throw ApiError.badRequest('That question does not belong to this quiz');
  if (question.type !== 'coding') throw ApiError.badRequest('This question is not a coding question');

  const languages = parseLanguages(question.coding_languages);
  if (!languages.includes(language)) throw ApiError.badRequest(`Language "${language}" is not allowed here. Allowed: ${languages.join(', ')}`);

  const cases = parseTestCases(question.test_cases);
  if (!cases.length) throw ApiError.badRequest('This coding question has no test cases yet — please tell your instructor');

  const verdict = await judgeCodingAnswer({
    language,
    sourceCode: source_code,
    cases,
    timeLimitMs: question.time_limit_ms,
    memoryLimitKb: question.memory_limit_kb,
  });

  await exec(
    `INSERT INTO quiz_answers (attempt_id, question_id, selected_answer, language, verified, tests_passed, tests_total)
     VALUES (?,?,?,?,1,?,?)
     ON DUPLICATE KEY UPDATE selected_answer = VALUES(selected_answer), language = VALUES(language),
       verified = 1, tests_passed = VALUES(tests_passed), tests_total = VALUES(tests_total)`,
    [attempt.id, question.id, JSON.stringify(String(source_code)), language, verdict.passed, verdict.total],
  );

  ok(res, {
    question_id: question.id,
    language,
    passed: verdict.passed,
    total: verdict.total,
    all_passed: verdict.allPassed,
    verdict: verdict.verdict,
    verdict_label: verdict.verdict_label,
    compile_output: verdict.compile_output,
    time_sec: verdict.time,       // the judge reports seconds
    memory_mb: verdict.memory,    // …and megabytes
    test_cases_run: verdict.total,
    results: verdict.results,
  });
});

/** Grade one attempt from the stored answers + question keys. */
async function evaluateAttempt(attemptId) {
  return tx(async (conn) => {
    const [[attempt]] = await conn.query('SELECT * FROM quiz_attempts WHERE id = ? FOR UPDATE', [attemptId]);
    if (!attempt) throw ApiError.notFound('Attempt not found');
    if (attempt.status === 'evaluated') {
      return {
        score: Number(attempt.score || 0), total: Number(attempt.total_marks || 0),
        correct: Number(attempt.correct_count || 0), wrong: Number(attempt.wrong_count || 0),
        unattempted: Number(attempt.unattempted_count || 0), accuracy: Number(attempt.accuracy || 0),
        seconds: Number(attempt.time_taken_seconds || 0), passed: !!attempt.passed,
        rank: Number(attempt.rank_position || 0), already_evaluated: true,
      };
    }
    if (attempt.status !== 'in_progress' && attempt.status !== 'submitted') {
      throw ApiError.badRequest('This attempt can no longer be evaluated');
    }
    const [questions] = await conn.query('SELECT * FROM quiz_questions WHERE quiz_id = ?', [attempt.quiz_id]);
    const [answers] = await conn.query('SELECT * FROM quiz_answers WHERE attempt_id = ?', [attemptId]);
    const answerMap = answers.reduce((a, x) => { a[x.question_id] = x; return a; }, {});

    /* ---- AI detection: style + paste + timing, fused (see services/aiDetection.service.js) ----
       Prose answers and code answers are analysed SEPARATELY — the old code
       concatenated them into one blob and ran a prose classifier over the
       result, which made both unreadable. */
    let aiScore = null, aiSignals = null, aiStyle = null, aiPaste = null,
      aiTiming = null, aiVerdict = null, aiTrusted = 0;
    try {
      if (await antiCheat.resolveBoolForUser(await antiCheat.quizCreatorId(attempt.quiz_id), 'ai_classifier_quiz_enabled', true)) {
        const parts = [];
        for (const question of questions) {
          const ans = answerMap[question.id];
          if (!ans || ans.selected_answer == null) continue;
          if (question.type !== 'short_answer' && question.type !== 'coding') continue;
          const raw = fromJson(ans.selected_answer);
          const text = typeof raw === 'string' ? raw : '';
          if (text.trim()) {
            parts.push({
              text,
              kind: question.type === 'coding' ? 'code' : 'prose',
              // subtract the skeleton we gave them, so the platform's own
              // boilerplate is never counted against the student
              starter: question.type === 'coding' ? question.starter_code : undefined,
            });
          }
        }
        const tele = aiDetect.readTelemetry({
          typed_chars: attempt.typed_chars,
          pasted_chars: attempt.pasted_chars,
          paste_events: attempt.paste_events,
          blocked_pastes: attempt.blocked_pastes,
          keystrokes: attempt.keystrokes,
          typing_ms: attempt.typing_ms,
          fast_intervals: attempt.fast_intervals,
          uniform_ratio: attempt.uniform_ratio,
        });
        // An MCQ-only paper has nothing to analyse — say so instead of
        // reporting a confident "0 = human".
        if (!parts.length && !tele.reported) {
          aiScore = null; aiVerdict = 'n/a'; aiSignals = 'no_written_answers';
        } else {
          const r = aiDetect.analyse(parts, tele);
          aiScore = r.score; aiSignals = r.signals; aiStyle = r.style;
          aiPaste = r.paste; aiTiming = r.timing; aiVerdict = r.verdict;
          aiTrusted = r.trusted ? 1 : 0;
        }
      }
    } catch (err) {
      // Grading must never be blocked by the classifier, but a silent catch
      // made a dead feature look identical to "no written answers".
      console.error('[ai-detect] attempt', attemptId, 'analysis failed:', err.message);
      aiVerdict = 'error';
      aiSignals = 'classifier_error';
    }

    let score = 0, correct = 0, wrong = 0, unattempted = 0;
    for (const question of questions) {
      const ans = answerMap[question.id];
      const key = fromJson(question.correct_answer);
      let isCorrect = 0, awarded = 0;
      if (!ans || ans.selected_answer == null || ans.selected_answer === 'null') {
        unattempted += 1;
      } else if (question.type === 'coding') {
        // Coding = judged by the sandboxed run the student performed, never inside this process.
        const cases = parseTestCases(question.test_cases);
        const raw = fromJson(ans.selected_answer);
        const code = typeof raw === 'string' ? raw : '';
        if (!code.trim()) {
          unattempted += 1;
        } else if (!cases.length) {
          // No test cases configured → the instructor grades it by hand (legacy behaviour).
          isCorrect = 1; awarded = Number(question.marks); correct += 1;
        } else {
          const ranEveryCase = Number(ans.verified) === 1 && Number(ans.tests_total) === cases.length;
          isCorrect = ranEveryCase && Number(ans.tests_passed) === cases.length ? 1 : 0;
          awarded = isCorrect ? Number(question.marks) : 0;
          if (isCorrect) correct += 1; else wrong += 1;
        }
      } else {
        const selected = fromJson(ans.selected_answer);
        if (question.type === 'short_answer') {
          const accepted = Array.isArray(key) ? key : [key];
          isCorrect = accepted.some((k) => normaliseText(k) === normaliseText(selected)) ? 1 : 0;
        } else if (question.type === 'multiple') {
          isCorrect = arraysEqual(key, selected) ? 1 : 0;
        } else {
          isCorrect = normaliseText(Array.isArray(key) ? key[0] : key) === normaliseText(Array.isArray(selected) ? selected[0] : selected) ? 1 : 0;
        }
        awarded = isCorrect ? Number(question.marks) : -Number(question.negative_marks || 0);
        if (isCorrect) correct += 1; else wrong += 1;
      }
      score += awarded;
      await conn.query('UPDATE quiz_answers SET is_correct = ?, marks_awarded = ? WHERE attempt_id = ? AND question_id = ?', [isCorrect, awarded, attemptId, question.id]);
    }
    const attempted = correct + wrong;
    const accuracy = attempted ? Math.round((correct / attempted) * 10000) / 100 : 0;
    const [[{ total }]] = await conn.query('SELECT COALESCE(SUM(marks),0) AS total FROM quiz_questions WHERE quiz_id = ?', [attempt.quiz_id]);
    const [[quiz]] = await conn.query('SELECT passing_score, negative_marking FROM quizzes WHERE id = ?', [attempt.quiz_id]);
    const seconds = Math.max(1, Math.floor((Date.now() - new Date(attempt.started_at).getTime()) / 1000));
    const passed = total > 0 ? (score / total) * 100 >= (quiz.passing_score || 0) : false;

    await conn.query(
      `UPDATE quiz_attempts SET status='evaluated', score=?, total_marks=?, correct_count=?, wrong_count=?,
         unattempted_count=?, accuracy=?, time_taken_seconds=?, passed=?, ai_score=?, ai_signals=?,
         ai_style_score=?, ai_paste_score=?, ai_timing_score=?, ai_verdict=?, ai_trusted=?,
         submitted_at=NOW() WHERE id=?`,
      [score, total, correct, wrong, unattempted, accuracy, seconds, passed ? 1 : 0, aiScore, aiSignals,
        aiStyle, aiPaste, aiTiming, aiVerdict, aiTrusted, attemptId],
    );
    // Ranking: one CASE-based UPDATE instead of one round-trip per attempt.
    // (The shared assignRanks helper documents the same pattern; the UPDATEs
    // here must run inside THIS transaction, so it is done inline.)
    const [rows] = await conn.query(
      "SELECT id FROM quiz_attempts WHERE quiz_id = ? AND status='evaluated' ORDER BY score DESC, time_taken_seconds ASC",
      [attempt.quiz_id],
    );
    if (rows.length) {
      const ids = rows.map((r) => Number(r.id));
      const placeholders = ids.map(() => '?').join(',');
      const cases = ids.map((id, i) => `WHEN ${id} THEN ${i + 1}`).join(' ');
      await conn.query(
        `UPDATE quiz_attempts SET rank_position = CASE id ${cases} END WHERE id IN (${placeholders})`,
        ids,
      );
    }
    return { score, total, correct, wrong, unattempted, accuracy, seconds, passed, rank: rows.findIndex((r) => Number(r.id) === Number(attemptId)) + 1 };
  });
}

const submitAttempt = asyncHandler(async (req, res) => {
  const attempt = await q1('SELECT * FROM quiz_attempts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (attempt.status !== 'in_progress') return ok(res, { already_submitted: true });
  // Answers bundled with a late submit must not count: only what was saved
  // before the deadline is graded. (saveAnswer enforces the same cutoff.)
  const __quizEarly = await q1(
    'SELECT quiz_type, status, time_limit_minutes, live_started_at, end_at FROM quizzes WHERE id = ?',
    [attempt.quiz_id],
  );
  // A lobby seat must never be submittable: grading it would finish the
  // student's paper before the host's synchronized start. (Host-end
  // auto-submits use evaluateAttempt directly and are unaffected.)
  if (isLiveLobby(__quizEarly)) throw ApiError.forbidden(LIVE_LOBBY_MSG);
  const __deadlineEarly = attemptDeadlineMs(attempt, __quizEarly);
  const lateSubmit = !!(__deadlineEarly && Date.now() > __deadlineEarly + ATTEMPT_GRACE_MS);
  if (!lateSubmit && Array.isArray(req.body.answers)) {
    // Only questions that actually belong to this quiz may receive answers —
    // the same check saveAnswer enforces per request; a bulk submit must not
    // skip it just because it is bulk.
    const ownQuestionIds = new Set((await q('SELECT id FROM quiz_questions WHERE quiz_id = ?', [attempt.quiz_id]))
      .map((row) => Number(row.id)));
    for (const a of req.body.answers) {
      const questionId = Number(a.question_id);
      if (!ownQuestionIds.has(questionId)) continue;
      // IMPORTANT: when the bundled answer REPLACES a stored one, the previous
      // judge run no longer describes the new code — verified/tests_passed/tests_total
      // are reset exactly like saveAnswer does. Without this, a student could run
      // correct code once and then submit different, never-executed code while the
      // stale verified=1 still awarded full marks.
      await exec(
        `INSERT INTO quiz_answers (attempt_id, question_id, selected_answer, time_spent_seconds)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE
           verified = IF(selected_answer <=> VALUES(selected_answer), verified, 0),
           tests_passed = IF(selected_answer <=> VALUES(selected_answer), tests_passed, NULL),
           tests_total = IF(selected_answer <=> VALUES(selected_answer), tests_total, NULL),
           selected_answer = VALUES(selected_answer),
           time_spent_seconds = VALUES(time_spent_seconds)`,
        [attempt.id, questionId, JSON.stringify(a.selected_answer ?? null), a.time_spent_seconds || 0],
      );
    }
  }
  /* Typing telemetry from the runner. Always persisted — writing it only
     when non-zero made genuine clean work indistinguishable from a client
     that never reported at all. */
  const tele = aiDetect.readTelemetry(req.body);
  const pct = Math.min(100, Math.round((tele.pasted / Math.max(1, tele.pasted + tele.typed)) * 100));
  await exec(
    `UPDATE quiz_attempts SET paste_pct = ?, typed_chars = ?, pasted_chars = ?, blocked_pastes = ?,
       keystrokes = ?, typing_ms = ?, fast_intervals = ?, uniform_ratio = ? WHERE id = ?`,
    [pct, tele.typed, tele.pasted, tele.blocked, tele.keystrokes, tele.typingMs,
      tele.fast, Number(tele.uniform.toFixed(3)), attempt.id],
  );
  // Gate: a coding answer that was never run against every test case cannot be submitted.
  const codingAnswers = await q(
    `SELECT qq.id, qq.position, qq.type, qq.test_cases, qq.starter_code, qa.selected_answer, qa.verified, qa.tests_total
       FROM quiz_answers qa JOIN quiz_questions qq ON qq.id = qa.question_id
      WHERE qa.attempt_id = ? AND qq.type = 'coding'`,
    [attempt.id],
  );
  const quizTiming = await q1(
    'SELECT id, quiz_type, shuffle_questions, start_at, live_started_at, time_limit_minutes, end_at FROM quizzes WHERE id = ?',
    [attempt.quiz_id],
  );
  const startMs = new Date(attempt.started_at).getTime();
  const limitOver = !!(quizTiming && quizTiming.time_limit_minutes)
    && Date.now() > startMs + quizTiming.time_limit_minutes * 60000;
  const windowOver = !!(quizTiming && quizTiming.end_at) && Date.now() > new Date(quizTiming.end_at).getTime();
  const outOfTime = limitOver || windowOver;

  // Live-quiz view gate (manual submits): the runner sends the ids of the
  // questions it has actually opened. A live attempt that submits without
  // having opened every assigned question is rejected here as the server-side
  // backstop — the UI disables the button anyway. Auto-submits (timer /
  // host end) omit the field and are never blocked by this rule.
  const seenField = req.body && Array.isArray(req.body.seen_question_ids) ? new Set(req.body.seen_question_ids.map(String)) : null;
  if (seenField && quizTiming && quizTiming.quiz_type === 'live' && !outOfTime) {
    const canonicalForSeen = await q('SELECT id FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id', [attempt.quiz_id]);
    const assignedForSeen = await questionAssignment(canonicalForSeen, attempt, quizTiming);
    const unseenCount = assignedForSeen.questions.filter((row) => !seenField.has(String(row.id))).length;
    if (unseenCount) {
      throw ApiError.badRequest(
        `Submission is allowed only after all ${assignedForSeen.questions.length} questions have been viewed once `
        + `(${assignedForSeen.questions.length - unseenCount}/${assignedForSeen.questions.length} viewed — ${unseenCount} remaining). Open every question, then click Submit.`,
      );
    }
  }

  const pending = codingAnswers.filter((row) => {
    const code = fromJson(row.selected_answer);
    if (typeof code !== 'string' || !code.trim()) return false;         // left blank → simply unattempted
    if (!parseTestCases(row.test_cases).length) return false;            // nothing to run (instructor's side)
    // an untouched starter template is not a solution yet — it must not lock the submit button
    const templates = Object.values(parseStarter(row.starter_code)).map((t) => String(t || '').trim()).filter(Boolean);
    if (templates.includes(code.trim())) return false;
    return Number(row.verified) !== 1;
  });
  if (pending.length && !outOfTime) {
    const canonical = await q('SELECT id FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id', [attempt.quiz_id]);
    const assigned = await questionAssignment(canonical, attempt, quizTiming);
    const ordinal = new Map(assigned.questions.map((row, i) => [row.id, i + 1]));
    const numbers = pending.map((row) => `Q${ordinal.get(row.id) || row.id}`).join(', ');
    throw ApiError.badRequest(
      `Run the test cases before submitting — ${numbers} still ${pending.length === 1 ? 'has' : 'have'} un-run test cases. `
      + 'Open the question and press “Run code”.',
    );
  }

  // Before grading: if this attempt's frozen policy required proctoring but
  // the browser never reported it starting, say so explicitly in the
  // evidence trail. The policy — never today's switches — decides this: a
  // normal/practice quiz snapshots an all-off policy, and an admin who
  // enables Advanced Proctoring halfway through a paper must not retro-
  // actively charge every running student with "missing" checks they were
  // never asked to perform.
  try {
    const policy = proctorSvc.parseProctorPolicy(attempt.proctor_policy);
    if (policy) {
      await proctorSvc.closeAttempt(attempt.id, {
        cameraRequired: policy.camera_required,
        screenRequired: policy.screen_required,
        secondCameraRequired: policy.advanced.second_camera,
        roomScanRequired: policy.advanced.room_scan,
        identityRequired: policy.advanced.identity,
      });
    } else if (__quizEarly && __quizEarly.quiz_type === 'live') {
      // Legacy attempts opened before policy snapshots existed keep the old
      // basic camera/screen behaviour (live quizzes only — the same scope
      // the runner enforces), but never gain advanced missing-checks.
      const creatorId = await antiCheat.quizCreatorId(attempt.quiz_id);
      const [creatorCamOn, creatorScrOn] = await Promise.all([
        antiCheat.resolveBoolForUser(creatorId, 'proctor_camera_enabled', false),
        antiCheat.resolveBoolForUser(creatorId, 'proctor_screen_enabled', false),
      ]);
      if (creatorCamOn || creatorScrOn) {
        await proctorSvc.closeAttempt(attempt.id, {
          cameraRequired: creatorCamOn,
          screenRequired: creatorScrOn,
        });
      }
    }
  } catch (_) { /* evidence bookkeeping must never block a submission */ }

  const result = await evaluateAttempt(attempt.id);
  liveProctor.removeAttempt(attempt.id);
  // gamification: a graded quiz counts toward the daily streak
  touchActivity(req.user.id).catch(() => {});
  const quiz = await q1('SELECT title, id FROM quizzes WHERE id = ?', [attempt.quiz_id]);
  // Issue quiz excellence certificate if score ≥ 70% (idempotent)
  let quizCert = null;
  try {
    const { issueQuiz } = require('./certificate.controller');
    const certId = await issueQuiz(attempt.id);
    if (certId) quizCert = await q1('SELECT certificate_no, public_token FROM certificates WHERE id=?', [certId]);
  } catch (_) { /* cert issuance failure must not block grading */ }
  await recalcUser(req.user.id);
  await awardAchievements(req.user.id);
  await notify({
    userId: req.user.id, audience: 'user', type: 'quiz', link: quizCert ? `/cert/${quizCert.public_token}` : '/student/results',
    title: quizCert ? `Quiz certificate earned: ${quiz.title} 🏅` : `Quiz result: ${quiz.title}`,
    message: quizCert
      ? `You scored ${result.score}/${result.total} (${result.accuracy}%) — a Certificate of Excellence has been issued!`
      : `You scored ${result.score}/${result.total} (${result.accuracy}% accuracy, rank #${result.rank}).`,
  });
  ok(res, { ...result, certificate: quizCert ? { certificate_no: quizCert.certificate_no, token: quizCert.public_token } : null });
});

const myAttempts = asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT qa.*, z.title, z.quiz_type, z.difficulty FROM quiz_attempts qa JOIN quizzes z ON z.id = qa.quiz_id
      WHERE qa.user_id = ? ORDER BY qa.started_at DESC`, [req.user.id],
  );
  ok(res, rows);
});

const attemptDetail = asyncHandler(async (req, res) => {
  const attempt = await q1('SELECT * FROM quiz_attempts WHERE id = ?', [req.params.id]);
  if (!attempt) throw ApiError.notFound('Attempt not found');
  const quiz = await q1('SELECT * FROM quizzes WHERE id = ?', [attempt.quiz_id]);
  if (!quiz) throw ApiError.notFound('Quiz not found');

  const isOwner = !!req.user && Number(attempt.user_id) === Number(req.user.id);
  const canManage = isQuizHost(req.user, quiz);
  if (!isOwner && !canManage) throw ApiError.forbidden('You can only view your own attempt');

  // Solutions remain hidden while the paper is running, throughout a live
  // session, and after submission when the quiz says answers are not to be
  // shown. `show_answers_after=0` was previously ignored by this endpoint.
  let liveLocked = false;
  if (!canManage && quiz.quiz_type === 'live' && quiz.status === 'live') {
    const limitMs = Math.max(1, Number(quiz.time_limit_minutes || 10)) * 60000;
    const elapsedMs = quiz.live_started_at
      ? Date.now() - new Date(quiz.live_started_at).getTime() : 0;
    liveLocked = !quiz.live_started_at || elapsedMs < limitMs;
  }
  const hideSolutions = !canManage && (
    attempt.status === 'in_progress'
    || liveLocked
    || !Number(quiz.show_answers_after)
  );

  const rawAnswers = await q('SELECT * FROM quiz_answers WHERE attempt_id = ?', [attempt.id]);
  const answers = hideSolutions
    ? rawAnswers.map((answer) => ({ ...answer, is_correct: null, marks_awarded: null }))
    : rawAnswers;
  const canonical = await q('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id', [attempt.quiz_id]);
  const assignment = await questionAssignment(canonical, attempt, quiz);
  const questions = assignment.questions.map((row) => {
    let mapped = row.type === 'coding' && !canManage
      ? { ...row, ...codingConfig(row), correct_answer: null }
      : row;
    if (hideSolutions) mapped = { ...mapped, correct_answer: null, explanation: null };
    return mapped;
  });

  // Lobby seats must not receive the paper early either: until the host
  // starts the session the owner gets an empty question list, and the
  // runner redirects back to the waiting room on `lobby: true`. Hosts keep
  // full visibility for monitoring.
  const lobby = !canManage && isLiveLobby(quiz);
  const effectiveAntiCheat = await antiCheat.resolveForUser(quiz.created_by);
  // Only the student's own runner load may freeze the policy — a host
  // peeking at the attempt must not snapshot rules the student has not
  // been shown yet.
  const proctorPolicy = isOwner && !isLiveLobby(quiz) && attempt.status === 'in_progress'
    ? await captureAttemptProctorPolicy(attempt, quiz)
    : proctorSvc.parseProctorPolicy(attempt.proctor_policy);

  ok(res, {
    attempt,
    answers,
    questions: lobby ? [] : questions,
    lobby,
    anticheat: effectiveAntiCheat,
    proctor_policy: proctorPolicy,
    solutions_locked: hideSolutions,
    question_assignment: {
      individualized: assignment.individualized,
      seat_number: assignment.seat_number,
      unique_positions_for_first: assignment.unique_positions_for_first,
    },
  });
});

module.exports = {
  list, getOne, create, update, remove, exportQuizzes, exportQuiz, importQuizzes,
  startLive, startForAll, endLive, liveMonitor, results, resultsExcel,
  listQuestions, createQuestion, updateQuestion, removeQuestion, reorderQuestions,
  startAttempt, saveAnswer, runAttemptCode, submitAttempt, myAttempts, attemptDetail,
  recordViolation, recordProctorEvents, proctorReport, updateProctorFrame,
  getQuizProctorFrames, createSecondCameraSession, getSecondCameraStatus,
  secondCameraInfo, updateSecondCameraFrame, proctorSignal, getProctorIceServers, proctorHostAction,
  pingAttempt, unlock,
  evaluateAttempt,   // consumed by the housekeeping sweep in server.js
};

