'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const proctor = require('../../services/proctoring.service');

test('student-reportable events can never mint host/server attestations', () => {
  const client = proctor.eventsForSource('client');
  assert.equal(client.has('identity_verified'), false);
  assert.equal(client.has('host_warning_sent'), false);
  assert.equal(client.has('second_camera_connected'), false);
  assert.equal(client.has('room_scan_missing'), false);
  assert.equal(client.has('identity_check_missing'), false);
  assert.equal(client.has('camera_never_started'), false);
  // Genuine browser observations remain reportable.
  assert.equal(client.has('camera_off'), true);
  assert.equal(client.has('room_scan_completed'), true);
  assert.equal(client.has('identity_check_completed'), true);

  assert.deepEqual([...proctor.eventsForSource('host')].sort(), ['host_warning_sent', 'identity_verified']);
  assert.equal(proctor.eventsForSource('server').has('second_camera_connected'), true);
  assert.equal(proctor.eventsForSource('server').has('camera_off'), false);
});

test('body detections are advisory and never feed the violation total', () => {
  assert.equal(proctor.EVENTS.body_missing.weight, 0);
  assert.equal(proctor.EVENTS.multiple_people.weight, 0);
  assert.ok(proctor.ADVISORY_FLAG_EVENTS.includes('body_missing'));
  assert.ok(proctor.ADVISORY_FLAG_EVENTS.includes('multiple_people'));
});

test('a non-live attempt snapshots an all-off proctor policy', () => {
  const policy = proctor.buildProctorPolicy({
    live: false,
    creatorCamera: true,
    creatorScreen: true,
    advanced: { master: true, snapshot: true, secondCamera: true, roomScan: true, identity: true },
  });
  assert.equal(policy.live, false);
  assert.equal(policy.camera_required, false);
  assert.equal(policy.screen_required, false);
  assert.equal(policy.advanced.snapshot, false);
  assert.equal(policy.advanced.second_camera, false);
});

test('live policy forces only the sensors its enabled checks need', () => {
  const micOnly = proctor.buildProctorPolicy({
    live: true,
    advanced: { master: true, mic: true },
  });
  assert.equal(micOnly.camera_required, false);
  assert.equal(micOnly.screen_required, false);
  assert.equal(micOnly.advanced.mic, true);

  const snapshot = proctor.buildProctorPolicy({
    live: true,
    advanced: { master: true, snapshot: true },
  });
  assert.equal(snapshot.camera_required, true);
  assert.equal(snapshot.screen_required, true);
});

test('effective policy is frozen ∩ current: mid-exam ON never activates, OFF stops', () => {
  const frozen = proctor.buildProctorPolicy({
    live: true,
    advanced: { master: true, body: true },
  });
  const turnedOnLater = proctor.effectiveAdvancedPolicy(frozen, {
    master: true, body: true, snapshot: true, webrtc: true, secondCamera: true,
  });
  assert.equal(turnedOnLater.body, true);
  assert.equal(turnedOnLater.snapshot, false);
  assert.equal(turnedOnLater.webrtc, false);
  assert.equal(turnedOnLater.second_camera, false);

  const turnedOffLater = proctor.effectiveAdvancedPolicy(frozen, { master: false, body: true });
  assert.equal(turnedOffLater.body, false);
  assert.equal(turnedOffLater.master, false);

  // No snapshot at all → nothing advanced may run for that attempt.
  const noPolicy = proctor.effectiveAdvancedPolicy(null, { master: true, snapshot: true });
  assert.equal(noPolicy.snapshot, false);
});

test('policy parsing tolerates stored JSON and rejects junk', () => {
  const built = proctor.buildProctorPolicy({ live: true, creatorCamera: true, advanced: { master: true } });
  const parsed = proctor.parseProctorPolicy(JSON.stringify(built));
  assert.equal(parsed.camera_required, true);
  assert.equal(proctor.parseProctorPolicy('not json'), null);
  assert.equal(proctor.parseProctorPolicy(''), null);
  assert.equal(proctor.parseProctorPolicy(null), null);
});

test('flag joining never slices a flag in half and keeps the newest', () => {
  const flags = Array.from({ length: 40 }, (_, i) => `flag_${String(i).padStart(2, '0')}_abcdef`);
  const joined = proctor.joinFlags(flags);
  assert.ok(joined.length <= 255);
  assert.ok(joined.endsWith(flags[flags.length - 1]));
  joined.split(',').forEach((flag) => assert.ok(flags.includes(flag)));
});
