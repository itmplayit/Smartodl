'use strict';
/**
 * Coding questions inside quizzes.
 *
 * A `coding` question stores everything it needs in JSON columns:
 *   coding_languages  ["python","c","cpp", …]      allowed languages
 *   starter_code      { python: "…", cpp: "…" }    template per language
 *   test_cases        [{ input, expected_output, hidden }]
 *   time_limit_ms / memory_limit_kb
 *
 * The student's code is NEVER executed inside this Node process — it always goes
 * to the sandboxed judge (Judge0 in production, the local judge worker in dev)
 * through services/judge.service.js.
 */
const crypto = require('crypto');
const judge = require('../services/judge.service');

const DEFAULT_LANGUAGES = ['c', 'cpp', 'java', 'python', 'javascript'];

/** Allowed languages for a question (falls back to the platform default set). */
function parseLanguages(raw) {
  let value = raw;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { value = null; } }
  if (!Array.isArray(value) || !value.length) return [...DEFAULT_LANGUAGES];
  return value.map((v) => String(v)).filter(Boolean);
}

/** Starter templates: { language: code }. */
function parseStarter(raw) {
  let value = raw;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { value = null; } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

/** Normalised test cases: [{ index, input, expected_output, hidden }] */
function parseTestCases(raw) {
  const value = raw;
  let cases = value;
  if (typeof value === 'string') { try { cases = JSON.parse(value); } catch (_) { cases = null; } }
  if (!Array.isArray(cases)) return [];
  // A case counts whenever its expected output is DEFINED — an empty string is
  // a legitimate expectation ("the program must print nothing"). The old
  // `!== ''` filter dropped those cases, and a question whose only cases were
  // like that silently became "no test cases" → the evaluator then awarded
  // full marks for ANY non-empty code (instructor-graded fallback).
  return cases
    .filter((t) => t && typeof t === 'object' && t.expected_output !== undefined && t.expected_output !== null)
    .map((t, i) => ({
      index: i,
      input: t.input != null ? String(t.input) : '',
      expected_output: String(t.expected_output),
      hidden: !!(t.hidden === true || t.hidden === 1 || t.hidden === '1'),
    }));
}

/**
 * The safe view of a question's test cases for a student: hidden cases reveal
 * NOTHING (no input, no expected output) — only that they exist.
 */
function studentTestCases(cases) {
  return cases.map((t) => (t.hidden
    ? { index: t.index, hidden: true }
    : { index: t.index, hidden: false, input: t.input, expected_output: t.expected_output }));
}

/** Question → everything the in-quiz code editor needs. No answers, no hidden data. */
function codingConfig(question) {
  const cases = parseTestCases(question.test_cases);
  return {
    coding_languages: parseLanguages(question.coding_languages),
    starter_code: parseStarter(question.starter_code),
    test_cases: studentTestCases(cases),
    test_count: cases.length,
    time_limit_ms: Number(question.time_limit_ms) || 2000,
    memory_limit_kb: Number(question.memory_limit_kb) || 262144,
  };
}

const VERDICT_LABEL = {
  accepted: 'Accepted',
  wrong_answer: 'Wrong Answer',
  time_limit_exceeded: 'Time Limit Exceeded',
  compilation_error: 'Compilation Error',
  runtime_error: 'Runtime Error',
  memory_limit_exceeded: 'Memory Limit Exceeded',
  internal_error: 'Judge Error',
};

/** Judge one piece of student code against every test case of a question. */
async function judgeCodingAnswer({ language, sourceCode, cases, timeLimitMs, memoryLimitKb }) {
  const tests = cases.map((t) => ({ input: t.input, expected_output: t.expected_output }));
  const raw = await judge.runBatch({
    language,
    sourceCode,
    tests,
    timeLimitMs: timeLimitMs || 2000,
    memoryLimitKb: memoryLimitKb || 262144,
    stopOnFailure: false, // run them all — the student must see every case
  });

  const results = raw.map((r, i) => ({
    index: i,
    hidden: !!cases[i].hidden,
    passed: !!r.passed,
    status: r.status,
    time: r.time,
    memory: r.memory,
    // never echo stdout for hidden cases — it can leak the expected answer
    output: cases[i].hidden ? undefined : r.output,
    stderr: cases[i].hidden ? undefined : (r.stderr || r.compileOutput || ''),
  }));

  const compileError = raw.find((r) => r.status === 'compilation_error');
  const passed = results.filter((r) => r.passed).length;
  const firstFailure = results.find((r) => !r.passed);
  const verdict = passed === results.length
    ? 'accepted'
    : (compileError ? 'compilation_error' : (firstFailure ? firstFailure.status : 'wrong_answer'));

  return {
    results,
    passed,
    total: results.length,
    allPassed: passed === results.length && results.length > 0,
    verdict,
    verdict_label: VERDICT_LABEL[verdict] || 'Wrong Answer',
    compile_output: compileError ? (compileError.compileOutput || compileError.stderr || '') : '',
    time: results.reduce((m, r) => Math.max(m, r.time || 0), 0),
    memory: results.reduce((m, r) => Math.max(m, r.memory || 0), 0),
  };
}

/**
 * Binds a completed run to exactly what it proved: the question, the language,
 * the submitted source, and the CONTENT of every test case.
 *
 * Why this exists: `verified = 1` used to be reset only when the student's own
 * answer changed. Edit a test case's expected output without changing the case
 * COUNT and the stored verdict still said "passed 3 of 3", so the student was
 * awarded full marks for code that never passed the corrected case.
 *
 * The hash is what ties the stored verdict to the cases that produced it. It is
 * SHA-256 over a canonical JSON form, so it is stable across runs and cannot be
 * guessed or crafted by the client.
 *
 * @returns {string} 64 hex characters
 */
function verificationHash({ questionId, language, source, cases }) {
  const payload = JSON.stringify({
    q: String(questionId == null ? '' : questionId),
    lang: String(language || ''),
    src: String(source == null ? '' : source),
    cases: (Array.isArray(cases) ? cases : []).map((t) => [
      String(t && t.index != null ? t.index : ''),
      String(t && t.input != null ? t.input : ''),
      String(t && t.expected_output != null ? t.expected_output : ''),
      t && t.hidden ? 1 : 0,
    ]),
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

module.exports = {
  DEFAULT_LANGUAGES,
  VERDICT_LABEL,
  verificationHash,
  parseLanguages,
  parseStarter,
  parseTestCases,
  studentTestCases,
  codingConfig,
  judgeCodingAnswer,
};
