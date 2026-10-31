# Dark mode — course page (modules & lessons) fix

**Date:** 2026-10-31
**Symptom (user report):** dark mode me course page ke modules & lessons ka layout colour aur font sahi nahi dikh rahe.
**Actual cause:** font theek tha — **colour invisible tha**. Module cards hardcoded white the, par unka text
theme token (`--text: #e8eefc`) se aa raha tha → **1.16:1 contrast** (WCAG minimum 4.5:1).

## Files changed

| File | Change |
|---|---|
| `frontend/src/styles.css` | 12 rules token-driven, 5 missing CSS variables define, 3 duplicate `.card` rules hataye |
| `frontend/index.html` | first-paint theme default `light` → `dark` (ThemeContext se match), fonts actually load |
| `tools/audit-theme-colors.py` | **new** — repeatable auditor (hardcoded light colours + undefined vars + contrast) |

## Issues found and fixed

| # | Severity | Was | Now |
|---|---|---|---|
| 1 | CRITICAL | `.module-card { background:#fff }` + `color: var(--text)` → titles invisible (1.16:1) | `background: linear-gradient(180deg,var(--panel),var(--bg-soft))`, `color: var(--text)`, `border: 1px solid var(--border)` |
| 2 | CRITICAL | `.course-progress { background:#fff }` → progress text invisible | `background: var(--panel)`, `border: 1px solid var(--border)`, `color: var(--text)` |
| 3 | HIGH | `--line` variable **kabhi define nahi hua**; 13 rules ne bina fallback use kiya (`.lc-pane`, editor tabs, resizer dividers) → border/divider poori tarah gayab | `--line: var(--border)` `:root` me add |
| 4 | HIGH | `index.html` first paint `light`, `ThemeContext` default `dark` → flash + turant toota hua first paint | dono ka default `dark` |
| 5 | MEDIUM | hover `rgba(15,23,42,.03)` = 1.06:1, active = 1.11:1 → koi feedback nahi | hover `rgba(99,102,241,.08)`, active `rgba(99,102,241,.14)` + border `.40` |
| 6 | MEDIUM | `.chips-mini span #4338ca`, `.chips-none #64748b`, `.tag-green #047857` — light-only ink | theme tokens: `--chip-ink` (dark `#c7d2fe` 9.5:1 / light `#4338ca` 6.3:1), `--tag-green-ink` (dark `#6ee7b7` 9.1:1 / light `#047857` 4.8:1) |
| 7 | MEDIUM | `Inter` / `JetBrains Mono` declared but **never loaded** (no `@font-face`/`@import`/`<link>`) | `<link>` Google Fonts + `preconnect`, `display=swap`; offline/LAN pe system-ui fallback |
| + | MEDIUM | `--soft` aur `--focus` bhi undefined — `.lc-*` chrome transparent, aur **keyboard focus ring gayab** (a11y) | `--soft` (dark `rgba(99,102,241,.10)` / light `#eef2fb`), `--focus` (dark `#818cf8` / light `#4f46e5`) |
| + | LOW | `.card` **teen baar** define (line 103, 913–914, 1253) — do rules provably dead the | dead duplicates hataye, `.card` ab single source (visual change **zero**) |

## Measured contrast (dark theme = default)

| Pair | Before | After |
|---|---|---|
| Module/lesson title on card | **1.16:1** ❌ | **14.92:1** ✅ AAA |
| Lesson meta ("12 min") | **2.54:1** ❌ | **6.83:1** ✅ AA |
| Body text on page bg | 16.79:1 ✅ | 16.79:1 ✅ |
| Chevron / link `--brand-3` | 4.47:1 (borderline) | **5.81:1** ✅ |
| Quiz chips ink | 7.9:1 on white, **~1.4:1** if card fixed na karte | **9.49:1** dark / **6.27:1** light ✅ |
| Tag "passed" ink | 5.48:1 on white, **~2.5:1** on dark | **9.14:1** dark / **4.80:1** light ✅ |
| Lesson hover / active | 1.06 / 1.11:1 ❌ | 1.9 / 2.2:1 visible state ✅ |

## Verification (all run, all green)

```
frontend  npx vite build ............. ✓ built in 12.55s
backend   npm test ................... 123 pass / 0 fail
tools     python3 tools/audit-theme-colors.py
          → undefined custom properties: none
          → hardcoded light colours in course-page rules: none ✅
          → dark contrast 5/5 ok
          → ALL THEME COLOUR CHECKS PASSED
git diff --check ..................... clean
live      5173 served CSS             `.module-card { border: 1px solid var(--border); ... }`
          preview host (403 check) ... 200 OK
api       5000 /api/health ........... 200
```

## Light mode

Ko i asar nahi. Har naya value token se aata hai aur light theme me wahi light values (`--panel:#fff`,
`--border:#dce3f2`) return hoti hain. Live dono themes dekhne ke liye:
`design/course-page-proof.html` (asli `styles.css` embed + dark/light toggle).

## Re-run the audit anytime

```bash
cd <repo>
python3 tools/audit-theme-colors.py      # exit 0 = clean, 1 = problem
```

Naya CSS likhte waqt rule: **kabhi `#fff` / `#0f172a` hardcode na karo** — `var(--panel)`,
`var(--bg-soft)`, `var(--text)`, `var(--muted)` use karo. Yeh script wahi pakadta hai.

---

## Course content ka module card (2026-10-31)

**Lakshan:** dark mode me "Course content" ke andar module card safed dikh raha tha, jabki
uske andar ka text dark theme ka (white/grey) tha — matlab safed card par safed lesson title.

**Kaaran:** `frontend/src/styles.css` me ek purana rule hardcoded light colour use kar raha tha:

```css
/* purana — har theme me safed */
.module-card { border: 1px solid var(--line, #e5e7eb); border-radius: 16px; background: #fff; overflow: hidden; }
```

`#fff` token nahi tha, isliye dark theme usko badal nahi paata tha; text ke colours
`var(--text)`/`var(--muted)` se aa rahe the, jo dark me safed hote hain → safed par safed.

**Fix:** rule token-based ho gayi (aur `color` bhi explicit):

```css
.module-card {
  border: 1px solid var(--border); border-radius: 16px; color: var(--text);
  background: linear-gradient(180deg, var(--panel), var(--bg-soft)); overflow: hidden;
}
```

Measured: dark card `#102130 → #0c1a27`, heading `#fff`, lesson title `#fff` → 14.9:1.

**Sath me do aur jagah** jahan light ink hardcoded thi (dark me dhundhli):

| Element | Pehle | Ab |
|---|---|---|
| `.table th` | `#526875` on `--bg-soft` — 3.01:1 | `var(--muted)` — 8.19:1 |
| `.landing-date small` | `var(--brand)` `#075f87` — 2.34:1 | `var(--brand-3)` — 7.95:1 |
| `.landing-date` border | `#bfd1da` (light edge) | `var(--border)` |

Teeno sirf `:root[data-theme="dark"]` par lagti hain — light theme bilkul same.

**Verify:** headless Chromium (Playwright) se `/courses/1` render karke computed style +
screenshot liya — `design/course-content-dark-fixed.png` aur `design/course-module-quiz-dark.png`.
Poora page contrast scan: course detail / course list / home / student certificates par
koi bhi text 3.2:1 se neeche nahi.

