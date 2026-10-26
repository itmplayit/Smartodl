import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtNum, fmtDate, timeAgo, countdown, clock, fmtBytes, toList, initials, statusLabel } from '../src/utils/format.js';

test('fmtNum uses Indian digit grouping and tolerates junk', () => {
  assert.equal(fmtNum(100000), '1,00,000');
  assert.equal(fmtNum(0), '0');
  assert.equal(fmtNum(null), '0');
  assert.equal(fmtNum('2500'), '2,500');
});

test('fmtDate renders a date and dashes invalid input', () => {
  assert.equal(fmtDate('2026-01-05'), '05 Jan 2026');
  assert.equal(fmtDate(null), '—');
  assert.equal(fmtDate('not-a-date'), '—');
});

test('timeAgo buckets recent times', () => {
  const now = Date.now();
  assert.equal(timeAgo(now - 10 * 1000), 'just now');
  assert.equal(timeAgo(now - 5 * 60 * 1000), '5m ago');
  assert.equal(timeAgo(now - 3 * 3600 * 1000), '3h ago');
  assert.equal(timeAgo(now - 2 * 86400 * 1000), '2d ago');
  assert.equal(timeAgo(null), '—');
});

test('countdown/clock split remaining seconds correctly', () => {
  const target = Date.now() + (2 * 3600 + 3 * 60 + 4) * 1000;
  const c = countdown(target);
  assert.equal(c.h, 2);
  assert.equal(c.m, 3);
  assert.equal(c.ended, false);
  assert.equal(countdown(null).ended, true);
  assert.equal(clock(65), '01:05');
  assert.equal(clock(3661), '01:01:01');
  assert.equal(clock(null), '--:--');
  assert.equal(clock(-5), '00:00');
});

test('fmtBytes scales units', () => {
  assert.equal(fmtBytes(512), '512 B');
  assert.equal(fmtBytes(2048), '2 KB');
  assert.equal(fmtBytes(2.5 * 1024 * 1024), '2.5 MB');
  assert.equal(fmtBytes(0), '—');
});

test('toList normalises arrays, JSON strings and CSV', () => {
  assert.deepEqual(toList(['a', null, 'b']), ['a', 'b']);
  assert.deepEqual(toList('["a","b"]'), ['a', 'b']);
  assert.deepEqual(toList('a, b ,c'), ['a', 'b', 'c']);
  assert.deepEqual(toList(''), []);
  assert.deepEqual(toList(null), []);
  assert.deepEqual(toList(42), [42]);
});

test('initials and statusLabel are display-safe', () => {
  assert.equal(initials('Ada Lovelace'), 'AL');
  assert.equal(initials('Prince'), 'P');
  assert.equal(initials(''), '?');
  assert.equal(statusLabel('pending_review'), 'Pending Review');
});
