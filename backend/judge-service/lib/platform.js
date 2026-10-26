'use strict';
/**
 * Platform layer for the judge worker.
 *
 * The sandbox uses Linux primitives (`sudo -n -u nobody` + `prlimit`). Windows has
 * neither, so this module detects the host, resolves the real path of every compiler
 * (XAMPP's mysql.exe, MinGW gcc, the JDK, Python …) and exposes one uniform API:
 *
 *     SANDBOX_MODE      'posix'  → full isolation (sudo + prlimit)
 *                       'none'   → direct execution, wall-clock + output limits only
 *     findBinary()      cached, PATH-aware executable lookup (adds .exe on Windows)
 *     buildCommand()    wraps a command for the current platform
 *     killTree()        kills the whole process tree on either OS
 *     childEnv()        a small, predictable environment for the child process
 *
 * Windows note: `SANDBOX_MODE === 'none'` still enforces time limits, output caps and
 * process-tree termination, which is enough for classroom/dev use, but it is NOT a
 * security boundary. For anything public, run the worker on Linux or point
 * JUDGE_MODE=judge0 at a hosted Judge0 CE instance.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const IS_WINDOWS = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

/* ------------------------------------------------------------------ */
/* binary resolution                                                    */
/* ------------------------------------------------------------------ */
const cache = new Map();

/** Candidate names for a tool, per platform (python3 vs python vs py …). */
function candidates(names) {
  const list = Array.isArray(names) ? names : [names];
  const out = [];
  for (const n of list) {
    out.push(n);
    if (IS_WINDOWS) {
      if (!/\.(exe|cmd|bat)$/i.test(n)) out.push(`${n}.exe`, `${n}.cmd`, `${n}.bat`);
    }
  }
  return out;
}

/** Extra Windows install locations worth probing (XAMPP, MinGW, JDK, Python). */
const WINDOWS_HINTS = {
  mysql: ['C:/xampp/mysql/bin/mysql.exe', 'C:/xampp/mariadb/bin/mysql.exe',
    'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe',
    'C:/Program Files/MariaDB 10.4/bin/mysql.exe'],
  gcc: ['C:/xampp/mingw64/bin/gcc.exe', 'C:/MinGW/bin/gcc.exe', 'C:/msys64/mingw64/bin/gcc.exe',
    'C:/msys64/ucrt64/bin/gcc.exe', 'C:/mingw64/bin/gcc.exe', 'C:/TDM-GCC-64/bin/gcc.exe',
    'C:/cygwin64/bin/gcc.exe', 'C:/Strawberry/c/bin/gcc.exe',
    'C:/Program Files/CodeBlocks/MinGW/bin/gcc.exe', 'C:/ProgramData/chocolatey/bin/gcc.exe'],
  'g++': ['C:/xampp/mingw64/bin/g++.exe', 'C:/MinGW/bin/g++.exe', 'C:/msys64/mingw64/bin/g++.exe',
    'C:/msys64/ucrt64/bin/g++.exe', 'C:/mingw64/bin/g++.exe', 'C:/TDM-GCC-64/bin/g++.exe',
    'C:/cygwin64/bin/g++.exe', 'C:/Strawberry/c/bin/g++.exe',
    'C:/Program Files/CodeBlocks/MinGW/bin/g++.exe', 'C:/ProgramData/chocolatey/bin/g++.exe'],
  python: ['C:/Python313/python.exe', 'C:/Python312/python.exe', 'C:/Python311/python.exe',
    'C:/Python310/python.exe', 'C:/Python39/python.exe',
    `${process.env.LOCALAPPDATA || ''}/Programs/Python/Python313/python.exe`,
    `${process.env.LOCALAPPDATA || ''}/Programs/Python/Python312/python.exe`,
    `${process.env.LOCALAPPDATA || ''}/Programs/Python/Python311/python.exe`,
    `${process.env.LOCALAPPDATA || ''}/Programs/Python/Python310/python.exe`,
    'C:/xampp/python/python.exe'],
  javac: ['C:/Program Files/Java/jdk-21/bin/javac.exe', 'C:/Program Files/Java/jdk-17/bin/javac.exe',
    'C:/Program Files/Java/jdk-24/bin/javac.exe', 'C:/Program Files/Java/jdk-23/bin/javac.exe',
    'C:/Program Files/Java/jdk-22/bin/javac.exe', 'C:/Program Files/Java/jdk-11/bin/javac.exe',
    'C:/Program Files/Eclipse Adoptium/jdk-21/bin/javac.exe', 'C:/Program Files/Eclipse Adoptium/jdk-17/bin/javac.exe',
    'C:/Program Files/Eclipse Adoptium/jdk-11/bin/javac.exe',
    'C:/Program Files/Microsoft/jdk-21/bin/javac.exe', 'C:/Program Files/Microsoft/jdk-17/bin/javac.exe',
    'C:/Program Files/Amazon Corretto/jdk21/bin/javac.exe', 'C:/Program Files/Amazon Corretto/jdk17/bin/javac.exe',
    'C:/Program Files/Zulu/zulu-21/bin/javac.exe', 'C:/Program Files/Zulu/zulu-17/bin/javac.exe'],
  java: ['C:/Program Files/Java/jdk-21/bin/java.exe', 'C:/Program Files/Java/jdk-17/bin/java.exe',
    'C:/Program Files/Java/jdk-24/bin/java.exe', 'C:/Program Files/Java/jdk-23/bin/java.exe',
    'C:/Program Files/Java/jdk-22/bin/java.exe', 'C:/Program Files/Java/jdk-11/bin/java.exe',
    'C:/Program Files/Eclipse Adoptium/jdk-21/bin/java.exe', 'C:/Program Files/Eclipse Adoptium/jdk-17/bin/java.exe',
    'C:/Program Files/Eclipse Adoptium/jdk-11/bin/java.exe',
    'C:/Program Files/Microsoft/jdk-21/bin/java.exe', 'C:/Program Files/Microsoft/jdk-17/bin/java.exe',
    'C:/Program Files/Amazon Corretto/jdk21/bin/java.exe', 'C:/Program Files/Amazon Corretto/jdk17/bin/java.exe',
    'C:/Program Files/Zulu/zulu-21/bin/java.exe', 'C:/Program Files/Zulu/zulu-17/bin/java.exe'],
  node: ['C:/Program Files/nodejs/node.exe', `${process.env.PROGRAMFILES || 'C:/Program Files'}/nodejs/node.exe`],
};

function exists(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}

/** Resolve an executable. Returns { name } (found on PATH) or { path } (absolute). */
function findBinary(names) {
  const key = (Array.isArray(names) ? names : [names]).join('|');
  if (cache.has(key)) return cache.get(key);

  const list = candidates(names);
  const dirs = (process.env.PATH || '').split(IS_WINDOWS ? ';' : ':').filter(Boolean);

  // 1) absolute path given directly
  for (const n of list) {
    if (path.isAbsolute(n) && exists(n)) { const r = { path: n, name: path.basename(n) }; cache.set(key, r); return r; }
  }
  // 2) PATH lookup
  for (const n of list) {
    for (const d of dirs) {
      const full = path.join(d, n);
      if (exists(full)) { const r = { path: full, name: n }; cache.set(key, r); return r; }
    }
  }
  // 3) known install locations (mainly Windows)
  if (IS_WINDOWS) {
    const base = String(Array.isArray(names) ? names[0] : names).replace(/\.(exe|cmd|bat)$/i, '');
    for (const hint of WINDOWS_HINTS[base] || []) {
      if (hint && exists(hint)) { const r = { path: hint, name: path.basename(hint) }; cache.set(key, r); return r; }
    }
  }
  // 4) last resort: ask the OS itself — `where` on Windows, `which` elsewhere.
  //    This mirrors exactly what a terminal / VS Code would find, even when the
  //    process PATH looks different (e.g. service shells with stripped env).
  {
    const tool = IS_WINDOWS ? 'where.exe' : 'which';
    for (const n of list) {
      try {
        const out = execFileSync(tool, [n], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString();
        for (const line of out.split(/\r?\n/)) {
          const p = line.trim();
          if (p && exists(p)) { const r = { path: p, name: path.basename(p) }; cache.set(key, r); return r; }
        }
      } catch { /* not resolvable under this name — try the next */ }
    }
  }
  const miss = { missing: true, name: Array.isArray(names) ? names[0] : names };
  cache.set(key, miss);
  return miss;
}

/** The string to spawn for a tool (absolute path when we had to hunt for it). */
function binName(names, fallback) {
  const found = findBinary(names);
  if (found.missing) return fallback || (Array.isArray(names) ? names[0] : names);
  return found.path || found.name;
}

/* ------------------------------------------------------------------ */
/* sandbox mode                                                         */
/* ------------------------------------------------------------------ */
// On POSIX we can drop to an unprivileged user; on Windows we cannot.
const RUN_AS = process.env.JUDGE_RUN_AS === '' ? null : (process.env.JUDGE_RUN_AS || (IS_WINDOWS ? null : 'nobody'));
const SANDBOX_MODE = (!IS_WINDOWS && RUN_AS) ? 'posix' : 'none';

/* ------------------------------------------------------------------ */
/* command building                                                     */
/* ------------------------------------------------------------------ */
/**
 * Wrap a command with `sudo -n -u <user> prlimit …` when the host supports it.
 *
 * `opts.network` (default false) decides whether the child keeps network
 * access. Submitted code must NOT have any: without this a student can simply
 * call an AI API or fetch a solution from inside their program, which walks
 * straight past the fullscreen lockdown, the copy-paste block and the
 * typing analytics. `unshare -n` gives the child an empty network namespace.
 *
 * SQL questions are the one exception — the runner has to reach MySQL on
 * loopback, and a fresh namespace has its own (separate, down) loopback. That
 * path stays on the host network and is contained by the least-privilege
 * `edu_sql` grant instead, which cannot see the application schema.
 */
/**
 * Can this host give the child its own PID namespace and a private /proc?
 *
 * Without it, submitted code can run `ps aux` and read /proc for every process
 * on the machine — the full command line of each one. That leaks the install
 * layout and any secret that happens to sit on a command line. Measured on a
 * normal box: 104 visible PIDs before, 2 after.
 *
 * Probed once at startup rather than assumed, because `--mount-proc` needs
 * privileges that some container hosts withhold. If it is not available the
 * judge keeps working exactly as before (network isolation only) and says so,
 * instead of failing every submission.
 */
/* ------------------------------------------------------------------ */
/* fixed-argument sudo wrappers (hardened deployments)                */
/* ------------------------------------------------------------------ */
/**
 * A sudoers entry like `NOPASSWD: /usr/bin/unshare, /usr/bin/chown, /usr/bin/rm`
 * hands the worker arbitrary root commands (unshare `-- anything`). The
 * sandbox/sodl-*.sh wrappers in this repo replace that pattern with two
 * bounded programs; when they are installed, every privileged action goes
 * through them and nothing else. Detection: both wrappers exist and are
 * executable — or JUDGE_SANDBOX_WRAPPERS=1 forces the mode (a missing wrapper
 * is then a hard error rather than a silent downgrade).
 */
const WRAPPER_DIR = process.env.JUDGE_SANDBOX_WRAPPER_DIR || '/usr/local/sbin';
const WRAP_EXEC = path.join(WRAPPER_DIR, 'sodl-exec');
const WRAP_CLEAN = path.join(WRAPPER_DIR, 'sodl-clean');

function detectWrappers() {
  if (SANDBOX_MODE !== 'posix') return { enabled: false, reason: 'not-posix' };
  const execOk = exists(WRAP_EXEC) && fs.existsSync(WRAP_CLEAN);
  const forced = ['1', 'true', 'yes', 'on'].includes(String(process.env.JUDGE_SANDBOX_WRAPPERS || '').trim().toLowerCase());
  if (forced && !execOk) {
    throw new Error(`JUDGE_SANDBOX_WRAPPERS is enabled but the sandbox wrappers are missing — expected executable `
      + `${WRAP_EXEC} and ${WRAP_CLEAN} (copy backend/judge-service/sandbox/sodl-*.sh there, root-owned, mode 0755)`);
  }
  return { enabled: execOk, execPath: WRAP_EXEC, cleanPath: WRAP_CLEAN };
}
const SANDBOX_WRAPPERS = detectWrappers();

let pidNsSupported = null;
function supportsPidNamespace() {
  if (pidNsSupported !== null) return pidNsSupported;
  if (SANDBOX_MODE !== 'posix') { pidNsSupported = false; return false; }
  try {
    let probe;
    if (SANDBOX_WRAPPERS.enabled) {
      // Ask the wrapper itself — that is exactly the chain submissions take.
      probe = require('child_process').spawnSync(
        'sudo', ['-n', WRAP_EXEC, '--probe', '--ns', 'n,pid,fork,mount-proc'],
        { stdio: 'ignore', timeout: 5000 },
      );
    } else {
      probe = require('child_process').spawnSync(
        'sudo', ['-n', 'unshare', '-n', '--pid', '--fork', '--mount-proc', '--', '/bin/true'],
        { stdio: 'ignore', timeout: 5000 },
      );
    }
    pidNsSupported = probe.status === 0;
  } catch (_) { pidNsSupported = false; }
  if (!pidNsSupported) {
    console.warn('[judge] PID namespace unavailable on this host — submitted code can see the '
      + 'host process list. Network isolation and resource limits are unaffected.');
  }
  return pidNsSupported;
}

/** The wrapper argv fragment for one run (limits arrive as plain integers). */
function wrapperArgs(dir, limits, ns) {
  return [
    '-n', WRAP_EXEC,
    '--dir', String(dir),
    '--user', String(RUN_AS),
    '--cpu', String(Math.max(1, Math.ceil(limits.cpuSec))),
    '--as', String(limits.as),
    '--nproc', String(limits.nproc),
    '--nofile', '64',
    '--fsize', String(Math.max(1024 * 1024, limits.fsize)),
    '--stack', '67108864',
    '--core', '0',
    '--ns', ns,
    '--',
  ];
}

function buildCommand(cmd, args, limits, opts = {}) {
  if (SANDBOX_MODE !== 'posix') return { command: cmd, args };   // Windows: run directly

  if (SANDBOX_WRAPPERS.enabled) {
    if (!opts.dir) throw new Error('sandbox wrappers mode requires opts.dir (the run work directory)');
    // The wrapper itself does chown/chmod, unshare, the sudo drop and prlimit;
    // it validates every argument and refuses anything outside the run root.
    let ns = opts.network ? '' : 'n';
    if (supportsPidNamespace()) ns = `${ns ? `${ns},` : ''}pid,fork,mount-proc`;
    return { command: 'sudo', args: [...wrapperArgs(opts.dir, limits, ns), cmd, ...args] };
  }

  const limitArgs = [
    `--cpu=${Math.max(1, Math.ceil(limits.cpuSec))}`,
    `--as=${limits.as}`,
    `--nproc=${limits.nproc}`,
    '--nofile=64',
    `--fsize=${Math.max(1024 * 1024, limits.fsize)}`,
    '--stack=67108864',
    '--core=0',
  ];
  const drop = ['-u', RUN_AS, 'prlimit', ...limitArgs, '--', cmd, ...args];
  // `unshare` must run before privileges are dropped, hence the nested sudo.
  if (opts.network) {
    // The network stays (MySQL on loopback), but a private PID namespace +
    // proc still hides every other process — including this child's own
    // command line from other submissions, and theirs from it.
    const pidNs = supportsPidNamespace() ? ['unshare', '--pid', '--fork', '--mount-proc', '--'] : [];
    return { command: 'sudo', args: ['-n', ...pidNs, ...(pidNs.length ? ['sudo', '-n'] : []), ...drop] };
  }

  // --pid --fork --mount-proc hides every other process on the box; -n keeps
  // the empty network namespace. Falls back to network-only isolation when the
  // host cannot provide a PID namespace.
  const ns = supportsPidNamespace()
    ? ['unshare', '-n', '--pid', '--fork', '--mount-proc', '--']
    : ['unshare', '-n', '--'];
  return { command: 'sudo', args: ['-n', ...ns, 'sudo', '-n', ...drop] };
}

/* ------------------------------------------------------------------ */
/* process execution helpers                                            */
/* ------------------------------------------------------------------ */
const UNSAFE_ENV = /^(DB_|JWT_|SQL_SANDBOX_|SMTP_|GOOGLE_|GITHUB_|JUDGE_SERVICE_TOKEN)/i;

/** Minimal environment for a child: keeps PATH plus locale, drops every secret. */
function childEnv(extra) {
  const env = { ...extra };
  if (IS_WINDOWS) {
    ['SystemRoot', 'windir', 'TEMP', 'TMP', 'PATHEXT', 'ComSpec', 'USERPROFILE', 'APPDATA', 'NUMBER_OF_PROCESSORS']
      .forEach((k) => { if (process.env[k]) env[k] = process.env[k]; });
    env.PATH = process.env.PATH || '';
    env.LANG = env.LANG || 'en_US.UTF-8';
  } else {
    env.PATH = process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
    env.LANG = env.LANG || 'C.UTF-8';
    env.HOME = env.HOME || os.tmpdir();
  }
  Object.keys(env).forEach((k) => { if (UNSAFE_ENV.test(k)) delete env[k]; });
  return env;
}

/** Kill the whole process tree (works on Windows and POSIX). */
function killTree(child) {
  if (!child || !child.pid) return;
  if (IS_WINDOWS) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } catch { try { child.kill('SIGKILL'); } catch { /* ignore */ } }
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* ignore */ } }
}

/** Default throw-away work directory (Windows has no /tmp). */
const defaultWorkdir = () => process.env.JUDGE_WORKDIR || path.join(os.tmpdir(), 'smartodl-judge');

module.exports = {
  supportsPidNamespace,
  IS_WINDOWS, IS_MAC, SANDBOX_MODE, RUN_AS,
  findBinary, binName, buildCommand, childEnv, killTree, defaultWorkdir,
  SANDBOX_WRAPPERS,
};
