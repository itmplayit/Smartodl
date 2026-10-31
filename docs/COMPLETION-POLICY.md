# Lesson complete karne ka rule (watch-lock + quiz gate)

**Problem jo tha:** student lesson kholta tha, 15 second rukta tha, "Mark complete"
dabata tha — video dekha ya nahi, kuch check nahi hota tha. Lesson kholne ka stamp
(`lesson_opens`) + dwell time (`lesson_min_open_seconds`, default 15s) bas itna
prove karta tha ki page fetch hua.

**Ab:** har course apna rule chunta hai. Default **`click`** hai, isliye koi
existing course apne aap nahi badlega.

| Policy | "Mark complete" kab allowed |
| --- | --- |
| `click` (default) | Pehle jaisa: lesson khula + dwell time |
| `watch` | Uploaded video ka **90% timeline** chal chuka ho |
| `quiz` | Course se linked **koi quiz pass** ho (best score ≥ `passing_score`) |
| `watch_and_quiz` | Dono |

Kahan set karein: **Admin/Courses → course edit → "Lesson complete karne ka rule"**
(`PUT /api/courses/:id {"completion_policy":"watch"}`).

## 90% "coverage" ka matlab kya hai

Video ki timeline **10 second ke slices** me kati jaati hai. Player har 10 second
me heartbeat bhejta hai (`POST /api/lessons/:id/watch`) — position, duration,
playing, rate. Server decide karta hai kaunse slices **dekhe gaye**:

- sirf tab count hota hai jab `playing = true` (paused tab = kuch nahi),
- lagatar chalne par beech ke saare slices cover hote hain,
- seek karke aage jump karne par sirf **ek** slice cover hota hai — isliye
  end tak kheench dene se 100% fake nahi banta (test me seek-to-end = 50%,
  honest playback = 100%),
- 2x speed allowed hai, 10x fast-forward nahi,
- buffering ke liye 15s ki chhoot hai, warna slow internet wala student
  "cheating" jaisa lagne lagta hai.

Coverage = `COUNT(slices) / total_slices`, aur ye **sirf badhta** hai.

## Kya naapa nahi ja sakta (honest limits)

1. **YouTube/Vimeo embed** — cross-origin iframe, browser hamein playback nahi
   batata. Aise lesson par `watch` apne aap lagu nahi hota (warna student
   hamesha ke liye fas jaata); `watch_and_quiz` me sirf quiz half chalta hai.
   Video upload karein to coverage naapi jaati hai.
2. **PDF** — browser ke andar ka scroll bhi cross-origin hai. Isliye PDF par
   "kitna padha" claim nahi karte; PDF-only lesson ke liye `quiz` policy sahi
   hai.
3. **Script se fake heartbeat** theoretically possible hai (client-side
   measurement kabhi proof nahi hota). Isi liye "watch + quiz" combo recommend
   kiya jaata hai: video chalane se sirf coverage milti hai, **marks quiz se**
   aate hain.

## Fairness rules jo code me locked hain

- Default `click` — purane course ka behaviour nahi badla.
- Jis lesson me measurable video nahi, wahan `watch` requirement **skip** ho
  jaati hai (student ko trap nahi karte).
- Gate sirf **naya completion** rokta hai; pehle se bane completions,
  certificates aur grades ko chhua nahi jaata. Issuance/revocation ka rule wahi.
- Message accuse nahi karta — sirf batata hai kitna baaki hai
  ("Video ka 45% dekha gaya hai — 90% chahiye"). Test is wording ko lock karta hai.
- Reason server-side banta hai; frontend sirf dikhata hai. Postman/curl se bhi
  bypass nahi hoga.

## Naye endpoints

| Method | Path | Kaam |
| --- | --- | --- |
| POST | `/api/lessons/:id/watch` | heartbeat: `{position, duration, playing, rate}` |
| GET | `/api/lessons/:id/watch` | `{coverage_percent, complete, target_percent, policy}` |

Dono par wahi entitlement check chalta hai jo lesson kholne par (guest 401,
unenrolled 403, enrolled 200). Elapsed time **server** par naapa jaata hai,
client ke claim par nahi.

## Database

`npm run migrate` adds: `courses.completion_policy`, `lesson_watch`,
`lesson_watch_buckets`. Manual ke liye `cd backend && npm run migrate`.

## Verification (sandbox, MariaDB 11.8, 12-second demo video)

| Scenario | Result |
| --- | --- |
| `watch` policy, kuch nahi dekha, complete dabaya | 400 — "Video ka 0% dekha gaya hai … 90% chahiye" |
| Sirf end tak seek kiya | coverage 50%, complete block |
| 0→12s honest playback (1s beats) | coverage 100%, complete **allowed** |
| `quiz` policy, koi attempt nahi | 400 — quiz pass karo |
| Failing attempt 2/16 | still blocked |
| Passing attempt 14/16 | allowed |
| `watch_and_quiz`, video-less lesson 4 | watch skip, quiz pass → allowed |
| `watch_and_quiz`, video lesson, coverage 0 | blocked |
| Invalid policy `watch_100` | 400 with allowed list |
| Student policy badalne ki koshish | 403 |
| `npm test` | 109/109 (13 naye watch/policy tests) |
