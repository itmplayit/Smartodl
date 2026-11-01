'use strict';
/**
 * Filesystem isolation and real memory limits for submitted code.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `unshare -n --pid --fork --mount-proc` gives a run its own network, its own
 * PID space and a private /proc — but no filesystem boundary. The host tree
 * stays visible, so a submission can read any world-readable file: the app's
 * .env (which often holds JUDGE_SERVICE_TOKEN), other people's files in /tmp,
 * /etc/passwd, and the deployed source. Verified by running it, not by reading
 * it: a Python submission printed the contents of a decoy .env.
 *
 * This module builds a PRIVATE ROOT for every run with bubblewrap: a read-only
 * toolchain allowlist, the run's own directory as the only writable place, and
 * private /tmp, /var/tmp and /run. Inside it there is no /home, no /root, no
 * /var, and no application directory.
 *
 * It also provides the memory ceiling that RLIMIT_AS cannot: the JVM and V8
 * reserve huge virtual address ranges up front, so they were deliberately
 * exempted from --as and capped only by -Xmx / --max-old-space-size — which
 * bound the managed heap and nothing else. `Buffer.alloc(256 MB)` at a 16 MB
 * limit was measured at 297.7 MB and still reported Accepted.
 *
 * FAIL-CLOSED
 * -----------
 * If no private root can be built, production startup refuses to boot. Set
 * JUDGE_ALLOW_UNSANDBOXED=1 only on a trusted, disposable machine — it is not a
 * security boundary.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RO_BINDS_DEFAULT = [
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib32',
  '/lib64',
  '/libx32',
  '/etc/alternatives',
  '/etc/ld.so.cache',
  '/etc/ld.so.conf',
  '/etc/ld.so.conf.d',
  '/etc/ssl/certs',
  '/etc/pki',
  '/etc/java',
  '/etc/python3',
  '/etc/node',
  // Source-installed interpreters live here (this host's python3 is
  // /usr/local/bin/python3), so it stays in the default set.
  '/usr/local',
];

/**
 * Mounted only when an operator asks for them by name.
 *
 * These are real deployment locations, so leaving them in the default allowlist
 * would hand submitted code a readable copy of whatever the institution keeps
 * there. Toolchains under /opt or /snap are supported — just name them
 * explicitly with JUDGE_RO_BINDS, which makes the exposure a deliberate choice.
 */
const RO_BINDS_OPTIONAL = ['/opt', '/snap'];

/** Extra read-only mounts an operator can add for toolchains outside the default set. */
function extraRoBinds() {
  const raw = String(process.env.JUDGE_RO_BINDS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
    .filter((p) => path.isAbsolute(p));
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch (_) { return false; }
}

/** Single-file essentials that must exist inside the sandbox too. */
const RO_FILES = [
  '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf',
  '/etc/passwd', '/etc/group', '/etc/localtime',
];

/**
 * The read-only half of the private root, shared by the real sandbox AND the
 * startup probe. They must use the same list: a probe that mounted only /usr
 * failed with "execvp: No such file or directory" because the dynamic loader
 * lives in /lib64, and would have reported a working host as broken.
 */
function roBindArgs() {
  const args = [];
  const optedIn = extraRoBinds();
  const wanted = [...RO_BINDS_DEFAULT];
  for (const p of RO_BINDS_OPTIONAL) {
    if (optedIn.includes(p)) wanted.push(p);
  }
  for (const p of [...new Set([...wanted, ...optedIn])]) {
    if (exists(p)) args.push('--ro-bind', p, p);
  }
  for (const f of RO_FILES) {
    if (exists(f)) args.push('--ro-bind', f, f);
  }
  return args;
}

/** A do-nothing binary guaranteed to live under the mounted allowlist. */
function trueBinary() {
  for (const c of ['/usr/bin/true', '/bin/true']) if (exists(c)) return c;
  return '/bin/true';
}

/* ------------------------------------------------------------------ */
/* bubblewrap discovery                                                 */
/* ------------------------------------------------------------------ */

let bwrapBin = null;
function findBwrap() {
  if (bwrapBin !== null) return bwrapBin;
  if (String(process.env.JUDGE_DISABLE_BWRAP || '').trim() === '1') { bwrapBin = ''; return bwrapBin; }
  const custom = String(process.env.JUDGE_BWRAP_BIN || '').trim();
  const candidates = custom ? [custom] : ['/usr/bin/bwrap', '/bin/bwrap', 'bwrap'];
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 5000 });
      bwrapBin = c;
      return bwrapBin;
    } catch (_) { /* try the next candidate */ }
  }
  bwrapBin = '';
  return bwrapBin;
}

/**
 * Can this host actually give a child a private root?
 * Probed for real (bwrap --ro-bind / /tmp/x true) rather than assumed, because
 * user namespaces are disabled on some hosts and containers.
 */
let fsProbe = null;
function filesystemIsolationAvailable() {
  if (fsProbe !== null) return fsProbe;
  const bin = findBwrap();
  if (!bin) { fsProbe = { ok: false, reason: 'bubblewrap not installed (apt install bubblewrap)' }; return fsProbe; }
  const probeDir = path.join(require('os').tmpdir(), `sodl-bwrap-probe-${process.pid}`);
  try {
    fs.mkdirSync(probeDir, { recursive: true, mode: 0o700 });
  } catch (_) {
    fsProbe = { ok: false, reason: 'could not create the probe directory' };
    return fsProbe;
  }
  try {
    execFileSync(bin, [
      '--die-with-parent',
      ...roBindArgs(),
      '--bind', probeDir, probeDir,
      '--tmpfs', '/tmp',
      '--proc', '/proc',
      '--dev', '/dev',
      trueBinary(),
    ], { stdio: 'ignore', timeout: 10000 });
    fsProbe = { ok: true, reason: 'bubblewrap', bin };
  } catch (err) {
    fsProbe = {
      ok: false,
      bin,
      reason: `bubblewrap present but cannot build a namespace (${err.code || err.message}). `
        + 'Enable unprivileged user namespaces (kernel.unprivileged_userns_clone=1) or run the worker outside a restricted container.',
    };
  } finally {
    try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
  return fsProbe;
}

/**
 * Can we really change uid (a true privilege drop), or only map one?
 * `bwrap --uid` maps the sandbox uid back to our own, so the filesystem,
 * network, PID, rlimit and memory confinement IS the boundary — the account is
 * not. Reported honestly through /health either way.
 */
function sudoDropAvailable(runAs) {
  if (!runAs) return false;
  try {
    execFileSync('sudo', ['-n', '-u', runAs, '/bin/true'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (_) { return false; }
}

/* ------------------------------------------------------------------ */
/* filesystem sandbox                                                   */
/* ------------------------------------------------------------------ */

/**
 * Build the bubblewrap argv prefix for one run.
 *
 * @returns {{ bin, args, mode }} where `args` ends with the `--` separator, so
 *          the caller appends the program and its arguments.
 */
function buildFsSandbox({ dir, network = false, runAs = '', uid = 0, gid = 0 } = {}) {
  const probe = filesystemIsolationAvailable();
  if (!probe.ok) throw new Error(probe.reason);

  if (!dir || !path.isAbsolute(String(dir))) {
    throw new Error('buildFsSandbox requires an absolute run directory');
  }

  const args = ['--die-with-parent', '--new-session'];

  // Namespaces. The network namespace is skipped for SQL questions, which must
  // reach MySQL on loopback — that path is contained by the least-privilege
  // edu_sql grant instead.
  args.push('--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts');
  if (!network) args.push('--unshare-net');

  // Filesystem: a private root assembled from an allowlist (shared with the
  // startup probe so both agree on what a working sandbox looks like).
  args.push(...roBindArgs());

  // ORDER MATTERS. The scratch filesystems must be mounted BEFORE the run
  // directory is bound: the work root lives under /tmp, so a tmpfs mounted
  // afterwards hides it and every run dies with
  // "bwrap: Can't chdir to /tmp/smartodl-judge/run-XXXX".
  // Private scratch space — nothing here survives the run, and nothing from the
  // host /tmp is visible.
  args.push('--tmpfs', '/tmp', '--tmpfs', '/var/tmp', '--tmpfs', '/run');
  // The run's own directory is the only writable real path.
  args.push('--bind', dir, dir);
  args.push('--proc', '/proc', '--dev', '/dev');
  args.push('--chdir', dir);

  // Privilege drop: a real uid change when sudo can do it, otherwise a
  // namespace-mapped one (weaker, but the filesystem boundary still holds).
  // A real uid change is stronger than a mapped one. With sudo we drop to the
  // run account and let bwrap only build the namespaces; without it we ask
  // bwrap to map the uid/gid, which is NOT a privilege drop but still leaves
  // every other boundary (filesystem, network, PID, rlimits, memory) intact.
  let mode = 'uid-map';
  if (runAs && sudoDropAvailable(runAs)) {
    mode = 'sudo-drop';
  } else {
    args.push('--uid', String(uid), '--gid', String(gid));
  }

  args.push('--');
  return { bin: probe.bin, args, mode, dropUser: mode === 'sudo-drop' ? runAs : null };
}

/* ------------------------------------------------------------------ */
/* memory enforcement                                                   */
/* ------------------------------------------------------------------ */

/**
 * Is a writable cgroup v2 directory available for us to delegate into?
 * Never chmod the host cgroup root to make this true — that is how a container
 * escapes. Delegate properly: `Delegate=yes` on the systemd unit.
 */
let cgroupProbe = null;
function cgroupAvailable() {
  if (cgroupProbe !== null) return cgroupProbe;
  const root = String(process.env.JUDGE_CGROUP_ROOT || '').trim();
  cgroupProbe = { ok: false, root };
  if (!root) return cgroupProbe;
  try {
    fs.accessSync(root, fs.constants.W_OK);
    const maxFile = path.join(root, 'memory.max');
    const killFile = path.join(root, 'cgroup.kill');
    if (!exists(maxFile)) return cgroupProbe;
    fs.writeFileSync(maxFile, 'max');
    cgroupProbe = { ok: true, root, killFile: exists(killFile) ? killFile : null };
  } catch (_) { /* not delegated; fall back to the RSS sampler */ }
  return cgroupProbe;
}

function descendantsOf(pid, seen = new Set()) {
  if (seen.has(pid)) return seen;
  seen.add(pid);
  try {
    const kids = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim();
    if (kids) for (const k of kids.split(/\s+/)) descendantsOf(Number(k), seen);
  } catch (_) { /* kernel without that file, or the process already exited */ }
  return seen;
}

function rssOf(pid) {
  try {
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) : 0;
  } catch (_) { return 0; }
}

/**
 * A real memory ceiling for a process tree.
 *
 * Preferred: cgroup v2 memory.max (the kernel enforces it, we just read it).
 * Fallback: sample the summed resident set of the whole tree and SIGKILL it
 * when the total crosses the limit — which is what the JVM/V8 exemption left
 * entirely unenforced.
 *
 * @returns {{ stop: () => { peakKb: number, exceeded: boolean } }}
 */
function memoryGuard(rootPid, limitKb) {
  const cg = cgroupAvailable();
  let peakKb = 0;
  let exceeded = false;
  let killed = false;

  if (cg.ok) {
    try {
      fs.writeFileSync(path.join(cg.root, 'memory.max'), String(limitKb * 1024));
      if (exists(path.join(cg.root, 'memory.swap.max'))) {
        fs.writeFileSync(path.join(cg.root, 'memory.swap.max'), '0');
      }
      if (exists(path.join(cg.root, 'memory.oom.group'))) {
        fs.writeFileSync(path.join(cg.root, 'memory.oom.group'), '1');
      }
    } catch (_) { /* fall through to sampling */ }
  }

  const sample = () => {
    if (killed) return peakKb;
    let total = 0;
    if (process.platform === 'linux') {
      for (const pid of descendantsOf(rootPid)) total += rssOf(pid);
    }
    if (total > peakKb) peakKb = total;
    if (limitKb > 0 && total > limitKb) {
      exceeded = true;
      killed = true;
      try { process.kill(-rootPid, 'SIGKILL'); } catch (_) { /* already gone */ }
      try { process.kill(rootPid, 'SIGKILL'); } catch (_) { /* already gone */ }
    }
    return total;
  };

  sample();                                  // a short-lived program can finish between ticks
  const timer = setInterval(sample, 10);
  timer.unref?.();

  return {
    mode: cg.ok ? 'cgroup' : 'rss-sampler',
    stop: () => {
      clearInterval(timer);
      sample();
      if (cg.ok && cg.root) {
        try {
          const peakFile = path.join(cg.root, 'memory.peak');
          if (exists(peakFile)) {
            const fromCgroup = Number(fs.readFileSync(peakFile, 'utf8').trim());
            if (Number.isFinite(fromCgroup) && fromCgroup > 0) peakKb = Math.max(peakKb, Math.round(fromCgroup / 1024));
          }
        } catch (_) { /* best effort */ }
      }
      return { peakKb, exceeded };
    },
  };
}

module.exports = {
  RO_BINDS_DEFAULT,
  RO_BINDS_OPTIONAL,
  RO_FILES,
  roBindArgs,
  trueBinary,
  extraRoBinds,
  findBwrap,
  filesystemIsolationAvailable,
  sudoDropAvailable,
  buildFsSandbox,
  cgroupAvailable,
  memoryGuard,
  descendantsOf,
  rssOf,
};
