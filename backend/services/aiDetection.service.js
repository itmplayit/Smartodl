'use strict';
/**
 * AI-assistance detection — telemetry normalisation, scoring and schema.
 *
 * One place where the Coding Arena and the Live Quiz agree on what the
 * numbers mean, so the two surfaces can never drift apart again.
 *
 * THE EVIDENCE STREAMS
 *   style   — backend/utils/aiTextClassifier.js, branched prose vs code
 *   paste   — characters that arrived by paste/drop instead of by typing,
 *             PLUS paste attempts the admin copy-paste block cancelled
 *   timing  — keystroke rhythm: superhuman speed, robotic uniformity
 *
 * They are fused with a noisy-OR (see classifier `fuse`), not Math.max, so
 * no single stream convicts on its own but agreeing streams compound.
 *
 * EVERY INPUT IS CLIENT-REPORTED. Treat the result as evidence for a human
 * to review, never as proof. `trusted` says whether telemetry was actually
 * reported at all, so "0% pasted" can be told apart from "nothing measured".
 */

const { q1, exec } = require('../config/db');
const { classify, fuse, band } = require('../utils/aiTextClassifier');

/* ─────────────────────────── schema ─────────────────────────── */

async function ensureColumn(table, column, ddl) {
  const row = await q1(
    'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  );
  if (!Number(row.c)) await exec(`ALTER TABLE \`${table}\` ${ddl}`);
}

/**
 * Idempotent upgrade, runs every boot. The score used to be a single opaque
 * number; the breakdown columns let a teacher see WHICH stream fired, which
 * is the difference between "evidence" and "an accusation".
 */
async function ensureSchema() {
  const breakdown = [
    ['ai_style_score', 'ADD COLUMN ai_style_score TINYINT UNSIGNED NULL'],
    ['ai_paste_score', 'ADD COLUMN ai_paste_score TINYINT UNSIGNED NULL'],
    ['ai_timing_score', 'ADD COLUMN ai_timing_score TINYINT UNSIGNED NULL'],
    ['ai_verdict', "ADD COLUMN ai_verdict VARCHAR(12) NULL"],
    ['ai_trusted', 'ADD COLUMN ai_trusted TINYINT(1) NOT NULL DEFAULT 0'],
  ];
  for (const table of ['coding_submissions', 'quiz_attempts']) {
    for (const [col, ddl] of breakdown) {
      await ensureColumn(table, col, ddl); // eslint-disable-line no-await-in-loop
    }
  }
  // typing telemetry the quiz never stored (the arena already had its own)
  const quizTelemetry = [
    ['typed_chars', 'ADD COLUMN typed_chars INT UNSIGNED NOT NULL DEFAULT 0'],
    ['pasted_chars', 'ADD COLUMN pasted_chars INT UNSIGNED NOT NULL DEFAULT 0'],
    ['blocked_pastes', 'ADD COLUMN blocked_pastes INT UNSIGNED NOT NULL DEFAULT 0'],
    ['keystrokes', 'ADD COLUMN keystrokes INT UNSIGNED NOT NULL DEFAULT 0'],
    ['typing_ms', 'ADD COLUMN typing_ms INT UNSIGNED NOT NULL DEFAULT 0'],
    ['fast_intervals', 'ADD COLUMN fast_intervals INT UNSIGNED NOT NULL DEFAULT 0'],
    ['uniform_ratio', 'ADD COLUMN uniform_ratio DECIMAL(4,3) NOT NULL DEFAULT 0'],
  ];
  for (const [col, ddl] of quizTelemetry) {
    await ensureColumn('quiz_attempts', col, ddl); // eslint-disable-line no-await-in-loop
  }
  const arenaTelemetry = [
    ['blocked_pastes', 'ADD COLUMN blocked_pastes INT UNSIGNED NOT NULL DEFAULT 0'],
    ['keystrokes', 'ADD COLUMN keystrokes INT UNSIGNED NOT NULL DEFAULT 0'],
    ['typing_ms', 'ADD COLUMN typing_ms INT UNSIGNED NOT NULL DEFAULT 0'],
    ['fast_intervals', 'ADD COLUMN fast_intervals INT UNSIGNED NOT NULL DEFAULT 0'],
    ['uniform_ratio', 'ADD COLUMN uniform_ratio DECIMAL(4,3) NOT NULL DEFAULT 0'],
  ];
  for (const [col, ddl] of arenaTelemetry) {
    await ensureColumn('coding_submissions', col, ddl); // eslint-disable-line no-await-in-loop
  }

}

/* ─────────────────────── telemetry intake ─────────────────────── */

const int = (v, max = 5000000) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const frac = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/**
 * Normalise whatever the client sent. Hostile input is expected: values are
 * clamped, and impossible combinations are detected rather than trusted.
 */
function readTelemetry(body = {}) {
  const t = {
    typed: int(body.typed_chars),
    pasted: int(body.pasted_chars ?? body.paste_chars),
    events: int(body.paste_events, 100000),
    blocked: int(body.blocked_pastes, 100000),
    keystrokes: int(body.keystrokes, 5000000),
    typingMs: int(body.typing_ms, 86400000),
    fast: int(body.fast_intervals, 5000000),
    uniform: frac(body.uniform_ratio),
  };
  // Did the client report anything at all? Distinguishes genuine clean work
  // from a runner that never sent stats (or stripped them).
  t.reported = (t.typed + t.pasted + t.keystrokes + t.blocked) > 0;
  return t;
}

/* ───────────────────────── paste stream ───────────────────────── */

/**
 * Share of the final text that did not come from the keyboard.
 *
 * Blocked attempts count too, and that is the fix for the arena being blind:
 * when the admin copy-paste block is ON a paste never lands, so the old
 * ratio was always 0 and the whole feature scored every student at zero.
 * A student who repeatedly tries to paste into a locked editor is the single
 * clearest behavioural signal available, so it is scored directly.
 */
function pasteScore(t) {
  const total = t.pasted + t.typed;
  const ratio = total > 0 ? t.pasted / total : 0;
  let score = Math.round(ratio * 100);

  if (t.blocked > 0) {
    // 1 attempt can be a reflex; repeated attempts are intent.
    const attemptScore = Math.min(75, 25 + (t.blocked - 1) * 18);
    score = Math.max(score, attemptScore);
  }
  return { score: Math.min(100, score), ratio: Number(ratio.toFixed(3)) };
}

/* ───────────────────────── timing stream ───────────────────────── */

/**
 * Keystroke rhythm. This is the stream that survives BOTH countermeasures:
 * it still works when pasting is blocked, and it still works when a student
 * retypes from a chatbot on a second screen (transcription is slower and
 * far more uniform than composition).
 *
 * Needs a real sample — short answers return 0 rather than guessing.
 */
function timingScore(t) {
  const signals = [];
  if (t.keystrokes < 40 || t.typingMs < 5000) return { score: 0, signals };

  let score = 0;

  // 1. sustained characters-per-minute. Fast human typists reach ~500 CPM
  //    (100 WPM); 900+ sustained over a real body of text is not hand-typed.
  const minutes = t.typingMs / 60000;
  const cpm = minutes > 0 ? t.typed / minutes : 0;
  if (t.typed >= 200) {
    if (cpm > 1200) { score += 55; signals.push('impossible_speed'); }
    else if (cpm > 800) { score += 32; signals.push('superhuman_speed'); }
    else if (cpm > 600) { score += 14; signals.push('very_fast_typing'); }
  }

  // 2. gaps below 30 ms are faster than a human finger can repeat
  const fastShare = t.keystrokes > 0 ? t.fast / t.keystrokes : 0;
  if (fastShare > 0.35) { score += 30; signals.push('machine_intervals'); }
  else if (fastShare > 0.18) { score += 14; signals.push('burst_intervals'); }

  // 3. a human's rhythm wanders; a replayed or scripted stream does not
  if (t.uniform > 0.72) { score += 28; signals.push('robotic_rhythm'); }
  else if (t.uniform > 0.55) { score += 12; signals.push('uniform_rhythm'); }

  return { score: Math.min(100, score), signals };
}

/* ─────────────────────────── analyse ─────────────────────────── */

/**
 * @param {Array<{text:string, kind:'prose'|'code', starter?:string}>} parts
 *        answered content; `starter` is the template supplied for that
 *        question and is subtracted before the code is judged
 * @param {object} telemetry from readTelemetry()
 * @returns {{score, verdict, signals, style, paste, timing, trusted, detail}}
 */
function analyse(parts, telemetry) {
  const t = telemetry;
  const signals = [];

  /* style — each part judged with the right analyser, worst one carries.
     Joining a code answer and an essay into one blob (the old behaviour)
     made both unreadable to the classifier. */
  let style = 0;
  let styleConclusive = false;
  const styleDetail = [];
  for (const part of parts || []) {
    if (!part || !String(part.text || '').trim()) continue;
    const r = classify(part.text, {
      kind: part.kind === 'code' ? 'code' : 'prose',
      // the skeleton we handed out is not the student's authorship
      starter: part.starter,
    });
    styleDetail.push({ kind: r.kind, score: r.score, signals: r.signals });
    if (r.score > style) {
      style = r.score;
      // carried by artefacts that cannot be typed by accident
      styleConclusive = Boolean(r.detail && r.detail.conclusive);
      signals.length = 0;
      signals.push(...r.signals);
    }
  }

  const p = pasteScore(t);
  const ti = timingScore(t);

  if (p.score >= 20) {
    signals.unshift(t.blocked > 0 && p.ratio * 100 < p.score
      ? `blocked_paste_attempts:${t.blocked}`
      : `pasted:${Math.round(p.ratio * 100)}%`);
  }
  signals.push(...ti.signals);

  const score = fuse({ style, paste: p.score, timing: ti.score, styleConclusive });

  return {
    score,
    verdict: band(score),
    signals: signals.length ? signals.join(',').slice(0, 255) : null,
    style,
    paste: p.score,
    timing: ti.score,
    pasteRatio: p.ratio,
    trusted: t.reported,
    detail: styleDetail,
  };
}

module.exports = { ensureSchema, readTelemetry, analyse, pasteScore, timingScore };
