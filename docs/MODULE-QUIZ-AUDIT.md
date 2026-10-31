# Module quiz — deep audit (bug report + fixes)

Audit date: 2026-10-28 · repo: `Smartodl` · live checks against MariaDB `education_platform` + API on `:5000` + Vite proxy `:5173`.

Symptom jo aapne bataya: **“course main quiz nahi aa rahi”**. Uska root cause + 5 aur problem mile.
Sab fix ho gaye, sab live re-verify hue.

---

## 1. Root cause: quiz `draft` tha, isliye learner ko dikh hi nahi raha tha

Quiz banate waqt default status **draft** hota hai. Course page learner ko sirf
`published` / `completed` quiz dikhata hai — isliye module ke andar quiz card gayab tha.

**Aur isi ke saath ek bada bug tha:** draft quiz **dikh nahi raha tha, attempt bhi nahi ho sakta tha,
par lesson completion rok raha tha** → student permanently stuck.

```
{"success":false,"error":"Is course ka linked quiz pass karna zaroori hai — Course assessments section se quiz attempt karein."}
```
…aur “Course assessments” section me woh quiz tha hi nahi. Ye dead-end tha.

**Fix:** gate ab sirf **wahi quiz** ginta hai jo learner attempt kar sakta hai
(`status IN ('published','completed')`). Draft quiz gate nahi karta.

**Verify (live):**

| Case | Pehle | Ab |
| --- | --- | --- |
| Module quiz draft, student ne attempt nahi kiya, lesson complete dabaya | ❌ blocked (dead-end) | ✅ allowed |
| Module quiz published, attempt nahi kiya | ❌ blocked | ❌ blocked — message ab module ka naam batata hai |
| Module quiz 9/10 pass | ✅ allowed | ✅ allowed |

Naya message: `Is module ka quiz (“Module 1 Check - C basics”) pass karna zaroori hai — quiz us module ke andar diya hai.`

---

## 2. Anti-cheat browser me chal hi nahi raha tha (sabse gambhir)

Backend `anticheat.tab_guard_enabled / quiz_lockdown_enabled / quiz_cp_block /
screenshot_block_enabled = true` bhej raha tha, **par runner me chaaron checks
`&& isLive` se bandhe the**. Module quiz `normal` type ka hota hai → yaani
tab guard, fullscreen lockdown, copy-paste block, screenshot block aur safe exam mode
**kabhi activate hi nahi hote the**. Paper par likha tha, browser me dead code tha.

**Fix:** naya `acEnforced = isLive || module quiz` flag (backend se `module_quiz: true`
+ `enforced: true` aata hai, aur `quiz.module_id` bhi payload me hai). Chaaron checks
+ safe exam mode ab `acEnforced` par chalte hain. Camera/screen share **abhi bhi**
sirf live par — module quiz me nahi (jaan-boojh kar).

Runner UI me naya badge: `📚 Module quiz · no camera`, aur lockdown gate ka text
“This is a supervised module quiz … **No camera and no screen share are used in a module quiz.**”

---

## 3. Feature Control ka floor switch OFF karte hi camera maang sakta tha

`module_quiz_anticheat_enabled=0` karne par code seedha **creator ki settings**
le raha tha. Agar us teacher ne apni settings me `proctor_camera_enabled=1` rakha hai,
to module quiz camera maang sakta tha — jo aapka hard rule todta hai
(“module quiz me webcam/screen kabhi nahi”).

**Fix:** module quiz ke liye camera/screen **hamesha** false — floor on ho ya off.
Floor off ka matlab sirf itna hai ki teacher apne tab-guard/lockdown/copy-block
choices use kar sakta hai.

**Verify (live, floor OFF + creator camera/screen forced ON):**
```
module_quiz=True enforced=True
proctor_camera_enabled=False proctor_screen_enabled=False
camera_allowed=False screen_allowed=False
```
Non-module quiz waisa hi rehta hai (payload me koi `module_quiz`/`enforced` key nahi).

---

## 4. Module quiz “Course assessments” me duplicate dikh raha tha

`course.quizzes` query sirf `course_id` par filter karti thi, `module_id` par nahi →
module quiz **do jagah** dikhta tha (module ke andar + neeche assessments me), aur
assessments me `passed` state bhi nahi thi. Owner view me confirm hua:
`course quizzes[]: [(1, …), (2, 'Module 1 Check - C basics')]`.

**Fix:** course-level list ab `AND z.module_id IS NULL`. Assessments section jab khaali ho
par module quizzes hon, to manager ko batata hai: “N module quizzes is attached to the
modules above … a course-level quiz is optional.”

---

## 5. Ek module par doosra quiz “gayab” ho jaata tha

Module ka payload ek hi quiz (`find()`) uthata tha — teacher galti se doosra quiz attach
kare to woh kahin render hi nahi hota tha.

**Fix:** har module me ab `quizzes: [...]` array (aur purane callers ke liye `quiz` = pehla).
Course page sab render karta hai, count bhi quiz-wise hai (`2 module quizzes`, module head
me `📚 2 module quizzes`), aur quiz dropdown me “· already has: <title>” hint aata hai.

**Verify:** module 1 par do quiz attach kiye → dono payload me aaye, assessments me ek bhi nahi.

---

## 6. “Add quiz” / “Open in admin” link developer ke liye galat tha

Course page ka shortcut hamesha `/admin/quizzes?...` kholta tha. Developer ka quizzes
screen `/developer/quizzes` par hai → developer ko 403/redirect milta.

**Fix:** role ke hisaab se `/admin` ya `/developer`.

---

## 7. (Player) Background tab se 90% watch requirement pass ho sakti thi

`VideoPlayer` heartbeat me `playing: true` bhejta tha chahe tab background me ho.
Server `playing=false` par kuch count nahi karta, to ye ek asli loophole tha:
video chhod ke doosra tab kholo, coverage phir bhi badhti rehti thi.

**Fix:** `playing: visible && !paused && !ended` (`document.visibilityState`). Ab
hidden tab se watch time nahi banta.

---

## Aur cheezein jo check ki, theek nikli (koi change nahi)

| Check | Result |
| --- | --- |
| Module quiz ko live banana | 400 — saaf message (camera/screen reason ke saath) |
| Dusre course ka module attach karna | 400 “That module does not exist” |
| `module_quizzes_enabled` OFF | course page se quiz gayab **+** create API 403 |
| Course-level quiz par module floor ka asar | ❌ nahi — payload bilkul pehle jaisa |
| Attempt payload me `proctor_policy.live` | `false`, camera/screen required `false` |
| Module quiz ko global quiz catalogue me dikhna | Haan (published) — ab wahan `📚 module quiz` tag lagta hai |
| Extra DB/query load | 1 extra query, flag ek hi baar padha jaata hai (double read hata diya) |
| `npm test` (backend) | **115/115** pass (module quiz + policy tests ke saath) |
| `vite build` / `git diff --check` | ✓ build · clean |

---

## Siski bachi cheezein (jaan-boojh kar aise rakha)

- **Per-question time limit** sirf live quiz me chalta hai (module quiz me poore quiz ka timer).
  Ye purana design hai; module quiz ke liye badalna ho to bata dein.
- **`in_progress` attempt chhoote reh jaate hain** (student tab band kar de) — purana
  behaviour, quiz 2 me ek aisa attempt dikha. Chaahein to “student ne chhoda” flag/stale-cleanup
  add kar sakte hain.
- **Camera/screen keys me `'1'` (string) aur `true` (boolean) dono aa sakte hain** —
  runner (`acOn`) dono handle karta hai, par API contract saaf karna ho to bata dein.
- Module quiz **published** karna zaroori hai, warna learner use nahi dekh paayega
  (ab course page par teacher ko `draft · students can't see it` badge dikh jaata hai).

## Kaise test karein (2 minute)

1. `Admin → Quizzes → Create quiz` (ya module ke saamne **🧠 Quiz**) → course “Let Us C”,
   “Linked module” = Module 1, passing 40%, questions add karein.
2. **Status `published`** karein — yahi asli wajah thi ki quiz nahi dikh raha tha.
3. Student se course page kholein → Module 1 expand → quiz card + **Start quiz**.
4. Quiz khulte hi fullscreen lockdown gate aayega, header me `📚 Module quiz · no camera`
   aur `🔒 Lockdown` + `📋 Copy-paste off` + `👁 Violations 0/3` dikhega. Camera ka
   koi prompt **nahi** aayega.

---

## 8. Chhote UI/UX fixes jo isi audit me nikle

| Problem | Fix |
| --- | --- |
| Course assessments khaali hone par manager ko “No quiz is linked” dikhta tha, chahe module quizzes ho | Ab likha aata hai: “N module quizzes is attached to the modules above — module quizzes gate that module's lessons, so they are not repeated here.” |
| Student quiz catalogue me module quiz aur practice quiz ek jaise dikhte the | Published module quiz par ab `📚 module quiz` tag (payload me `module_id` pehle se tha) |
| Module ke bina ki module quiz ko “Add quiz” ka koi raasta nahi tha | Har khaali module ke andar manager ko `➕ Add quiz` (course + module pre-filled form kholta hai) |
| Wahi link developer ke liye `/admin/...` kholta tha (403/redirect) | Role ke hisaab se `/admin` ya `/developer` |
| Ek module par doosra quiz attach karne par dropdown me kuch pata nahi chalta tha | Option me “· already has: <title>” hint |

## 9. Data issue (code nahi) — DB me “â€—” jaisa text

Aapke DB me agar kisi quiz/lesson ka title `â€”` jaisa dikhe, to woh UTF-8 ka double-encode hai.
Reason: `mysql` CLI ka default charset latin1 hota hai — usme em dash (—) daalne par row double-encode ho jaati hai.
Is sandbox me 2 quiz rows isi tarah corrupt mili thi, repair kar di gayi. Dhyaan rakhein:

```bash
# galat
mysql -u root -p education_platform
# sahi (CLI manual update karte waqt)
mysql --default-character-set=utf8mb4 -u root -p education_platform
```

Byte-level scan ke baad ab poore database me 0 corrupt rows hain (`HEX(col) LIKE '%C3A2C282%'` se check).

## 10. Jo cheezein “bug” lag sakti hain par aise hi design hain

- `POST /quiz-attempts/:id/submit` response me marks `total` key me aata hai, `total_marks` me nahi
  (`{score: 2, total: 2, passed: true, accuracy: 100}`).
- Course-level `quizzes[]` me module quiz **nahi** aatega — wo module ke andar hote hain (jaan-boojh kar).
- Learner ko draft module quiz dikhega nahi; teacher ko `draft · students can't see it` badge dikhega.
- Module quiz ke attempt par camera/screen ki keys payload me **hamesha false** aati hain, chahe
  Feature Control ka anti-cheat switch off ho.

---

## 11. “Fix all” round — jo 4 cheezein bachi hui thi, wo bhi ho gayi

### 11.1 Per-question time limit ab module quiz me bhi chalta hai
Pehle `time_limit_seconds` wala countdown **sirf live** quiz me chalta tha. Module quiz bhi
supervised assessment hai, isliye ab wahi countdown + question lock module quiz par bhi lagta hai
(condition `isLive` → `acEnforced`).

### 11.2 Chhoote hue (ghost) attempts ab khud settle hote hain
Pehle ek attempt `in_progress` pada rehta tha jab tak purana hourly housekeeping use **24 ghante**
baad na chhuye — tab tak course page "in_progress" dikhata tha, "Try again" wahi dead paper
kholta tha (jisme likhna already band tha), aur live quiz ki `max_participants` seats ghost
attempts se bhari rehti thi.

Naya `backend/services/quizAttempts.service.js`:
- quiz ke **deadline + 30 min** ke baad (ya bina time-limit quiz me 24 ghante ki chuppi ke baad)
  attempt settle hota hai,
- **saved answers hon to grade** hote hain (late submit jaisa insaaf),
- **kuch bhi save na hua ho to `abandoned`** — jhootha “evaluated 0/10” history me nahi jaata,
- `startAttempt` par bhi turant settle hota hai (student ko intezaar nahi karna padta),
- boot par + har 15 min me chalta hai; live session khula ho to host ke haath me chhoda jaata hai.

**Live verify:** 5-minute quiz me 3 ghante purana attempt → start dabate hi purana attempt band
(`evaluated 1.00` jab answer saved tha, `abandoned` jab kuch save nahi tha) aur naya attempt khula.

### 11.3 Anti-cheat payload ka type contract saaf
Pehle `tab_guard_enabled` kabhi `true` aata tha, kabhi `'1'` (settings se seedha). Ab
`normaliseFlags()` sab `*_enabled`, `*_allowed`, `*_block`, `*_auto_submit` aur `exam_safe_mode`
ko **asli boolean** bana deta hai — counts (`proctor_max_violations`) number hi rehte hain.
Live verify: module quiz aur course-level quiz dono me sab flags `bool`.

### 11.4 `submit` response me `total_marks` alias
`{score, total, …}` ke saath ab `total_marks` bhi aata hai (baaki quiz payloads yahi naam use
karte hain), to client ko guess nahi karna padta.
