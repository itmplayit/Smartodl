# Course page ab poora learning experience carry karta hai

Ye note batata hai ki pehle wala **Learning Path** feature kahan gaya aur uske
features course ke andar kaise aaye. Code ka source of truth repo hai; ye file
sirf "kya hata, kya course me aaya" ka hisaab rakhti hai.

## 1. Kya hata (removed)

| Surface | Kya hata |
| --- | --- |
| Backend files | `controllers/learningPath.controller.js`, `services/learningPaths.service.js`, `services/learningPathCertificates.service.js`, `utils/learningPath.js`, `utils/pathInsights.js` |
| API routes | `/api/learning-paths*` (browse, detail, enrol, progress, insights, xlsx, admin CRUD) — ab 404 |
| Migrations | `learning-paths` upgrade step aur `learning_paths` / `learning_path_courses` / `learning_path_enrollments` critical-table checks hata diye |
| Certificates | `issuePath` / `issueCompletedForCourse` hook hata diya — koi naya path certificate issue nahi hoga |
| Frontend pages | `pages/LearningPaths.jsx`, `pages/LearningPathDetail.jsx`, `student/MyLearningPaths.jsx`, `admin/LearningPathsManager.jsx`, `admin/LearningPathForm.jsx` |
| Navigation | Student/Developer/Admin sidebar links aur public header ka "Learning Paths" link |
| API client | `learningPathApi` block |
| Tests/docs | `learningPath.test.js`, `pathInsights.test.js`, `pathRecommendation.test.js`, `docs/PHASE-1..3-*` |

**Purane certificates safe hain.** Pehle jo path certificates issue hue the wo
`certificates` table me hain, verify page aur "My Certificates" par render hote
hain (label ab "Programme completion (legacy)"). Database ke
`learning_path*` tables delete nahi kiye — koi code unhe padhta nahi, isliye
data loss ka risk nahi. Chahein to baad me manually drop kar sakte hain.

## 2. Kya course ke andar aaya (moved)

Sab kuch course ke around hai — course hi ab unit hai, path nahi.

### Course page (`/courses/:id`)
- **Course assessments** — `CourseQuizzes` component: us course se linked saare
  quizzes ek list me (questions, marks, pass %, time limit, premium tag) aur
  learner ka last attempt status + score. Button normal quiz flow kholta hai,
  yani enrolment/premium/privacy checks wahi purane hain.
- **Course insights** (sirf owner / admin / us course ka developer) —
  `CourseInsights` component: enrolled, completed + completion %, average
  progress, `stall_days` (default 14) se inactive learners, certificates,
  module-wise funnel (learners finished / drop-off %) aur **Export report
  (Excel)** button.

### Course catalogue (`/courses`)
- **Suggested for you** strip: sirf un categories ke aadhar par jo learner ne
  complete ki hain; har card par reason likha hota hai ("Based on …"), aur
  suggestion kisi paid course ko unlock nahi karta.

### Naye endpoints
| Method | Path | Kaun |
| --- | --- | --- |
| GET | `/api/courses/recommended` | student (explainable suggestions) |
| GET | `/api/courses/:id/analytics` | course owner / admin / assigned developer |
| GET | `/api/courses/:id/analytics.xlsx` | wahi log — 3 sheets: Course summary, Module funnel, Learners |

`GET /api/courses/:id` ke response me ab `quizzes[]` bhi aata hai (staff ko
non-published quizzes bhi dikhte hain).

## 3. Rules jo nahi badle

- **Module complete** ka matlab wahi hai: module ke saare lessons complete.
  Isi rule se course complete hota hai aur funnel banta hai.
- **Inactive learner** sirf nudge signal hai — koi automatic penalty, email ya
  grade change nahi.
- **Integrity band** review indicator hai, misconduct ka finding nahi. Wahi
  band logic (green ≥80 / yellow 50–79 / red <50) course certificate par chalta
  hai jab course se koi quiz linked ho. Evidence na ho to "Insufficient data".
- **Public verification** par band default OFF hai (Feature Control se on).
- Course enrolment, payment (Razorpay/Paytm/UPI), lesson read-time guard,
  lesson progress aur certificate issuance — sab jaisa tha waisa chal raha hai.

## 4. Analytics me kya jaan-boojh kar nahi hai

- Time-on-task, engagement score, effort score, "suspicion" — kuch nahi.
  Sirf enrolment status + lesson completion + timestamps se derive hota hai.
- Chhote sample (3 se kam learners) par headline "Not enough data yet" hota
  hai — tiny cohort ko "healthy" nahi bolte.

## 5. Do baatein jo dhyaan me rakhein

1. **Purana path progress UI se nahi dikhega.** Learner ka course progress intact
   hai, par "main is path par 3/5 course kar chuka hoon" wala view ab nahi hai —
   path hi nahi raha. Chahein to `learning_path_enrollments` se CSV nikaal kar
   record rakh sakte hain (tables abhi DB me hain).
2. **Landing page ka purana content.** Landing Builder me jo content pehle save
   ho chuka hai usme "Guided learning paths" trust point saved ho sakta hai —
   naya default text "Structured course tracks" hai, par existing install me
   Admin → Landing Page Builder se ek baar edit karke save karna padega.

## 6. Tests

`cd backend && npm test` — 88/88 pass, jisme `test/unit/courseInsights.test.js`
(6 checks: completion counting, module funnel rule, stall count, weekly trend,
recommendation reasons, tiny-cohort label).

Live DB par alag se verify kiya gaya (MariaDB 11.8 + seeded "Let Us C" course):
quiz list on course page, analytics numbers, 403 for students, xlsx 3 sheets,
recommendations, `/api/learning-paths` = 404, aur lesson progress → analytics
refresh.
