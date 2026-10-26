'use strict';
/**
 * Benchmark the CODE path of the AI-assistance classifier.
 *
 *   node backend/test/ai-code-bench.js          summary + failures
 *   node backend/test/ai-code-bench.js --all    every sample, with signals
 *
 * Exit code is non-zero when a quality gate fails, so this can run in CI.
 *
 * Gates (chosen so the system errs toward the student):
 *   - no HUMAN sample may reach the 'ai' band
 *   - HUMAN mean must stay well under the 'suspicious' line
 *   - every AI sample must at least reach 'suspicious'
 *   - AI mean must sit inside the 'ai' band
 *   - the two distributions must not touch (min AI > max HUMAN)
 */

const path = require('path');
const { classify } = require(path.join(__dirname, '..', 'utils', 'aiTextClassifier'));
const { HUMAN, AI } = require('./ai-code-corpus');

const SHOW_ALL = process.argv.includes('--all');

const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

function run(samples, label) {
  return samples.map((s) => {
    const r = classify(s.code, { kind: 'code' });
    return { ...s, score: r.score, verdict: r.verdict, signals: r.signals, detail: r.detail, label };
  });
}

function stats(rows) {
  const xs = rows.map((r) => r.score);
  const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  return {
    n: xs.length,
    mean: Number(mean.toFixed(1)),
    min: Math.min(...xs),
    max: Math.max(...xs),
  };
}

function bar(score) {
  const n = Math.round(score / 4);
  const ch = score >= 60 ? '█' : score >= 30 ? '▓' : '░';
  return (ch.repeat(n) + ' '.repeat(25 - n)).slice(0, 25);
}

const human = run(HUMAN, 'human');
const ai = run(AI, 'ai');

const hs = stats(human);
const as = stats(ai);

console.log(C.b('\n  AI-assistance classifier — CODE benchmark\n'));
console.log(`  ${'sample'.padEnd(26)} ${'score'.padStart(5)}  ${'verdict'.padEnd(11)} bar`);
console.log(`  ${'─'.repeat(74)}`);

function show(rows, expectHigh) {
  for (const r of rows) {
    const bad = expectHigh ? r.verdict === 'human' : r.verdict === 'ai';
    const warn = expectHigh ? r.verdict === 'suspicious' : r.verdict === 'suspicious';
    if (!SHOW_ALL && !bad && !warn) continue;
    const col = bad ? C.r : warn ? C.y : C.g;
    console.log(`  ${r.id.padEnd(26)} ${col(String(r.score).padStart(5))}  ${col(r.verdict.padEnd(11))} ${bar(r.score)}`);
    if (SHOW_ALL || bad) {
      console.log(C.d(`  ${' '.repeat(26)} ${r.note}`));
      if (r.signals.length) console.log(C.d(`  ${' '.repeat(26)} ${r.signals.join(' · ')}`));
    }
  }
}

console.log(C.b('  HUMAN — must stay low') + C.d('   (shown: suspicious or worse)'));
show(human, false);
if (!SHOW_ALL && human.every((r) => r.verdict === 'human')) console.log(C.g('   all clean ✓'));

console.log(C.b('\n  AI — must score high') + C.d('   (shown: suspicious or worse)'));
show(ai, true);
if (!SHOW_ALL && ai.every((r) => r.verdict === 'ai')) console.log(C.g('   all caught ✓'));

console.log(`\n  ${'─'.repeat(74)}`);
console.log(`  HUMAN  n=${hs.n}  mean ${String(hs.mean).padStart(5)}  min ${String(hs.min).padStart(3)}  max ${String(hs.max).padStart(3)}`);
console.log(`  AI     n=${as.n}  mean ${String(as.mean).padStart(5)}  min ${String(as.min).padStart(3)}  max ${String(as.max).padStart(3)}`);
console.log(`  separation (AI min − HUMAN max) = ${C.b(String(as.min - hs.max))}`);

/* ── starter-template handling ──
   The platform hands out a skeleton. Comments IN that skeleton are the
   platform's words, not the student's, and must not be scored; but the
   skeleton must not blunt a real detection either. */
const CHATTY_TEMPLATE = `# Read the input values from standard input
# Convert the tokens into integers
# Print the final result to the console
def main():
    pass

if __name__ == "__main__":
    main()`;
const FILLED_IN = CHATTY_TEMPLATE.replace('    pass', '    a,b=map(int,input().split())\n    print(a+b)');
const PLAIN_TEMPLATE = `def main():
    pass

if __name__ == "__main__":
    main()`;

const tplBlind = classify(FILLED_IN, { kind: 'code' }).score;
const tplAware = classify(FILLED_IN, { kind: 'code', starter: CHATTY_TEMPLATE }).score;
const aiBlind = classify(AI[0].code, { kind: 'code' }).score;
const aiAware = classify(AI[0].code, { kind: 'code', starter: PLAIN_TEMPLATE }).score;

console.log(C.b('\n  starter-template handling'));
console.log(`   student filling a chatty template : ${tplBlind} -> ${C.g(String(tplAware))}  (platform's comments discounted)`);
console.log(`   genuine AI answer                 : ${aiBlind} -> ${C.g(String(aiAware))}  (detection preserved)`);

/* ── quality gates ── */
const gates = [
  ['no human sample in the "ai" band', human.every((r) => r.verdict !== 'ai')],
  ['human mean < 12', hs.mean < 12],
  ['human max < 30 (below "suspicious")', hs.max < 30],
  ['every AI sample >= "suspicious"', ai.every((r) => r.verdict !== 'human')],
  ['AI mean >= 60 (inside the "ai" band)', as.mean >= 60],
  ['>= 80% of AI samples reach "ai"', ai.filter((r) => r.verdict === 'ai').length / ai.length >= 0.8],
  ['distributions do not overlap', as.min > hs.max],
  ['template comments are not scored as the student', tplAware < 30],
  ['template subtraction does not blunt a real detection', aiAware >= 60],
];

console.log(C.b('\n  gates'));
let failed = 0;
for (const [name, ok] of gates) {
  console.log(`   ${ok ? C.g('PASS') : C.r('FAIL')}  ${name}`);
  if (!ok) failed += 1;
}
console.log('');
process.exit(failed ? 1 : 0);
