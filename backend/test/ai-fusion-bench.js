'use strict';
/**
 * End-to-end check of the FUSED verdict (style + paste + timing), which is
 * what the admin actually sees — the style score alone never reaches the UI.
 *
 *   node backend/test/ai-fusion-bench.js
 *
 * The scenarios encode the policy we want:
 *   - honest work, however it was typed, stays "human"
 *   - a physical artefact (fence / preamble / chat typography) convicts alone
 *   - AI habits WITHOUT an artefact only reach "suspicious" until a second
 *     stream (paste or robotic timing) agrees
 */

const path = require('path');
const { analyse } = require(path.join(__dirname, '..', 'services', 'aiDetection.service'));
const { HUMAN, AI } = require('./ai-code-corpus');

const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
};

const pick = (list, id) => list.find((x) => x.id === id).code;

/** telemetry shapes, as readTelemetry() would produce them */
const TYPED_NORMALLY = {
  typed: 900, pasted: 0, events: 0, blocked: 0,
  keystrokes: 900, ms: 420000, fast: 20, uniform: 0.21, reported: true,
};
const TYPED_FAST_HUMAN = { // the fast typist the audit protected
  typed: 900, pasted: 0, events: 0, blocked: 0,
  keystrokes: 900, ms: 150000, fast: 300, uniform: 0.34, reported: true,
};
const PASTED_WHOLESALE = {
  typed: 40, pasted: 860, events: 1, blocked: 0,
  keystrokes: 40, ms: 9000, fast: 2, uniform: 0.3, reported: true,
};
const ROBOTIC = {
  typed: 900, pasted: 0, events: 0, blocked: 0,
  keystrokes: 900, ms: 60000, fast: 600, uniform: 0.84, reported: true,
};
const NO_TELEMETRY = {
  typed: 0, pasted: 0, events: 0, blocked: 0,
  keystrokes: 0, ms: 0, fast: 0, uniform: 0, reported: false,
};

const CASES = [
  // ── honest students ──
  ['human terse, typed normally', pick(HUMAN, 'h01-py-terse-sum'), TYPED_NORMALLY, 'human'],
  ['human strong student, typed', pick(HUMAN, 'h09-py-strong-student'), TYPED_NORMALLY, 'human'],
  ['human FAST typist (audit case)', pick(HUMAN, 'h03-py-twosum-brute'), TYPED_FAST_HUMAN, 'human'],
  ['human Hinglish comments', pick(HUMAN, 'h19-py-hindi-comments'), TYPED_NORMALLY, 'human'],
  ['human em-dash in output str', pick(HUMAN, 'h20-py-emdash-in-output'), TYPED_NORMALLY, 'human'],
  ['human, no telemetry at all', pick(HUMAN, 'h15-java-verbose-student'), NO_TELEMETRY, 'human'],

  // ── artefacts: must convict with NO corroboration ──
  ['AI fence, typed out by hand', pick(AI, 'a03-py-fence-left-in'), TYPED_NORMALLY, 'ai'],
  ['AI whole chat reply, retyped', pick(AI, 'a08-py-explanation-mixed'), TYPED_NORMALLY, 'ai'],
  ['AI "Certainly!" preamble', pick(AI, 'a15-py-certainly'), TYPED_NORMALLY, 'ai'],
  ['AI chat typography', pick(AI, 'a07-py-emdash-comments'), TYPED_NORMALLY, 'ai'],

  // ── habits only: need a second stream to agree ──
  ['AI habits only, typed slowly', pick(AI, 'a11-py-light-ai'), TYPED_NORMALLY, 'suspicious-or-human'],
  ['AI habits + wholesale paste', pick(AI, 'a11-py-light-ai'), PASTED_WHOLESALE, 'ai'],
  ['AI habits + robotic timing', pick(AI, 'a11-py-light-ai'), ROBOTIC, 'not-human'],
  ['AI heavy style, typed slowly', pick(AI, 'a01-py-chatgpt-twosum'), TYPED_NORMALLY, 'ai'],
];

console.log(C.b('\n  Fused verdict — what the admin actually sees\n'));
console.log(`  ${'scenario'.padEnd(32)} ${'style'.padStart(5)} ${'paste'.padStart(5)} ${'time'.padStart(5)} ${'FUSED'.padStart(6)}  verdict`);
console.log(`  ${'─'.repeat(78)}`);

let failed = 0;
for (const [name, code, tele, want] of CASES) {
  const r = analyse([{ text: code, kind: 'code' }], tele);
  const ok = want === 'suspicious-or-human' ? r.verdict !== 'ai'
    : want === 'not-human' ? r.verdict !== 'human'
      : r.verdict === want;
  if (!ok) failed += 1;
  const col = ok ? C.g : C.r;
  console.log(
    `  ${name.padEnd(32)} ${String(r.style).padStart(5)} ${String(r.paste).padStart(5)} ${String(r.timing).padStart(5)} ${String(r.score).padStart(6)}  ${col(r.verdict.padEnd(11))}${ok ? '' : C.r(`want ${want}`)}`,
  );
}

console.log(`\n  ${failed ? C.r(`${failed} scenario(s) FAILED`) : C.g('all scenarios behave as intended')}\n`);
process.exit(failed ? 1 : 0);
