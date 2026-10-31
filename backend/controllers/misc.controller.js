'use strict';
/** Leaderboard, achievements, notifications, search, reports, dashboard & settings. */
const events = require('../services/events.service');
const { q, q1, exec } = require('../config/db');
const { ApiError, asyncHandler, ok, created, parsePagination } = require('../utils/helpers');
const { notify } = require('../services/notification.service');
const { refreshLeaderboard, recalcUser } = require('../services/points.service');
const settingsService = require('../services/settings.service');
const antiCheat = require('../services/anticheatSettings.service');
const { publicUrl, UPLOAD_ROOT } = require('../middleware/upload');
const fs = require('fs/promises');
const path = require('path');

/* ------------------------------ leaderboard ------------------------------ */
const SCOPE = { global: null, weekly: null, monthly: null, contest: 'contest_id', course: 'course_id' };

const leaderboard = asyncHandler(async (req, res) => {
  const scope = Object.keys(SCOPE).includes(req.query.scope) ? req.query.scope : 'global';
  const { limit } = parsePagination(req.query, { limit: 50 });
  const parsedScopeRef = req.query.scope_ref ? Number(req.query.scope_ref) : null;
  if (parsedScopeRef !== null && (!Number.isInteger(parsedScopeRef) || parsedScopeRef <= 0)) {
    throw ApiError.badRequest('scope_ref must be a positive integer');
  }
  const scopeRef = ['contest', 'course'].includes(scope) ? parsedScopeRef : null;
  if (['contest', 'course'].includes(scope) && !scopeRef) {
    throw ApiError.badRequest(`scope_ref is required for the ${scope} leaderboard`);
  }

  if (scope === 'course') {
    // course leaderboard is computed live from coding + quiz activity of enrolled students
    const rows = await q(
      `SELECT u.id AS user_id, u.full_name, u.avatar, u.college, u.points, u.problems_solved,
              (SELECT COUNT(*) FROM coding_submissions s WHERE s.user_id = u.id) AS submissions,
              (SELECT COALESCE(ROUND(100*SUM(s.status='accepted')/NULLIF(COUNT(*),0),2),0) FROM coding_submissions s WHERE s.user_id = u.id) AS accuracy
         FROM users u
         JOIN enrollments e ON e.user_id = u.id
         JOIN roles r ON r.id = u.role_id
        WHERE e.course_id = ? AND r.slug = 'student'
        ORDER BY u.points DESC, u.problems_solved DESC LIMIT ?`, [scopeRef, limit],
    );
    return ok(res, rows.map((r, i) => ({ ...r, rank_position: i + 1, scope: 'course', scope_ref: scopeRef })));
  }

  const params = [scope];
  let where = 'l.scope = ?';
  if (scope === 'contest') { where += ' AND l.scope_ref = ?'; params.push(scopeRef); }
  else where += ' AND l.scope_ref IS NULL';
  const rows = await q(
    `SELECT l.*, u.full_name, u.avatar, u.college, u.points AS total_points, r.slug AS role
       FROM leaderboard l JOIN users u ON u.id = l.user_id JOIN roles r ON r.id = u.role_id
      WHERE ${where}
      ORDER BY (l.rank_position IS NULL), l.rank_position ASC, l.points DESC LIMIT ?`,
    [...params, limit],
  );
  const myRank = req.user
    ? await q1(
      `SELECT * FROM leaderboard
        WHERE scope = ? AND user_id = ? AND ${scope === 'contest' ? 'scope_ref = ?' : 'scope_ref IS NULL'}`,
      scope === 'contest' ? [scope, req.user.id, scopeRef] : [scope, req.user.id],
    )
    : null;
  ok(res, rows, { scope, scope_ref: scopeRef, my_rank: myRank });
});

const refreshLeaderboardNow = asyncHandler(async (req, res) => {
  await refreshLeaderboard();
  ok(res, { refreshed: true });
});

/* ------------------------------ achievements ------------------------------ */
const listAchievements = asyncHandler(async (req, res) => {
  const rows = await q('SELECT * FROM achievements ORDER BY criteria_value, id');
  let mine = [];
  if (req.user) {
    const rows2 = await q('SELECT achievement_id, awarded_at FROM user_achievements WHERE user_id = ?', [req.user.id]);
    mine = rows2;
  }
  ok(res, rows.map((a) => ({ ...a, earned: mine.some((m) => m.achievement_id === a.id), earned_at: (mine.find((m) => m.achievement_id === a.id) || {}).awarded_at || null })));
});

const createAchievement = asyncHandler(async (req, res) => {
  const { code, title, description, icon, badge_color, criteria_type, criteria_value, points_reward, is_active } = req.body;
  if (!code || !title) throw ApiError.badRequest('code and title are required');
  const result = await exec(
    `INSERT INTO achievements (code, title, description, icon, badge_color, criteria_type, criteria_value, points_reward, is_active)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [code, title, description || null, icon || '🏅', badge_color || '#6366f1', criteria_type || 'custom',
      criteria_value || 0, points_reward || 0, is_active === false ? 0 : 1],
  );
  created(res, await q1('SELECT * FROM achievements WHERE id = ?', [result.insertId]));
});

const updateAchievement = asyncHandler(async (req, res) => {
  const allowed = ['code', 'title', 'description', 'icon', 'badge_color', 'criteria_type', 'criteria_value', 'points_reward', 'is_active'];
  const data = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) data[k] = req.body[k]; });
  const keys = Object.keys(data);
  if (!keys.length) throw ApiError.badRequest('Nothing to update');
  await exec(`UPDATE achievements SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), req.params.id]);
  ok(res, await q1('SELECT * FROM achievements WHERE id = ?', [req.params.id]));
});

const removeAchievement = asyncHandler(async (req, res) => {
  await exec('DELETE FROM achievements WHERE id = ?', [req.params.id]);
  ok(res, { deleted: true });
});

/** POST /api/achievements/:id/award — admin grants a badge manually */
const awardAchievement = asyncHandler(async (req, res) => {
  const achievement = await q1('SELECT * FROM achievements WHERE id = ?', [req.params.id]);
  if (!achievement) throw ApiError.notFound('Achievement not found');
  const userId = Number(req.body.user_id);
  if (!userId) throw ApiError.badRequest('user_id is required');
  await exec('INSERT IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?,?)', [userId, achievement.id]);
  await notify({ userId, audience: 'user', type: 'achievement', link: '/student/achievements',
    title: `Achievement unlocked: ${achievement.title} ${achievement.icon || ''}`.trim(),
    message: `An instructor awarded you "${achievement.title}".`, createdBy: req.user.id });
  await recalcUser(userId);
  ok(res, { awarded: true });
});

/* ------------------------------ notifications ------------------------------ */
const myNotifications = asyncHandler(async (req, res) => {
  const rows = await require('../services/notification.service').listForUser(req.user.id, req.user.role, {
    limit: Number(req.query.limit) || 30, unreadOnly: req.query.unread === '1',
  });
  const unread = await require('../services/notification.service').unreadCount(req.user.id, req.user.role);
  ok(res, rows, { unread });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const changed = await require('../services/notification.service').markRead(req.params.id, req.user.id, req.user.role);
  if (!changed) throw ApiError.notFound('Notification not found');
  ok(res, { read: true });
});

const markAllRead = asyncHandler(async (req, res) => {
  await require('../services/notification.service').markAllRead(req.user.id, req.user.role);
  ok(res, { read: true });
});

const broadcastNotification = asyncHandler(async (req, res) => {
  const { title, message, audience = 'all', type = 'system', link, user_id } = req.body;
  if (!title || !message) throw ApiError.badRequest('title and message are required');
  const id = await notify({ userId: user_id || null, audience, title, message, type, link, createdBy: req.user.id });
  const [{ recipients }] = await q(
    audience === 'user' ? 'SELECT 1 AS recipients'
      : "SELECT COUNT(*) AS recipients FROM users WHERE status <> 'suspended' AND (? = 'all' OR (SELECT slug FROM roles WHERE id = role_id) = ?)",
    [audience, audience],
  );
  created(res, { id, recipients });
});

const listAllNotifications = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query, { limit: 20 });
  const rows = await q(
    `SELECT n.*, u.full_name AS created_by_name FROM notifications n LEFT JOIN users u ON u.id = n.created_by
      ORDER BY n.created_at DESC LIMIT ? OFFSET ?`, [limit, offset],
  );
  const [{ total }] = await q('SELECT COUNT(*) AS total FROM notifications');
  ok(res, rows, { page, limit, total, pages: Math.ceil(total / limit) });
});

const removeNotification = asyncHandler(async (req, res) => {
  await exec('DELETE FROM notifications WHERE id = ?', [req.params.id]);
  ok(res, { deleted: true });
});

/* --------------------------------- search --------------------------------- */
const globalSearch = asyncHandler(async (req, res) => {
  const term = String(req.query.q || req.query.search || '').trim();
  if (term.length < 2) return ok(res, { query: term, results: {}, total: 0 });
  const like = `%${term}%`;
  const scope = String(req.query.type || 'all').toLowerCase();
  const want = (t) => scope === 'all' || scope === t;
  const out = {};

  if (want('courses')) {
    out.courses = await q(
      `SELECT c.id, c.title, c.slug, c.thumbnail, c.difficulty, c.total_students, p.name AS category_name, 'course' AS type
         FROM courses c LEFT JOIN categories p ON p.id = c.category_id
        WHERE c.status='published' AND (c.title LIKE ? OR c.summary LIKE ?) LIMIT 6`, [like, like]);
  }
  if (want('notes')) {
    out.notes = await q(
      `SELECT n.id, n.title, n.slug, n.file_type, n.subject, n.download_count, 'note' AS type
         FROM notes n WHERE n.status='published' AND (n.title LIKE ? OR n.description LIKE ? OR n.subject LIKE ?) LIMIT 6`, [like, like, like]);
  }
  if (want('quizzes')) {
    out.quizzes = await q(
      `SELECT z.id, z.title, z.slug, z.quiz_type, z.difficulty, z.question_count, 'quiz' AS type
         FROM quizzes z WHERE z.status IN ('published','live','scheduled') AND (z.title LIKE ? OR z.description LIKE ?) LIMIT 6`, [like, like]);
  }
  if (want('problems')) {
    out.problems = await q(
      `SELECT p.id, p.title, p.slug, p.difficulty, p.points, p.acceptance_rate, 'problem' AS type
         FROM coding_problems p WHERE p.status='published' AND (p.title LIKE ? OR p.description LIKE ?) LIMIT 6`, [like, like]);
  }
  if (want('contests')) {
    out.contests = await q(
      `SELECT c.id, c.title, c.slug, c.status, c.start_at, 'contest' AS type
         FROM contests c WHERE c.title LIKE ? OR c.description LIKE ? LIMIT 6`, [like, like]);
  }
  if (want('developers')) {
    out.developers = await q(
      `SELECT u.id, u.full_name, u.college, u.avatar, COUNT(c.id) AS courses_created, 'developer' AS type
         FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN courses c ON c.instructor_id = u.id
        WHERE r.slug IN ('developer','admin','owner') AND (u.full_name LIKE ? OR u.college LIKE ?)
        GROUP BY u.id LIMIT 6`, [like, like]);
  }
  const total = Object.values(out).reduce((s, arr) => s + arr.length, 0);
  ok(res, { query: term, results: out, total });
});

/** GET /api/search/suggestions?q= */
const searchSuggestions = asyncHandler(async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 1) return ok(res, []);
  const like = `%${term}%`;
  const rows = await q(
    `SELECT title AS label, 'course' AS type, CONCAT('/courses/', id) AS link FROM courses WHERE status='published' AND title LIKE ? LIMIT 4`, [like]);
  const problems = await q(
    `SELECT title AS label, 'problem' AS type, CONCAT('/coding/', id) AS link FROM coding_problems WHERE status='published' AND title LIKE ? LIMIT 4`, [like]);
  const quizzes = await q(
    `SELECT title AS label, 'quiz' AS type, CONCAT('/quizzes/', id) AS link FROM quizzes WHERE title LIKE ? LIMIT 3`, [like]);
  const notes = await q(
    `SELECT title AS label, 'note' AS type, '/notes' AS link FROM notes WHERE status='published' AND title LIKE ? LIMIT 3`, [like]);
  ok(res, [...rows, ...problems, ...quizzes, ...notes]);
});

/* --------------------------- settings + maintenance --------------------------- */
const getPublicSettings = asyncHandler(async (req, res) => {
  const all = await settingsService.loadSettings();
  const keys = ['site_name', 'site_tagline', 'site_description', 'site_logo', 'site_favicon', 'contact_email',
    'landing_banner_enabled', 'landing_banner_image', 'landing_banner_title', 'landing_banner_subtitle',
    'landing_banner_cta_label', 'landing_banner_cta_link',
    'contact_phone', 'contact_address', 'social_facebook', 'social_twitter', 'social_instagram', 'social_linkedin',
    'social_youtube', 'social_github', 'maintenance_mode', 'maintenance_message', 'registration_enabled',
    'student_registration', 'developer_registration', 'items_per_page', 'enable_global_search',
    'leaderboard_enabled', 'contests_enabled', 'achievements_enabled', 'quiz_system_enabled', 'coding_system_enabled',
    'live_quiz_enabled', 'download_login_required',
    'tab_guard_enabled', 'tab_guard_max_violations', 'tab_guard_auto_submit', 'quiz_lockdown_enabled',
    'quiz_cp_block',
    'coding_arena_cp_block', 'screenshot_block_enabled', 'exam_safe_mode',
    'ai_classifier_arena_enabled', 'ai_classifier_quiz_enabled',
    // Proctoring: the quiz runner has to know BEFORE the attempt renders
    // whether it must ask for camera / screen permission.
    'proctor_camera_enabled', 'proctor_screen_enabled',
    'proctor_max_violations',
    // Advanced proctoring is admin/global only. The runner and host monitor
    // read the same switches so consent screens never promise a check that
    // is off, and the host never waits for a feed that cannot start.
    'proctor_advanced_enabled', 'proctor_body_detection_enabled',
    'proctor_head_pose_enabled', 'proctor_live_snapshot_enabled',
    'proctor_live_webrtc_enabled', 'proctor_second_camera_enabled',
    'proctor_room_scan_enabled', 'proctor_identity_check_enabled',
    'proctor_mic_monitoring_enabled', 'proctor_dual_monitor_enabled', 'proctor_recording_enabled',
    // NOTE: proctor_webrtc_ice_servers is deliberately NOT public. It may
    // carry TURN credentials; browsers fetch the (possibly short-lived)
    // list from the authenticated attempt ICE endpoint instead.
    'proctor_live_warnings_enabled'];
  const out = {};
  keys.forEach((k) => { if (all[k]) out[k] = all[k].setting_value; });
  ok(res, out);
});

const getAllSettings = asyncHandler(async (req, res) => ok(res, await settingsService.allSettingsGrouped()));

/* ------------------------- anti-cheat settings ---------------------------
   A developer holding `manage_anticheat` may flip the exam-integrity switches
   without being handed the whole Website Settings screen (which also holds
   SMTP credentials, payment keys and the landing page). The allow-list below
   is the entire surface they can touch — anything else is rejected outright
   rather than silently ignored, so a typo surfaces instead of doing nothing. */
const ANTI_CHEAT_KEYS = antiCheat.ANTI_CHEAT_KEYS;

/**
 * Whose anti-cheat row a request may touch. A developer may only ever see or
 * edit their OWN overrides; owner/admin may target any user (that is how an
 * administrator configures one particular developer without touching the
 * platform defaults). Anything else is a loud 403, never a silent retarget.
 */
function antiCheatTargetUser(req, requestedUserId) {
  const isAdmin = ['owner', 'admin'].includes(req.user.role);
  const uid = Number(requestedUserId) || 0;
  if (!uid || uid === Number(req.user.id)) return Number(req.user.id);
  if (!isAdmin) throw ApiError.forbidden('You can only manage your own anti-cheat settings');
  return uid;
}

const getAntiCheatSettings = asyncHandler(async (req, res) => {
  const userId = antiCheatTargetUser(req, req.query.user_id);
  const [global, overrides] = await Promise.all([
    antiCheat.globalValues(),
    antiCheat.getOverrides(userId),
  ]);
  const effective = { ...global, ...overrides };
  // `settings` stays as the effective map for older clients; the layered
  // view (global vs overrides) is what the per-developer screen renders.
  ok(res, { settings: effective, global, overrides, effective, user_id: userId, keys: ANTI_CHEAT_KEYS });
});

const updateAntiCheatSettings = asyncHandler(async (req, res) => {
  const payload = req.body.settings || req.body;
  if (!payload || typeof payload !== 'object') throw ApiError.badRequest('settings object is required');

  const rejected = Object.keys(payload).filter((k) => !ANTI_CHEAT_KEYS.includes(k));
  if (rejected.length) {
    throw ApiError.forbidden(`Not an anti-cheat setting: ${rejected.join(', ')}. Use Website Settings for that.`);
  }
  if (!Object.keys(payload).length) throw ApiError.badRequest('No anti-cheat settings were supplied');

  const isAdmin = ['owner', 'admin'].includes(req.user.role);
  const scope = String(req.body.scope || 'mine').toLowerCase();

  if (scope === 'global') {
    // Platform defaults stay an administrator decision. A developer holding
    // `manage_anticheat` gets per-developer control (below), never the
    // global row — that was the old behaviour this split exists to remove.
    if (!isAdmin) throw ApiError.forbidden('Only an administrator can change the platform-wide anti-cheat defaults');
    await settingsService.updateSettings(payload, req.user.id);
    // Same broadcast as the admin path, so students already sitting in a live
    // quiz pick the change up without reloading (they often cannot — F5 is
    // blocked under lockdown).
    events.publish('settings_changed', { keys: Object.keys(payload), at: Date.now() });
    const [global, overrides] = await Promise.all([
      antiCheat.globalValues(),
      antiCheat.getOverrides(req.user.id),
    ]);
    return ok(res, { settings: { ...global, ...overrides }, global, overrides, effective: { ...global, ...overrides }, user_id: Number(req.user.id), scope });
  }
  if (scope !== 'mine') throw ApiError.badRequest("scope must be 'mine' or 'global'");

  // A null value clears that override (back to inheriting the admin default).
  // The settings_changed broadcast is kept so open runners re-resolve live.
  const userId = antiCheatTargetUser(req, req.body.user_id);
  const overrides = await antiCheat.setOverrides(userId, payload);
  events.publish('settings_changed', { keys: Object.keys(payload), user_id: userId, at: Date.now() });
  const global = await antiCheat.globalValues();
  ok(res, { settings: { ...global, ...overrides }, global, overrides, effective: { ...global, ...overrides }, user_id: userId, scope });
});

const updateSettings = asyncHandler(async (req, res) => {
  const payload = req.body.settings || req.body;
  if (!payload || typeof payload !== 'object') throw ApiError.badRequest('settings object is required');
  await settingsService.updateSettings(payload, req.user.id);
  /* Feature Control promises each switch "takes effect everywhere" instantly,
   * but every client reads /settings/public once at mount and never again — so
   * a student already sitting in a live quiz kept the old flags until they
   * reloaded, and under Fullscreen Lockdown they cannot even reload (F5 and
   * Ctrl+R are blocked). Announce the change so open clients can re-read it. */
  events.publish('settings_changed', { keys: Object.keys(payload), at: Date.now() });
  ok(res, await settingsService.allSettingsGrouped());
});

async function removeUploadedBanner(url) {
  if (!String(url || '').startsWith('/uploads/banners/')) return;
  const bannerRoot = path.resolve(UPLOAD_ROOT, 'banners');
  const filePath = path.resolve(UPLOAD_ROOT, String(url).slice('/uploads/'.length));
  if (!filePath.startsWith(`${bannerRoot}${path.sep}`)) return;
  try { await fs.unlink(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function hasValidBannerSignature(file) {
  const handle = await fs.open(file.path, 'r');
  try {
    const bytes = Buffer.alloc(12);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const ext = path.extname(file.originalname).toLowerCase();
    const isPng = bytesRead >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = bytesRead >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebp = bytesRead >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    return (ext === '.png' && isPng)
      || (['.jpg', '.jpeg'].includes(ext) && isJpeg)
      || (ext === '.webp' && isWebp);
  } finally { await handle.close(); }
}

const uploadLandingBanner = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('A JPG, PNG or WebP banner image is required');
  if (!(await hasValidBannerSignature(req.file))) {
    await fs.unlink(req.file.path).catch(() => {});
    throw ApiError.badRequest('The uploaded file is not a valid JPG, PNG or WebP image');
  }
  const previous = await settingsService.readSetting('landing_banner_image', '');
  const url = publicUrl(req.file);
  await settingsService.updateSettings({ landing_banner_image: url, landing_banner_enabled: '1' }, req.user.id);
  await removeUploadedBanner(previous);
  ok(res, { url, enabled: true });
});

const removeLandingBanner = asyncHandler(async (req, res) => {
  const previous = await settingsService.readSetting('landing_banner_image', '');
  await settingsService.updateSettings({ landing_banner_image: '', landing_banner_enabled: '0' }, req.user.id);
  await removeUploadedBanner(previous);
  ok(res, { url: '', enabled: false });
});

/* ------------------------------- reports -------------------------------- */
const listReports = asyncHandler(async (req, res) => {
  ok(res, await q('SELECT r.*, u.full_name AS generated_by_name FROM reports r LEFT JOIN users u ON u.id = r.generated_by ORDER BY r.created_at DESC'));
});

const generateReport = asyncHandler(async (req, res) => {
  const type = String(req.body.report_type || 'activity');
  let payload = {};
  if (type === 'users') {
    payload = await q('SELECT r.slug AS role, COUNT(*) AS count FROM users u JOIN roles r ON r.id = u.role_id GROUP BY r.slug');
  } else if (type === 'courses') {
    payload = await q('SELECT c.title, c.total_students, c.lessons_count, c.status FROM courses c ORDER BY c.total_students DESC');
  } else if (type === 'coding') {
    payload = await q("SELECT difficulty, COUNT(*) AS submissions, SUM(status='accepted') AS accepted FROM coding_submissions s JOIN coding_problems p ON p.id = s.problem_id GROUP BY difficulty");
  } else if (type === 'quizzes') {
    payload = await q('SELECT z.title, COUNT(qa.id) AS attempts, ROUND(AVG(qa.score),2) AS avg_score FROM quizzes z LEFT JOIN quiz_attempts qa ON qa.quiz_id = z.id GROUP BY z.id');
  } else if (type === 'contests') {
    payload = await q('SELECT c.title, c.status, c.registered_count, COUNT(cp.id) AS participants FROM contests c LEFT JOIN contest_participants cp ON cp.contest_id = c.id GROUP BY c.id');
  } else {
    payload = await q(`SELECT DATE(created_at) AS day, COUNT(*) AS signups FROM users WHERE created_at >= NOW() - INTERVAL 30 DAY GROUP BY DATE(created_at) ORDER BY day`);
  }
  const result = await exec(
    `INSERT INTO reports (report_type, title, description, payload, period_start, period_end, generated_by)
     VALUES (?,?,?,?,CURDATE() - INTERVAL 30 DAY, CURDATE(), ?)`,
    [type, `${type[0].toUpperCase()}${type.slice(1)} report`, `Generated on demand by ${req.user.full_name}`, JSON.stringify(payload), req.user.id],
  );
  created(res, await q1('SELECT * FROM reports WHERE id = ?', [result.insertId]));
});

/* ------------------------------ dashboards ------------------------------ */
const dashboard = asyncHandler(async (req, res) => {
  const [counts] = await q(`
    SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='student') AS students,
      (SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='developer') AS developers,
      (SELECT COUNT(*) FROM courses) AS courses,
      (SELECT COUNT(*) FROM notes) AS notes,
      (SELECT COUNT(*) FROM quizzes) AS quizzes,
      (SELECT COUNT(*) FROM coding_problems) AS coding_problems,
      (SELECT COUNT(*) FROM contests) AS contests,
      (SELECT COUNT(*) FROM coding_submissions) AS submissions,
      (SELECT COUNT(*) FROM quiz_attempts) AS quiz_attempts,
      (SELECT COUNT(*) FROM users WHERE last_login_at >= NOW() - INTERVAL 1 DAY) AS active_users,
      (SELECT COUNT(*) FROM coding_problems WHERE status='published') AS published_problems,
      (SELECT COUNT(*) FROM courses WHERE status='published') AS published_courses
  `);

  const recentUsers = await q(`SELECT u.id, u.full_name, u.email, u.status, u.created_at, r.slug AS role FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.created_at DESC LIMIT 6`);
  const recentSubmissions = await q(`SELECT s.id, s.status, s.language, s.submitted_at, u.full_name, p.title FROM coding_submissions s JOIN users u ON u.id=s.user_id JOIN coding_problems p ON p.id=s.problem_id ORDER BY s.submitted_at DESC LIMIT 6`);
  const topLearners = await q(`SELECT u.id, u.full_name, u.points, u.problems_solved
     FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.slug = 'student' ORDER BY u.points DESC LIMIT 5`);
  const activity = await q(`
    SELECT DATE(s.submitted_at) AS day, COUNT(*) AS submissions FROM coding_submissions s
     WHERE s.submitted_at >= NOW() - INTERVAL 14 DAY GROUP BY DATE(s.submitted_at) ORDER BY day`);
  const enrollTrend = await q(`
    SELECT DATE(enrolled_at) AS day, COUNT(*) AS enrollments FROM enrollments
     WHERE enrolled_at >= NOW() - INTERVAL 14 DAY GROUP BY DATE(enrolled_at) ORDER BY day`);
  const pendingDevelopers = await q(`SELECT u.id, u.full_name, u.email, u.created_at FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='developer' AND u.status='pending'`);

  ok(res, { counts, recentUsers, recentSubmissions, topLearners, activity, enrollTrend, pendingDevelopers, last_updated: new Date().toISOString() });
});

const studentDashboard = asyncHandler(async (req, res) => {
  const enrolledCourses = await q(
    `SELECT e.*, c.title, c.thumbnail, c.difficulty, c.lessons_count FROM enrollments e JOIN courses c ON c.id=e.course_id
      WHERE e.user_id = ? ORDER BY e.last_accessed_at IS NULL, e.last_accessed_at DESC, e.enrolled_at DESC LIMIT 6`, [req.user.id]);
  const upcomingQuizzes = await q(
    `SELECT z.id, z.title, z.status, z.quiz_type, z.start_at, z.end_at, z.time_limit_minutes, z.total_marks, z.difficulty
       FROM quizzes z WHERE z.status IN ('published','scheduled','live') ORDER BY (z.status='live') DESC, z.start_at IS NULL, z.start_at ASC LIMIT 4`);
  const liveContests = await q(
    `SELECT id, title, status, start_at, end_at FROM contests WHERE status IN ('live','published','scheduled') ORDER BY FIELD(status,'live','scheduled','published'), start_at LIMIT 3`);
  const recentNotes = await q(
    `SELECT id, title, file_type, subject, download_count, created_at FROM notes WHERE status='published' ORDER BY created_at DESC LIMIT 4`);
  const mySubmissions = await q(
    `SELECT s.id, s.status, s.language, s.score, s.test_cases_passed, s.total_test_cases, s.submitted_at, p.title, p.id AS problem_id
       FROM coding_submissions s JOIN coding_problems p ON p.id=s.problem_id WHERE s.user_id = ? ORDER BY s.submitted_at DESC LIMIT 5`, [req.user.id]);
  const myAttempts = await q(
    `SELECT qa.id, qa.score, qa.total_marks, qa.accuracy, qa.rank_position, qa.status, qa.started_at, z.title
       FROM quiz_attempts qa JOIN quizzes z ON z.id=qa.quiz_id WHERE qa.user_id = ? ORDER BY qa.started_at DESC LIMIT 5`, [req.user.id]);
  const badges = await q(
    `SELECT a.*, ua.awarded_at FROM user_achievements ua JOIN achievements a ON a.id=ua.achievement_id
      WHERE ua.user_id = ? ORDER BY ua.awarded_at DESC`, [req.user.id]);
  const rank = await q1("SELECT rank_position, points, accuracy FROM leaderboard WHERE user_id = ? AND scope='global'", [req.user.id]);
  const progress = await q(
    `SELECT c.title, e.progress_percent, e.completed_lessons, c.lessons_count FROM enrollments e JOIN courses c ON c.id=e.course_id
      WHERE e.user_id = ? AND e.status='active' ORDER BY e.last_accessed_at DESC LIMIT 5`, [req.user.id]);
  ok(res, {
    user: req.user,
    enrolled_courses: enrolledCourses,
    upcoming_quizzes: upcomingQuizzes,
    live_contests: liveContests,
    recent_notes: recentNotes,
    recent_submissions: mySubmissions,
    recent_quiz_attempts: myAttempts,
    badges,
    rank,
    progress,
  });
});

const developerDashboard = asyncHandler(async (req, res) => {
  const stats = await q(`
    SELECT
      (SELECT COUNT(*) FROM courses WHERE instructor_id = ?) AS my_courses,
      (SELECT COUNT(*) FROM courses WHERE instructor_id = ? AND status='published') AS published_courses,
      (SELECT COUNT(*) FROM notes WHERE uploaded_by = ?) AS my_notes,
      (SELECT COUNT(*) FROM quizzes WHERE created_by = ?) AS my_quizzes,
      (SELECT COUNT(*) FROM coding_problems WHERE created_by = ?) AS my_problems,
      (SELECT COUNT(*) FROM contests WHERE created_by = ?) AS my_contests,
      (SELECT COUNT(DISTINCT e.user_id) FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE c.instructor_id = ?) AS total_students`,
    [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]);
  const myCourses = await q(
    `SELECT c.id, c.title, c.status, c.difficulty, c.total_students, c.lessons_count, c.created_at FROM courses c
      WHERE c.instructor_id = ? ORDER BY c.created_at DESC LIMIT 6`, [req.user.id]);
  const myProblems = await q(
    `SELECT p.id, p.title, p.difficulty, p.total_submissions, p.acceptance_rate, p.status FROM coding_problems p
      WHERE p.created_by = ? ORDER BY p.created_at DESC LIMIT 6`, [req.user.id]);
  const recentSubmissions = await q(
    `SELECT s.id, s.status, s.language, s.submitted_at, u.full_name, p.title FROM coding_submissions s
       JOIN users u ON u.id=s.user_id JOIN coding_problems p ON p.id=s.problem_id
      WHERE p.created_by = ? ORDER BY s.submitted_at DESC LIMIT 8`, [req.user.id]);
  const myQuizzes = await q(
    `SELECT z.id, z.title, z.status, z.quiz_type, z.question_count, z.time_limit_minutes FROM quizzes z
      WHERE z.created_by = ? ORDER BY z.created_at DESC LIMIT 6`, [req.user.id]);
  ok(res, { stats: stats[0], my_courses: myCourses, my_problems: myProblems, recent_submissions: recentSubmissions, my_quizzes: myQuizzes, permissions: req.user.permissions });
});

/* --------------------------- public platform stats --------------------------- */
const publicStats = asyncHandler(async (req, res) => {
  const [row] = await q(`
    SELECT
      (SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='student')  AS total_students,
      (SELECT COUNT(*) FROM users u JOIN roles r ON r.id=u.role_id WHERE r.slug='developer') AS total_developers,
      (SELECT COUNT(*) FROM courses WHERE status='published')  AS total_courses,
      (SELECT COUNT(*) FROM notes WHERE status='published')    AS total_notes,
      (SELECT COUNT(*) FROM quizzes)                           AS total_quizzes,
      (SELECT COUNT(*) FROM coding_problems WHERE status='published') AS total_problems,
      (SELECT COUNT(*) FROM coding_submissions)                AS total_submissions,
      (SELECT COUNT(*) FROM contests)                          AS total_contests,
      (SELECT COUNT(*) FROM quiz_attempts WHERE status='evaluated') AS total_quiz_attempts
  `);
  ok(res, row);
});

/* ------------------------------ categories ------------------------------ */
const listCategories = asyncHandler(async (req, res) => {
  const rows = await q('SELECT * FROM categories ORDER BY type, name');
  ok(res, rows);
});

module.exports = {
  leaderboard, refreshLeaderboardNow,
  getAntiCheatSettings, updateAntiCheatSettings, ANTI_CHEAT_KEYS,
  listAchievements, createAchievement, updateAchievement, removeAchievement, awardAchievement,
  myNotifications, markNotificationRead, markAllRead, broadcastNotification, listAllNotifications, removeNotification,
  globalSearch, searchSuggestions,
  getPublicSettings, getAllSettings, updateSettings, uploadLandingBanner, removeLandingBanner,
  listReports, generateReport,
  dashboard, studentDashboard, developerDashboard, listCategories, publicStats,
};
