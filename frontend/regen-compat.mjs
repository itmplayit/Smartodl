import fs from 'node:fs';
import { execSync } from 'node:child_process';
import postcss from 'postcss';

const REPO = '/home/user/SmartODL';
const read = (p) => fs.readFileSync(p, 'utf8');
const gitShow = (path) => execSync(`git -C ${REPO} show HEAD:${path}`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const classesIn = (s) => [...s.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)].map((m) => m[1]);

// Split a selector into compound parts on combinators (space > + ~) at depth 0.
function compounds(sel) {
  const out = []; let cur = ''; let dp = 0; let db = 0;
  for (const ch of sel) {
    if (ch === '(') dp++; if (ch === ')') dp--;
    if (ch === '[') db++; if (ch === ']') db--;
    if (dp === 0 && db === 0 && (ch === '>' || ch === '+' || ch === '~')) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    if (dp === 0 && db === 0 && /\s/.test(ch)) { if (cur.trim()) { out.push(cur.trim()); cur = ''; } continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
// The "owning" classes of a selector: classes of the rightmost compound that
// has any (the component actually being styled).
function owningClasses(sel) {
  const parts = compounds(sel);
  for (let i = parts.length - 1; i >= 0; i--) {
    const cs = classesIn(parts[i]);
    if (cs.length) return cs;
  }
  return [];
}

// Classes the ORIGINAL design actually styles (as selector subjects in the
// main styles.css). The arena stylesheet is a skin: it references shell
// classes (e.g. hides .institution-notice in immersive mode) without
// defining their base styling, so only its own lc-*/arena-* subjects count.
const oldSubjectDefined = new Set();
postcss.parse(gitShow('frontend/src/styles.css')).walkRules((r) => {
  (r.selectors || [r.selector]).forEach((sel) => owningClasses(sel).forEach((c) => oldSubjectDefined.add(c)));
});
postcss.parse(gitShow('frontend/src/styles/leetcode-arena.css')).walkRules((r) => {
  (r.selectors || [r.selector]).forEach((sel) => owningClasses(sel).forEach((c) => {
    if (/^(lc-|arena-)/.test(c)) oldSubjectDefined.add(c);
  }));
});

const instRoot = postcss.parse(gitShow('frontend/src/institutional.css'));
let kept = 0; let dropped = 0;
const usedVars = new Set();
const usedAnimations = new Set();

// First pass: filter rule selectors.
instRoot.walkRules((rule) => {
  const sels = rule.selectors || [rule.selector];
  const keptSels = sels.filter((sel) => {
    const own = owningClasses(sel);
    return own.length && own.some((c) => !oldSubjectDefined.has(c));
  });
  if (!keptSels.length) { rule.__drop = true; dropped++; return; }
  kept++;
  rule.selector = keptSels.join(',');
  rule.walkDecls((d) => {
    [...d.value.matchAll(/var\(\s*(--[_a-zA-Z0-9-]+)/g)].forEach((m) => usedVars.add(m[1]));
    if (/^animation(-name)?$/.test(d.prop)) {
      d.value.split(',').forEach((part) => {
        const name = part.trim().split(/\s+/)[0];
        if (/^[_a-zA-Z][_a-zA-Z0-9-]*$/.test(name) && !/^(none|initial|inherit|unset)$/.test(name)) usedAnimations.add(name);
      });
    }
  });
});
instRoot.walkRules((rule) => { if (rule.__drop) rule.remove(); });
// Drop keyframes not used by kept rules; drop empty atrules.
instRoot.walkAtRules((at) => {
  if (/keyframes$/.test(at.name)) {
    const name = at.params.trim().split(/\s+/)[0];
    if (!usedAnimations.has(name)) at.remove();
  }
});
let changed = true;
while (changed) {
  changed = false;
  instRoot.walkAtRules((at) => {
    if (!/keyframes$/.test(at.name) && at.nodes && at.nodes.length === 0) { at.remove(); changed = true; }
  });
}
// Remove stray top-level declarations/comments leftovers are fine to keep out:
instRoot.walkDecls((d) => { if (d.parent && d.parent.type === 'root') d.remove(); });

let cssOut = instRoot.toString().replaceAll('var(--text-inv)', 'var(--brand-text)');

const aliases = `:root{
  --navy-950:#05070f; --navy-900:#0a0f1e; --navy-800:#111a2e;
  --heading-font:var(--sans);
  --motion-fast:160ms; --motion-base:300ms; --motion-slow:520ms; --ease-out:cubic-bezier(.22,1,.36,1);
  --focus:var(--accent);
  --brand-50:var(--white-06);
  --shadow-lg:0 18px 44px rgba(3,7,18,.55);
  --user-font-scale:1;
}
:root[data-theme="light"]{ --shadow-lg:0 18px 44px rgba(15,23,42,.13); }
/* Text-size accessibility control (MainLayout) drives this variable. */
html{font-size:calc(16px * var(--user-font-scale))}
`;

const header = `/* ============================================================
   Layout compatibility — institutional-era structural classes,
   re-tokenized onto the original SmartODL design system above.
   (Extracted from the retired institutional.css override when the
   original dark design was restored: header/nav/footer, dashboard
   shell and landing-builder classes that only that file defined.
   Every colour/shadow/radius flows through the tokens at the top
   of this file, so both themes keep working.)
   ============================================================ */
`;

const current = read(`${REPO}/frontend/src/styles.css`);
const base = current.split('\n').slice(0, 1168).join('\n'); // lines 1..1168 (before old compat)
const definedVars = new Set([...(base + aliases).matchAll(/(--[_a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
const missingVars = [...usedVars].filter((v) => !definedVars.has(v)).sort();

fs.writeFileSync('/tmp/compat-v2.css', header + aliases + cssOut + '\n');
console.log(`oldSubjectDefined=${oldSubjectDefined.size} kept=${kept} dropped=${dropped} bytes=${cssOut.length}`);
console.log('animations used:', [...usedAnimations].join(', ') || 'none');
console.log('missingVars:', missingVars.join(', ') || 'none');
