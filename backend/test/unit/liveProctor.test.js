'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const live = require('../../services/liveProctor.service');

const JPEG = `data:image/jpeg;base64,${Buffer.from('frame').toString('base64')}`;

test('live proctor frames are validated, grouped by quiz and expire from memory', () => {
  live._resetForTests();
  const now = Date.now();
  const attempt = { id: 42, quiz_id: 7, user_id: 9 };

  assert.equal(live.validateFrame('camera', JPEG), JPEG);
  assert.equal(live.validateFrame('camera', 'data:text/html;base64,PHNjcmlwdD4='), null);
  assert.equal(live.validateFrame('recording', JPEG), null);

  assert.ok(live.putFrame(attempt, 'camera', JPEG, now));
  assert.equal(live.framesForQuiz(7, now)['42'].camera.image, JPEG);
  assert.equal(live.framesForQuiz(8, now)['42'], undefined);
  assert.equal(live.getFrames(42, now + 46 * 1000), null);
});

test('frame freshness is per feed: a live screen cannot resurrect a dead camera', () => {
  live._resetForTests();
  const now = Date.now();
  const attempt = { id: 43, quiz_id: 7, user_id: 9 };

  live.putFrame(attempt, 'camera', JPEG, now);
  live.putFrame(attempt, 'screen', JPEG, now + 40 * 1000);
  live.putFrame(attempt, 'screen', JPEG, now + 80 * 1000);

  const frames = live.framesForQuiz(7, now + 80 * 1000)['43'];
  assert.equal(frames.camera, null, '80s-old camera frame must be gone');
  assert.equal(frames.screen.image, JPEG);
  assert.equal(live.stats(now + 80 * 1000).frame_bytes, JPEG.length);

  // Incremental polling: nothing newer than the last poll is re-sent.
  const incremental = live.framesForQuiz(7, now + 81 * 1000, { since: now + 80 * 1000 });
  assert.equal(incremental['43'], undefined);
  live.putFrame(attempt, 'camera', JPEG, now + 82 * 1000);
  const delta = live.framesForQuiz(7, now + 82 * 1000, { since: now + 80 * 1000 })['43'];
  assert.equal(delta.camera.image, JPEG);
  assert.equal(delta.screen, null, 'unchanged screen frame is not re-sent');
});

test('second-camera pairing is attempt-bound and reports connection freshness', () => {
  live._resetForTests();
  const now = Date.now();
  const attempt = { id: 100, quiz_id: 5, user_id: 8 };
  const first = live.createSecondCameraSession(attempt, now);
  const second = live.createSecondCameraSession(attempt, now + 1000);

  assert.equal(second.token, first.token);
  assert.equal(first.connected, false);
  assert.ok(live.putSecondCameraFrame(first.token, JPEG, now + 2000));
  assert.equal(live.secondCameraStatus(100, now + 3000).connected, true);
  assert.equal(live.secondCameraStatus(100, now + 40 * 1000).connected, false);
  assert.equal(live.secondCameraStatus(100, now + 40 * 1000).ever_connected, true);

  // Rotating the pairing code kills the old token immediately.
  const rotated = live.createSecondCameraSession(attempt, now + 50 * 1000, { rotate: true });
  assert.notEqual(rotated.token, first.token);
  assert.equal(live.getSecondCameraSession(first.token, now + 50 * 1000), null);
  assert.ok(live.getSecondCameraSession(rotated.token, now + 50 * 1000));
});

test('WebRTC viewer sessions route only to their registered host', () => {
  live._resetForTests();
  const now = Date.now();
  live.registerViewer('host-session-123', 77, 5, now);
  assert.equal(live.viewerFor('host-session-123', now).hostUserId, 77);
  live.forgetViewer('host-session-123', 78);
  assert.ok(live.viewerFor('host-session-123', now));
  live.forgetViewer('host-session-123', 77);
  assert.equal(live.viewerFor('host-session-123', now), null);
});

test('one peer bye retires only that attempt; a session cannot be hijacked', () => {
  live._resetForTests();
  const now = Date.now();
  live.registerViewer('host-grid-1', 77, 5, now, 1001);
  live.registerViewer('host-grid-1', 77, 5, now, 1002);

  // Another host (or another quiz) reusing the id must not steal routing.
  assert.equal(live.registerViewer('host-grid-1', 88, 5, now, 1003), null);
  assert.equal(live.registerViewer('host-grid-1', 77, 9, now, 1003), null);
  assert.equal(live.viewerFor('host-grid-1', now).hostUserId, 77);

  live.forgetViewer('host-grid-1', 77, 1001);
  const viewer = live.viewerFor('host-grid-1', now);
  assert.ok(viewer, 'session survives while other attempts remain');
  assert.equal(live.viewerAllowsAttempt(viewer, 1001), false);
  assert.equal(live.viewerAllowsAttempt(viewer, 1002), true);

  live.forgetViewer('host-grid-1', 77, 1002);
  assert.equal(live.viewerFor('host-grid-1', now), null);
});
