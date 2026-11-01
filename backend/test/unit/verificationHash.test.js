'use strict';
/**
 * A completed in-quiz run must be bound to what it actually proved.
 *
 * `verified = 1` is cleared when the student's own answer changes, but NOT when
 * an instructor edits a test case. Edit a case's expected output while keeping
 * the case COUNT the same and the old verdict used to survive, so the student
 * scored full marks for code that never passed the corrected case.
 */
const test = require('node:test');
const assert = require('node:assert');

// quiz-code.js reaches judge.service.js, which validates its mode at import.
process.env.JUDGE_MODE = process.env.JUDGE_MODE || 'local';
process.env.JUDGE_SERVICE_URL = process.env.JUDGE_SERVICE_URL || 'http://127.0.0.1:2358';
process.env.JUDGE_SERVICE_TOKEN = process.env.JUDGE_SERVICE_TOKEN || 'unit-test-token-not-a-real-secret';

const { verificationHash, parseTestCases } = require('../../utils/quiz-code');

const CASES = [
  { input: '2 2', expected_output: '4' },
  { input: '3 3', expected_output: '9' },
  { input: '5 0', expected_output: '' },       // an empty expectation is a real case
];

const base = () => ({
  questionId: 42,
  language: 'python',
  source: 'a,b = map(int, input().split())\nprint(a*b)',
  cases: parseTestCases(JSON.stringify(CASES)),
});

test('the hash is stable for identical inputs', () => {
  assert.strictEqual(verificationHash(base()), verificationHash(base()));
  assert.match(verificationHash(base()), /^[0-9a-f]{64}$/);
});

test('editing a case invalidates the hash even when the count is unchanged', () => {
  const edited = base();
  edited.cases[1].expected_output = '9\n';        // same number of cases
  assert.notStrictEqual(verificationHash(base()), verificationHash(edited));
});

test('adding or removing a case invalidates the hash', () => {
  const grown = base();
  grown.cases.push({ index: 3, input: '1 1', expected_output: '1', hidden: false });
  assert.notStrictEqual(verificationHash(base()), verificationHash(grown));
});

test('changing the submitted source invalidates the hash', () => {
  const changed = base();
  changed.source = 'print("cheating")';
  assert.notStrictEqual(verificationHash(base()), verificationHash(changed));
});

test('changing the language or question invalidates the hash', () => {
  const otherLang = base(); otherLang.language = 'cpp';
  const otherQ = base(); otherQ.questionId = 43;
  assert.notStrictEqual(verificationHash(base()), verificationHash(otherLang));
  assert.notStrictEqual(verificationHash(base()), verificationHash(otherQ));
});

test('hidden cases are part of what was proved', () => {
  const hidden = base();
  hidden.cases[2].hidden = true;
  assert.notStrictEqual(verificationHash(base()), verificationHash(hidden));
});

test('an empty expectation still counts as a case, so it cannot collapse to "no cases"', () => {
  const cases = parseTestCases(JSON.stringify([{ input: '', expected_output: '' }]));
  assert.strictEqual(cases.length, 1);
  assert.notStrictEqual(
    verificationHash({ questionId: 1, language: 'python', source: 'x', cases }),
    verificationHash({ questionId: 1, language: 'python', source: 'x', cases: [] }),
  );
});
