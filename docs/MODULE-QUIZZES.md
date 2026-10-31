# Module quizzes — har module ka apna quiz, anti-cheat ke saath, camera ke bina

## Kya bana

- Har **course module** ke saath **ek quiz** link ho sakta hai (`quizzes.module_id`).
- Course page par quiz **usi module ke andar** dikhta hai (lesson list ke neeche),
  attempt status, score aur pass/fail ke saath.
- Module quiz ke attempts par **anti-cheat floor** hamesha chalta hai:
  **tab guard + fullscreen lockdown + copy-paste block + screenshot block**.
- **Webcam aur screen share kabhi nahi** — ye structurally rok diya gaya hai:
  module quiz hamesha `quiz_type = 'normal'` hota hai, aur camera/screen sirf
  **live** quiz me hi maange jaate hain (proctor policy `live:false`).

## Feature Control me alag button (do switch)

**Admin → Feature Control → “📚 Module quizzes (course ke andar — alag switch)”**

| Switch | Default | Kaam |
| --- | --- | --- |
| `module_quizzes_enabled` | ON | Poore feature ka master. OFF karte hi: course page se module quizzes gayab, aur **API bhi refuse** karti hai (sirf UI chhupna nahi). |
| `module_quiz_anticheat_enabled` | ON | Module quiz attempts par upar wala anti-cheat floor. OFF karne par creator ki apni anti-cheat settings lagti hain (camera/screen phir bhi kabhi nahi). |

## Teacher ka flow

1. **Admin → Modules & Lessons** → module ke saamne **🧠 Quiz** button.
   Ye `/admin/quizzes?course=<id>&module=<id>` kholta hai aur **create form
   pehle se bhara hua** aata hai.
2. Title, time limit, passing score bhar ke save karein → **Questions** add karein
   → **Publish**.
3. (Ya seedha **Admin → Quizzes → Create quiz** me “Linked module” dropdown se bhi
   ho sakta hai.)

⚠️ Module quiz ko **live** quiz banana mana hai — try karne par saaf error:
“A module quiz cannot be a live quiz — module quizzes run with tab guard and
lockdown, but never a camera or screen share.”

## Completion rule ke saath connection

Course policy `quiz` ya `watch_and_quiz` ho to:

- Agar **lesson ke module ka apna quiz** hai → **wahi** pass karna hoga.
  Course-level quiz pass karke module quiz skip **nahi** ho sakta (test se locked).
- Module ka quiz na ho → course-level quiz chalega.
- Module me quiz hai par student ne attempt hi nahi kiya → complete block.

## Naye/updated endpoints

| Method | Path | Note |
| --- | --- | --- |
| POST | `/api/quizzes` | body me `module_id` (optional) |
| PUT | `/api/quizzes/:id` | `module_id` set/unlink; live + module conflict par 400 |
| GET | `/api/courses/:id` | har module me `quiz: {...}` + `quizzes: [...]` + `module_quizzes_enabled`; course-level `quizzes[]` me module quizzes **nahi** aate |

Attempt payload (`POST /api/quizzes/:id/attempts`) me ab:
`anticheat.tab_guard_enabled / quiz_lockdown_enabled / quiz_cp_block /
screenshot_block_enabled = true`, `proctor_camera_enabled = false`,
`proctor_screen_enabled = false`, `module_quiz = true`, `enforced = true`,
`camera_allowed = false`, `screen_allowed = false`, aur `quiz.module_id`.
Runner `enforced` dekh kar hi tab guard + lockdown + copy-paste block + screenshot
block + safe exam mode chalata hai (live ke liye `quiz_type='live'`).

## Attempt status (course page par)

`in progress` · `submitted` · `evaluated` · `abandoned (time over)`

Ghost attempts (tab band kar diya) ab **deadline + 30 min** par khud settle ho jaate hain:
saved answers hon to grade, warna `abandoned` (jhootha zero nahi). Purana 24-ghante wala wait
hata diya gaya hai.

## Published karna zaroori hai

Quiz default me **draft** banta hai. Draft module quiz learner ko dikhta nahi,
attempt bhi nahi hota — aur ab completion gate bhi nahi rokte (pehle rok deta tha,
student permanently stuck ho jaata tha). Course page par teacher ko
`draft · students can't see it` badge dikhta hai.

## Multiple quizzes per module

Ek module par ek se zyada quiz ho sakte hain — sab course page par render hote hain,
aur completion ke liye **koi ek** pass karna kaafi hai.

## Verification (sandbox, MariaDB 11.8)

> Deep audit ki poori list — bug, symptom, fix, verify — `docs/MODULE-QUIZ-AUDIT.md` me hai.


| Scenario | Result |
| --- | --- |
| Module quiz banaya (course 1, module 1) | 200, `module_id: 1`, `quiz_type: normal` |
| Module quiz live banana | 400 — clear message, camera/screen reason ke saath |
| Kisi aur course ka module | 400 “That module does not exist / different course” |
| Course page payload | module 1 me `quiz` object, baaki modules me `null` |
| Attempt payload | tab guard/lockdown/cp/screenshot = **true**, camera/screen = **false**, `proctor_policy.live=false` |
| Module quiz pass nahi (course quiz pass hai), complete dabaya | **blocked** — “linked quiz pass karna zaroori hai” |
| Module quiz 8/10 pass | **allowed** |
| Feature Control switch OFF | course page se quiz gayab + create API 403 |
| Draft module quiz + lesson complete | **allowed** (pehle dead-end block tha) |
| Published module quiz, attempt nahi | blocked, message me module quiz ka naam |
| Ek module par 2 quiz | dono payload/render me, assessments me ek bhi nahi |
| Floor switch OFF + creator camera ON | camera/screen phir bhi **false** |
| `npm test` | **115/115** (naye module-quiz + policy tests) |

## Database

`npm run migrate` → `quizzes.module_id` + index + 2 settings rows.
Manual: `database/patch-module-quizzes.sql` (idempotent; module quiz jo live ho
gaya ho use report bhi karta hai).
