'use strict';
/**
 * Regression tests for quiz coding-question test-case parsing.
 *
 * parseTestCases used to drop cases whose expected_output was an empty
 * string. A question made ONLY of such cases then looked like "no test
 * cases" to evaluateAttempt, which falls back to instructor-graded mode and
 * awarded FULL marks for any non-empty answer — without the sandbox ever
 * running it.
 */
process.env.JUDGE_MODE = 'local';
process.env.JUDGE_SERVICE_URL = 'http://127.0.0.1:2358';
process.env.JUDGE_SERVICE_TOKEN = '0123456789abcdef0123456789abcdef0123';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTestCases, parseLanguages, parseStarter, studentTestCases } = require('../../utils/quiz-code');

test('empty expected_output is a real test case, not a missing one', () => {
  const cases = parseTestCases('[{"input":"5","expected_output":""}]');
  assert.equal(cases.length, 1);
  assert.equal(cases[0].expected_output, '');
  assert.equal(cases[0].input, '5');
});

test('undefined/null expected_output (placeholder rows) are still dropped', () => {
  assert.equal(parseTestCases('[{}]').length, 0);
  assert.equal(parseTestCases('[{"input":"1"}]').length, 0);
  assert.equal(parseTestCases('[{"input":"1","expected_output":null}]').length, 0);
});

test('mixed rows keep order and reindex after dropping placeholders', () => {
  const cases = parseTestCases('[{}, {"input":"1","expected_output":"2"}, {"input":"3","expected_output":""}]');
  assert.deepEqual(cases.map((c) => c.index), [0, 1]);
  assert.equal(cases[1].expected_output, '');
});

test('hidden flag survives, malformed input returns empty list', () => {
  const cases = parseTestCases([{ input: '1', expected_output: '', hidden: '1' }]);
  assert.equal(cases[0].hidden, true);
  assert.deepEqual(parseTestCases('not-json{'), []);
  assert.deepEqual(parseTestCases(null), []);
});

test('language/starter helpers tolerate string and object forms', () => {
  assert.deepEqual(parseLanguages('["python","c"]'), ['python', 'c']);
  assert.ok(parseLanguages(null).includes('python'));
  assert.deepEqual(parseStarter('{"python":"x=1"}'), { python: 'x=1' });
  assert.deepEqual(parseStarter('garbage'), {});
});

test('studentTestCases never leaks hidden expected_output', () => {
  const safe = studentTestCases(parseTestCases(
    '[{"input":"1","expected_output":"2"},{"input":"9","expected_output":"","hidden":true}]',
  ));
  assert.deepEqual(safe[0], { index: 0, hidden: false, input: '1', expected_output: '2' });
  assert.deepEqual(safe[1], { index: 1, hidden: true });
});
