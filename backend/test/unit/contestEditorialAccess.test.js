'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mayViewContestEditorial } = require('../../utils/contestEditorialAccess');

const now = Date.parse('2026-10-26T12:00:00Z');
const liveContest = { status: 'live', created_by: 8, end_at: '2026-10-26T13:00:00Z' };

test('contest editorial stays private until contest end for public users', () => {
  assert.equal(mayViewContestEditorial(null, liveContest, now), false);
  assert.equal(mayViewContestEditorial({ id: 4, role: 'student' }, liveContest, now), false);
  assert.equal(mayViewContestEditorial({ id: 9, role: 'developer' }, liveContest, now), false);
});

test('contest managers may view their editorial before the contest ends', () => {
  assert.equal(mayViewContestEditorial({ id: 1, role: 'owner' }, liveContest, now), true);
  assert.equal(mayViewContestEditorial({ id: 2, role: 'admin' }, liveContest, now), true);
  assert.equal(mayViewContestEditorial({ id: 8, role: 'developer' }, liveContest, now), true);
});

test('editorial becomes public after completion or scheduled end time', () => {
  assert.equal(mayViewContestEditorial(null, { status: 'completed' }, now), true);
  assert.equal(mayViewContestEditorial(null, {
    status: 'live', end_at: '2026-10-26T11:59:59Z',
  }, now), true);
});

test('missing or invalid end time does not expose an unfinished editorial', () => {
  assert.equal(mayViewContestEditorial(null, { status: 'scheduled' }, now), false);
  assert.equal(mayViewContestEditorial(null, {
    status: 'live', end_at: 'not-a-date',
  }, now), false);
});
