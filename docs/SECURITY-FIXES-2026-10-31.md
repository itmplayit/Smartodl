# Security and correctness fixes — 31 October 2026

**Base commit:** `fe91c48c593b88d38c3afb8aa2a3475d27d48254` ("fix ALL")
**Audit report:** `docs/AUDIT-JUDGE-SANDBOX-2026-10-31.md`

> Note: the repository already carries `docs/AUDIT-2026-10-31.md`, which audited the
> API and frontend (including a real browser crawl) and did **not** cover the judge
> sandbox at all — no mention of `bwrap`, `unshare`, `prlimit` or memory limits.
> That is why B1, B2 and B7 were still open. The two audits are complementary.
**Verification:** static review of ~56,000 lines plus live reproduction against a
real judge worker (submitted code actually executed) and a real MariaDB 11.8.

| # | Problem | Severity | Status |
|---|---|---|---|
| B1 | Submitted code read any world-readable host file | Critical | Fixed (11 live tests) |
| B2 | JavaScript ignored the memory limit; MLE ignored the measurement | High | Fixed (11 live tests) |
| B3 | Fresh-install schema failed on MySQL 8 / TiDB | High | Fixed (real DB) |
| B4 | Password-reset links written to the server log | Medium | Fixed |
| B5 | Main rate limits were per-IP, not per-account | Medium | Fixed |
| B6 | Editing a test case did not invalidate a previous pass | Medium | Fixed |
| B7 | The shipped schema dump did not import (found while fixing B3) | **High** | Fixed (real DB) |

---

## B1 — Private filesystem root for every run

**Was.** `buildCommand()` wrapped runs in `unshare -n --pid --fork --mount-proc`.
That is a network namespace and a PID namespace; there was no filesystem
boundary. Reproduced: a Python submission printed
`JUDGE_SERVICE_TOKEN=SUPERSECRET-CANARY-7f3a9c` from a decoy `.env` (mode 0644),
read `/etc/passwd`, listed the real host root, and wrote a file into the host
`/tmp`.

**Now.** `backend/judge-service/lib/sandbox.js` builds the run with bubblewrap:
a private root from a read-only toolchain allowlist, the run's own directory as
the only writable real path, private `/tmp`, `/var/tmp` and `/run`, fresh
`/proc` and `/dev`. Verified after the fix: the canary is `BLOCKED`, `/home` and
`/etc/shadow` do not exist inside the sandbox, and a write to `/tmp` never
reaches the host.

Two non-obvious things the implementation has to get right, both found the hard way:

- **Mount order.** The scratch tmpfs must be mounted *before* the run directory
  is bound — the work root lives under `/tmp`, so a tmpfs mounted afterwards
  hides it and every run dies with `Can't chdir to /tmp/smartodl-judge/run-XXXX`.
- **The loader needs `/lib` and `/lib64`.** Binding only `/usr` fails with
  `execvp: No such file or directory`, because binaries request
  `/lib64/ld-linux-x86-64.so.2`. The startup probe now uses the same allowlist as
  the real sandbox.

**Fail-closed.** Production refuses to boot when no private root can be built.
`JUDGE_ALLOW_UNSANDBOXED=1` opts out on a trusted, disposable machine.

**Operator actions**

1. `sudo apt install bubblewrap` and enable unprivileged user namespaces.
2. Confirm `GET /health` reports `filesystem_isolation: true`.
3. Make sure every interpreter lives under a mounted path. `/opt` and `/snap`
   are **not** mounted by default (they are real deployment locations, so
   exposing them silently would leak whatever is there); add them deliberately
   with `JUDGE_RO_BINDS` if your toolchain needs them.

## B2 — Memory is enforced, and the verdict respects it

**Was.** Two independent defects. `VM_RUNTIMES = {java, javascript}` skipped
`RLIMIT_AS`, leaving only `-Xmx` / `--max-old-space-size`, which cap the managed
heap and nothing else. And MLE was decided only inside `if (r.code !== 0)`, so a
run that exited 0 was Accepted regardless of measured memory — the judge measured
297.7 MB against a 16 MB cap and still returned Accepted.

**Now.** A `memoryGuard()` gives every run a real ceiling (delegated cgroup v2
`memory.max` when available, otherwise an aggregate-RSS tree kill), and the
verdict checks the measurement for **every** run, not just failing ones.

The enforced ceiling is `problem memory_limit_kb` **plus a per-runtime
allowance**. That allowance is not a fudge — the measured figure is the whole
process tree, so it includes the interpreter (V8 ~32 MB, CPython ~15 MB, the JVM
more). Comparing the raw total against the limit made *every* JavaScript
submission fail on any problem with a small limit. Configurable via
`JUDGE_MEMORY_ALLOWANCE_KB`.

Verified: 256 MB of touched off-heap `Buffer` at a 16 MB limit → **Memory Limit
Exceeded**; a correct `print(n*2)` → **Accepted**; `while True` → **Time Limit
Exceeded**.

## B3 — Portable schema

Eight tables used `utf8mb4_uca1400_ai_ci`, which exists only in MariaDB 11.x, so
the documented `mysql < database/education_platform.sql` step aborted on MySQL 8
and TiDB.

Replaced with `utf8mb4_unicode_ci`, **and** every `CREATE TABLE` — in the dump
and in the migration services — now states its collation explicitly. The second
part matters: tables declaring only `DEFAULT CHARSET=utf8mb4` inherit MariaDB's
server default (which *is* `uca1400`), so a `mysqldump` of that running database
was still un-importable on MySQL 8.

Verified on MariaDB 11.8: 53 tables, **0** MariaDB-only collations.

## B4 — Reset links are no longer logged

`forgotPassword` wrote `Reset link for <email>: <link>` to `console.warn`
whenever `MAIL_MODE !== 'smtp'`. The in-response `dev_reset_link` was already
gated behind an explicit opt-in; the log line was not.

The comment argued "only someone with server access can read that console."
Logs routinely reach files, journald, Docker log drivers and centralised
aggregators — readable by far more people and processes than the database — and
a reset link is a full account-takeover credential, including for the owner
account. The log now says *what is misconfigured*, never the token.

## B5 — Rate limits keyed by account

`make()` supplied no `keyGenerator`, so express-rate-limit's per-IP default
applied to `submitLimiter` (20/min), `executionLimiter` (60/min), `writeLimiter`
(240/min), `authLimiter` and `apiLimiter`. A whole lab behind one NAT address
shared one budget, and one abusive account could spend everyone's quota.

The default is now the account id when the caller is authenticated and the IP
when not — the same pattern the proctoring limiters already used. Anonymous
traffic must stay keyed by IP: there is no account yet, and keying login by
anything the request carries would let an attacker choose their own bucket.

## B6 — A run is bound to what it proved

`verified = 1` was cleared when the student's own answer changed, but not when an
instructor edited a test case. Edit an expected output while keeping the case
count the same and the stale "passed 3 of 3" survived → full marks for code that
never passed the corrected case.

`quiz_answers.verification_hash` (SHA-256 over question id, language, submitted
source and the content of every test case) is written when the run completes and
re-checked at grading time **and** on the submit gate.

Deliberately non-destructive: no row is rewritten. Answers stored before the
column existed have no hash, so if their attempt is still open the student is
asked to run the test cases again. Already-evaluated attempts keep their score —
re-evaluation is refused anyway.

**One behaviour change worth calling out.** A coding question with *no* test
cases used to award full marks for any non-empty answer. The runner itself
refuses to run such a question ("no test cases yet"), so no verdict can exist for
it. It now scores 0 and counts as unattempted; the answer is still stored for the
instructor to mark by hand. If you rely on the old behaviour, revert that branch
in `evaluateAttempt`.

## B7 — The shipped schema dump did not import (found while fixing B3)

Not in the original audit — discovered when importing the dump to verify B3.

`INSERT INTO certificate_templates` supplied **23** values for a table with
**24** columns: `logo_path` was missing. The import failed with
`ERROR 1136: Column count doesn't match value count at row 1`, so the documented
fresh-install step left the database without its certificate templates.

Confirmed pre-existing by importing the unmodified `git show HEAD:` version —
same error. All 5 seed rows fixed. The dump now imports cleanly: 53 tables, 5
certificate templates.

---

## Deployment checklist

1. **Judge host:** `apt install bubblewrap`, enable user namespaces, confirm
   `GET /health` → `filesystem_isolation: true`.
2. **Toolchains:** under the mounted paths, or named in `JUDGE_RO_BINDS`.
3. **Database:** back up, then `cd backend && npm run migrate` as a privileged
   account (adds `quiz_answers.verification_hash`). The API can keep running
   least-privilege with `SMARTODL_SKIP_MIGRATIONS=1`.
4. **After the upgrade:** students with in-progress coding answers will be asked
   to re-run the test cases. No stored score changes.
5. A coding question with no test cases now scores 0 until the instructor marks it.

## Tests

```bash
npm test --prefix backend                 # 156 unit tests (7 new for the hash)
npm test --prefix frontend                # 13 tests
npm test --prefix backend/judge-service   # 11 live sandbox tests (needs bubblewrap)
npm run check --prefix backend/judge-service
```

The judge suite starts a real worker and executes real submissions; it skips
loudly when the host cannot isolate, so a laptop without bubblewrap is not a
false failure.

## What was verified, and what was not

Verified by execution: the filesystem boundary, the memory ceiling, TLE, all
three languages still judging correctly, the schema importing cleanly into
MariaDB 11.8, all 24 migrations applying (including `quiz-answers`) and being
idempotent, 156 backend unit tests, 13 frontend tests, 11 live sandbox tests,
0 npm vulnerabilities across all three packages.

**Not verified:**

- **MySQL 8 and TiDB were not available.** B3 was confirmed by removing the
  MariaDB-only collations and checking portability, not by importing into those
  engines.
- B4, B5 and B6 are **by inspection** — I read the code and reasoned about it,
  I did not execute the attack. They are the changes most worth re-reading.
- Untouched entirely: live payment gateways (Razorpay/Paytm/UPI), real OAuth
  round-trips, SMTP, Docker/systemd deployment, a live Judge0 instance,
  browser-level proctoring, recording upload/finalise, load testing, and the
  frontend beyond its XSS sinks.
- The sandbox narrows the blast radius of one submission. It is not a VM
  boundary — a shared kernel still needs patching, disk quotas and capacity
  planning.
