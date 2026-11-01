# Performance & Security Improvements — 2026-10-31

Branch `main`, working tree on top of `fe91c48`.
Companion to [`PERFORMANCE-SECURITY-CONCEPTS.md`](./PERFORMANCE-SECURITY-CONCEPTS.md)
(the 16-topic assessment) — this file records only what was **actually changed**.

**Status: implemented and unit-tested. Not load-tested. Not deployed.**

---

## What changed

| # | Topic | Change | Where |
|---|-------|--------|-------|
| 3 | Response caching | New cache-aside layer + 4 cached reads | `backend/services/cache.service.js` (new) + 3 controllers |
| 8 | N+1 queries | Course leaderboard → 1 join; contest recalc → batched writes | `misc.controller.js`, `coding.controller.js` |
| 6 | CAPTCHA | New service + middleware + React widget | `services/captcha.service.js`, `middleware/captcha.js`, `components/CaptchaField.jsx` |
| 13/14 | Session & device visibility | `GET/DELETE /auth/sessions` + settings UI | `auth.controller.js`, `utils/deviceLabel.js`, `pages/Settings.jsx` |

---

## 3. Caching

### New: `backend/services/cache.service.js`

A cache-aside helper over the **existing** Redis client (`services/redis.service.js`).

- **No-op when Redis is unavailable.** Every function checks for a client first and
  returns a miss / resolves immediately. A single-instance deployment with Redis off
  behaves **exactly as it did before** — this was a hard requirement, because the app
  must keep working without Redis.
- **A cache error never fails a request.** Reads fall through to the DB; writes swallow
  the error. Losing the cache must never take the site down.
- `delPrefix()` uses `SCAN`, not `KEYS` (which blocks the whole server on a large keyspace).
- Prefix `sodl:cache:`, default TTL 60 s.
- `cached(key, ttl, fn)` never caches `undefined`.
- Hit/miss counters exposed via `snapshot()` for ad-hoc inspection.

### What is cached

| Key | TTL | Why this TTL |
|-----|-----|--------------|
| `coding:languages` | 300 s | Judge0 language list; changes only when the judge pool changes. |
| `stats:public` | 60 s | 9 counting subqueries; landing-page counters tolerate a minute of staleness. |
| `landing:public` | 300 s | Anonymous visitors all get the same page; it is the single hottest read. |
| `contest:leaderboard:<id>` | 60 s | **Completed contests only** — see below. |

### Invalidation

- Landing publish / revert-to-draft / restore-revision → `dropLandingCache()`.
- Any settings update → `landing:public` dropped (site name and banner live in settings).
- Live contests are **not** cached — the standings change on every submission.

### Why caching the completed-contest leaderboard is safe

`recalcContest` also drives certificate issuance, so caching it could have skipped
certificates. It cannot: `_issue()` in `controllers/certificate.controller.js` takes
`SELECT id FROM users … FOR UPDATE` and checks for an existing certificate **inside the
same transaction** (`uq_certificate` on user/type/context). Issuance is idempotent and
upgrades in place on a better result, so a cache hit that skips a recalc loses nothing.

### Deliberately NOT cached

**Settings.** `services/settings.service.js` already holds a 15 s in-process TTL cache
and `updateSettings()` refreshes it via `loadSettings(true)`. Adding Redis on top would
be redundant. (An earlier draft of this file claimed settings hit the DB per request —
that was checked and found to be wrong.)

---

## 8. N+1 queries

### Course leaderboard — `misc.controller.js`

**Before:** two correlated subqueries per returned row. On a 500-student course that is
~1000 extra lookups on every page view.

**After:** one aggregate `LEFT JOIN` over the course's own students, single pass.

Scope is still enforced by `course_id`, so a student only ever aggregates over their own
course's roster.

### Contest recalculation — `coding.controller.js`

**Before:** one `INSERT`/`UPDATE` per participant **and** one per problem. A contest with
200 participants × 4 problems was ~520 round-trips, all inside one request.

**After:**
- `upsertContestParticipants()` — chunked multi-row `INSERT … ON DUPLICATE KEY UPDATE`
  (chunk size 200), relying on the existing `uq_contest_participant (contest_id, user_id)`.
- `updateContestProblemCounts()` — a single `CASE`-based `UPDATE` for all problems.

~520 round-trips → roughly 4.

---

## 6. CAPTCHA

**Why it is worth adding:** `loginGuard` throttles after N failures, but that is reactive —
the attempts still hit the credential check and the database. A CAPTCHA on the three
credential-entry forms stops the scripted traffic before that.

**Why it is self-hosted by default:** requiring a reCAPTCHA key just to run the app means
the feature is effectively off on every self-hosted install. The `image` provider needs no
signup, no outbound network, and sends no user data to a third party.

- `services/captcha.service.js` — one interface over `image` / `recaptcha` / `hcaptcha` /
  `turnstile`. Config via `CAPTCHA_ENABLED`, `CAPTCHA_PROVIDER`, `CAPTCHA_SITE_KEY`,
  `CAPTCHA_SECRET_KEY`, `CAPTCHA_MIN_SCORE`. Documented in `backend/.env.example`.
- `middleware/captcha.js` — `requireCaptcha`, a no-op until `CAPTCHA_ENABLED=true`.
- Wired onto `POST /auth/register`, `/auth/login`, `/auth/forgot-password`.
- New public endpoints: `GET /api/captcha/config`, `GET /api/captcha/challenge`.
- `components/CaptchaField.jsx` — renders whatever the server has configured; inert when
  disabled. Wired into **Login, Register and ForgotPassword** (all three, not just login —
  the backend middleware is on all three, so wiring only one would break the others the
  moment an admin enables it).
- `backend/test/unit/captcha.test.js` — 6 new unit tests.

**Image-provider design notes:**
- Each challenge is **single-use** — consumed whether the answer was right or wrong — so a
  bot cannot grind answers against one long-lived id.
- Answer comparison uses `crypto.timingSafeEqual`.
- Rendered as an inline SVG data URL (no image files, no canvas dependency).

**Two known limitations, stated plainly:**
1. The `image` provider stores challenges **in process memory**, so it only works on a
   **single backend instance**. Behind more than one instance, use a hosted provider or
   back the map with Redis. This caveat is in the service file's header comment.
2. A simple arithmetic SVG stops a dumb script, not a determined OCR attack. If you are
   actually being targeted, use a hosted provider.

---

## 13/14. Session & device visibility

The app already stored `user_agent` and `ip_address` on every `user_sessions` row. Nothing
ever displayed them, so a session the user did not recognise stayed invisible until it was
used.

- `GET /api/auth/sessions` — lists the caller's live sessions with a human-readable device
  label, IP, created/last-used/expiry, and a `current` flag.
- `DELETE /api/auth/sessions/:id` — revokes one session, scoped by `user_id` so a guessed id
  can only ever hit the caller's own rows. If the caller revokes the session they are
  sitting on, their cookie is cleared too.
- `utils/deviceLabel.js` — dependency-free UA → `"Chrome on Windows 10/11"`.
- `pages/Settings.jsx` — new "Active devices" card.

**Two details worth knowing:**
- The session list **purges expired/revoked rows first**. Without that the table grows
  forever and the list fills with sessions the user cannot use.
- `refresh_token` is read server-side to work out which row is `current`, then **dropped** —
  the token digest is never sent to the client.
- `last_used_at` falls back to `created_at`: rotation only moves on refresh, so that is the
  best "last seen" signal available without a schema change.

---

## Verification

Run after all edits:

```
backend   npm test   → # pass 162   # fail 0     (was 156; +6 captcha tests)
frontend  npm test   → # pass 13    # fail 0
judge     npm test   → # pass 11    # fail 0
frontend  npx vite build → built OK
node --check on every changed .js  → clean
```

## What is NOT verified

- **No load testing was done.** Cache hit-rate and the N+1 gains are reasoned from the
  query shapes, not measured under production traffic.
- **The CAPTCHA end-to-end flow was never exercised against a real provider** (no
  reCAPTCHA/hCaptcha/Turnstile credentials, and no outbound network in this sandbox).
  Only the self-hosted `image` path is unit-tested.
- **The new `/auth/sessions` endpoints were not exercised against a live database** —
  verified by code review and the existing suite, not by an integration test.
- Nothing here has been deployed.

## Not changed (re-assessed and left alone)

- **Settings caching** — already has a 15 s TTL cache. No change needed.
- **Message broker** — the judge runs `MAX_CONCURRENCY=2` / `MAX_QUEUE=200` and SSE already
  uses Redis pub/sub. A broker would be added complexity for no gain.
- **Anomaly detection** — no traffic baseline exists to build it on; it would generate
  noise.
- **Refresh-token rotation, connection pooling, payment idempotency** — already correct.
