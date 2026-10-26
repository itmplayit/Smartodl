import fs from 'node:fs';
import { execSync } from 'node:child_process';
import postcss from 'postcss';

const REPO = '/home/user/SmartODL';
const read = (p) => fs.readFileSync(p, 'utf8');
const gitShow = (path) => execSync(`git -C ${REPO} show HEAD:${path}`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const classesIn = (s) => [...s.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)].map((m) => m[1]);
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
function owningClasses(sel) {
  const parts = compounds(sel);
  for (let i = parts.length - 1; i >= 0; i--) {
    const cs = classesIn(parts[i]);
    if (cs.length) return cs;
  }
  return [];
}
const oldSubjectDefined = new Set();
postcss.parse(gitShow('frontend/src/styles.css')).walkRules((r) => {
  (r.selectors || [r.selector]).forEach((sel) => owningClasses(sel).forEach((c) => oldSubjectDefined.add(c)));
});
postcss.parse(gitShow('frontend/src/styles/leetcode-arena.css')).walkRules((r) => {
  (r.selectors || [r.selector]).forEach((sel) => owningClasses(sel).forEach((c) => {
    if (/^(lc-|arena-)/.test(c)) oldSubjectDefined.add(c);
  }));
});

const norm = (s) => s.replace(/\s+/g, '')
  .replaceAll('var(--text-inv)', 'var(--brand-text)')
  .replaceAll('rgba(1,80,124,', 'rgba(79,70,229,')
  .replaceAll('var(--landing-page-bg-dark,#071722)', 'var(--landing-page-bg-dark,#080c18)')
  .replaceAll('var(--landing-page-bg-light,#f5f8fa)', 'var(--landing-page-bg-light,#f5f7fb)')
  .replaceAll('rgba(4,82,117,.98)', 'rgba(30,27,75,.98)');

const finalNorm = norm(read(`${REPO}/frontend/src/styles.css`));
const inst = postcss.parse(gitShow('frontend/src/institutional.css'));
let total = 0;
const missing = [];
inst.walkRules((rule) => {
  const sels = rule.selectors || [rule.selector];
  const compatSels = sels.filter((sel) => {
    const own = owningClasses(sel);
    return own.length && own.some((c) => !oldSubjectDefined.has(c));
  });
  if (!compatSels.length) return;
  total++;
  const decls = [];
  rule.walkDecls((d) => decls.push(norm(`${d.prop}:${d.value}${d.important ? '!important' : ''}`)));
  const absent = decls.filter((d) => !finalNorm.includes(d));
  if (absent.length) missing.push({ sel: compatSels.join(','), absent, total: decls.length });
});
console.log(`compat rules=${total} with absent declarations=${missing.length}`);
missing.forEach((m) => console.log(`ABSENT ${m.absent.length}/${m.total} ${m.sel} :: ${m.absent.join(' ; ')}`));
