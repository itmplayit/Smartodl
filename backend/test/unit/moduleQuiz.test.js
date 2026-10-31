'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-module-quiz';

const moduleQuiz = require('../../services/moduleQuiz.service');
const policy = require('../../utils/completionPolicy');

test('a module quiz is chosen over the course-level quiz for its own module', () => {
  assert.equal(policy.requiredQuizForModule({ moduleQuizId: 9, courseQuizIds: [4] }), 9);
  assert.equal(policy.requiredQuizForModule({ moduleQuizId: null, courseQuizIds: [4] }), 4);
  assert.equal(policy.requiredQuizForModule({}), null);
  assert.equal(policy.requiredQuizForModule({ moduleQuizId: 'abc', courseQuizIds: [] }), null);
});

test('the module anti-cheat floor turns on the four checks and leaves the camera off', () => {
  const creatorSettings = {
    tab_guard_enabled: false, quiz_lockdown_enabled: false, quiz_cp_block: false,
    screenshot_block_enabled: false, proctor_camera_enabled: true, proctor_screen_enabled: true,
  };
  const floor = {
    tab_guard_enabled: true, quiz_lockdown_enabled: true, quiz_cp_block: true, screenshot_block_enabled: true,
    proctor_camera_enabled: false, proctor_screen_enabled: false,
  };
  const merged = moduleQuiz.applyAntiCheatFloor(creatorSettings, floor);
  assert.equal(merged.tab_guard_enabled, true);
  assert.equal(merged.quiz_lockdown_enabled, true);
  assert.equal(merged.quiz_cp_block, true);
  assert.equal(merged.screenshot_block_enabled, true);
  // The point of the whole feature: no webcam, no screen share.
  assert.equal(merged.proctor_camera_enabled, false);
  assert.equal(merged.proctor_screen_enabled, false);
});

test('without a floor the creator settings are untouched', () => {
  const creatorSettings = { tab_guard_enabled: false, proctor_camera_enabled: false };
  assert.deepEqual(moduleQuiz.applyAntiCheatFloor(creatorSettings, null), creatorSettings);
});

test('the flag names are stable (Feature Control reads them by key)', () => {
  assert.equal(moduleQuiz.FLAG_MODULE_QUIZZES, 'module_quizzes_enabled');
  assert.equal(moduleQuiz.FLAG_MODULE_ANTICHEAT, 'module_quiz_anticheat_enabled');
});

test('module quiz + watch policy still demands both halves', () => {
  const blocked = policy.evaluateCompletion({
    policy: 'watch_and_quiz', hasMeasurableVideo: true, coveragePercent: 30, quizPassed: true,
  });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /30%/);

  const quizOnly = policy.evaluateCompletion({
    policy: 'watch_and_quiz', hasMeasurableVideo: true, coveragePercent: 95, quizPassed: false,
  });
  assert.equal(quizOnly.allowed, false);
  assert.match(quizOnly.reason, /quiz/i);

  const both = policy.evaluateCompletion({
    policy: 'watch_and_quiz', hasMeasurableVideo: true, coveragePercent: 95, quizPassed: true,
  });
  assert.equal(both.allowed, true);
});

test('the blocked-completion message names the module quiz, not a generic course quiz', () => {
  const verdict = policy.evaluateCompletion({
    policy: 'quiz',
    quizPassed: false,
    quizLabel: 'Is module ka quiz (“Module 1 Check”)',
  });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /module ka quiz/i);
  assert.match(verdict.reason, /Module 1 Check/);
  // …and the old generic wording still comes out when no module quiz applies.
  const courseLevel = policy.evaluateCompletion({ policy: 'quiz', quizPassed: false });
  assert.match(courseLevel.reason, /Course assessments/);
});

test('anti-cheat flags come out as real booleans, counts stay numbers', () => {
  const normalised = moduleQuiz.normaliseFlags({
    tab_guard_enabled: '1', quiz_lockdown_enabled: '0', quiz_cp_block: 'true',
    screenshot_block_enabled: false, exam_safe_mode: 'on', proctor_camera_enabled: '0',
    tab_guard_max_violations: '3', proctor_max_violations: 1,
  });
  assert.equal(normalised.tab_guard_enabled, true);
  assert.equal(normalised.quiz_lockdown_enabled, false);
  assert.equal(normalised.quiz_cp_block, true);
  assert.equal(normalised.screenshot_block_enabled, false);
  assert.equal(normalised.exam_safe_mode, true);
  assert.equal(normalised.proctor_camera_enabled, false);
  // A count of 1 must never become `true`.
  assert.equal(normalised.proctor_max_violations, 1);
  assert.equal(typeof normalised.tab_guard_max_violations, 'string');
});

test('expired attempts are settled after the deadline + grace, and never while fresh', () => {
  const attempts = require('../../services/quizAttempts.service');
  const now = Date.UTC(2026, 9, 28, 12, 0, 0);
  const minutesAgo = (m) => new Date(now - m * 60000);

  // 10-minute quiz started 15 minutes ago → still inside limit + 30 min grace.
  assert.equal(attempts.isExpiredAttempt({ started_at: minutesAgo(15), time_limit_minutes: 10 }, now), false);
  // …started 3 hours ago → settled.
  assert.equal(attempts.isExpiredAttempt({ started_at: minutesAgo(180), time_limit_minutes: 10 }, now), true);
  // No time limit at all: only a full day of silence counts.
  assert.equal(attempts.isExpiredAttempt({ started_at: minutesAgo(180), time_limit_minutes: 0 }, now), false);
  assert.equal(attempts.isExpiredAttempt({ started_at: minutesAgo(60 * 25), time_limit_minutes: null }, now), true);
  // Recent activity keeps an untimed attempt alive.
  assert.equal(attempts.isExpiredAttempt({
    started_at: minutesAgo(60 * 30), last_seen_at: minutesAgo(5), time_limit_minutes: 0,
  }, now), false);
});

/* ------------------- live features on normal / practice quizzes ------------------- */
const supervision = require('../../services/quizSupervision.service');

test('normal + practice quizzes get the live anti-cheat floor', () => {
  const creator = {
    tab_guard_enabled: false, quiz_lockdown_enabled: false, quiz_cp_block: false,
    screenshot_block_enabled: false, exam_safe_mode: false,
  };
  for (const quiz_type of ['normal', 'practice']) {
    const out = supervision.resolveAntiCheat({ quiz_type, module_id: null }, creator, { supervision: true });
    assert.equal(out.tab_guard_enabled, true, quiz_type);
    assert.equal(out.quiz_lockdown_enabled, true, quiz_type);
    assert.equal(out.quiz_cp_block, true, quiz_type);
    assert.equal(out.screenshot_block_enabled, true, quiz_type);
    assert.equal(out.exam_safe_mode, true, quiz_type);
    assert.equal(out.enforced, true, quiz_type);
    // Privacy default: a non-live quiz never asks for a camera.
    assert.equal(out.proctor_camera_enabled, false, quiz_type);
    assert.equal(out.camera_allowed, false, quiz_type);
  }
});

test('the supervision switch OFF hands control back to the creator', () => {
  const out = supervision.resolveAntiCheat(
    { quiz_type: 'normal' }, { tab_guard_enabled: false, quiz_lockdown_enabled: false }, { supervision: false },
  );
  assert.equal(out.tab_guard_enabled, false);
  assert.equal(out.enforced, false);
});

test('live quizzes are untouched by the supervision layer', () => {
  const out = supervision.resolveAntiCheat(
    { quiz_type: 'live' }, { tab_guard_enabled: true, quiz_cp_block: false }, { supervision: true },
  );
  assert.equal(out.quiz_scope, 'live');
  assert.equal(out.enforced, false);
  assert.equal(out.quiz_cp_block, false); // creator's choice survives
});

test('camera on a non-live quiz needs the admin proctoring switch', () => {
  const creator = { proctor_camera_enabled: true, proctor_screen_enabled: true };
  const off = supervision.resolveAntiCheat({ quiz_type: 'normal' }, creator, { supervision: true, proctoring: false });
  assert.equal(off.proctor_camera_enabled, false);
  assert.equal(off.camera_allowed, false);

  const on = supervision.resolveAntiCheat({ quiz_type: 'normal' }, creator, { supervision: true, proctoring: true });
  assert.equal(on.proctor_camera_enabled, true);
  assert.equal(on.camera_allowed, true);
});

test('a module quiz still never gets a camera, even with proctoring on', () => {
  const out = supervision.resolveAntiCheat(
    { quiz_type: 'normal', module_id: 7 }, { proctor_camera_enabled: true },
    { supervision: true, proctoring: true },
  );
  assert.equal(out.proctor_camera_enabled, false);
  assert.equal(out.proctor_screen_enabled, false);
  assert.equal(out.module_quiz, true);
});

test('rules: live forces both, others opt in', () => {
  assert.deepEqual(supervision.rulesFor({ quiz_type: 'live' }), { require_all_viewed: true, individualized_order: true });
  assert.deepEqual(supervision.rulesFor({ quiz_type: 'normal', require_all_viewed: 1, individualized_order: 0 }),
    { require_all_viewed: true, individualized_order: false });
  assert.deepEqual(supervision.rulesFor({ quiz_type: 'practice' }), { require_all_viewed: false, individualized_order: false });
});
