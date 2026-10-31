# Live quiz features → normal + practice quizzes

Har live quiz ke andar ye features the. Normal (course) quiz aur practice quiz me
inme se **kaafi kuch nahi tha**, chahe wo bhi graded assessments hain. Ab wo sab
wahan bhi chalta hai — bina live session ke.

## Feature matrix

| Feature | Live quiz | Normal quiz | Practice quiz | Kaise |
| --- | --- | --- | --- | --- |
| Tab guard (tab switch detect + strikes) | ✅ | ✅ **naya** | ✅ **naya** | Feature Control floor |
| Fullscreen lockdown (bhagne par violation) | ✅ | ✅ **naya** | ✅ **naya** | Feature Control floor |
| Copy / cut / paste block | ✅ | ✅ **naya** | ✅ **naya** | Feature Control floor |
| Screenshot (PrintScreen) block | ✅ | ✅ **naya** | ✅ **naya** | Feature Control floor |
| Safe Exam Mode (F5, F12, Ctrl+R/W/T/N/P, right-click, refresh) | ✅ | ✅ **naya** | ✅ **naya** | Feature Control floor |
| Per-question timer (`time_limit_seconds`) | ✅ | ✅ **naya** | ✅ **naya** | runner |
| Violation counter + auto-submit on limit | ✅ | ✅ **naya** | ✅ **naya** | runner |
| "Open every question before submit" | ✅ hamesha | ⚙️ opt-in per quiz | ⚙️ opt-in per quiz | quiz toggle |
| Personal question order (individualized paper) | ✅ hamesha | ⚙️ opt-in per quiz | ⚙️ opt-in per quiz | quiz toggle |
| Webcam / screen share | ✅ (creator switch) | ⚙️ sirf admin allow kare to | ⚙️ sirf admin allow kare to | Feature Control (OFF by default) |
| Lobby, synchronised host start, live monitor, live warnings, snapshot/WebRTC/room scan/second camera/recording | ✅ | ❌ | ❌ | ye live session ke bina possible nahi |

## Do nayi Feature Control switches

**Admin → Feature Control → “🧪 Normal + practice quiz supervision”**

| Switch | Default | Kaam |
| --- | --- | --- |
| `normal_quiz_supervision_enabled` | **ON** | Institutional floor: tab guard, fullscreen lockdown, copy-paste block, screenshot block, Safe Exam Mode — normal aur practice quiz par. Teacher apni settings se ise kam nahi kar sakta. OFF karte hi creator ki apni settings hi lagti hain (purana behaviour). |
| `normal_quiz_proctoring_enabled` | **OFF** | ON karne par hi normal/practice quiz webcam/screen maang sakta hai (aur tab bhi creator ka switch chahiye). Consent screen pehle aati hai — kuch bhi chup-chaap start nahi hota. |

## Do naye per-quiz rules (quiz form me)

- **🔒 Open every question before submit** — student Submit tab tak nahi kar sakta jab tak
  saare questions ek baar na khole. **Server bhi rokta hai** (sirf UI disable nahi):
  `seen_question_ids` ke bina incomplete paper 400 deta hai.
- **🔀 Personal question order** — har student ka paper alag order me, attempt ke dauraan
  stable (live quiz jaisa Latin-square assignment).

Live quiz me ye dono hamesha ON rehte hain (jaisa pehle tha) — form me locked dikhte hain.

## Runner me kya badla

- `acEnforced` ab payload ke `enforced` / `supervised` se aata hai (pehle `quiz_type === 'live'`
  hard-code tha). Isliye tab guard, lockdown, copy-paste, screenshot, Safe Exam Mode aur
  per-question timer normal/practice quiz me bhi sach me chalte hain.
- `rules` payload se "view all" + personal order decide hote hain.
- Camera/screen sirf tab jab backend `camera_allowed: true` bheje (`isLive` ki jagah).
- Lockdown gate ka text ab: *"This is a supervised quiz… No camera and no screen share are
  used unless your instructor enabled them."*

## API payload (attempt)

```json
{
  "anticheat": {
    "tab_guard_enabled": true, "quiz_lockdown_enabled": true,
    "quiz_cp_block": true, "screenshot_block_enabled": true, "exam_safe_mode": true,
    "proctor_camera_enabled": false, "proctor_screen_enabled": false,
    "enforced": true, "quiz_scope": "course", "camera_allowed": false
  },
  "rules": { "require_all_viewed": true, "individualized_order": false },
  "supervised": true
}
```

`quiz_scope`: `live` | `module` | `course` | `practice`.

## Verification (sandbox, live)

`tmp-verify/verify-quiz-supervision.sh` — 12 checks, sab pass:

| Check | Result |
| --- | --- |
| normal quiz floor | 5 switches + `enforced=true`, `quiz_scope=course` |
| practice quiz floor | `quiz_scope=practice`, 5 switches |
| rules on | `view_all=True personal=True individualized=True` |
| rules off (default) | `view_all=False personal=False` |
| webcam default | `camera=False screen=False camera_allowed=False` |
| live quiz | payload unchanged (`quiz_scope=live`, `enforced=False`) |
| server backstop | 1 question dekh kar submit → **400** "viewed once" |
| saare questions dekh kar submit | **200** |
| supervision switch OFF | `enforced=False` (creator settings) |
| proctoring switch OFF + creator camera ON | `camera_allowed=False` |
| proctoring switch ON | `camera_allowed=True` |

`npm test`: **123/123** (6 naye supervision tests).

## Database

`npm run migrate` → upgrade `quiz-supervision`: `quizzes.require_all_viewed`,
`quizzes.individualized_order`, aur do settings rows.
Manual SQL ki zaroorat nahi: `npm run migrate` (backend) idempotent hai aur ye columns + settings rows khud add karta hai.

## Jo live-only rahega (jaan-boojh kar)

Lobby + synchronised start, host panel, live participant list, live monitor, host warnings,
snapshot grid, live WebRTC, room scan, mobile second camera aur saved recordings — ye sab
**host session** par depend karte hain. Normal quiz me host nahi hota, isliye ye nahi jodhe
gaye. Webcam presence/phone-book detection ab possible hai jab admin proctoring switch ON kare.
