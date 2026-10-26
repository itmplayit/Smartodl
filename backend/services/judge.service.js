'use strict';
/**
 * Judge abstraction layer.
 *
 *  IMPORTANT SECURITY NOTE
 *  -----------------------
 *  User-submitted code is NEVER executed inside this Node.js process.
 *  Every run/submission is delegated either to:
 *    (a) the bundled sandboxed judge worker (JUDGE_MODE=local)  -> backend/judge-service/judge.js
 *    (b) a hosted Judge0 CE instance (JUDGE_MODE=judge0)
 *  Both are external services; this module only performs HTTP calls.
 */
const axios = require('axios');

const JUDGE0_STATUS = {
  1: 'queued', 2: 'running', 3: 'accepted', 4: 'wrong_answer', 5: 'time_limit_exceeded',
  6: 'compilation_error', 7: 'runtime_error', 8: 'runtime_error', 9: 'runtime_error',
  10: 'runtime_error', 11: 'runtime_error', 12: 'runtime_error', 13: 'internal_error', 14: 'internal_error',
};

const LOCAL_STATUS_MAP = {
  Accepted: 'accepted', 'Wrong Answer': 'wrong_answer', 'Time Limit Exceeded': 'time_limit_exceeded',
  'Compilation Error': 'compilation_error', 'Runtime Error': 'runtime_error', 'Internal Error': 'internal_error',
  'Memory Limit Exceeded': 'memory_limit_exceeded',
};
const LOCAL_BATCH_SIZE = 60;

function judgeMode() {
  const mode = String(process.env.JUDGE_MODE || '').trim();
  if (!['local', 'judge0'].includes(mode)) throw new Error('JUDGE_MODE must be configured as local or judge0');
  return mode;
}

const configuredMode = judgeMode();
if (configuredMode === 'local') {
  if (String(process.env.JUDGE_SERVICE_TOKEN || '').length < 32) throw new Error('JUDGE_SERVICE_TOKEN must contain at least 32 random characters');
  if (String(process.env.JUDGE_SERVICE_TOKEN).toLowerCase().startsWith('294676c6c5bf4357')) {
    throw new Error('JUDGE_SERVICE_TOKEN is the old leaked example token — generate a new one: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  }
  if (!process.env.JUDGE_SERVICE_URL) throw new Error('JUDGE_SERVICE_URL is required in local judge mode');
}
if (configuredMode === 'judge0' && !process.env.JUDGE0_URL) throw new Error('JUDGE0_URL is required in judge0 mode');

/* ------------------------------------------------------------------ */
/* local sandboxed worker                                              */
/* ------------------------------------------------------------------ */
function localClient() {
  return axios.create({
    baseURL: process.env.JUDGE_SERVICE_URL,
    // A 60-case batch is compile + 60 runs; 60s was tight under load and a
    // timeout marked innocent submissions internal_error. The judge's own
    // per-run limits still apply.
    timeout: 180000,
    headers: { 'x-judge-token': process.env.JUDGE_SERVICE_TOKEN },
  });
}

async function localExecute({ language, sourceCode, stdin, timeLimitMs, memoryLimitKb }) {
  const { data } = await localClient().post('/api/v1/execute', {
    language, source_code: sourceCode, stdin: stdin || '',
    time_limit_ms: timeLimitMs, memory_limit_kb: memoryLimitKb,
  });
  const status = LOCAL_STATUS_MAP[data.status && data.status.description] || 'internal_error';
  return {
    status,
    output: data.stdout || '',
    stderr: data.stderr || '',
    compileOutput: data.compile_output || '',
    time: Number(data.time || 0),
    memory: Number(data.memory || 0),
  };
}

async function localExecuteBatch({ language, sourceCode, tests, timeLimitMs, memoryLimitKb, stopOnFailure }) {
  const allTests = Array.isArray(tests) ? tests : [];
  const results = [];
  // The worker intentionally caps one request at 60 cases. Chunk here and
  // verify completeness — silently judging only the first 60 could turn a
  // 61st failing hidden case into a false Accepted verdict.
  for (let offset = 0; offset < allTests.length; offset += LOCAL_BATCH_SIZE) {
    const chunk = allTests.slice(offset, offset + LOCAL_BATCH_SIZE);
    const { data } = await localClient().post('/api/v1/execute-batch', {
      language, source_code: sourceCode, tests: chunk, time_limit_ms: timeLimitMs,
      memory_limit_kb: memoryLimitKb, stop_on_failure: !!stopOnFailure,
    });
    if (!Array.isArray(data.results) || data.results.length > chunk.length) {
      throw new Error('Judge worker returned an invalid batch result count');
    }
    if (!stopOnFailure && data.results.length !== chunk.length) {
      throw new Error(`Judge worker returned ${data.results.length} results for ${chunk.length} test cases`);
    }
    const mapped = data.results.map((r) => ({
      passed: !!r.passed,
      status: LOCAL_STATUS_MAP[(r.status && r.status.description) || ''] || 'internal_error',
      output: r.stdout || '',
      stderr: r.stderr || '',
      compileOutput: r.compile_output || '',
      time: Number(r.time || 0),
      memory: Number(r.memory || 0),
    }));
    results.push(...mapped);
    if (stopOnFailure && mapped.some((result) => !result.passed)) break;
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Judge0 CE (https://ce.judge0.com or self-hosted)                    */
/* ------------------------------------------------------------------ */
function judge0Client() {
  const rapidKey = process.env.JUDGE0_RAPIDAPI_KEY || '';
  const headers = { 'Content-Type': 'application/json' };
  if (rapidKey) { headers['X-RapidAPI-Key'] = rapidKey; headers['X-RapidAPI-Host'] = process.env.JUDGE0_RAPIDAPI_HOST || 'judge0-ce.p.rapidapi.com'; }
  return axios.create({ baseURL: process.env.JUDGE0_URL, timeout: 130000, headers });
}

const JUDGE0_IDS = { c: 50, cpp: 54, java: 62, python: 71, javascript: 63, sql: 82, csharp: 51, go: 60 };

async function judge0Run({ language, sourceCode, stdin, languageId, timeLimitMs, memoryLimitKb }) {
  if (String(language || '').toLowerCase() === 'sql') {
    throw new Error('SQL problems require the local judge worker with its disposable SQL sandbox; Judge0 mode cannot provide the SmartODL fixture/isolation');
  }
  const client = judge0Client();
  const id = languageId || JUDGE0_IDS[String(language || '').toLowerCase()];
  if (!id) throw new Error(`Unsupported Judge0 language: ${language}`);

  // Ask Judge0 for base64 explicitly and decode every field. The old
  // base64_encoded=false + "looks like base64" heuristic corrupted honest
  // plaintext outputs such as "SGVsbG8=" by decoding them a second time.
  const params = new URLSearchParams({ base64_encoded: 'true', wait: 'true', fields: '*' });
  const encode = (value) => Buffer.from(String(value ?? ''), 'utf8').toString('base64');
  const decode = (value) => (value ? Buffer.from(String(value), 'base64').toString('utf8') : '');
  const cpuLimitSeconds = Math.min(60, Math.max(0.1, (Number(timeLimitMs) || 2000) / 1000));
  const memoryLimit = Math.round(Math.min(4194304, Math.max(16384, Number(memoryLimitKb) || 262144)));
  const { data } = await client.post(`/submissions?${params.toString()}`, {
    source_code: encode(sourceCode),
    language_id: id,
    stdin: encode(stdin || ''),
    cpu_time_limit: cpuLimitSeconds,
    wall_time_limit: Math.min(120, cpuLimitSeconds + 2),
    memory_limit: memoryLimit,
  });

  let status = JUDGE0_STATUS[data.status && data.status.id] || 'internal_error';
  const memoryKb = Number(data.memory || 0);
  if (memoryKb > memoryLimit && status !== 'time_limit_exceeded') {
    status = 'memory_limit_exceeded';
  }
  return {
    status,
    output: decode(data.stdout),
    stderr: decode(data.stderr),
    compileOutput: decode(data.compile_output),
    time: Number(data.time || 0),
    // Judge0 reports KB; the local worker and the rest of SmartODL use MB.
    memory: Math.round((memoryKb / 1024) * 10) / 10,
  };
}

/* ------------------------------------------------------------------ */
/* unified public API                                                  */
/* ------------------------------------------------------------------ */
async function runCode(opts) {
  const mode = await judgeMode();
  if (mode === 'judge0') return judge0Run(opts);
  return localExecute(opts);
}

async function runBatch(opts) {
  const mode = await judgeMode();
  if (mode === 'judge0') {
    // Judge0 has no batch endpoint on CE — run the shared test set sequentially.
    const results = [];
    for (const t of opts.tests || []) {
      const r = await judge0Run({
        language: opts.language, sourceCode: opts.sourceCode, stdin: t.input,
        languageId: opts.languageId, timeLimitMs: opts.timeLimitMs, memoryLimitKb: opts.memoryLimitKb,
      });
      results.push({ ...r, passed: r.status === 'accepted' && normalise(r.output) === normalise(t.expected_output) });
      if (!results[results.length - 1].passed && opts.stopOnFailure) break;
    }
    return results;
  }
  return localExecuteBatch(opts);
}

function normalise(s) {
  return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '').trim();
}

/** Map engine results onto the DB status enum used by coding_submissions. */
function aggregate(results) {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  let status = 'accepted';
  if (passed < total) {
    const firstFail = results.find((r) => !r.passed) || {};
    const s = firstFail.status;
    if (s === 'compilation_error') status = 'compilation_error';
    else if (s === 'time_limit_exceeded') status = 'time_limit_exceeded';
    else if (s === 'memory_limit_exceeded') status = 'memory_limit_exceeded';
    else if (s === 'runtime_error') status = 'runtime_error';
    else if (s === 'internal_error') status = 'internal_error';
    else status = 'wrong_answer';
  }
  const worst = results.reduce((m, r) => Math.max(m, r.time || 0), 0);
  const mem = results.reduce((m, r) => Math.max(m, r.memory || 0), 0);
  return { status, passed, total, time: worst, memory: mem, results };
}

module.exports = { runCode, runBatch, aggregate, normalise, JUDGE0_IDS };
