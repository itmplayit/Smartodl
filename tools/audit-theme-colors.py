#!/usr/bin/env python3
"""
audit-theme-colors.py — dark/light theme colour auditor for frontend/src/styles.css

Kya karta hai:
  1. Token blocks (:root = dark default, :root[data-theme="light"]) padhta hai.
  2. Un CSS rules ko dhoondhta hai jo course page (CourseDetail + uske components)
     me use hote hain aur jinke andar LIGHT-ONLY hardcoded colours bache hain —
     wahi cheezein jo dark mode me text invisible karti hain.
  3. Custom properties jo use ho rahe hain par define nahi hue (jaise --line) report karta hai.
  4. Contrast check: common text/background jodi ke WCAG ratio.

Exit code 1 agar koi hardcoded light colour course rules me mile, warna 0.

Run:  python3 tools/audit-theme-colors.py   (repo root se)
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = ROOT / 'frontend/src/styles.css'
COURSE_FILES = [
    'frontend/src/pages/CourseDetail.jsx',
    'frontend/src/components/CourseQuizzes.jsx',
    'frontend/src/components/VideoPlayer.jsx',
    'frontend/src/components/PdfViewer.jsx',
    'frontend/src/components/Discussions.jsx',
    'frontend/src/components/Reviews.jsx',
    'frontend/src/components/CourseInsights.jsx',
]

# colours that only make sense on a white/light surface
LIGHT_ONLY = re.compile(
    r'#fff(?:fff)?\b|#f8fafc|#f1f5f9|#f8faff|#f5f7fb|#e5e7eb|#e6ebf6|#eef2fb'
    r'|rgba\(15,\s*23,\s*42|rgba\(248,\s*250,\s*252|#4338ca|#64748b|#047857|#0f172a'
    r'|rgba\(100,\s*116,\s*139|rgba\(79,\s*70,\s*229,\s*\.0')
# in these selectors a white/light value is intentional, because the *surface* there is
# always dark (hero banner, video player chrome) or always white (QR code, switch knob)
ALLOWLIST = ('.course-hero', '.vp', '.upi-qr', '.module-index', '.switch',
             '.icon-btn', '.btn-primary', '.course-buy-art', '.chips-muted')
# only text/background colour matters here — border-color with a neutral grey works in both themes
COLOUR_PROPS = ('color:', 'background:', 'background-color:')


def hex_to_rgb(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def luminance(h):
    def f(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = hex_to_rgb(h)
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast(a, b):
    l1, l2 = sorted([luminance(a), luminance(b)], reverse=True)
    return round((l1 + 0.05) / (l2 + 0.05), 2)


def main():
    css = CSS.read_text(encoding='utf-8')
    print(f'auditing {CSS.relative_to(ROOT)}  ({len(css.splitlines())} lines)')

    # 1) tokens
    token_blocks = {}
    for name, pat in (('dark', r':root\{([^}]*)\}'),
                      ('light', r':root\[data-theme="light"\]\{([^}]*)\}')):
        m = re.search(pat, css)
        token_blocks[name] = dict(re.findall(r'(--[\w-]+)\s*:\s*([^;]+)', m.group(1))) if m else {}
        print(f'  tokens[{name}]: {len(token_blocks[name])}')

    # 2) classes used by the course page
    used = set()
    for f in COURSE_FILES:
        p = ROOT / f
        if not p.exists():
            continue
        src = p.read_text(encoding='utf-8')
        for m in re.finditer(r'className=(?:"([^"]*)"|\{([^}]*)\})', src):
            used |= set(re.findall(r'[A-Za-z][\w-]{2,}', m.group(0)))

    # 3) hardcoded light colours inside course-page rules
    bad = []
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
        sel, body = m.group(1).strip(), m.group(2)
        if sel.startswith('@') or sel.startswith(':root') or 'data-theme' in sel:
            continue
        if not (set(re.findall(r'\.([\w-]+)', sel)) & used):
            continue
        if any(a in sel for a in ALLOWLIST):
            continue
        for decl in (d.strip() for d in body.split(';')):
            if not decl.startswith(COLOUR_PROPS):
                continue
            if LIGHT_ONLY.search(decl):
                bad.append((sel, decl))

    # 4) undefined custom properties
    defined = set(re.findall(r'(--[\w-]+)\s*:', css))
    # only a real bug when var(--x) is used WITHOUT a fallback: var(--x, #fallback) is safe
    unguarded = set(re.findall(r'var\((--[\w-]+)\s*\)', css))
    undefined = sorted(unguarded - defined)

    # 5) contrast spot-checks (dark theme = default)
    d = token_blocks['dark']
    bg = d.get('--bg', '#080c18').strip()
    panel = d.get('--panel', '#111a2e').strip()
    checks = [
        ('body text --text on --bg', d.get('--text', '#e8eefc').strip(), bg, 4.5),
        ('body text --text on --panel', d.get('--text', '#e8eefc').strip(), panel, 4.5),
        ('meta --muted on --panel', d.get('--muted', '#93a3c4').strip(), panel, 4.5),
        ('link/chevron --brand-3 on --panel', d.get('--brand-3', '#818cf8').strip(), panel, 4.5),
        ('primary btn --brand-text on --brand', d.get('--brand-text', '#fff').strip(), d.get('--brand', '#4f46e5').strip(), 4.5),
    ]

    print('\n-- undefined custom properties --')
    print('  none' if not undefined else '  ' + ', '.join(undefined))

    print('\n-- hardcoded light colours in course-page rules --')
    if not bad:
        print('  none ✅')
    else:
        for sel, decl in bad:
            print(f'  {sel}  ->  {decl}')

    print('\n-- dark-theme contrast (WCAG AA needs 4.5 for body text) --')
    fails = 0
    for label, fg, b, need in checks:
        try:
            r = contrast(fg, b)
        except ValueError:
            print(f'  {label}: skipped (non-hex "{fg}")')
            continue
        ok = r >= need
        fails += 0 if ok else 1
        print(f'  {"ok " if ok else "FAIL"} {label}: {r}:1')

    print()
    ok = (not bad) and (not undefined) and fails == 0
    print('RESULT:', 'ALL THEME COLOUR CHECKS PASSED' if ok else 'PROBLEMS FOUND')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
