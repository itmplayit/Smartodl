# SmartODL — deep analysis (commit `fe91c48`)

**Date:** 31 October 2026
**Analysed commit:** `fe91c48c593b88d38c3afb8aa2a3475d27d48254` — "fix ALL" (branch `main`)
**Repository:** https://github.com/itmplayit/Smartodl.git
**Method:** static review of ~56,000 lines + **live reproduction** against the real judge worker
(sudo + unshare + prlimit actually executed, submitted code actually ran)

> In this report **"REPRODUCED"** means I ran the attack/condition and observed the result.
> **"BY INSPECTION"** means I read the code and reasoned about it, but did not execute it.

---

## Summary

| # | Problem | Severity | Evidence |
|---|---|---|---|
| B1 | Submitted code reads any world-readable file on the host | **Critical** | REPRODUCED |
| B2 | JavaScript can blow past the memory limit and still be "Accepted" | **High** | REPRODUCED |
| B3 | Fresh-install schema fails on MySQL 8 / TiDB (8 tables) | **High** | CONFIRMED in the dump |
| B4 | Password-reset links still written to the server log | Medium | BY INSPECTION |
| B5 | Main rate limits are still per-IP, not per-account | Medium | BY INSPECTION |
| B6 | Editing a test case does not invalidate a previous pass | Medium | BY INSPECTION |

Six problems found. **Three are reproduced, three are by inspection.**
Baseline quality is good: 149/149 backend tests, 13/13 frontend tests, 0 npm
vulnerabilities in backend and frontend, and every SQL query is parameterised.

---

## Environment used for reproduction

```
Linux, Node v20.20.2, sudo -n working, nobody (65534) available
Toolchains found by the judge: gcc, g++, javac, java, python, node
Judge started with: NODE_ENV=development JUDGE_RUN_AS=nobody JUDGE_PORT=2358
```

Harness: `/home/user/audit/repro.cjs` — submits code through
`POST /api/v1/execute`, exactly the way the API does.

---

## B1 — CRITICAL: submitted code can read any world-readable file on the host

### What I did

Started the real judge worker, placed a decoy `.env` at `/opt/smartodl-sim/.env`
(mode 0644, the permission a real deployment's config file typically has), and
submitted this as a student's Python program:

```python
import os
for p in ["/opt/smartodl-sim/.env", "/tmp/smartodl-canary.txt", "/etc/passwd"]:
    with open(p) as f:
        print(p, "->", f.readline().strip())
```

### What happened

```
status=Accepted  exit=0  time=0.169s
stdout:
  /opt/smartodl-sim/.env    -> JUDGE_SERVICE_TOKEN=SUPERSECRET-CANARY-7f3a9c
  /tmp/smartodl-canary.txt  -> CANARY-TMP-42
  /etc/passwd               -> root:x:0:0:root:/root:/bin/bash
```

Also reproduced:

- `os.listdir("/")` returns the **real host root** — `[..., 'home', 'opt', 'proc', 'root', 'srv', 'sys', 'tmp', 'usr', 'var']`.
- **Writing outside the run directory is allowed**: the submission created
  `/tmp/pwned-by-submission.txt` successfully.

### Why

`lib/platform.js` → `buildCommand()` wraps every run as:

```
sudo -n unshare -n --pid --fork --mount-proc -- sudo -n -u nobody prlimit ... -- <program>
```

That provides a **network** namespace and a **PID** namespace (with a private
`/proc`), but **no filesystem namespace**. `--mount-proc` only mounts a fresh
`/proc`; the rest of the host tree is inherited unchanged. The process runs as
`nobody`, so it is limited to world-readable files — which in practice includes
the application config, other people's files under `/tmp`, `/etc/passwd`, and the
deployed source tree.

### Why this matters here specifically

The judge's own secret (`JUDGE_SERVICE_TOKEN`) is exactly the kind of value that
sits in a world-readable `.env` on many self-hosted boxes. Reading it from inside
a submission hands the student the ability to talk to the judge worker directly.

### What is genuinely working

Do not read this as "the sandbox does nothing" — three properties are real and verified:

- **Network is blocked** — connecting to `1.1.1.1:80` and `http://example.com` both failed.
- **Process list is hidden** — only 2 PIDs visible in `/proc` (was ~104 without the PID namespace).
- **Other submissions are not enumerable** — the work root is `0o711`, so a submission
  cannot list `/tmp/smartodl-judge` to find a classmate's in-flight source.

### Fix direction

Give each run a private filesystem root — bubblewrap, or `unshare -m` with a
read-only bind-mount allowlist plus a private `/tmp`. The unit of work is roughly
the size of the `lib/sandbox.js` module I wrote for the previous audit. Two
constraints to design for:

- Interpreters must live under the mounted paths (`/usr`, `/usr/local`, `/opt`).
  A Node under `~/.nvm` will simply not exist inside the sandbox.
- Make it **fail closed** — if no private root can be built, refuse to start in
  production rather than silently running unsandboxed.

---

## B2 — HIGH: JavaScript ignores the memory limit, and the verdict never checks measured memory

### What I did

Submitted JavaScript with `memory_limit_kb: 16384` (16 MB):

```javascript
const b = Buffer.alloc(256 * 1024 * 1024);   // 256 MB, OFF-HEAP
for (let i = 0; i < b.length; i += 4096) b[i] = 7;   // touch every page
console.log("touched 256MB off-heap");
```

### What happened

```
status=Accepted  exit=0  reported memory = 297.7 MB
stdout: touched 256MB off-heap
```

**The judge itself measured 297.7 MB against a 16 MB limit and still returned Accepted.**

For comparison, the same test in the other runtimes behaved correctly:

| Language | 96 MB at a 16 MB limit | Result |
|---|---|---|
| JavaScript | `Buffer.alloc(96 MiB)` | **Accepted** (bug) |
| Python | `bytearray(96 MiB)` | Memory Limit Exceeded — correct |
| C++ | `malloc(96 MiB)` | Runtime Error (malloc → NULL) — correct |

### Why — two independent defects

**1. The limit is never applied to JS/Java** (`judge.js`, the run block):

```javascript
const VM_RUNTIMES = new Set(['java', 'javascript']);
const asLimit = VM_RUNTIMES.has(langKey) ? lang.limit.as : (memKb + 64 * 1024) * 1024;
```

The comment explains it: the JVM and V8 reserve huge virtual address ranges up
front, so `RLIMIT_AS` kills them before they start. So they are capped by
`-Xmx` / `--max-old-space-size` instead — which bound the **managed heap only**.
`Buffer.alloc` is off-heap, so nothing stops it.

**2. Even a correct measurement cannot produce MLE** — MLE is only considered
inside `if (r.code !== 0)`:

```javascript
if (r.code !== 0) {
  const atCeiling = r.memoryKb && r.memoryKb >= memKb * 0.9;
  ...
  if (atCeiling || oomKilled) return { status: STATUS.MLE, ... };
  return { status: STATUS.RUNTIME_ERROR, ... };
}
return { status: STATUS.ACCEPTED, ... };      // ← exit 0 is always Accepted
```

A program that exits 0 is **Accepted no matter how much memory it used**. This
second defect is language-independent: it would also mask a C++ program that
stays just under `RLIMIT_AS` by measuring well above the intended cap.

### Impact

One student can consume hundreds of MB (or more) per submission. The box in my
test had 2 GB; at `JUDGE_CONCURRENCY=2` a handful of submissions is enough to
start swapping or trip the kernel OOM killer and take down the API on the same host.

### Fix direction

- Memory: delegated cgroup v2 (`memory.max`) is the clean answer; otherwise an
  aggregate-RSS sampler over the whole process tree with a kill at the ceiling.
- Verdict: check `r.memoryKb > memKb` for **every** run, independent of exit code.

---

## B3 — HIGH: the fresh-install schema still cannot be imported on MySQL 8 or TiDB

`utf8mb4_uca1400_ai_ci` exists only in MariaDB 11.x. It now appears in **8** tables
(it was 2 in the version I audited in October; the new proctoring tables added more):

```
app_meta, certificate_templates, point_adjustments, proctor_events,
proctor_recording_files, proctor_recording_sessions, site_pages,
user_anticheat_settings
```

The documented install step (`mysql < database/education_platform.sql`) aborts on
MySQL 8 and TiDB.

**The second half of this bug is easy to miss.** Several tables declare only
`DEFAULT CHARSET=utf8mb4` with no `COLLATE`. On MariaDB 11.x the default
collation *is* `uca1400`, so those tables are created with it anyway — and a
`mysqldump` taken from that running database is then equally un-importable on
MySQL 8. So fixing only the 8 explicit statements is not enough; every
`CREATE TABLE` (in the dump **and** in the migration services) should state its
collation explicitly.

I verified the full fix for this in the previous audit: 49 tables, 0 `uca1400`.

**Not reproduced end-to-end here** — no MySQL 8 or TiDB was available in this
sandbox. Confirmed by inspecting the dump and by the engine-specific nature of
the collation.

---

## B4 — MEDIUM: password-reset links are still written to the server log

`backend/controllers/auth.controller.js`:

```javascript
if (process.env.MAIL_MODE !== 'smtp') {
  console.warn(
    `[auth] MAIL_MODE=${...} — the reset email was not sent. `
    + `Reset link for ${user.email}: ${link}`,      // ← the live token
  );
  if (devResetLinkEnabled()) return ok(res, { message: generic, dev_reset_link: link });
  return ok(res, { message: generic });
}
```

The code comment argues "only someone who already has server access can read
that console, so this is not an additional disclosure." That reasoning is too
optimistic: logs are routinely shipped to files, journald, Docker log drivers
and centralised aggregators, all of which are commonly readable by far more
people and processes than the database. Anyone with log access can take over any
account — including the owner — without touching the DB.

**Credit where due:** the *in-response* leak (`dev_reset_link`) is now properly
gated behind an explicit opt-in (`devResetLinkEnabled()`) instead of depending on
`NODE_ENV`. That was the more dangerous half and it is fixed. Only the log line remains.

**Fix:** log *what is misconfigured*, not the token.

---

## B5 — MEDIUM: the main rate limits are still per-IP

`backend/middleware/rateLimit.js` — `make()` supplies no `keyGenerator`:

```javascript
const make = ({ prefix = 'api', ...opts }) => rateLimit({
  standardHeaders: true, legacyHeaders: false, skip: disabled, ...opts,
});
```

So express-rate-limit's default per-IP key applies to every limiter that does not
override it:

| Limiter | Budget | Key |
|---|---|---|
| `submitLimiter` | 20 / min | **per IP** |
| `executionLimiter` | 60 / min | **per IP** |
| `writeLimiter` | 240 / min | **per IP** |
| `authLimiter` | 100 / 15 min | **per IP** |
| `apiLimiter` | 5000 / 15 min | **per IP** |
| proctoring telemetry (5 limiters) | — | per account (`userKey`) |

A computer lab behind one NAT address shares **20 submissions per minute** across
every student in it, and one abusive account can spend the whole lab's budget.

The file's own comment shows the pattern is understood — the proctoring routes
were deliberately moved to `userKey` for exactly this reason. It just was not
applied to the main limiters.

**Fix:** default `keyGenerator` to the account id when authenticated, falling
back to IP for anonymous traffic — same as the proctoring limiters already do.

---

## B6 — MEDIUM: editing a test case does not invalidate a previous pass

### What is fixed

`quiz.controller.js` now resets the verdict when the *answer* changes:

```sql
ON DUPLICATE KEY UPDATE
  verified = IF(selected_answer <=> VALUES(selected_answer), verified, 0),
  tests_passed = IF(selected_answer <=> VALUES(selected_answer), tests_passed, NULL),
  tests_total  = IF(selected_answer <=> VALUES(selected_answer), tests_total,  NULL)
```

So a student can no longer run correct code once and then submit different,
never-executed code while `verified=1` still awards full marks.

`utils/quiz-code.js` → `parseTestCases()` also now counts
`expected_output: ""` as a real case. Previously the `!== ''` filter dropped
those, so a question whose only cases expected empty output silently became
"no test cases" and the evaluator awarded full marks for any non-empty code.

### What is still open

There is **no `verification_hash` anywhere in the codebase** (I grepped the whole
tree). The reset above is keyed on `selected_answer` only — it says nothing about
whether the *test cases* are still the ones that were run.

So: a student runs the code against the current cases and passes
(`verified=1, tests_passed=3, tests_total=3`). The instructor then fixes a wrong
expected output in one case — the count is still 3. The student submits without
touching their code. `selected_answer` is unchanged, so `verified` survives, and
full marks are awarded for code that never passed the corrected case.

The same gap applies to the submit gate, which checks `verified` and the counts
but has nothing to bind the run to the case *contents*.

**Fix:** store a hash of (question id, language, source, the content of every
test case) when the run completes, and require it to match at grading time.
This was the `quiz_answers.verification_hash` migration in the previous audit.

---

## Checked and found sound

I looked for these specifically and did **not** find a problem. Listing them so
the gaps are visible rather than silent.

| Area | Result |
|---|---|
| SQL injection | Every query parameterised. No user input interpolated into SQL in `controllers/` or `services/`. |
| `GET /coding/submissions/:id` | Now gated by `canReadCodingSubmission()` (owner / admin / `view_submissions`). Previously any developer could read any student's source. |
| `GET /users/:id` | Now self-or-admin only. Previously any logged-in student could enumerate ids and harvest every account's email and activity. |
| `GET /contests` | `editorial` withheld until the caller is entitled (was leaking solutions in the public catalogue). |
| Community `DELETE /reviews/:id` | Ownership checked, or admin. |
| Certificate tokens | `genToken()` = 18 random bytes (144 bits); certificate numbers 48 bits with a rate limit. |
| Second-camera endpoints | Unauthenticated by design, but 24-byte bearer tokens, feature-gated, status-checked, frames memory-only. |
| QR SVG → `dangerouslySetInnerHTML` | Not injectable: `toSvg()` emits only a `<path d>` built from the QR module matrix. The encoded text never becomes markup. |
| `Math.random()` | Used only for a non-security filename slug. |
| Network isolation | Verified blocked. |
| PID namespace | Verified: 2 PIDs visible inside a run. |
| Run-directory privacy | `0o711`, submissions cannot enumerate each other's in-flight work. |
| Time limits | Verified: `while True` → Time Limit Exceeded at the configured deadline. |
| Tests | Backend 149/149, frontend 13/13. |
| npm audit | backend 0, frontend 0, judge-service **1 moderate** (`qs` DoS, `GHSA-6pq8-jhm2-2vcw`). |

---

## Recommended order of work

1. **B1** — private filesystem root per run (Critical; the sandbox's main boundary is missing).
2. **B2** — enforce memory for VM runtimes *and* check measured memory regardless of exit code.
3. **B3** — replace the collation in all 8 tables and pin an explicit `COLLATE` everywhere.
4. **B6** — bind a run to the exact test cases it proved.
5. **B5** — key the main limiters by account.
6. **B4** — stop logging reset links.
7. `npm audit fix` in `backend/judge-service` for the moderate `qs` advisory.

---

## Limitations of this analysis

State these plainly, because they bound how much the report is worth:

- **No MySQL 8 or TiDB** was available, so B3 was confirmed by inspecting the
  dump plus the engine-specific nature of the collation — **not** by a failing import.
- Not exercised at all: live payment gateways (Razorpay/Paytm/UPI), real OAuth
  round-trips, SMTP delivery, Docker/systemd deployment, a live Judge0 instance,
  browser-level proctoring, recording upload/finalise flows, and any load testing.
- B4, B5 and B6 are **by inspection only** — I read the code, I did not run the
  attack. They are the three findings most worth double-checking before acting.
- The reproduction ran in a container where `/home/user` is `0750`. That made
  home-directory files unreadable by the sandbox user, so I placed the decoy
  under `/opt` to model a realistic deployment. Real deployments vary; the
  severity of B1 depends on what is world-readable on your particular host.
- I did not audit the frontend beyond the XSS sinks listed above.

## Artifacts

- `/home/user/audit/repro.cjs` — the live reproduction harness (needs a running judge)
- `/home/user/audit/mem2.cjs` — the focused memory-limit reproduction
- `/home/user/audit/judge.log` — the judge worker's startup diagnostics
