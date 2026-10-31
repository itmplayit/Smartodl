'use strict';
/**
 * The "mark complete" dwell rule (services/lessonOpens.service.js#dwellVerdict).
 *
 * This is the rule behind the 400s a student actually sees, so it is tested
 * directly rather than only through a controller that needs a database:
 *   • no stamp            → "Open the lesson and read it before marking it complete."
 *   • stamp too fresh     → "…about Ns"
 *   • setting = 0         → gate disabled
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { dwellVerdict } = require('../../services/lessonOpens.service');

const T0 = 1_700_000_000_000;
const DWELL = 15_000;

test('never opened → blocked with reason not-opened', () => {
  const v = dwellVerdict({ openedAt: null, dwellMs: DWELL, now: T0 });
  assert.equal(v.allowed, false);
  assert.equal(v.reason, 'not-opened');
});

test('opened 3s ago → blocked, and the remaining wait is 12s', () => {
  const v = dwellVerdict({ openedAt: new Date(T0 - 3000), dwellMs: DWELL, now: T0 });
  assert.equal(v.allowed, false);
  assert.equal(v.reason, 'too-early');
  assert.equal(Math.ceil(v.waitMs / 1000), 12);
});

test('opened exactly dwell time ago → allowed', () => {
  assert.equal(dwellVerdict({ openedAt: new Date(T0 - DWELL), dwellMs: DWELL, now: T0 }).allowed, true);
});

test('opened long ago (e.g. yesterday) → allowed', () => {
  assert.equal(dwellVerdict({ openedAt: new Date(T0 - 86_400_000), dwellMs: DWELL, now: T0 }).allowed, true);
});

test('setting 0 / negative disables the gate entirely', () => {
  for (const dwellMs of [0, -1, null, undefined]) {
    const v = dwellVerdict({ openedAt: null, dwellMs, now: T0 });
    assert.equal(v.allowed, true, `dwellMs=${dwellMs} must not block`);
  }
});

test('a corrupt stamp fails closed (not opened) instead of crashing', () => {
  const v = dwellVerdict({ openedAt: 'not-a-date', dwellMs: DWELL, now: T0 });
  assert.equal(v.allowed, false);
  assert.equal(v.reason, 'not-opened');
});

test('a future stamp (clock skew) is not treated as a valid wait', () => {
  const v = dwellVerdict({ openedAt: new Date(T0 + 60_000), dwellMs: DWELL, now: T0 });
  assert.equal(v.allowed, false);
  assert.equal(v.reason, 'too-early');
});
