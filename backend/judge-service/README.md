# SmartODL isolated judge worker

This process executes untrusted submissions separately from the API. Production local-judge startup requires:

- Linux/POSIX isolation;
- an existing unprivileged `JUDGE_RUN_AS` account;
- `sudo` and `prlimit`;
- a random `JUDGE_SERVICE_TOKEN` of at least 32 characters;
- required compilers/interpreters kept patched;
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

For Docker deployments, use the repository-root `Dockerfile.judge`. The image runs the HTTP process as `judgeweb`, executes submissions as `judgerun`, and includes the C/C++, Java, Python, Node and MariaDB-client toolchains. Set only `JUDGE_SERVICE_TOKEN` as a service secret; the image supplies `NODE_ENV=production`, `JUDGE_HOST=0.0.0.0`, `JUDGE_RUN_AS=judgerun`, and `JUDGE_WORKDIR`. Production startup fails closed if `sudo`, `prlimit`, `unshare`, privilege dropping, or the network namespace does not actually work in the host runtime.

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
