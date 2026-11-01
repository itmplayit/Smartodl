/**
 * SmartODL Judge Worker  —  isolated sandboxed code execution service
 * -------------------------------------------------------------------
 *  This service is the ONLY place where untrusted user code is executed.
 *  The main Express API NEVER runs submitted code (no child_process there);
 *  it always delegates to this worker (or to an external Judge0 instance).
 *
 *  Isolation layers used per execution:
 *    1. Fresh temp work directory per run (auto-removed afterwards).
 *    2. Dropped privileges  -> runs as `nobody` (uid 65534) via sudo -n.
 *    3. Resource limits    -> prlimit (CPU seconds, address space, nproc, files, file size).
 *    4. Wall-clock timeout -> process-group SIGKILL.
 *    5. Clean environment  -> no inherited env secrets, fixed cwd.
 *    6. Output caps        -> stdout/stderr truncated to 64 KB.
 *    7. Per-language safe args (no shell interpolation anywhere).
 *    8. Optional shared-secret header so only the API can call the worker.
 *    9. Bounded concurrency queue so the worker cannot be saturated.
 *
 *  For classroom/production deployments the same interface is also backed by
 *  Judge0 CE (set JUDGE_MODE=judge0 in the API .env).
 */
const express = require('express');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PLATFORM = require('./lib/platform');
const { IS_WINDOWS, SANDBOX_MODE, RUN_AS, findBinary, binName, buildCommand, childEnv, killTree, defaultWorkdir, SANDBOX_WRAPPERS, enforceSandbox } = PLATFORM;
const SANDBOX = require('./lib/sandbox');

const PORT = Number(process.env.JUDGE_PORT || process.env.PORT || 2358);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('JUDGE_PORT/PORT must be an integer from 1 to 65535');
}
// Loopback by default: this service executes arbitrary submitted code, so it
// must never be reachable merely because JUDGE_HOST was left unset. Cloud
// platforms inject PORT and expect a public bind, so that explicit signal
// switches the default to 0.0.0.0 (the token check still applies).
const HOST = process.env.JUDGE_HOST || (process.env.PORT && !process.env.JUDGE_PORT ? '0.0.0.0' : '127.0.0.1');
const TOKEN = process.env.JUDGE_SERVICE_TOKEN || '';
const MAX_CONCURRENCY = Number(process.env.JUDGE_CONCURRENCY || 2);
const MAX_QUEUE = Number(process.env.JUDGE_MAX_QUEUE || 200);
const OUTPUT_CAP = 64 * 1024;          // bytes kept from stdout/stderr
const COMPILE_TIMEOUT = 15000;         // ms
const DEFAULT_RUN_TIMEOUT = 2000;      // ms
const DEFAULT_MEMORY = 262144;         // KB
const MAX_BATCH_TESTS = 60;
// Compilers are the heaviest thing the worker runs (javac reserves a large
// address range). This is a hard RSS ceiling for the compile phase so a
// pathological source file cannot exhaust the host; the per-run limit below
// governs the student's program itself.
const COMPILE_MEMORY_LIMIT_KB = 2 * 1024 * 1024;

/**
 * RSS head-room added to a problem's memory limit before it is enforced.
 *
 * The measured figure is the WHOLE process tree, so it includes the runtime
 * itself — and that is not the student's allocation. V8 needs ~32 MB just to
 * start, CPython ~15 MB, the JVM considerably more. Comparing the raw total
 * against the configured limit therefore failed every JavaScript program the
 * moment the limit was set anywhere near those baselines (a correct
 * "print n*2" was reported as using 32 MB against a 16 MB cap).
 *
 * What is enforced is `problem limit + this allowance`, so the student still
 * gets roughly the configured amount of their own memory, and the host is
 * still protected. This is the same shape of allowance Judge0 applies.
 */
const MEMORY_RUNTIME_ALLOWANCE_KB = {
  javascript: 64 * 1024,
  java: 192 * 1024,
  python: 32 * 1024,
  c: 8 * 1024,
  cpp: 8 * 1024,
  sql: 8 * 1024,
};
const memoryAllowanceKb = (langKey) => {
  // Number('') is 0, not NaN — without the empty-string check the override
  // branch always won and silently reduced every allowance to zero.
  const raw = String(process.env.JUDGE_MEMORY_ALLOWANCE_KB || '').trim();
  if (raw !== '') {
    const override = Number(raw);
    if (Number.isFinite(override) && override >= 0) return override;
  }
  return MEMORY_RUNTIME_ALLOWANCE_KB[String(langKey).toLowerCase()] || 32 * 1024;
};
const WORKERS = defaultWorkdir();          // os.tmpdir() on Windows, /tmp elsewhere
const SQL_FIXTURE = path.join(__dirname, 'assets', 'sql-fixture.sql');
const SQL_ENABLED = process.env.SQL_SANDBOX_ENABLED === 'true';

if (TOKEN.length < 32) throw new Error('JUDGE_SERVICE_TOKEN must be a non-empty random value of at least 32 characters');
if (TOKEN.toLowerCase().startsWith('294676c6c5bf4357')) {
  throw new Error('JUDGE_SERVICE_TOKEN is the old leaked example token — generate a new one: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
}
if (!Number.isInteger(MAX_QUEUE) || MAX_QUEUE < 1 || MAX_QUEUE > 10000) throw new Error('JUDGE_MAX_QUEUE must be an integer from 1 to 10000');
if (!Number.isInteger(MAX_CONCURRENCY) || MAX_CONCURRENCY < 1 || MAX_CONCURRENCY > 64) throw new Error('JUDGE_CONCURRENCY must be an integer from 1 to 64');
if (process.env.NODE_ENV === 'production' && SANDBOX_MODE !== 'posix') {
  throw new Error('Production local judge requires Linux/POSIX isolation with a non-empty JUDGE_RUN_AS account');
}
if (SQL_ENABLED) {
  const requiredSql = ['SQL_SANDBOX_HOST', 'SQL_SANDBOX_PORT', 'SQL_SANDBOX_DB', 'SQL_SANDBOX_USER', 'SQL_SANDBOX_PASSWORD'];
  requiredSql.forEach((name) => { if (!String(process.env[name] || '').trim()) throw new Error(`${name} is required when SQL_SANDBOX_ENABLED=true`); });
  if (process.env.SQL_SANDBOX_DB === process.env.DB_NAME || /education_platform|smartodl/i.test(process.env.SQL_SANDBOX_DB)) {
    throw new Error('SQL_SANDBOX_DB must be a disposable database, never the application database');
  }
}

const STATUS = {
  QUEUED: { id: 1, description: 'In Queue' },
  PROCESSING: { id: 2, description: 'Processing' },
  ACCEPTED: { id: 3, description: 'Accepted' },
  WRONG_ANSWER: { id: 4, description: 'Wrong Answer' },
  TLE: { id: 5, description: 'Time Limit Exceeded' },
  COMPILE_ERROR: { id: 6, description: 'Compilation Error' },
  RUNTIME_ERROR: { id: 7, description: 'Runtime Error' },
  MLE: { id: 8, description: 'Memory Limit Exceeded' },
  INTERNAL_ERROR: { id: 13, description: 'Internal Error' },
};

/* ------------------------------------------------------------------ */
/* language definitions (mirrors the coding_languages table slugs)      */
/* ------------------------------------------------------------------ */
const EXE = IS_WINDOWS ? '.exe' : '';

/* Binaries are resolved once at boot so a missing compiler shows up in /health
   (and as a clear Compile Error) instead of failing mysteriously per submission. */
const BIN = {
  gcc: binName(['gcc'], 'gcc'),
  gpp: binName(['g++'], 'g++'),
  javac: binName(['javac'], 'javac'),
  java: binName(['java'], 'java'),
  python: binName(['python3', 'python', 'py'], 'python3'),
  node: binName(['node'], 'node'),
  mysql: binName(['mysql', 'mariadb'], 'mysql'),
};

const SANDBOX_BIN = {
  sudo: binName(['sudo'], 'sudo'),
  prlimit: binName(['prlimit'], 'prlimit'),
  unshare: binName(['unshare'], 'unshare'),
};

function commandWorks(command, args) {
  try {
    const result = spawnSync(command, args, { stdio: 'ignore', timeout: 5000 });
    return !result.error && result.status === 0;
  } catch (_) { return false; }
}

function sandboxDiagnostics() {
  if (SANDBOX_MODE !== 'posix') {
    return {
      ready: false, mode: SANDBOX_MODE, run_as: RUN_AS, tools: {},
      run_as_works: false, network_namespace_works: false,
    };
  }
  if (SANDBOX_WRAPPERS.enabled) {
    // Hardened mode: sudoers grants ONLY the two wrapper programs, and each
    // wrapper validates its own arguments. One probe covers the whole chain
    // (unshare → sudo -u <run user> → prlimit → /bin/true).
    const wrappersFound = { bin: SANDBOX_WRAPPERS.execPath, found: true };
    const probeWorks = commandWorks('sudo', ['-n', SANDBOX_WRAPPERS.execPath, '--probe', '--ns', 'n']);
    return {
      ready: wrappersFound.found && probeWorks,
      mode: SANDBOX_MODE,
      run_as: RUN_AS,
      tools: { wrappers: wrappersFound },
      sudo_wrappers: true,
      run_as_works: probeWorks,
      network_namespace_works: probeWorks,
    };
  }
  const tools = Object.fromEntries(Object.entries(SANDBOX_BIN).map(([tool, bin]) => [
    tool, { bin, found: !findBinary([bin]).missing },
  ]));
  const toolsReady = Object.values(tools).every((tool) => tool.found);
  const runAsWorks = toolsReady
    && commandWorks(SANDBOX_BIN.sudo, ['-n', '-u', RUN_AS, '/bin/true']);
  const networkNamespaceWorks = toolsReady
    && commandWorks(SANDBOX_BIN.sudo, ['-n', SANDBOX_BIN.unshare, '-n', '--', '/bin/true']);
  return {
    ready: toolsReady && runAsWorks && networkNamespaceWorks,
    mode: SANDBOX_MODE,
    run_as: RUN_AS,
    tools,
    run_as_works: runAsWorks,
    network_namespace_works: networkNamespaceWorks,
  };
}

const SANDBOX_DIAGNOSTICS = sandboxDiagnostics();
// A private filesystem root is not optional in production: `unshare -n` alone
// leaves every world-readable host file readable by submitted code. This throws
// on a host that cannot build one unless the operator opts out explicitly.
const FS_ISOLATION = enforceSandbox();
if (process.env.NODE_ENV === 'production' && !SANDBOX_DIAGNOSTICS.ready) {
  throw new Error(`Production judge sandbox is not ready: ${JSON.stringify(SANDBOX_DIAGNOSTICS)}`);
}

const TOOLCHAIN_REQUIREMENTS = {
  c: ['gcc'], cpp: ['gpp'], java: ['javac', 'java'], python: ['python'],
  javascript: ['node'], sql: ['mysql'],
};

function toolchainDiagnostics() {
  const toolchains = Object.entries(BIN).map(([tool, bin]) => ({
    tool, bin, found: !findBinary([bin]).missing,
  }));
  const found = new Set(toolchains.filter((tool) => tool.found).map((tool) => tool.tool));
  const languages = {};
  for (const language of Object.keys(TOOLCHAIN_REQUIREMENTS)) {
    const missing = TOOLCHAIN_REQUIREMENTS[language].filter((tool) => !found.has(tool));
    languages[language] = {
      ready: missing.length === 0 && (language !== 'sql' || SQL_ENABLED),
      missing,
      ...(language === 'sql' ? { enabled: SQL_ENABLED } : {}),
    };
  }
  return {
    toolchains,
    languages,
    ready_languages: Object.keys(languages).filter((language) => languages[language].ready),
  };
}

const LANGUAGES = {
  c: {
    file: 'main.c', bin: `prog${EXE}`,
    compile: [BIN.gcc, ['-O2', '-std=gnu11', '-o', `prog${EXE}`, 'main.c', '-lm']],
    run: () => [`./prog${EXE}`, []],
    limit: { as: 512 * 1024 * 1024, nproc: 64 },
  },
  cpp: {
    file: 'main.cpp', bin: `prog${EXE}`,
    compile: [BIN.gpp, ['-O2', '-std=gnu++17', '-o', `prog${EXE}`, 'main.cpp']],
    run: () => [`./prog${EXE}`, []],
    limit: { as: 1024 * 1024 * 1024, nproc: 64 },
  },
  java: {
    file: 'Main.java',
    compile: [BIN.javac, ['-J-Xmx256m', '-J-XX:MaxMetaspaceSize=128m', '-J-XX:ReservedCodeCacheSize=64m', 'Main.java']],
    run: () => [BIN.java, [
      '-XX:+UseSerialGC', '-XX:MaxMetaspaceSize=128m', '-XX:CompressedClassSpaceSize=64m',
      '-XX:ReservedCodeCacheSize=64m', '-Xss8m', '-Xmx256m', 'Main',
    ]],
    limit: { as: 4 * 1024 * 1024 * 1024, nproc: 128 },
  },
  python: {
    file: 'main.py',
    run: () => [BIN.python, ['main.py']],
    limit: { as: 1024 * 1024 * 1024, nproc: 32 },
  },
  javascript: {
    file: 'main.js',
    run: () => [BIN.node, ['main.js']],
    limit: { as: 4 * 1024 * 1024 * 1024, nproc: 64 },
  },
  sql: {
    file: 'query.sql',
    run: () => null, // handled by runSql()
    limit: { as: 512 * 1024 * 1024, nproc: 32 },
  },
};
if (!SQL_ENABLED) delete LANGUAGES.sql;

/* ------------------------------------------------------------------ */
/* Java — VS Code-style source handling                                 */
/* VS Code saves student code as <ClassName>.java, so `public class     */
/* HelloWorld` "just works" there. javac demands the same: a public     */
/* top-level type MUST live in a file of its own name. We detect the    */
/* class/record/enum name, drop any copied `package ...;` line, and     */
/* save/compile/run using the student's own class name.                 */
/* ------------------------------------------------------------------ */
function javaClassName(src) {
  const s = String(src || '');
  const pub = s.match(/public\s+(?:final\s+|abstract\s+|sealed\s+|non-sealed\s+)*(?:class|record|enum|@?interface)\s+([A-Za-z_$][\w$]*)/);
  if (pub) return pub[1];
  // non-public class that carries the main() method
  const withMain = s.match(/(?:^|\n)\s*(?:final\s+|abstract\s+|sealed\s+|non-sealed\s+)*(?:class|record|enum)\s+([A-Za-z_$][\w$]*)[\s\S]*?public\s+static\s+void\s+main/);
  if (withMain) return withMain[1];
  const anyDecl = s.match(/(?:^|\n)\s*(?:public\s+)?(?:final\s+|abstract\s+)*(?:class|record|enum)\s+([A-Za-z_$][\w$]*)/);
  return anyDecl ? anyDecl[1] : null;
}
function stripPackageLine(src) {
  // IDE-copied code often starts with `package com.example;` — there is no such
  // directory tree in a single-file sandbox run, so remove that one line.
  return String(src || '').replace(/^\s*package\s+[\w.]+\s*;/m, '');
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
function memMb(kb) { return kb ? Math.round((kb / 1024) * 10) / 10 : 0; }

function truncate(s, cap = OUTPUT_CAP) {
  if (!s) return '';
  return s.length > cap ? s.slice(0, cap) + `\n... [output truncated at ${cap} bytes]` : s;
}

/** Peak resident memory of a running child *and its descendants*, in KB.
 *
 *  The program itself may run one or two levels below the spawned process
 *  (POSIX runs it through `sudo -u nobody`, and compiled programs can fork),
 *  so we walk /proc/<pid>/task/<pid>/children and sample every descendant.
 */
function peakMemorySampler(rootPid) {
  let max = 0;

  const descendants = (pid, seen = new Set()) => {
    if (seen.has(pid)) return seen;
    seen.add(pid);
    try {
      const kids = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim();
      if (kids) for (const k of kids.split(/\s+/)) descendants(Number(k), seen);
    } catch (_) { /* kernel without that file, or process gone */ }
    return seen;
  };

  const readOne = (pid) => {
    try {
      const m = /VmHWM:\s+(\d+)\s+kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
      if (m) max = Math.max(max, Number(m[1]));
    } catch (_) { /* gone */ }
  };

  const read = () => {
    if (process.platform === 'linux') {
      for (const pid of descendants(rootPid)) readOne(pid);
    } else if (process.platform === 'darwin') {
      try {
        const out = require('child_process')
          .execSync(`ps -o rss= -p ${rootPid}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        if (out) max = Math.max(max, Number(out));
      } catch (_) { /* gone */ }
    }
    return max;
  };

  read();                                  // short-lived programs can finish between ticks
  const timer = setInterval(read, 10);
  return { stop: () => { clearInterval(timer); return read(); } };
}

let warnedCleanup = false;

/**
 * Remove a run's work directory.
 *
 * The directory is chown'ed to RUN_AS before execution so the sandboxed
 * process can write in it — which means THIS process (a different user) can
 * no longer delete what is inside. The old code did a plain fsp.rm and
 * swallowed the EACCES with `.catch(() => {})`, so every single submission
 * leaked one directory, forever, silently. 66 of them had piled up in testing.
 */
async function makeWorkdir() {
  return fsp.mkdtemp(path.join(WORKERS, 'run-'));
}

async function copyWorkdir(sourceDir) {
  const dir = await makeWorkdir();
  try {
    await fsp.cp(sourceDir, dir, { recursive: true, errorOnExist: false, dereference: false });
    return dir;
  } catch (error) {
    await cleanupWorkdir(dir);
    throw error;
  }
}

/**
 * Take a work directory back from the sandbox user.
 *
 * Preparing the batch template chowns it to RUN_AS and chmods it 0711, so a
 * non-root worker (the Docker image runs as `judgeweb`) can traverse it but
 * can no longer list it — `fsp.cp` then fails with EACCES and every batch
 * submission returns HTTP 500. Running the worker as root masked this in
 * local testing. The template is compile-only and is never executed from
 * directly, so reclaiming it for the worker before copying is safe; each
 * per-test copy is chowned to RUN_AS again by runSingle.
 */
async function reclaimWorkdir(dir) {
  if (SANDBOX_MODE !== 'posix') return;
  const me = os.userInfo().username;
  if (!me || me === RUN_AS) return;
  if (SANDBOX_WRAPPERS.enabled) {
    // The wrapper chowns only back to the configured worker user and only
    // inside the judge work root — no raw `chown` on sudoers any more.
    await new Promise((r) => spawn('sudo', ['-n', SANDBOX_WRAPPERS.cleanPath, '--chown-only', '--dir', dir],
      { stdio: 'ignore' }).on('close', r));
    return;
  }
  await new Promise((r) => spawn('sudo', ['-n', 'chown', '-R', me, dir], { stdio: 'ignore' }).on('close', r));
}

async function cleanupWorkdir(dir) {
  // Only ever delete inside our own workdir root — `dir` is generated here and
  // never comes from a request, and this keeps it that way.
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(WORKERS) + path.sep)) return;
  try {
    await fsp.rm(resolved, { recursive: true, force: true });
    if (!fs.existsSync(resolved)) return;
  } catch (_) { /* fall through to the privileged path */ }
  if (!IS_WINDOWS) {
    if (SANDBOX_WRAPPERS.enabled) {
      await new Promise((r) => spawn('sudo', ['-n', SANDBOX_WRAPPERS.cleanPath, '--dir', resolved],
        { stdio: 'ignore' }).on('close', r));
    } else {
      await new Promise((r) => spawn('sudo', ['-n', 'rm', '-rf', resolved], { stdio: 'ignore' }).on('close', r));
    }
  }
  if (fs.existsSync(resolved) && !warnedCleanup) {
    warnedCleanup = true;
    console.warn(`[judge] cannot remove work directory ${resolved} — temp space will grow. `
      + 'Check that the judge user may run `sudo -n rm`.');
  }
}

/** Boot sweep: clear anything a previous process left behind. */
async function sweepStaleWorkdirs() {
  try {
    const entries = await fsp.readdir(WORKERS).catch(() => []);
    const stale = entries.filter((e) => e.startsWith('run-'));
    if (!stale.length) return;
    for (const e of stale) await cleanupWorkdir(path.join(WORKERS, e));
    console.log(`[judge] swept ${stale.length} stale work director${stale.length === 1 ? 'y' : 'ies'}`);
  } catch (_) { /* never block startup on housekeeping */ }
}

/** Spawn a process, feed stdin, enforce wall-clock timeout, kill the whole tree. */
function execute({ command, args, cwd, stdin = '', timeoutMs, env, memoryLimitKb = 0 }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: env || childEnv(),
      // POSIX: own process group so we can kill the tree; Windows: taskkill handles the tree
      detached: !IS_WINDOWS,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '', stderr = '', killedByTimeout = false, settled = false;
    const memory = peakMemorySampler(child.pid);
    // peakMemorySampler only MEASURES. The guard is what ENFORCES: without it a
    // runtime exempt from RLIMIT_AS (the JVM, V8) had no ceiling at all, and
    // even a measured overrun was ignored unless the program happened to exit
    // non-zero.
    const guard = memoryLimitKb > 0 ? SANDBOX.memoryGuard(child.pid, memoryLimitKb) : null;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      killTree(child);
    }, timeoutMs);

    child.stdout.on('data', (d) => { if (stdout.length < OUTPUT_CAP * 2) stdout += d.toString(); });
    child.stderr.on('data', (d) => { if (stderr.length < OUTPUT_CAP * 2) stderr += d.toString(); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true; clearTimeout(timer); memory.stop();
      resolve({ stdout, stderr: String(err.message || err), code: -1, time: Date.now() - started, killedByTimeout, memoryKb: 0, spawnError: true });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const sampled = memory.stop();
      const enforced = guard ? guard.stop() : null;
      const memoryKb = Math.max(sampled, (enforced && enforced.peakKb) || 0);
      resolve({
        stdout, stderr, code, time: Date.now() - started, killedByTimeout, memoryKb,
        memoryExceeded: !!(enforced && enforced.exceeded),
        memoryMode: enforced ? enforced.mode : 'sampler-only',
      });
    });

    // A program may exit before consuming stdin. Without this handler Node
    // reports EPIPE as an unhandled stream error instead of returning the
    // program's real exit status/output.
    child.stdin.on('error', () => {});
    try {
      if (stdin) child.stdin.write(stdin);
      child.stdin.end();
    } catch (_) { /* child already exited; close/error handlers settle */ }
  });
}

let queue = [];
let active = 0;
function enqueue(task) {
  return new Promise((resolve, reject) => {
    // Bounded queue: an unbounded backlog turns a class-wide submit burst
    // (or a flood) into unbounded memory growth and multi-minute silent
    // waits. Beyond the cap the API gets a fast, honest 429 instead.
    if (queue.length >= MAX_QUEUE) {
      const err = new Error('Judge is busy — too many executions queued. Try again in a moment.');
      err.code = 'QUEUE_FULL'; err.statusCode = 429;
      reject(err);
      return;
    }
    queue.push({ task, resolve, reject });
    pump();
  });
}
function pump() {
  while (active < MAX_CONCURRENCY && queue.length) {
    const item = queue.shift();
    active++;
    item.task()
      .then(item.resolve, item.reject)
      .finally(() => { active--; pump(); });
  }
}

/* ------------------------------------------------------------------ */
/* normalisation                                                       */
/* ------------------------------------------------------------------ */
function normalise(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n+$/, '')
    .trim();
}

/* SQL executions share ONE scratch schema, so they are serialised: two
 * students' DROP/CREATE statements must never interleave. */
let sqlChain = Promise.resolve();
function withSqlLock(fn) {
  const p = sqlChain.then(fn, fn);
  sqlChain = p.then(() => {}, () => {});
  return p;
}

/* ------------------------------------------------------------------ */
/* the actual sandboxed run                                            */
/* ------------------------------------------------------------------ */
async function runSingle({ language, sourceCode, stdin = '', timeLimitMs = DEFAULT_RUN_TIMEOUT, memoryLimitKb = DEFAULT_MEMORY, _dir = null, _prepared = false, _keepDir = false, _compileOnly = false }) {
  const lang = LANGUAGES[String(language || '').toLowerCase()];
  if (!lang) {
    return { status: STATUS.INTERNAL_ERROR, stdout: '', stderr: `Unsupported language: ${language}`, compile_output: '', time: 0, memory: 0, exit_code: null };
  }

  // Batch runs pass a shared _dir with _prepared=true after the first test so
  // the program is written+compiled ONCE per submission instead of per test.
  const dir = _dir || await fsp.mkdtemp(path.join(WORKERS, 'run-'));
  try {
    const langKeyEarly = String(language || '').toLowerCase();
    const isJava = langKeyEarly === 'java';
    let sourceText = String(sourceCode || '');
    let srcFile = lang.file;
    let javaClass = null;
    if (isJava) {
      sourceText = stripPackageLine(sourceText);
      javaClass = javaClassName(sourceText) || 'Main';
      srcFile = `${javaClass}.java`;
    }
    if (!_prepared) {
      await fsp.writeFile(path.join(dir, srcFile), sourceText, 'utf8');
      await fsp.writeFile(path.join(dir, 'stdin.txt'), stdin || '', 'utf8');
      await fsp.chmod(path.join(dir, srcFile), 0o644).catch(() => {});
      await fsp.chmod(path.join(dir, 'stdin.txt'), 0o644).catch(() => {});
    }
    if (SANDBOX_MODE === 'posix' && !SANDBOX_WRAPPERS.enabled) {
      // The sandbox user must own every fresh/copied workdir. 0711 lets that
      // user work inside it while the worker retains traverse permission for
      // cleanup. This also runs for copied per-test dirs. In wrapper mode the
      // sodl-exec wrapper performs this chown+chmod itself (root, bounded to
      // the judge work root) right before each exec.
      await fsp.chmod(dir, 0o711).catch(() => {});
      await new Promise((r) => spawn('sudo', ['-n', 'chown', '-R', RUN_AS, dir], { stdio: 'ignore' }).on('close', r));
    }

    /* ---------- SQL: run against a throwaway MariaDB sandbox ---------- */
    if (String(language).toLowerCase() === 'sql') {
      return await withSqlLock(() => runSql({ sourceCode, stdin, timeLimitMs, dir }));
    }

    /* ---------- compile (once per batch) ---------- */
    if (lang.compile && !_prepared) {
      const [cbin, cargsBase] = lang.compile;
      const cargs = isJava ? cargsBase.map((a) => (a === 'Main.java' ? srcFile : a)) : cargsBase;
      const compileAs = String(language).toLowerCase() === 'java' ? 5 * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024;
      const { command, args } = buildCommand(cbin, cargs, { cpuSec: Math.ceil(COMPILE_TIMEOUT / 1000), as: compileAs, nproc: 128, fsize: 64 * 1024 * 1024 }, { dir });
      const c = await execute({ command, args, cwd: dir, timeoutMs: COMPILE_TIMEOUT, memoryLimitKb: COMPILE_MEMORY_LIMIT_KB });
      if (c.killedByTimeout || c.code !== 0) {
        let cmsg = truncate(c.stderr || c.stdout);
        if (c.spawnError) {
          // The compiler binary itself was not found; explain it plainly instead of using jargon.
          cmsg = `Compiler "${path.basename(cbin)}" was NOT found on this computer (spawn failed).\n`
               + `Check the "toolchains found:" line in the Judge Worker window. For every compiler missing there,\n`
               + `add its bin folder to the system PATH and restart the Judge Worker.\n`
               + `Diagnostic: double-click test-compilers.bat and it will identify the cause in about 30 seconds.\n\n` + cmsg;
        }
        return {
          status: c.killedByTimeout ? STATUS.INTERNAL_ERROR : STATUS.COMPILE_ERROR,
          stdout: truncate(c.stdout), stderr: truncate(c.stderr), compile_output: cmsg,
          time: c.time / 1000, memory: 0, exit_code: c.code,
        };
      }
    }

    if (_compileOnly) {
      return { status: STATUS.ACCEPTED, stdout: '', stderr: '', compile_output: '', time: 0, memory: 0, exit_code: 0 };
    }

    /* ---------- run ---------- */
    const runTimeout = Math.min(Math.max(Number(timeLimitMs) || DEFAULT_RUN_TIMEOUT, 100), 10000);
    const memKb = Math.min(Math.max(Number(memoryLimitKb) || DEFAULT_MEMORY, 16384), 1024 * 1024);
    let [rbin, rargs] = lang.run();
    if (String(language).toLowerCase() === 'sql') { /* handled above */ }
    if (isJava) {
      // run the student's own top-level class (VS Code behaviour), honouring the memory cap
      rargs = rargs.map((a) => (a === 'Main' ? javaClass : a));
      rargs = rargs.map((a) => (a.startsWith('-Xmx') ? `-Xmx${Math.floor(memKb / 1024)}m` : a));
    }
    if (String(language).toLowerCase() === 'javascript') {
      rargs = ['--max-old-space-size=' + Math.max(32, Math.floor(memKb / 1024)), ...rargs];
    }
    // The JVM and V8 reserve huge virtual address ranges up front, so RLIMIT_AS would
    // kill them before the program even starts — they are capped with -Xmx /
    // --max-old-space-size instead. Native runtimes get a real address-space cap
    // (problem memory limit + head-room for the interpreter/binary).
    const VM_RUNTIMES = new Set(['java', 'javascript']);
    const langKey = String(language).toLowerCase();
    const asLimit = VM_RUNTIMES.has(langKey) ? lang.limit.as : (memKb + 64 * 1024) * 1024;

    // The ceiling actually enforced: the problem's limit plus the runtime's own
    // unavoidable footprint. (See MEMORY_RUNTIME_ALLOWANCE_KB above.)
    const enforcedMemKb = memKb + memoryAllowanceKb(langKey);
    const { command, args } = buildCommand(rbin, rargs, {
      cpuSec: Math.ceil(runTimeout / 1000) + 1,
      as: asLimit,
      nproc: lang.limit.nproc,
      fsize: 32 * 1024 * 1024,
    }, { dir });
    const r = await execute({ command, args, cwd: dir, stdin, timeoutMs: runTimeout + 500, memoryLimitKb: enforcedMemKb });

    if (r.killedByTimeout) {
      return { status: STATUS.TLE, stdout: truncate(r.stdout), stderr: truncate(r.stderr), compile_output: '', time: runTimeout / 1000, memory: memMb(r.memoryKb), exit_code: r.code };
    }
    if (r.spawnError) {
      return {
        status: STATUS.INTERNAL_ERROR, stdout: '',
        stderr: `Runtime "${path.basename(rbin)}" was NOT found on this computer (spawn failed). Add the interpreter/compiler bin folder to PATH and restart the Judge Worker.\n${truncate(r.stderr)}`,
        compile_output: '', time: r.time / 1000, memory: 0, exit_code: -1,
      };
    }
    // MEMORY IS A LIMIT WHETHER OR NOT THE PROGRAM EXITED CLEANLY.
    // MLE used to be decided only inside the `r.code !== 0` branch below, so a
    // run measured at 297 MB against a 16 MB cap was reported Accepted purely
    // because it finished with status 0. The guard above also kills a tree that
    // crosses the ceiling, which is what finally enforces it for the JVM and V8
    // (they stay exempt from RLIMIT_AS because they reserve huge virtual ranges
    // up front and --as kills them before they start).
    if (r.memoryExceeded || (r.memoryKb && r.memoryKb > enforcedMemKb)) {
      return {
        status: STATUS.MLE,
        stdout: truncate(r.stdout),
        stderr: `Memory limit exceeded — the program used ${memMb(r.memoryKb)} MB and the limit for this problem is ${Math.round(memKb / 1024)} MB.\n${truncate(r.stderr, 2000)}`,
        compile_output: '',
        time: r.time / 1000,
        memory: memMb(r.memoryKb),
        exit_code: r.code,
        memory_mode: r.memoryMode,
      };
    }

    if (r.code !== 0) {
      // died right at the limit (or the kernel shot it for using too much) -> MLE
      const atCeiling = r.memoryKb && r.memoryKb >= memKb * 0.9;
      // 137 = SIGKILL (kernel OOM), 134/139 = abort/segfault right after a failed allocation
      const crashedHard = r.code === 134 || r.code === 139;
      const nativeLang = langKey === 'c' || langKey === 'cpp';
      const oomKilled = r.code === 137
        || /Cannot allocate memory|MemoryError|bad_alloc|bad_array_new_length|OutOfMemoryError|allocation of \d+ bytes failed|heap out of memory|alloc failed/i.test(r.stderr || '')
        || (nativeLang && crashedHard && r.memoryKb >= memKb * 0.5);
      if (atCeiling || oomKilled) {
        return {
          status: STATUS.MLE,
          stdout: truncate(r.stdout),
          stderr: `Memory limit exceeded — the program needed more than ${Math.round(memKb / 1024)} MB.\n${truncate(r.stderr, 2000)}`,
          compile_output: '',
          time: r.time / 1000,
          memory: memMb(r.memoryKb),
          exit_code: r.code,
        };
      }
      // native crash at ~the limit: malloc returned NULL and the program dereferenced it
      const crashed = r.code === 134 || r.code === 139;
      const tail = nativeLang && crashed
        ? `\n(hint: this program was allowed ${Math.round(memKb / 1024)} MB — if it allocated a bigger array, the allocation failed and the program crashed on the null pointer)`
        : '';
      // The most common student scenario: the program requested input, but the input box was EMPTY.
      // The judge is not interactive. VS Code and online compilers pause and prompt, whereas
      // the judge pipes in stdin supplied in advance. Empty stdin causes an immediate crash.
      const eofLike = /NoSuchElementException|No line found|EOFError|EOF when reading a line|killed by EOF/i.test(String(r.stderr || ''));
      const eofHint = eofLike
        ? `\n(hint: the program requested INPUT, but the input box was completely EMPTY. Enter data in the input box above or below BEFORE clicking Run. Unlike VS Code, a program running under the judge cannot pause midway to request input.)`
        : '';
      return { status: STATUS.RUNTIME_ERROR, stdout: truncate(r.stdout), stderr: truncate(r.stderr + tail + eofHint), compile_output: '', time: r.time / 1000, memory: memMb(r.memoryKb), exit_code: r.code };
    }
    return { status: STATUS.ACCEPTED, stdout: truncate(r.stdout), stderr: truncate(r.stderr), compile_output: '', time: r.time / 1000, memory: memMb(r.memoryKb), exit_code: r.code };
  } catch (err) {
    return { status: STATUS.INTERNAL_ERROR, stdout: '', stderr: truncate(String(err && err.message ? err.message : err)), compile_output: '', time: 0, memory: 0, exit_code: -1 };
  } finally {
    if (!_keepDir) await cleanupWorkdir(dir);
  }
}

/* ------------------------------------------------------------------ */
/* SQL sandbox (never touches the main application schema)             */
/* ------------------------------------------------------------------ */
async function runSql({ sourceCode, stdin, timeLimitMs, dir }) {
  if (!SQL_ENABLED) throw new Error('SQL execution is disabled');
  const fixture = fs.existsSync(SQL_FIXTURE) ? await fsp.readFile(SQL_FIXTURE, 'utf8') : '';
  // Fixture + student query are streamed to the mysql CLI over stdin (no shell,
  // no file written into the sandbox-owned workdir).
  // One shared scratch schema serves every student (serialised by
  // withSqlLock). Wipe whatever a previous submission created so runs cannot
  // see — or be broken by — each other's tables, then apply the fixture.
  const preclean = [
    'SET FOREIGN_KEY_CHECKS = 0;',
    "SET @__tables := (SELECT GROUP_CONCAT(CONCAT('`', TABLE_NAME, '`')) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE');",
    "SET @__stmt := IF(@__tables IS NULL, 'SELECT 1', CONCAT('DROP TABLE IF EXISTS ', @__tables));",
    'PREPARE __st FROM @__stmt;',
    'EXECUTE __st;',
    'DEALLOCATE PREPARE __st;',
    'SET FOREIGN_KEY_CHECKS = 1;',
  ].join('\n');
  const setup = `${preclean}\n${fixture}\n${sourceCode}\n`;

  const timeout = Math.min(Math.max(Number(timeLimitMs) || 2000, 100), 10000);
  const mysqlArgs = [
    '--protocol=tcp',
    '-h', process.env.SQL_SANDBOX_HOST,
    '-P', String(process.env.SQL_SANDBOX_PORT),
    '-u', process.env.SQL_SANDBOX_USER,
    // Password transport: off-POSIX (direct spawn) MYSQL_PWD keeps it out of
    // the process list. Under sudo it would be stripped by env_reset, so the
    // argv form is used there — contained by the private PID namespace the
    // network path now also gets (lib/platform.js buildCommand).
    ...(SANDBOX_MODE === 'posix' ? [`--password=${process.env.SQL_SANDBOX_PASSWORD}`] : []),
    '--batch', '--raw', '--skip-column-names', '--connect-timeout=5',
    process.env.SQL_SANDBOX_DB,   // connect straight into the scratch schema
  ];
  const { command, args } = buildCommand(BIN.mysql, mysqlArgs,
    { cpuSec: Math.ceil(timeout / 1000) + 1, as: 512 * 1024 * 1024, nproc: 32, fsize: 16 * 1024 * 1024 },
    { network: true, dir });   // must reach MySQL on loopback; contained by the edu_sql grant

  // `setup` is passed directly (no re-read of the sandbox file, which is owned by the run user)
  const r = await execute({
    command, args, cwd: dir, stdin: setup, timeoutMs: timeout + 500,
    env: SANDBOX_MODE === 'posix' ? undefined : childEnv({ MYSQL_PWD: process.env.SQL_SANDBOX_PASSWORD }),
  });
  if (r.killedByTimeout) return { status: STATUS.TLE, stdout: truncate(r.stdout), stderr: truncate(r.stderr), compile_output: '', time: timeout / 1000, memory: 0, exit_code: r.code };
  if (r.code !== 0) {
    return { status: STATUS.COMPILE_ERROR, stdout: truncate(r.stdout), stderr: truncate(r.stderr), compile_output: truncate(r.stderr), time: r.time / 1000, memory: 0, exit_code: r.code };
  }
  return { status: STATUS.ACCEPTED, stdout: truncate(r.stdout), stderr: '', compile_output: '', time: r.time / 1000, memory: 0, exit_code: 0 };
}

/* ------------------------------------------------------------------ */
/* HTTP API                                                            */
/* ------------------------------------------------------------------ */
const app = express();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
app.use(express.json({ limit: '2mb' }));

// Liveness probe for platform healthchecks (the checker cannot send the
// judge token). Reveals nothing beyond "the process is up" — full health
// detail stays behind the token check on /health.
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

app.use((req, res, next) => {
  const provided = Buffer.from(req.get('x-judge-token') || '');
  const expected = Buffer.from(TOKEN);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized judge worker request' });
  }
  next();
});

app.get('/health', (req, res) => {
  const diagnostics = toolchainDiagnostics();
  const sandboxReady = process.env.NODE_ENV === 'production'
    ? SANDBOX_DIAGNOSTICS.ready
    : (SANDBOX_MODE !== 'posix' || SANDBOX_DIAGNOSTICS.ready);
  // Without a private root the worker is not safe to use, so /health says so
  // even though it will still answer (a hard failure belongs at boot, above).
  const healthy = diagnostics.ready_languages.length > 0 && sandboxReady && FS_ISOLATION.filesystem_isolation;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded', service: 'smartodl-judge', engine: 'local-sandbox',
    platform: process.platform, sandbox: SANDBOX_MODE, runAs: RUN_AS || process.env.USER || 'current-user',
    sandbox_ready: SANDBOX_DIAGNOSTICS.ready,
    sandbox_diagnostics: SANDBOX_DIAGNOSTICS,
    filesystem_isolation: FS_ISOLATION.filesystem_isolation,
    filesystem_isolation_mode: FS_ISOLATION.mode,
    memory_limit: SANDBOX.cgroupAvailable().ok ? 'cgroup' : 'rss-sampler',
    // Only languages whose complete toolchain exists. The old filter said
    // every language was ready whenever any one binary existed.
    languages: diagnostics.ready_languages,
    supported_languages: Object.keys(LANGUAGES),
    language_diagnostics: diagnostics.languages,
    toolchains: diagnostics.toolchains,
    queue: queue.length, active, concurrency: MAX_CONCURRENCY, maxQueue: MAX_QUEUE,
    max_batch_tests: MAX_BATCH_TESTS,
    uptime: process.uptime(),
  });
});

app.get('/api/v1/languages', (req, res) => {
  const diagnostics = toolchainDiagnostics();
  res.json({
    languages: diagnostics.ready_languages,
    supported_languages: Object.keys(LANGUAGES),
    language_diagnostics: diagnostics.languages,
  });
});

app.get('/api/v1/statuses', (req, res) => res.json({ statuses: Object.values(STATUS) }));

/** Single execution with custom stdin — powers the "Run Code" button. */
app.post('/api/v1/execute', asyncRoute(async (req, res) => {
  const { language, source_code, stdin, time_limit_ms, memory_limit_kb } = req.body || {};
  if (!language || typeof source_code !== 'string') return res.status(400).json({ error: 'language and source_code are required' });
  if (source_code.length > 100000) return res.status(413).json({ error: 'Source code too large (max 100 KB)' });
  const result = await enqueue(() => runSingle({ language, sourceCode: source_code, stdin, timeLimitMs: time_limit_ms, memoryLimitKb: memory_limit_kb }));
  res.json(result);
}));

/** Batch execution against test cases — powers "Submit Code" auto-judging. */
app.post('/api/v1/execute-batch', asyncRoute(async (req, res) => {
  const { language, source_code, tests, time_limit_ms, memory_limit_kb, stop_on_failure = true } = req.body || {};
  if (!language || typeof source_code !== 'string' || !Array.isArray(tests)) {
    return res.status(400).json({ error: 'language, source_code and tests[] are required' });
  }
  if (source_code.length > 100000) return res.status(413).json({ error: 'Source code too large (max 100 KB)' });
  if (tests.length === 0) return res.status(400).json({ error: 'tests[] must not be empty' });
  if (tests.length > MAX_BATCH_TESTS) {
    // Never silently slice: dropping the 61st case could turn a failing
    // submission into Accepted. The API chunks larger submissions and a
    // direct caller gets an explicit error.
    return res.status(413).json({ error: `Too many test cases in one batch (max ${MAX_BATCH_TESTS})` });
  }
  if (tests.some((test) => !test || typeof test !== 'object')) {
    return res.status(400).json({ error: 'Every test must be an object' });
  }
  const results = [];
  const batch = tests;
  const isSql = String(language).toLowerCase() === 'sql';
  // Compile once into a template directory, then copy that pristine
  // directory for each test. Sharing one live directory let test 1 create a
  // file that test 2 could read (or overwrite the source/binary), making
  // verdicts order-dependent. SQL keeps a fresh dir per test; its isolation
  // comes from withSqlLock + the preclean wipe.
  let templateDir = null;
  let compileFailure = null;
  try {
    if (!isSql) {
      templateDir = await makeWorkdir();
      const prepared = await enqueue(() => runSingle({
        language, sourceCode: source_code, stdin: '',
        timeLimitMs: time_limit_ms, memoryLimitKb: memory_limit_kb,
        _dir: templateDir, _keepDir: true, _compileOnly: true,
      }));
      if (prepared.status && (prepared.status.id === STATUS.COMPILE_ERROR.id || prepared.status.id === STATUS.INTERNAL_ERROR.id)) {
        compileFailure = prepared;
      }
      // The prepare run chowned the template to the sandbox user; take it
      // back so copyWorkdir can read it when this worker is not root.
      if (!compileFailure) await reclaimWorkdir(templateDir);
    }
    for (let i = 0; i < batch.length; i += 1) {
      const t = batch[i];
      let out;
      if (compileFailure) {
        out = compileFailure; // same compile/internal failure for every case
      } else if (isSql) {
        out = await enqueue(() => runSingle({
          language, sourceCode: source_code, stdin: t.input || '',
          timeLimitMs: time_limit_ms, memoryLimitKb: memory_limit_kb,
        }));
      } else {
        out = await enqueue(async () => {
          const testDir = await copyWorkdir(templateDir);
          return runSingle({
            language, sourceCode: source_code, stdin: t.input || '',
            timeLimitMs: time_limit_ms, memoryLimitKb: memory_limit_kb,
            _dir: testDir, _prepared: true, _keepDir: false,
          });
        });
      }
      const expected = normalise(t.expected_output);
      const got = normalise(out.stdout);
      let status = out.status;
      if (status.id === STATUS.ACCEPTED.id) status = got === expected ? STATUS.ACCEPTED : STATUS.WRONG_ANSWER;
      results.push({ ...out, status, passed: status.id === STATUS.ACCEPTED.id, expected: t.expected_output || '', got: out.stdout });
      if (stop_on_failure && status.id !== STATUS.ACCEPTED.id) break;
    }
  } finally {
    if (templateDir) await cleanupWorkdir(templateDir);
  }
  res.json({ results });
}));

app.use((err, req, res, next) => {
  console.error('[judge] error:', err && err.message);
  res.status((err && err.statusCode) || 500).json({
    error: 'Judge worker error',
    detail: process.env.NODE_ENV === 'production' ? undefined : (err && err.message),
  });
});

/* 0o711: traversable but NOT listable.
 * Every submission executes as the same user (`nobody`), so file ownership
 * cannot keep one student's run out of another's. With a 0755 parent, any
 * submission could glob this directory, find a classmate's run folder and
 * read their in-flight solution during a live contest. Dropping the read bit
 * leaves the randomly-named run directories unguessable.
 */
fs.mkdirSync(WORKERS, { recursive: true, mode: 0o711 });
try { fs.chmodSync(WORKERS, 0o711); } catch (_) { /* pre-existing dir */ }
app.listen(PORT, HOST, () => {
  sweepStaleWorkdirs();   // clear anything a previous run left behind
  const diagnostics = toolchainDiagnostics();
  const found = diagnostics.toolchains.filter((tool) => tool.found).map((tool) => tool.tool);
  const missing = diagnostics.toolchains.filter((tool) => !tool.found).map((tool) => tool.tool);
  console.log(`[judge] SmartODL sandbox worker listening on http://${HOST}:${PORT}`);
  console.log(`[judge] platform=${process.platform}  sandbox=${SANDBOX_MODE}  run-as=${RUN_AS || 'current user'}  concurrency=${MAX_CONCURRENCY}`);
  console.log(`[judge] sandbox ready=${SANDBOX_DIAGNOSTICS.ready}  diagnostics=${JSON.stringify(SANDBOX_DIAGNOSTICS)}`);
  console.log(`[judge] filesystem isolation=${FS_ISOLATION.filesystem_isolation ? `yes (${FS_ISOLATION.mode}, drop=${FS_ISOLATION.drop || 'uid-map'})` : `NO — ${FS_ISOLATION.reason || 'unavailable'}`}`);
  console.log(`[judge] memory limit=${SANDBOX.cgroupAvailable().ok ? 'cgroup v2' : 'aggregate-RSS sampler'}  toolchain mounts=${SANDBOX.RO_BINDS_DEFAULT.filter((x) => { try { require('fs').accessSync(x); return true; } catch (_) { return false; } }).join(' ')}`);
  console.log(`[judge] workdir=${WORKERS}`);
  console.log(`[judge] toolchains found: ${found.join(', ') || 'none'}`);
  console.log(`[judge] languages ready: ${diagnostics.ready_languages.join(', ') || 'none'}`);
  if (missing.length) console.log(`[judge] not found (those languages will report a Compile/Internal Error): ${missing.join(', ')}`);
  if (SANDBOX_MODE === 'none') {
    console.log('[judge] NOTE: this host has no sudo/prlimit sandbox. Time limits, output caps and');
    console.log('[judge]       process-tree termination still apply, but this is NOT a security');
    console.log('[judge]       boundary — use Linux or JUDGE_MODE=judge0 for public deployments.');
  }
});
