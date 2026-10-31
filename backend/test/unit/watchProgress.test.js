'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const watch = require('../../utils/watchProgress');
const policy = require('../../utils/completionPolicy');

test('a paused player proves nothing was watched', () => {
  const buckets = watch.bucketsForHeartbeat({
    position: 120, duration: 600, playing: false, rate: 1, previousPosition: 110, elapsedMs: 10000,
  });
  assert.deepEqual(buckets, []);
});

test('continuous playback covers every slice it moved through', () => {
  const buckets = watch.bucketsForHeartbeat({
    position: 30, duration: 600, playing: true, rate: 1, previousPosition: 0, elapsedMs: 30500,
  });
  // 0s,10s,20s,30s → buckets 0..3
  assert.deepEqual(buckets, [0, 1, 2, 3]);
});

test('jumping to the end covers one slice, not the whole video', () => {
  const jumped = watch.bucketsForHeartbeat({
    position: 590, duration: 600, playing: true, rate: 1, previousPosition: 5, elapsedMs: 8000,
  });
  assert.deepEqual(jumped, [59]);
  const coverage = watch.coveragePercent(jumped.length, 600);
  assert.ok(coverage < 5, `expected small coverage, got ${coverage}`);
  assert.equal(watch.isCoverageComplete(jumped.length, 600), false);
});

test('buffering longer than expected does not look like cheating', () => {
  // 18s of playback in 25s of wall clock (buffering) must still count the slices
  const buckets = watch.bucketsForHeartbeat({
    position: 20, duration: 600, playing: true, rate: 1, previousPosition: 2, elapsedMs: 25000,
  });
  assert.ok(buckets.length >= 3);
});

test('2x playback counts, 10x fast-forward does not', () => {
  const double = watch.bucketsForHeartbeat({
    position: 40, duration: 600, playing: true, rate: 2, previousPosition: 20, elapsedMs: 10000,
  });
  assert.ok(double.length >= 3, '2x for 10s covers ~20s of video');
  const cheat = watch.bucketsForHeartbeat({
    position: 400, duration: 600, playing: true, rate: 10, previousPosition: 20, elapsedMs: 10000,
  });
  assert.equal(cheat.length, 1, 'a 380s jump in 10s is a seek, not playback');
});

test('90% coverage is required to be complete', () => {
  const duration = 600; // 60 slices
  assert.equal(watch.totalBuckets(duration), 60);
  assert.equal(watch.isCoverageComplete(53, duration), false); // 88.3%
  assert.equal(watch.isCoverageComplete(54, duration), true); // 90%
  assert.equal(watch.isCoverageComplete(60, duration), true);
  assert.equal(watch.coveragePercent(30, duration), 50);
});

test('a nonsense duration is refused instead of graded against', () => {
  assert.equal(watch.durationIsUsable(1), false, 'a 1-second "video" would make 90% trivial');
  assert.equal(watch.durationIsUsable(0), false);
  assert.equal(watch.durationIsUsable(7 * 60 * 60), false);
  assert.equal(watch.durationIsUsable(600), true);
  assert.deepEqual(watch.bucketsForHeartbeat({ position: 5, duration: 1, playing: true }), []);
  // the first sane duration wins; a later short claim cannot shrink it
  assert.equal(watch.canonicalDuration(600, 5), 600);
  assert.equal(watch.canonicalDuration(0, 600), 600);
  assert.equal(watch.canonicalDuration(0, 0), 0);
});

test('heartbeat numbers are clamped to something sane', () => {
  assert.deepEqual(watch.normaliseHeartbeat({ position: -5, duration: 999999999, playing: 'true', rate: 99 }), {
    position: 0, duration: 6 * 60 * 60, playing: true, rate: 4,
  });
  assert.equal(watch.normaliseHeartbeat({}).playing, false);
  assert.equal(watch.normaliseHeartbeat({ rate: 'abc' }).rate, 1);
});

test('default policy is the old behaviour, so nothing changes silently', () => {
  assert.equal(policy.normalisePolicy(undefined), 'click');
  assert.equal(policy.normalisePolicy('nonsense'), 'click');
  assert.equal(policy.normalisePolicy('WATCH_AND_QUIZ'), 'watch_and_quiz');
  assert.equal(policy.evaluateCompletion({ policy: 'click' }).allowed, true);
});

test('watch policy blocks a half-watched video with a clear reason', () => {
  const blocked = policy.evaluateCompletion({
    policy: 'watch', hasMeasurableVideo: true, coveragePercent: 45,
  });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /45%/);
  assert.match(blocked.reason, /90%/);
  assert.equal(blocked.checks.watch_ok, false);

  const ok = policy.evaluateCompletion({ policy: 'watch', hasMeasurableVideo: true, coveragePercent: 92 });
  assert.equal(ok.allowed, true);
});

test('a lesson without measurable video never demands watch coverage', () => {
  // no upload, or an external YouTube embed we cannot measure
  const noVideo = policy.evaluateCompletion({ policy: 'watch', hasMeasurableVideo: false, coveragePercent: 0 });
  assert.equal(noVideo.allowed, true);
  assert.equal(noVideo.checks.watch_required, false);
  assert.equal(noVideo.checks.measurement_available, false);

  // but the quiz half still applies under watch_and_quiz
  const combo = policy.evaluateCompletion({
    policy: 'watch_and_quiz', hasMeasurableVideo: false, coveragePercent: 0, quizPassed: false,
  });
  assert.equal(combo.allowed, false);
  assert.match(combo.reason, /quiz/i);
  assert.equal(combo.checks.watch_required, false);
});

test('quiz policy needs a passed quiz, not just an attempt', () => {
  assert.equal(policy.evaluateCompletion({ policy: 'quiz', quizPassed: false }).allowed, false);
  assert.equal(policy.evaluateCompletion({ policy: 'quiz', quizPassed: true }).allowed, true);
  assert.equal(policy.evaluateCompletion({
    policy: 'watch_and_quiz', hasMeasurableVideo: true, coveragePercent: 95, quizPassed: true,
  }).allowed, true);
});

test('the reason text never threatens or accuses the learner', () => {
  const blocked = policy.evaluateCompletion({ policy: 'watch', hasMeasurableVideo: true, coveragePercent: 10 });
  assert.equal(/cheat|fraud|misconduct|punish|penalty/i.test(blocked.reason), false);
  assert.match(policy.POLICY_LABELS.watch, /90%/);
});
