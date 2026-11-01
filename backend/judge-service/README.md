# SmartODL isolated judge worker

This process executes untrusted submissions separately from the API. Production local-judge startup requires:

- **bubblewrap** (`apt install bubblewrap`) with unprivileged user namespaces, so
  every run gets a private filesystem root — see "Filesystem isolation" below;
- Linux/POSIX isolation;
- an existing unprivileged `JUDGE_RUN_AS` account;
- `sudo` and `prlimit`;
- a random `JUDGE_SERVICE_TOKEN` of at least 32 characters;
- required compilers/interpreters kept patched, **and installed under a mounted
  path** (`/usr`, `/usr/local`) — see "Toolchain locations";
- network exposure restricted to the API host.

## Configure and start

```bash
cp .env.example .env
# Fill the required blanks without committing .env.
npm ci --omit=dev
# Load .env with your process supervisor, then:
npm start
```

The API must use the same token and point `JUDGE_SERVICE_URL` at this worker. Keep `JUDGE_HOST=127.0.0.1` when both processes run on one VPS.

Check that every boundary is actually active before going live:

```bash
curl -H 'x-judge-token: <token>' http://127.0.0.1:2358/health | python3 -m json.tool
#   "filesystem_isolation": true
#   "filesystem_isolation_mode": "bubblewrap"
#   "memory_limit": "cgroup" or "rss-sampler"
```

Run the sandbox regression suite on the host — it executes real submissions:

```bash
npm test            # 11 live tests; skips loudly if the host cannot isolate
```

For Docker deployments, use the repository-root `Dockerfile.judge`. The image runs the HTTP process as `judgeweb`, executes submissions as `judgerun`, and includes the C/C++, Java, Python, Node and MariaDB-client toolchains. Set only `JUDGE_SERVICE_TOKEN` as a service secret; the image supplies `NODE_ENV=production`, `JUDGE_HOST=0.0.0.0`, `JUDGE_RUN_AS=judgerun`, and `JUDGE_WORKDIR`. Production startup fails closed if `sudo`, `prlimit`, `unshare`, privilege dropping, or the network namespace does not actually work in the host runtime.

## Filesystem isolation (bubblewrap)

`unshare -n` hides the network and **nothing else**. Without a private root, a
submission reads every world-readable file on the host — verified by running it:
a Python submission printed the contents of a decoy `.env` holding
`JUDGE_SERVICE_TOKEN`, read `/etc/passwd`, and listed the real host root.

Every run is now built with bubblewrap (`lib/sandbox.js`):

```
sudo -n -u <JUDGE_RUN_AS> bwrap \
    --die-with-parent --new-session \
    --unshare-user --unshare-pid --unshare-ipc --unshare-uts --unshare-net \
    --tmpfs /tmp --tmpfs /var/tmp --tmpfs /run \
    --bind <run-dir> <run-dir> \
    --ro-bind /usr /usr --ro-bind /bin /bin … (read-only toolchain allowlist) \
    --proc /proc --dev /dev --chdir <run-dir> \
    prlimit … -- <compiler/runner>
```

Inside that sandbox there is no `/home`, no `/root`, no `/opt`, no `/var` and no
application directory — only the read-only toolchain, the run's own writable
directory, and private `/tmp`, `/proc` and `/dev`. Writes to `/tmp` land in the
private tmpfs and never touch the host.

Two details that are easy to get wrong:

- **Mount order matters.** The scratch tmpfs must be mounted *before* the run
  directory is bound. The work root lives under `/tmp`, so a tmpfs mounted
  afterwards hides it and every run dies with
  `bwrap: Can't chdir to /tmp/smartodl-judge/run-XXXX`.
- **The dynamic loader needs both `/lib` and `/lib64`.** Mounting only `/usr`
  fails with `execvp: No such file or directory`, because `/usr/bin/*` requests
  `/lib64/ld-linux-x86-64.so.2`. The startup probe uses the same allowlist as the
  real sandbox so both agree on what "working" means.

**Fail-closed.** If no private root can be built, production startup refuses to
boot. `JUDGE_ALLOW_UNSANDBOXED=1` opts out on a trusted, disposable machine — it
is not a security boundary. `JUDGE_DISABLE_BWRAP=1` forces the old behaviour for
debugging.

### Toolchain locations

Mounted read-only by default:

```
/usr  /bin  /sbin  /lib  /lib32  /lib64  /libx32  /usr/local
/etc/alternatives  /etc/ld.so.cache  /etc/ld.so.conf  /etc/ld.so.conf.d
/etc/ssl/certs  /etc/pki  /etc/java  /etc/python3  /etc/node
/etc/resolv.conf  /etc/hosts  /etc/nsswitch.conf  /etc/passwd  /etc/group  /etc/localtime
```

`/opt` and `/snap` are **not** mounted by default. They are real deployment
locations, so exposing them silently would hand submitted code a readable copy
of whatever the institution keeps there. If your toolchain lives there, opt in:

```bash
JUDGE_RO_BINDS=/opt/node22,/snap/bin
```

Anything you add becomes readable by submitted code. Interpreters outside the
mounted paths (a Node under `~/.nvm`, for example) will not exist inside the
sandbox and the language will fail with `Runtime "…" was NOT found`.

## Memory limits are enforced

The JVM and V8 reserve huge virtual address ranges up front, so they are
deliberately exempt from `RLIMIT_AS` and were capped only by `-Xmx` /
`--max-old-space-size` — which bound the managed heap and nothing else.
`Buffer.alloc(256 MB)` at a 16 MB limit was measured at 297.7 MB and still
reported **Accepted**.

Two changes fix that:

- **A real ceiling.** With a delegated cgroup v2 (`JUDGE_CGROUP_ROOT`) the
  kernel enforces `memory.max`; otherwise an aggregate-RSS sampler sums the
  resident set of the whole process tree and kills it at the ceiling. Delegate
  with `Delegate=yes` on the systemd unit — never `chmod` the host cgroup root.
- **The verdict respects the measurement.** MLE used to be decided only inside
  `if (exit code !== 0)`, so a run that exited cleanly was Accepted no matter
  how much memory it used. It is now checked for every run.

Enforced ceiling = `problem memory_limit_kb` + a per-runtime allowance
(`JUDGE_MEMORY_ALLOWANCE_KB` overrides it). The allowance exists because the
measured figure includes the interpreter itself — V8 needs ~32 MB to start,
CPython ~15 MB, the JVM more — and comparing the raw total against the limit
failed every JavaScript program outright. This is the same shape of allowance
Judge0 applies.

## Sudoers hardening — use the wrappers

Do **not** grant the worker `NOPASSWD: /usr/bin/unshare, /usr/bin/chown, /usr/bin/rm` (an earlier version of this README and the Dockerfile did — that is arbitrary root, because `sudo -n unshare -- /bin/sh` bypasses every argument check). The two fixed-argument wrappers in `sandbox/` replace all three grants:

| Wrapper | What root may do through it |
|---|---|
| `/usr/local/sbin/sodl-exec` | chown + chmod + `unshare` + `sudo -u <user> prlimit … -- <run>` **only** inside the judge work root, with integer-validated limits and an allowlisted namespace flag set |
| `/usr/local/sbin/sodl-clean` | chown back / delete **only** `run-*` directories inside the judge work root |

Manual Linux install (Docker users: already baked into the image):

```bash
sudo install -m 0755 sandbox/sodl-exec.sh /usr/local/sbin/sodl-exec
sudo install -m 0755 sandbox/sodl-clean.sh /usr/local/sbin/sodl-clean
sudo tee /etc/smartodl-judge.conf >/dev/null <<'CONF'
ROOT="/tmp/smartodl-judge"   # keep identical to JUDGE_WORKDIR (if you set one)
WEB_USER="judgeweb"          # the account that runs node judge.js
RUN_USER="judgerun"          # the account submissions execute as (JUDGE_RUN_AS)
CONF
sudo tee /etc/sudoers.d/smartodl-judge >/dev/null <<'SUDO'
Defaults:judgeweb !requiretty
judgeweb ALL=(root) NOPASSWD: /usr/local/sbin/sodl-exec, /usr/local/sbin/sodl-clean
SUDO
sudo visudo -cf /etc/sudoers.d/smartodl-judge
```

The worker auto-detects the wrappers at boot and uses them whenever they exist. Set `JUDGE_SANDBOX_WRAPPERS=1` to make their absence a fatal startup error instead of a silent downgrade. `GET /health` reports `"sudo_wrappers": true` for a hardened worker.

Authenticated health check:

```bash
curl -H 'x-judge-token: <token>' http://127.0.0.1:2358/health
```

The worker creates a fresh temporary directory for each run, drops privileges, applies CPU/address-space/process/file limits, caps output, kills timed-out process groups, strips application secrets from the child environment, and deletes the working directory afterward.

The SQL runner is disabled by default. Enable `SQL_SANDBOX_ENABLED=true` only after provisioning a dedicated disposable database and account with no privileges on the SmartODL application database.
