'use strict';
/**
 * Live sandbox regression tests for the judge worker.
 *
 * These really start the worker and really execute submitted code — a passing
 * suite means the boundary held, not that a mock said it would. The two things
 * under test are the ones that were missing:
 *
 *   B1  `unshare -n` hides the network and nothing else, so a submission could
 *       read any world-readable file on the host (verified: it printed the
 *       contents of a decoy .env).
 *   B2  the JVM and V8 are exempt from RLIMIT_AS, so JavaScript had no memory
 *       ceiling at all — 256 MB at a 16 MB limit was measured at 297.7 MB and
 *       still reported Accepted.
 *
 * The suite skips loudly when the host cannot provide the primitives (no
 * bubblewrap, no user namespaces, no sudo) so a plain `npm test` on a laptop
 * does not report a false failure.
 */
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const SANDBOX = require('../lib/sandbox');

const TOKEN = 'sandbox-test-token-'.padEnd(64, '0');
const CANARY = path.join(os.tmpdir(), `sodl-sandbox-canary-${process.pid}.txt`);
const CANARY_BODY = 'JUDGE_SERVICE_TOKEN=LEAKED-CANARY-VALUE';

let baseUrl = null;
let judge = null;
let runnable = false;
let skipReason = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function post(pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-judge-token': TOKEN },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function run(language, source_code, opts = {}) {
  return post('/api/v1/execute', {
    language,
    source_code,
    stdin: opts.stdin || '',
    time_limit_ms: opts.time_limit_ms || 5000,
    memory_limit_kb: opts.memory_limit_kb || 262144,
  });
}

test.before(async () => {
  const probe = SANDBOX.filesystemIsolationAvailable();
  if (!probe.ok) {
    skipReason = `no filesystem isolation on this host — ${probe.reason}`;
    return;
  }
  try {
    spawnSync('sudo', ['-n', 'true'], { stdio: 'ignore', timeout: 5000 });
  } catch (_) {
    skipReason = 'sudo -n is not available on this host';
    return;
  }

  fs.writeFileSync(CANARY, `${CANARY_BODY}\n`);
  fs.chmodSync(CANARY, 0o644);

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  judge = spawn(process.execPath, ['judge.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      JUDGE_HOST: '127.0.0.1',
      JUDGE_PORT: String(port),
      JUDGE_SERVICE_TOKEN: TOKEN,
      JUDGE_RUN_AS: process.env.JUDGE_RUN_AS || 'nobody',
      JUDGE_CONCURRENCY: '2',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  judge.stderr.on('data', () => {});

  // wait for the worker to answer
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) { runnable = true; return; }
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  skipReason = 'the judge worker did not start in time';
});

test.after(() => {
  if (judge) judge.kill('SIGKILL');
  try { fs.unlinkSync(CANARY); } catch (_) { /* best effort */ }
});

/**
 * Wraps a test so it skips with a clear reason when the host cannot run it.
 *
 * The skip is decided inside the test, not through the `skip` option: node:test
 * evaluates that option while the file is being registered, which happens
 * BEFORE `test.before` runs — every test would silently skip with an empty
 * reason and the suite would look green while testing nothing.
 */
const live = (name, fn) => test(name, async (t) => {
  if (!runnable) return t.skip(skipReason);
  return fn(t);
});

live('the worker reports a private filesystem root', async () => {
  const res = await fetch(`${baseUrl}/health`, { headers: { 'x-judge-token': TOKEN } });
  const body = await res.json();
  assert.strictEqual(body.filesystem_isolation, true, '/health must report filesystem isolation');
  assert.strictEqual(body.filesystem_isolation_mode, 'bubblewrap');
});

live('submitted code cannot read a world-readable file outside its run directory', async () => {
  const r = await run('python', `
import sys
try:
    with open(${JSON.stringify(CANARY)}) as f:
        print("LEAKED:", f.read().strip())
except Exception as e:
    print("BLOCKED:", type(e).__name__)
`);
  assert.strictEqual(r.status.description, 'Accepted', `run should succeed, got ${r.status.description}: ${r.stderr}`);
  assert.match(r.stdout, /BLOCKED/, 'the canary outside the run dir must be unreadable');
  assert.doesNotMatch(r.stdout, /LEAKED/, 'the canary leaked into the submission');
});

live('submitted code sees a private root, not the host filesystem', async () => {
  const r = await run('python', `
import os
print("ROOT:", ",".join(sorted(os.listdir("/"))))
print("HOME_EXISTS:", os.path.exists("/home"))
print("SHADOW_EXISTS:", os.path.exists("/etc/shadow"))
`);
  assert.strictEqual(r.status.description, 'Accepted');
  assert.doesNotMatch(r.stdout, /HOME_EXISTS: True/, '/home must not exist inside the sandbox');
  assert.doesNotMatch(r.stdout, /SHADOW_EXISTS: True/, '/etc/shadow must not exist inside the sandbox');
  assert.doesNotMatch(r.stdout, /ROOT:.*\bhome\b/, 'the real host root is visible');
});

live('writing outside the run directory does not touch the host', async () => {
  const target = path.join(os.tmpdir(), `sodl-escape-${process.pid}.txt`);
  const r = await run('python', `
try:
    open(${JSON.stringify(target)}, "w").write("pwned")
    print("WROTE")
except Exception as e:
    print("BLOCKED:", type(e).__name__)
`);
  assert.strictEqual(r.status.description, 'Accepted');
  assert.equal(fs.existsSync(target), false, 'the submission wrote a file onto the host');
});

live('submitted code has no network', async () => {
  const r = await run('python', `
import socket
s = socket.socket(); s.settimeout(3)
try:
    s.connect(("1.1.1.1", 80)); print("CONNECTED")
except Exception as e:
    print("BLOCKED:", type(e).__name__)
`);
  assert.match(r.stdout, /BLOCKED/, 'network reachability is not blocked');
  assert.doesNotMatch(r.stdout, /CONNECTED/);
});

live('JavaScript cannot exceed the memory limit off-heap', async () => {
  const r = await run('javascript', `
const b = Buffer.alloc(256 * 1024 * 1024);
for (let i = 0; i < b.length; i += 4096) b[i] = 7;
console.log("allocated and touched 256MB");
`, { memory_limit_kb: 16384 });
  assert.strictEqual(r.status.description, 'Memory Limit Exceeded', `got ${r.status.description} at ${r.memory} MB`);
});

live('Python cannot exceed the memory limit', async () => {
  const r = await run('python', 'x = bytearray(96 * 1024 * 1024)\nprint(len(x))', { memory_limit_kb: 16384 });
  assert.strictEqual(r.status.description, 'Memory Limit Exceeded');
});

live('a correct JavaScript answer is still Accepted', async () => {
  const r = await run('javascript', 'const n=parseInt(require("fs").readFileSync(0,"utf8").trim()||"0",10);console.log(n*2);', { stdin: '21' });
  assert.strictEqual(r.status.description, 'Accepted', r.stderr);
  assert.strictEqual(r.stdout.trim(), '42');
});

live('a correct Python answer is still Accepted', async () => {
  const r = await run('python', 'n = int(input().strip() or 0)\nprint(n*2)', { stdin: '21' });
  assert.strictEqual(r.status.description, 'Accepted', r.stderr);
  assert.strictEqual(r.stdout.trim(), '42');
});

live('a correct C++ answer is still Accepted', async () => {
  const r = await run('cpp', '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;return 0;}', { stdin: '20 22' });
  assert.strictEqual(r.status.description, 'Accepted', r.stderr);
  assert.strictEqual(r.stdout.trim(), '42');
});

live('the time limit is still enforced', async () => {
  const r = await run('python', 'while True: pass', { time_limit_ms: 2000 });
  assert.strictEqual(r.status.description, 'Time Limit Exceeded');
});
