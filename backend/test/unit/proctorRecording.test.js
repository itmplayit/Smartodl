'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const recording = require('../../services/proctorRecording.service');
const { CRITICAL_TABLES } = require('../../services/migrations.service');

test('recording sessions require a random UUID session identifier', () => {
  assert.equal(recording.uuid('d9428888-122b-4fa3-9f12-98b97f33c1a1'), true);
  assert.equal(recording.uuid('../private.webm'), false);
  assert.equal(recording.uuid(''), false);
  assert.equal(recording.uuid('00000000-0000-0000-0000-000000000000'), false);
});

test('recordings use bounded chunk/session limits and critical schema verification', () => {
  assert.equal(recording.MAX_CHUNK_BYTES, 8 * 1024 * 1024);
  assert.equal(recording.MAX_SESSION_BYTES, 2 * 1024 * 1024 * 1024);
  assert.ok(CRITICAL_TABLES.includes('proctor_recording_sessions'));
  assert.ok(CRITICAL_TABLES.includes('proctor_recording_files'));
});

test('recording storage accepts the two browser containers and rejects non-video types', () => {
  assert.equal(recording.normalizeRecordingMime('video/webm;codecs=vp8,opus'), 'video/webm');
  assert.equal(recording.normalizeRecordingMime('video/mp4;codecs=avc1.42E01E'), 'video/mp4');
  assert.equal(recording.normalizeRecordingMime('application/octet-stream'), null);
  assert.equal(recording.normalizeRecordingMime('audio/webm'), null);
});

test('only two uploaded feeds count as completed; partial captures stay reviewable as interrupted', () => {
  assert.equal(recording.finalRecordingStatus({ totalBytes: 2000, cameraBytes: 1000, screenBytes: 1000 }), 'completed');
  assert.equal(recording.finalRecordingStatus({ totalBytes: 1000, cameraBytes: 1000, screenBytes: 0 }), 'interrupted');
  assert.equal(recording.finalRecordingStatus({ totalBytes: 0, cameraBytes: 0, screenBytes: 0 }), 'failed');
  assert.equal(recording.finalRecordingStatus({ interrupted: true, totalBytes: 2000, cameraBytes: 1000, screenBytes: 1000 }), 'interrupted');
});
