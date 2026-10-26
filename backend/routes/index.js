'use strict';
/** All REST API routes with their auth / role / permission middleware. */
const express = require('express');
const { clientBase } = require('../utils/clientUrl');
const passport = require('passport');

const auth = require('../controllers/auth.controller');
const users = require('../controllers/user.controller');
const courses = require('../controllers/course.controller');
const notes = require('../controllers/note.controller');
const quizzes = require('../controllers/quiz.controller');
const pointsCtl = require('../controllers/points.controller');
const coding = require('../controllers/coding.controller');
const misc = require('../controllers/misc.controller');
const certs = require('../controllers/certificate.controller');
const landingBuilder = require('../controllers/landing-builder.controller');
const subs = require('../controllers/subscription.controller');

const { authenticate, optionalAuth, authorize, requirePermission } = require('../middleware/auth');
const {
  notesUpload, imageUpload, avatarUpload, bannerUpload, landingMediaUpload,
  validateRasterImage, validateNoteFile,
} = require('../middleware/upload');
const {
  authLimiter, executionLimiter, submitLimiter, writeLimiter, certLimiter,
  proctorEventLimiter, proctorFrameLimiter, proctorSignalLimiter, proctorStatusLimiter,
  secondCameraLimiter,
} = require('../middleware/rateLimit');

const router = express.Router();
const adminOnly = [authenticate, authorize('admin')];
const staff = [authenticate, authorize('admin', 'developer')];

/* ------------------------ Feature Control gates ------------------------ */
// The admin switches whole feature areas ON/OFF from the Feature Control panel.
// These gates block the matching APIs immediately (nav + pages gate on the client).
const settingsService = require('../services/settings.service');
const featureGate = (key, label) => async (req, res, next) => {
  try {
    if (await settingsService.readBool(key, false)) return next();
    return res.status(403).json({ success: false, error: `${label} is currently disabled by the administrator` });
  } catch (error) { return next(error); }
};
router.use('/quizzes', featureGate('quiz_system_enabled', 'The quiz system'));
router.use('/quiz-attempts', featureGate('quiz_system_enabled', 'The quiz system'));
router.use('/coding', featureGate('coding_system_enabled', 'The coding arena'));
router.use('/contests', featureGate('contests_enabled', 'Contests'));
router.use('/leaderboard', featureGate('leaderboard_enabled', 'The leaderboard'));
router.use('/achievements', featureGate('achievements_enabled', 'Achievements'));

/* ------------------------------- health ------------------------------- */
router.get('/health', async (req, res) => {
  const { ping } = require('../config/db');
  try {
    await ping();
    return res.json({
      success: true,
      status: 'ok',
      service: 'smartodl-api',
      capabilities: { json_transfer: 1 },
      time: new Date().toISOString(),
    });
  } catch (_) {
    return res.status(503).json({ success: false, status: 'unavailable', service: 'smartodl-api', time: new Date().toISOString() });
  }
});

/* -------------------------------- auth -------------------------------- */
router.post('/auth/register', authLimiter, auth.register);
router.post('/auth/login', authLimiter, auth.login);
router.post('/auth/refresh', authLimiter, auth.refresh);
router.post('/auth/logout', optionalAuth, auth.logout);
router.post('/auth/forgot-password', authLimiter, auth.forgotPassword);
router.post('/auth/reset-password', authLimiter, auth.resetPassword);
router.post('/auth/change-password', authenticate, writeLimiter, auth.changePassword);
router.get('/auth/me', authenticate, auth.me);
router.get('/auth/providers', auth.providers);

/** OAuth 2.0 — providers must be configured and explicitly enabled by an admin. */
router.get('/auth/google', async (req, res, next) => {
  try {
    const enabled = await settingsService.readBool('google_login_enabled', false);
    if (!(enabled && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) {
      return res.redirect(`${clientBase()}/login?error=google_not_configured`);
    }
    const state = require('../config/passport').beginOAuthState(res, 'google');
    return passport.authenticate('google', { scope: ['profile', 'email'], session: false, state })(req, res, next);
  } catch (error) { return next(error); }
});
router.get('/auth/google/callback',
  // Mirror the guard on the entry route: without credentials the strategy was
  // never registered and passport.authenticate() throws, which used to reach
  // the browser as a bare 500 instead of a readable login-page message.
  (req, res, next) => (require('../config/passport').strategyReady('google')
    ? next()
    : res.redirect(`${clientBase()}/login?error=google_not_configured`)),
  (req, res, next) => (require('../config/passport').verifyOAuthState(req, res, 'google')
    ? next()
    : res.redirect(`${clientBase()}/login?error=oauth_state`)),
  (req, res, next) => passport.authenticate('google', { session: false, failureRedirect: `${clientBase()}/login?error=google_failed` })(req, res, next),
  (req, res, next) => require('../config/passport').issueTokensAndRedirect(req, res, req.user).catch(next));

/** OAuth 2.0 — GitHub */
router.get('/auth/github', async (req, res, next) => {
  try {
    const enabled = await settingsService.readBool('github_login_enabled', false);
    if (!(enabled && process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)) {
      return res.redirect(`${clientBase()}/login?error=github_not_configured`);
    }
    const state = require('../config/passport').beginOAuthState(res, 'github');
    return passport.authenticate('github', { scope: ['user:email'], session: false, state })(req, res, next);
  } catch (error) { return next(error); }
});
router.get('/auth/github/callback',
  // Mirror the guard on the entry route: without credentials the strategy was
  // never registered and passport.authenticate() throws, which used to reach
  // the browser as a bare 500 instead of a readable login-page message.
  (req, res, next) => (require('../config/passport').strategyReady('github')
    ? next()
    : res.redirect(`${clientBase()}/login?error=github_not_configured`)),
  (req, res, next) => (require('../config/passport').verifyOAuthState(req, res, 'github')
    ? next()
    : res.redirect(`${clientBase()}/login?error=oauth_state`)),
  (req, res, next) => passport.authenticate('github', { session: false, failureRedirect: `${clientBase()}/login?error=github_failed` })(req, res, next),
  (req, res, next) => require('../config/passport').issueTokensAndRedirect(req, res, req.user).catch(next));

/* -------------------------------- users -------------------------------- */
router.get('/users/me/permissions', authenticate, users.myPermissions);
router.patch('/users/me', authenticate, writeLimiter, users.updateMe);
router.post('/users/me/avatar', authenticate, avatarUpload.single('avatar'), validateRasterImage, users.uploadAvatar);
router.get('/users', ...adminOnly, users.list);
// Colleges section of the admin panel — students and developers grouped by college name
router.get('/admin/colleges', ...adminOnly, users.collegeSummary);

/* ---- subscriptions & premium plans ---- */
router.get('/plans', optionalAuth, subs.plans);                     // pricing page (public)
router.get('/subscriptions/me', authenticate, subs.myStatus);
router.post('/subscriptions/checkout', authenticate, authorize('student', 'developer'), writeLimiter, subs.checkout);
router.post('/subscriptions/verify', authenticate, authorize('student', 'developer'), writeLimiter, subs.verify);
// Paytm Business: the callback comes from Paytm's server without a JWT; its security comes from the checksum
// plus a server-side status re-query.
router.post('/subscriptions/paytm/callback', subs.paytmCallback);
// Razorpay webhook: server-to-server, HMAC over the raw body (see server.js rawBody capture).
router.post('/subscriptions/razorpay/webhook', subs.razorpayWebhook);
router.get('/subscriptions/paytm/status/:id', authenticate, subs.paytmStatus);
router.get('/admin/plans', ...adminOnly, subs.adminPlans);
router.post('/admin/plans', ...adminOnly, writeLimiter, subs.createPlan);
router.put('/admin/plans/:id', ...adminOnly, writeLimiter, subs.updatePlan);
router.delete('/admin/plans/:id', ...adminOnly, subs.removePlan);
router.get('/admin/subscriptions', ...adminOnly, subs.adminSubs);
router.post('/admin/subscriptions/grant', ...adminOnly, writeLimiter, subs.grant);
router.get('/admin/colleges/members', ...adminOnly, users.collegeMembers);
router.post('/users', ...adminOnly, users.createUser);
router.get('/users/:id/permissions', ...adminOnly, users.getPermissions);
router.put('/users/:id/permissions', ...adminOnly, users.setPermissions);
router.get('/users/:id', authenticate, users.getOne);
router.patch('/users/:id', ...adminOnly, users.updateUser);
router.delete('/users/:id', ...adminOnly, users.removeUser);

/* ------------------------------ categories ------------------------------ */
router.get('/categories', optionalAuth, misc.listCategories);
router.post('/categories', ...adminOnly, writeLimiter, require('../controllers/crud.controller').categories.create);
router.put('/categories/:id', ...adminOnly, require('../controllers/crud.controller').categories.update);
router.delete('/categories/:id', ...adminOnly, require('../controllers/crud.controller').categories.remove);

/* -------------------------------- courses -------------------------------- */
router.get('/courses', optionalAuth, courses.listCourses);
router.post('/courses', authenticate, authorize('admin', 'developer'), requirePermission('create_course'), writeLimiter, courses.createCourse);
router.get('/courses/:id', optionalAuth, courses.getCourse);
router.put('/courses/:id', authenticate, authorize('admin', 'developer'), requirePermission('edit_course'), writeLimiter, courses.updateCourse);
router.delete('/courses/:id', authenticate, authorize('admin', 'developer'), requirePermission('delete_course'), courses.removeCourse);
router.post('/courses/:id/thumbnail', authenticate, authorize('admin', 'developer'), requirePermission('edit_course'), imageUpload.single('thumbnail'), validateRasterImage, courses.uploadThumbnail);
router.post('/courses/:id/enroll', authenticate, authorize('student'), courses.enroll);
router.post('/courses/:id/purchase', authenticate, authorize('student'), writeLimiter, subs.courseCheckout);
router.post('/courses/:id/purchase/verify', authenticate, authorize('student'), writeLimiter, subs.courseVerify);
router.get('/courses/:id/enrollments', ...staff, requirePermission('view_student_data'), courses.courseEnrollments);

router.get('/modules', ...staff, courses.listModules);
router.post('/modules', ...staff, requirePermission('create_course'), writeLimiter, courses.createModule);
router.put('/modules/:id', ...staff, requirePermission('edit_course'), courses.updateModule);
router.delete('/modules/:id', ...staff, requirePermission('delete_course'), courses.removeModule);
router.post('/lessons', ...staff, requirePermission('create_course'), writeLimiter, courses.createLesson);
router.put('/lessons/reorder', ...staff, requirePermission('edit_course'), courses.reorderLessons);
router.get('/lessons/:id', optionalAuth, courses.getLesson);
router.put('/lessons/:id', ...staff, requirePermission('edit_course'), courses.updateLesson);
router.delete('/lessons/:id', ...staff, requirePermission('delete_course'), courses.removeLesson);

/* ------------------------------ enrollments ------------------------------ */
router.get('/enrollments/my', authenticate, courses.myEnrollments);
router.post('/enrollments/:id/progress', authenticate, authorize('student'), courses.updateProgress);

/* ----------------------------- certificates ----------------------------- */
router.get('/certificates/mine', authenticate, certs.myCertificates);
router.get('/cert/:token/print', certLimiter, certs.printView);   // public printable HTML
router.get('/cert/:token', certLimiter, certs.verify);            // public JSON verification

/* ----------------------- admin certificate management ----------------------- */
const adminCerts = require('../controllers/admin-certificates.controller');
router.get('/admin/certificates/stats', ...adminOnly, adminCerts.stats);
router.get('/admin/certificates', ...adminOnly, adminCerts.listAll);
router.delete('/admin/certificates/:id', ...adminOnly, adminCerts.revoke);
router.post('/admin/certificates/:id/reissue', ...adminOnly, adminCerts.reissue);

/* certificate design templates (admin) */
const certTpl = require('../controllers/certificate-templates.controller');
router.get('/admin/certificate-templates', ...adminOnly, certTpl.list);
router.post('/admin/certificate-templates', ...adminOnly, writeLimiter, certTpl.create);
router.post('/admin/certificate-templates/preview/:id', ...adminOnly, certTpl.preview);
router.get('/admin/certificate-templates/:id', ...adminOnly, certTpl.getOne);
router.put('/admin/certificate-templates/:id', ...adminOnly, writeLimiter, certTpl.update);
router.post('/admin/certificate-templates/:id/duplicate', ...adminOnly, writeLimiter, certTpl.duplicate);
router.post('/admin/certificate-templates/:id/default', ...adminOnly, writeLimiter, certTpl.setDefault);
router.delete('/admin/certificate-templates/:id', ...adminOnly, writeLimiter, certTpl.remove);

/* ------------------------- public information pages ------------------------- */
const sitePages = require('../controllers/pages.controller');
router.get('/pages', sitePages.listPublic);                 // footer + help index
router.get('/pages/:slug', sitePages.getPublic);            // a single public page

/* site pages (admin) */
router.get('/admin/pages', ...adminOnly, sitePages.listAdmin);
router.post('/admin/pages', ...adminOnly, writeLimiter, sitePages.createPage);
router.get('/admin/pages/:id', ...adminOnly, sitePages.getAdmin);
router.put('/admin/pages/:id', ...adminOnly, writeLimiter, sitePages.updatePage);
router.post('/admin/pages/:id/reset', ...adminOnly, writeLimiter, sitePages.resetPage);
router.delete('/admin/pages/:id', ...adminOnly, writeLimiter, sitePages.removePage);

/* ------------------------------ UPI payments ------------------------------ */
const upiPay = require('../controllers/upi.controller');
router.get('/subscriptions/upi/config', upiPay.publicConfig);
router.get('/subscriptions/upi/mine', authenticate, upiPay.mine);
router.post('/subscriptions/upi/checkout', authenticate, authorize('student', 'developer'), writeLimiter, upiPay.checkout);
router.post('/subscriptions/upi/:id/submit', authenticate, writeLimiter, upiPay.submit);

/* UPI review (admin) — declared before /:id so the literal path wins */
router.get('/admin/upi-payments/preview', ...adminOnly, upiPay.adminPreview);
router.get('/admin/upi-payments', ...adminOnly, upiPay.adminList);
router.post('/admin/upi-payments/:id/approve', ...adminOnly, writeLimiter, upiPay.approve);
router.post('/admin/upi-payments/:id/reject', ...adminOnly, writeLimiter, upiPay.reject);

/* --------------------------------- notes --------------------------------- */
router.get('/notes', optionalAuth, notes.list);
router.post('/notes', ...staff, requirePermission('upload_notes'), notesUpload.single('file'), validateNoteFile, notes.create);
router.get('/notes/:id/download', optionalAuth, notes.download);
router.get('/notes/:id', optionalAuth, notes.getOne);
router.put('/notes/:id', ...staff, requirePermission('upload_notes'), notesUpload.single('file'), validateNoteFile, notes.update);
router.delete('/notes/:id', ...staff, requirePermission('upload_notes'), notes.remove);

/* -------------------------------- quizzes -------------------------------- */
router.get('/quizzes', optionalAuth, quizzes.list);
router.post('/quizzes', ...staff, requirePermission('create_quiz'), writeLimiter, quizzes.create);
router.get('/quizzes/export', ...staff, requirePermission('create_quiz'), quizzes.exportQuizzes);
router.post('/quizzes/import', ...staff, requirePermission('create_quiz'), writeLimiter, quizzes.importQuizzes);
router.get('/quizzes/:id/export', ...staff, requirePermission('create_quiz'), quizzes.exportQuiz);
router.get('/quizzes/:id/live', ...staff, featureGate('live_quiz_enabled', 'Live quizzes'), quizzes.liveMonitor);
router.post('/quizzes/:id/start-live', ...staff, requirePermission('host_quiz'), featureGate('live_quiz_enabled', 'Live quizzes'), quizzes.startLive);
router.post('/quizzes/:id/live/start', ...staff, requirePermission('host_quiz'), featureGate('live_quiz_enabled', 'Live quizzes'), quizzes.startForAll);
router.post('/quizzes/:id/end-live', ...staff, requirePermission('host_quiz'), featureGate('live_quiz_enabled', 'Live quizzes'), quizzes.endLive);
router.get('/quizzes/:id/results', optionalAuth, quizzes.results);
// Excel leaderboard: staff only — the sheet carries e-mail addresses and
// the anti-cheat counters, which the public ranking deliberately omits.
router.get('/quizzes/:id/results.xlsx', ...staff, quizzes.resultsExcel);
router.get('/quizzes/:id/questions', ...staff, requirePermission('create_quiz'), quizzes.listQuestions);
router.post('/quizzes/:id/questions', ...staff, requirePermission('create_quiz'), writeLimiter, quizzes.createQuestion);
router.post('/quizzes/:id/unlock', authLimiter, authenticate, quizzes.unlock);
router.post('/quizzes/:id/attempts', authenticate, quizzes.startAttempt); // role checked in the controller for a clearer message
router.put('/quiz-questions/reorder', ...staff, requirePermission('create_quiz'), quizzes.reorderQuestions);
router.put('/quiz-questions/:id', ...staff, requirePermission('create_quiz'), quizzes.updateQuestion);
router.delete('/quiz-questions/:id', ...staff, requirePermission('create_quiz'), quizzes.removeQuestion);
router.get('/quizzes/:id', optionalAuth, quizzes.getOne);
router.put('/quizzes/:id', ...staff, requirePermission('create_quiz'), writeLimiter, quizzes.update);
router.delete('/quizzes/:id', ...staff, requirePermission('create_quiz'), quizzes.remove);

router.get('/quiz-attempts/my', authenticate, quizzes.myAttempts);
router.get('/quiz-attempts/:id', authenticate, quizzes.attemptDetail);
router.put('/quiz-attempts/:id/answer', authenticate, authorize('student'), quizzes.saveAnswer);
router.post('/quiz-attempts/:id/run-code', authenticate, authorize('student'), executionLimiter, quizzes.runAttemptCode);
router.post('/quiz-attempts/:id/submit', authenticate, authorize('student'), quizzes.submitAttempt);
router.put('/quiz-attempts/:id/violation', authenticate, writeLimiter, quizzes.recordViolation);
// Proctoring telemetry uses per-account budgets (see rateLimit.js): the
// per-IP write limiter starved a whole lab behind one NAT address.
router.post('/quiz-attempts/:id/proctor', authenticate, proctorEventLimiter, quizzes.recordProctorEvents);
// Evidence view for whoever is invigilating — staff only, it names the student.
router.get('/quiz-attempts/:id/proctor', ...staff, quizzes.proctorReport);
// Advanced live proctoring. Snapshot frames are memory-only; WebRTC media is
// peer-to-peer and only its signalling messages pass through the API.
router.get('/quizzes/:id/proctor-frames', ...staff, quizzes.getQuizProctorFrames);
router.post('/quiz-attempts/:id/proctor-frame', authenticate, authorize('student'), proctorFrameLimiter, quizzes.updateProctorFrame);
router.post('/quiz-attempts/:id/proctor-signal', authenticate, proctorSignalLimiter, quizzes.proctorSignal);
router.get('/quiz-attempts/:id/proctor-ice', authenticate, proctorStatusLimiter, quizzes.getProctorIceServers);
router.post('/quiz-attempts/:id/proctor-action', ...staff, writeLimiter, quizzes.proctorHostAction);
router.post('/quiz-attempts/:id/second-camera/session', authenticate, authorize('student'), writeLimiter, quizzes.createSecondCameraSession);
router.get('/quiz-attempts/:id/second-camera/status', authenticate, proctorStatusLimiter, quizzes.getSecondCameraStatus);
router.get('/proctor/second-camera/:token', certLimiter, quizzes.secondCameraInfo);
router.post('/proctor/second-camera/:token', secondCameraLimiter, quizzes.updateSecondCameraFrame);
router.post('/quiz-attempts/:id/ping', authenticate, quizzes.pingAttempt);

/* ------------------------------ coding arena ------------------------------ */
router.get('/coding/languages', coding.languages);
router.get('/coding/problems', optionalAuth, coding.listProblems);
router.post('/coding/problems', ...staff, requirePermission('create_problem'), writeLimiter, coding.createProblem);
router.get('/coding/problems/export', ...staff, requirePermission('create_problem'), coding.exportProblems);
router.post('/coding/problems/import', ...staff, requirePermission('create_problem'), writeLimiter, coding.importProblems);
router.get('/coding/problems/:id/export', ...staff, requirePermission('create_problem'), coding.exportProblem);
router.get('/coding/submissions/my', authenticate, coding.mySubmissions);
router.get('/coding/submissions', ...staff, requirePermission('view_submissions'), coding.allSubmissions);
router.get('/coding/submissions/:id', authenticate, coding.submissionDetail);
router.post('/coding/run', authenticate, executionLimiter, coding.runCode);
router.post('/coding/submit', authenticate, submitLimiter, coding.submitCode);
router.get('/coding/test-cases/:id', ...staff, requirePermission('create_problem'), coding.listTestCases);
router.post('/coding/test-cases/:id', ...staff, requirePermission('create_problem'), coding.createTestCase);
router.put('/coding/test-cases/item/:id', ...staff, requirePermission('create_problem'), coding.updateTestCase);
router.delete('/coding/test-cases/item/:id', ...staff, requirePermission('create_problem'), coding.removeTestCase);
router.get('/coding/problems/:id', optionalAuth, coding.getProblem);
router.put('/coding/problems/:id', ...staff, requirePermission('create_problem'), coding.updateProblem);
router.delete('/coding/problems/:id', ...staff, requirePermission('create_problem'), coding.removeProblem);

/* -------------------------------- contests -------------------------------- */
router.get('/contests', optionalAuth, coding.listContests);
router.post('/contests', ...staff, requirePermission('create_contest'), writeLimiter, coding.createContest);
router.get('/contests/:id/leaderboard', optionalAuth, coding.contestLeaderboard);
router.post('/contests/:id/register', authenticate, authorize('student'), coding.registerContest);
router.get('/contests/:id', optionalAuth, coding.getContest);
router.put('/contests/:id', ...staff, requirePermission('create_contest'), coding.updateContest);
router.delete('/contests/:id', ...staff, requirePermission('create_contest'), coding.removeContest);

/* ------------------------------ leaderboard ------------------------------ */
router.get('/leaderboard', optionalAuth, misc.leaderboard);
router.post('/leaderboard/refresh', ...adminOnly, misc.refreshLeaderboardNow);

/* ---------------------------- points management ---------------------------
   Admin-only: these endpoints retune the points economy and can hand out or
   take away points, so `developer` is deliberately excluded. */
router.get('/points/overview', ...adminOnly, pointsCtl.overview);
router.get('/points/rules', ...adminOnly, pointsCtl.getRules);
router.put('/points/rules', ...adminOnly, writeLimiter, pointsCtl.updateRules);
router.get('/points/users', ...adminOnly, pointsCtl.listUsers);
router.get('/points/adjustments', ...adminOnly, pointsCtl.listAdjustments);
router.post('/points/recalc', ...adminOnly, writeLimiter, pointsCtl.recalcEveryone);
router.get('/points/users/:id', ...adminOnly, pointsCtl.userDetail);
router.post('/points/users/:id/adjust', ...adminOnly, writeLimiter, pointsCtl.adjust);
router.post('/points/users/:id/recalc', ...adminOnly, writeLimiter, pointsCtl.recalcOne);
router.delete('/points/adjustments/:adjustmentId', ...adminOnly, writeLimiter, pointsCtl.revokeAdjustment);

/* ------------------------------ achievements ------------------------------ */
router.get('/achievements', optionalAuth, misc.listAchievements);
router.post('/achievements', ...adminOnly, misc.createAchievement);
router.post('/achievements/:id/award', ...adminOnly, misc.awardAchievement);
router.put('/achievements/:id', ...adminOnly, misc.updateAchievement);
router.delete('/achievements/:id', ...adminOnly, misc.removeAchievement);

/* ----------------------------- notifications ----------------------------- */
router.get('/notifications/my', authenticate, misc.myNotifications);
router.put('/notifications/read-all', authenticate, misc.markAllRead);
router.put('/notifications/:id/read', authenticate, misc.markNotificationRead);
router.get('/notifications', ...adminOnly, misc.listAllNotifications);
router.post('/notifications/broadcast', ...adminOnly, misc.broadcastNotification);
router.delete('/notifications/:id', ...adminOnly, misc.removeNotification);

/* ------------------------------ public stats ------------------------------ */
router.get('/stats/public', misc.publicStats);

/* --------------------------------- search --------------------------------- */
router.get('/search/suggestions', optionalAuth, misc.searchSuggestions);
router.get('/search', optionalAuth, misc.globalSearch);

/* --------------------------- landing page builder --------------------------- */
router.get('/landing/page', landingBuilder.publicPage);
router.get('/landing/builder', ...adminOnly, landingBuilder.editor);
router.put('/landing/builder/draft', ...adminOnly, landingBuilder.saveDraft);
router.post('/landing/builder/publish', ...adminOnly, landingBuilder.publish);
router.post('/landing/builder/revert', ...adminOnly, landingBuilder.revertDraft);
router.get('/landing/builder/revisions', ...adminOnly, landingBuilder.listRevisions);
router.post('/landing/builder/revisions/:id/restore', ...adminOnly, landingBuilder.restoreRevision);
router.get('/landing/media', ...adminOnly, landingBuilder.listMedia);
router.post('/landing/media', ...adminOnly, landingMediaUpload.single('image'), landingBuilder.uploadMedia);
router.put('/landing/media/:id', ...adminOnly, landingBuilder.updateMedia);
router.delete('/landing/media/:id', ...adminOnly, landingBuilder.removeMedia);

/* --------------------------------- settings --------------------------------- */
router.get('/settings/public', misc.getPublicSettings);
router.get('/settings', ...adminOnly, misc.getAllSettings);
router.put('/settings', ...adminOnly, misc.updateSettings);
/* Anti-cheat only. requirePermission lets admins straight through and checks
   `manage_anticheat` for developers, so one route serves both. */
router.get('/settings/anti-cheat', authenticate, requirePermission('manage_anticheat'), misc.getAntiCheatSettings);
router.put('/settings/anti-cheat', authenticate, requirePermission('manage_anticheat'), writeLimiter, misc.updateAntiCheatSettings);
router.post('/settings/banner', ...adminOnly, bannerUpload.single('banner'), misc.uploadLandingBanner);
router.delete('/settings/banner', ...adminOnly, misc.removeLandingBanner);

/* --------------------------------- reports --------------------------------- */
router.get('/reports', ...adminOnly, misc.listReports);
router.post('/reports/generate', ...adminOnly, misc.generateReport);

/* -------------------------------- dashboards -------------------------------- */
router.get('/dashboard', ...adminOnly, misc.dashboard);
router.get('/dashboard/student', authenticate, authorize('student'), misc.studentDashboard);
router.get('/dashboard/developer', ...staff, misc.developerDashboard);

/* ----------------------------- AI content generator ----------------------------- */
const ai = require('../controllers/ai.controller');
router.get('/ai/status', ...adminOnly, ai.status);
router.post('/ai/generate', ...adminOnly, writeLimiter, ai.generate);
router.post('/ai/save/course', ...adminOnly, writeLimiter, ai.saveCourse);
router.post('/ai/save/quiz',   ...adminOnly, writeLimiter, ai.saveQuiz);
router.post('/ai/save/problem',...adminOnly, writeLimiter, ai.saveProblem);

/* --------------------- community & engagement (Feature Pack v2) --------------------- */
const community = require('../controllers/community.controller');
// gamification — streak, XP level & heatmap
router.get('/gamification/me', authenticate, community.myGamification);
router.get('/gamification/levels', community.levelTable);
// problem of the day
router.get('/coding/problem-of-day', optionalAuth, community.problemOfDay);
// hint unlocks (costs points)
router.post('/coding/problems/:id/unlock-hint', authenticate, writeLimiter, community.unlockHint);
// course reviews
router.get('/courses/:id/reviews', optionalAuth, community.listReviews);
router.post('/courses/:id/reviews', authenticate, authorize('student', 'developer', 'admin'), writeLimiter, community.upsertReview);
router.delete('/reviews/:id', authenticate, community.removeReview);
// discussions (Q&A on problems & courses)
router.get('/discussions', optionalAuth, community.listDiscussions);
router.post('/discussions', authenticate, writeLimiter, community.createDiscussion);
router.get('/discussions/:id', optionalAuth, community.discussionReplies);
router.post('/discussions/:id/replies', authenticate, writeLimiter, community.addReply);

/* --------------------- plagiarism / similarity check --------------------- */
const plagiarism = require('../controllers/plagiarism.controller');
router.get('/plagiarism/problems', ...staff, requirePermission('view_submissions'), plagiarism.listCheckable);
router.get('/plagiarism/check/:id', ...staff, requirePermission('view_submissions'), plagiarism.checkProblem);

/* --------------------- realtime events (Server-Sent Events) --------------------- */
const events = require('../services/events.service');
router.get('/events/stream', authenticate, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  events.subscribe(req.user, res);
});

module.exports = router;
