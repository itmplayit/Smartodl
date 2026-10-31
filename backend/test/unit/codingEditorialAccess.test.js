'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mayViewCodingEditorial } = require('../../utils/codingEditorialAccess');

const now = Date.parse('2026-10-26T12:00:00Z');

test('problem managers and students who solved the problem may view editorials', () => {
  assert.equal(mayViewCodingEditorial({ canManage: true }, now), true);
  assert.equal(mayViewCodingEditorial({ solved: true }, now), true);
});

test('unsolved students cannot read editorial for ordinary published problems', () => {
  assert.equal(mayViewCodingEditorial({ contests: [] }, now), false);
});

test('editorial stays hidden while a linked contest is scheduled or live', () => {
  assert.equal(mayViewCodingEditorial({ contests: [
    { status: 'scheduled', end_at: '2026-10-27T12:00:00Z' },
  ] }, now), false);
  assert.equal(mayViewCodingEditorial({ contests: [
    { status: 'live', end_at: '2026-10-26T13:00:00Z' },
  ] }, now), false);
});

test('editorial unlocks after all linked contests end or are cancelled', () => {
  assert.equal(mayViewCodingEditorial({ contests: [
    { status: 'completed', end_at: null },
    { status: 'live', end_at: '2026-10-26T11:59:59Z' },
  ] }, now), true);
  assert.equal(mayViewCodingEditorial({ contests: [
    { status: 'cancelled', end_at: '2026-10-27T12:00:00Z' },
  ] }, now), true);
});

test('missing or invalid contest end time fails closed', () => {
  assert.equal(mayViewCodingEditorial({ contests: [
    { status: 'live', end_at: null },
  ] }, now), false);
  assert.equal(mayViewCodingEditorial({ contests: [
    { status: 'published', end_at: 'invalid' },
  ] }, now), false);
});
