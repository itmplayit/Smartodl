# Certificate integrity band (green / yellow / red)

**Status:** Implemented. Backend tests pass (97/97) and the frontend production build passes. Not yet exercised against a live database.

## What it does

A course certificate now carries an **integrity review band** beside the grade:

| Band | Score | Meaning |
| --- | --- | --- |
| 🟢 Green | 80–100 | No deductions, or a minor one |
| 🟡 Yellow | 50–79 | Some recorded events — check the attempt log |
| 🔴 Red | under 50 | Many recorded events — review before relying on it |
| ⚪ Insufficient data | — | No monitored assessment in scope |

The band appears on:

- the printed / PDF certificate (`GET /api/cert/:token/print`)
- the learner’s **My Certificates** cards
- the verification page (`/cert/:token`) — see the privacy rule below

## Rules that must not be broken

1. **No evidence is never green.** A certificate for a course with no monitored, linked assessment shows “Insufficient data”, not an all-clear.
2. **It is a review indicator, not a verdict.** Wording on the certificate and the verify page says so explicitly. The band never blocks issuance, changes a grade, or revokes a credential — revocation remains a human admin action on the Certificates screen.
3. **Public exposure is opt-in.** `certificate_integrity_band_public` defaults to **OFF**: someone looking up a certificate by its printed number sees no band. Only the holder (who has the private print token) and admins see it. Turn it ON only if your institution has agreed to publish a review indicator about a named learner.
4. **No new punishment paths.** Nothing is emailed, locked or flagged automatically because of a band.

## Which attempts are counted

`certificate_integrity_scope` decides:

- **`course`** (default) — only quizzes an admin linked to that course. This needed a new nullable `quizzes.course_id`; the admin **Quizzes** form now has a “Linked course (optional)” selector. A course certificate should not borrow signals from unrelated exams.
- **`overall`** — every monitored attempt by that learner in the last 12 months. Use it only where quizzes are not linked to courses; it is a broader, weaker signal and the UI says so.

The score itself is unchanged: `utils/integrityScore.js` starts at 100 and deducts the configured marks per recorded tab switch and proctor violation. Advisory detections, AI estimates, recording-consent choices and technical failures are still excluded.

Multiple attempts are averaged, and the response also returns `lowest_score` so an owner can spot a single bad sitting.

## Settings

Managed from **Admin → Feature Control → ⚖️ Student Integrity Score**:

| Key | Default | Purpose |
| --- | --- | --- |
| `certificate_integrity_band_enabled` | ON | Show the band at all |
| `certificate_integrity_band_public` | **OFF** | Also show it on public verification |
| `certificate_integrity_scope` | `course` | Linked-course assessments vs. all monitored attempts |

## Implementation map

- `backend/utils/integrityBand.js` — thresholds + `summarizeIntegrity` (pure, unit-tested)
- `backend/services/certificateIntegrity.service.js` — `quizzes.course_id` migration, settings, per-certificate lookup
- `backend/controllers/certificate.controller.js` — `myCertificates`, `verify`, `printView` + the printed block
- `backend/controllers/quiz.controller.js` — validated `course_id` on quiz create/update
- `frontend` — band chip in My Certificates and the verify page, course selector in the quiz form, three switches + scope select in Feature Control

## Acceptance checks

1. Course with a linked quiz and a clean monitored attempt → green.
2. Linked quiz with many recorded events → yellow/red, and the certificate still prints with the same grade and score.
3. No linked quiz → “Insufficient data”; never green.
4. Public certificate-number lookup shows no band while `certificate_integrity_band_public` is OFF.
5. Turning `certificate_integrity_band_enabled` OFF removes the band everywhere without touching stored certificates.
6. Quiz → course linking does not change quiz visibility, access, scoring or existing certificates.
