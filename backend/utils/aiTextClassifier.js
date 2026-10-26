'use strict';
/**
 * Built-in AI-assistance classifier — 100% local, no external API.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS WAS REWRITTEN
 *
 * The previous version ran ONE prose-oriented heuristic over everything,
 * including source code. Measured on a held-out set it scored human code at
 * avg 6.1 and AI code at avg 6.0 — literally no discriminative power — while
 * flagging honest students who write formal exam English at 90/100 ("ai").
 *
 * This version:
 *   • branches on content type — prose and code get disjoint signal sets;
 *   • counts every word ONCE (the old lists double-scored `crucial`,
 *     `furthermore`, … in both the phrase and the vocabulary signal);
 *   • drops ordinary technical English (`crucial`, `essential`, `ensure`,
 *     `robust`, `optimal`, `comprehensive`) from the "AI tell" list — those
 *     are what good ESL exam writing looks like, not evidence of a chatbot;
 *   • anchors the markdown regexes so Python `# comments` and C `int **ptr`
 *     stop registering as "pasted from a chat window";
 *   • never applies sentence-rhythm analysis to code, where uniform line
 *     length is a property of the FORMATTER, not of the author.
 *
 * Returns { score, verdict, signals, kind, detail }.
 * `score` is ADVISORY evidence strength, never proof — all inputs are
 * client-reported and a determined student can forge them.
 * ──────────────────────────────────────────────────────────────────────────
 */

/* ══════════════════════ shared helpers ══════════════════════ */

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/* ══════════════════════ PROSE signals ══════════════════════ */

/**
 * Chat-model boilerplate ONLY — turns of phrase a model emits because it is
 * answering a person, which have no reason to appear in an exam answer.
 * Deliberately excludes formal-register words; those live in AI_VOCAB below
 * and are scored once, by density.
 */
const CHAT_BOILERPLATE = [
  /\bas an ai\b/i,
  /\b(ai|language) model\b/i,
  /\bchatgpt\b|\bopenai\b|\bcopilot\b|\bgemini\b|\bclaude\b|\bbard\b|\bdeepseek\b|\bperplexity\b/i,
  /\bhere('’)?s (the|a|my|an) (solution|code|answer|function|program|explanation|implementation)\b/i,
  /\bcertainly[!,]/i,
  /\b(sure|absolutely|of course)[!,]\s*(here|let|i)\b/i,
  /\bi hope this helps\b/i,
  /\blet me know if (you|there|anything)\b/i,
  /\bfeel free to (ask|reach)\b/i,
  /\bi'?m (sorry|unable|not able) to\b/i,
  /\bas (a|an) (large )?language model\b/i,
  /\bbelow is (a|an|the)\b/i,
];

/**
 * Formal-register words statistically over-represented in model output.
 * Scored ONCE, as a density, never as a flat per-hit bonus — a single
 * "furthermore" in a human paragraph must not move the needle.
 * Ordinary technical vocabulary (ensure/robust/optimal/essential/crucial/
 * comprehensive) was REMOVED: those are normal exam English.
 */
const AI_VOCAB = [
  'furthermore', 'moreover', 'additionally', 'consequently', 'nevertheless',
  'utilize', 'utilizing', 'leverage', 'leveraging', 'delve', 'delves', 'delving',
  'streamline', 'streamlines', 'facilitate', 'facilitates', 'paradigm',
  'seamless', 'seamlessly', 'pivotal', 'meticulous', 'meticulously',
  'realm', 'tapestry', 'underscore', 'underscores', 'multifaceted', 'holistic',
];
const AI_VOCAB_SET = new Set(AI_VOCAB);

/** Multi-word formal connectives — matched as phrases, counted with vocab. */
const AI_CONNECTIVES = [
  /\bit('’)?s (important|worth|crucial) to note\b/i,
  /\bin conclusion\b/i,
  /\bto summari[sz]e\b/i,
  /\bin today('’)?s (world|landscape|digital)\b/i,
  /\bplays a (vital|key|crucial) role\b/i,
  /\bwhen it comes to\b/i,
];

/**
 * Artifacts of copying out of a rendered chat window.
 * ANCHORED so they stop matching ordinary source code:
 *   old heading regex  #{1,3}\s+\w   matched every Python/Bash/Ruby comment
 *   old bold regex     star-star-any-star-star   matched C/C++ double
 *                      pointers such as `int **grid` and `f(int **a)`
 */
const CHAT_ARTIFACTS = [
  { re: /^\s*```/m, name: 'code_fence' },
  { re: /^\s*>\s+\S/m, name: 'quoted_block' },
  // bold needs non-space immediately inside the asterisks and no line break
  { re: /\*\*(?! )[^*\n]{2,}(?<! )\*\*/, name: 'markdown_bold' },
  // heading must start a line and be followed by a space + word
  { re: /^#{1,3} +\w/m, name: 'markdown_heading' },
  // numbered "1. **Step**" list scaffolding typical of chat answers
  { re: /^\s*\d+\.\s+\*\*/m, name: 'numbered_bold_list' },
];

function splitProseSentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3);
}

function burstiness(sentences) {
  const lens = sentences.map((s) => s.split(/\s+/).length);
  if (lens.length < 4) return null; // too few to say anything
  const m = mean(lens);
  if (!m) return null;
  const sd = Math.sqrt(mean(lens.map((l) => (l - m) ** 2)));
  return sd / m; // coefficient of variation
}

function classifyProse(text) {
  const signals = [];
  const detail = {};
  let score = 0;

  const words = text.toLowerCase().replace(/[^a-z'\s]/g, ' ').split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  /* 1 ── chat boilerplate: the only genuinely diagnostic phrase signal */
  const boiler = CHAT_BOILERPLATE.filter((re) => re.test(text)).length;
  detail.boilerplate = boiler;
  if (boiler) {
    score += Math.min(55, boiler * 22);
    signals.push(`chat_boilerplate:${boiler}`);
  }

  /* 2 ── chat/markdown artifacts (anchored) */
  const artifacts = CHAT_ARTIFACTS.filter((a) => a.re.test(text));
  detail.artifacts = artifacts.map((a) => a.name);
  if (artifacts.length) {
    score += Math.min(24, artifacts.length * 12);
    signals.push(`chat_artifacts:${artifacts.map((a) => a.name).join('+')}`);
  }

  /* 3 ── formal-register DENSITY, counted once per word, length-normalised */
  let vocabHits = 0;
  for (const w of words) if (AI_VOCAB_SET.has(w)) vocabHits += 1;
  for (const re of AI_CONNECTIVES) if (re.test(text)) vocabHits += 1;
  const density = wordCount >= 30 ? vocabHits / wordCount : 0;
  detail.vocab_hits = vocabHits;
  detail.vocab_density = Number(density.toFixed(4));
  // thresholds raised: human formal writing sits around 1-2%, so only a
  // genuinely saturated buzzword register scores. The top tier exists for
  // the "delving into the realm / underscores / pivotal / meticulous" style
  // that carries no chat boilerplate but is unmistakably generated.
  if (density > 0.09) { score += 42; signals.push('saturated_ai_vocabulary'); }
  else if (density > 0.045) { score += 22; signals.push('ai_vocabulary'); }
  else if (density > 0.025) { score += 11; signals.push('formal_vocabulary'); }

  /* 4 ── burstiness: prose only, and only with enough sentences */
  const sentences = splitProseSentences(text);
  const cv = burstiness(sentences);
  detail.sentences = sentences.length;
  detail.burstiness = cv === null ? null : Number(cv.toFixed(3));
  if (cv !== null) {
    if (cv < 0.22) { score += 20; signals.push('uniform_rhythm'); }
    else if (cv < 0.38) { score += 9; signals.push('steady_rhythm'); }
  }

  /* 5 ── templated repetition of sentence openings */
  if (sentences.length >= 5) {
    const starts = {};
    sentences.forEach((s) => {
      const w = (s.split(/\s+/)[0] || '').toLowerCase();
      if (w) starts[w] = (starts[w] || 0) + 1;
    });
    const maxRepeat = Math.max(0, ...Object.values(starts));
    if (maxRepeat >= Math.ceil(sentences.length / 2)) {
      score += 10; signals.push('repetitive_openings');
    }
  }

  return { score, signals, detail, evidence: wordCount };
}

/* ══════════════════════ CODE signals ══════════════════════ */

/*
 * Scoring is TIERED on purpose.
 *
 *   HARD   — artefacts that have essentially no innocent explanation in an
 *            exam submission (a markdown fence, chat boilerplate, an em-dash
 *            typed by nobody's keyboard, explanation prose sitting outside
 *            the code). Any one of these can carry a verdict alone.
 *   MEDIUM — authorship style that is strongly suggestive but reachable by a
 *            very tidy human: narrating every step, full-sentence comments,
 *            a docstring on every single function.
 *   SOFT   — weak circumstantial stuff: long identifiers, machine-perfect
 *            spacing, type hints, a main() guard. The SUM of these is capped
 *            below the 'suspicious' line, so a careful student who writes
 *            beautiful code can NEVER be accused on style alone.
 *
 * That cap is the whole safety argument: to be flagged you must trip
 * something a formatter cannot produce for you.
 */
const SOFT_CAP = 20;

const LINE_COMMENT = /^\s*(\/\/|#|--|;)\s?(.*)$/;
const BLOCK_COMMENT_LINE = /^\s*(\/\*+|\*+\/?|"""|''')\s?(.*)$/;

/**
 * Narration: a comment that restates in English what the very next line does.
 * Students writing under time pressure do not annotate every step.
 */
const NARRATIVE_COMMENT = [
  /^(initiali[sz]e|declare|define|create|build|set up)\b/i,
  /^(iterate|loop|traverse|walk) (through|over|across)\b/i,
  /^(check|verify|determine|test) (if|whether|that)\b/i,
  /^(return|output|print|display) (the|a|an|our|final|result)\b/i,
  /^(store|save|keep|track|record) (the|a|an|each|all|previously)\b/i,
  /^(this|the) (function|method|class|variable|loop|block|helper)\b/i,
  /^(helper|utility) (function|method)\b/i,
  /^(base case|edge case|time complexity|space complexity)\b/i,
  /^(handle|process|update|calculate|compute|compare|add|remove|convert|parse|read|split|join|normali[sz]e|extract|populate|obtain|delegate|guard|record|traverse)\b.{0,60}$/i,
  /^(dictionary|hash ?map|array|list|set|map|queue|stack) (to|that) (store|hold|track|keep)\b/i,
  /^(if|when) (the|a|an) \w+ (exists|is found|matches|has)\b/i,
  /^(we|you|us) (will|can|then|now|use|read|need|store|return|check)\b/i,
  /\bfor optimal\b|\bto avoid overflow\b|\bfor efficiency\b|\bin a single pass\b|\bfor future lookups?\b|\bfor fast lookups?\b/i,
];

/** Structured docstrings — Google/NumPy/Javadoc/Sphinx section headers. */
const DOCSTRING_SECTIONS = [
  /^\s*(Args|Arguments|Params|Parameters|Returns|Return|Raises|Yields|Examples?|Note|Attributes)\s*:/m,
  /^\s*[*\s]*@(param|return|returns|throws|exception)\b/m,
  /^\s*:(param|returns?|rtype|raises)\b/m,
];

/**
 * Typographic characters a programmer cannot produce from a normal keyboard
 * while typing code: em/en dashes, curly quotes, ellipsis, arrows, bullets,
 * check marks, emoji. Pasted straight out of a rendered chat window.
 *
 * NOTE: deliberately a CLOSED LIST of punctuation, never "any non-ASCII".
 * Students here write Hindi/Devanagari comments and transliterated notes —
 * those are evidence of a human, and must not be penalised.
 */
const AI_TYPOGRAPHY = /[\u2014\u2013\u2018\u2019\u201C\u201D\u2026\u2192\u21D2\u2022\u2713\u2714\u00D7\u2265\u2264\u2260]|[\u{1F300}-\u{1FAFF}]|[\u{2700}-\u{27BF}]/u;

/** Explicit complexity book-keeping — a marking-scheme habit of chat models. */
const COMPLEXITY_NOTE = /\b(time|space)\s*(and\s*space\s*)?complexit(y|ies)\s*[:=-]|\bO\(\s*[n1ml][^)]*\)\s*(time|space)\b|\bruns? in O\(/i;

/** "Step 1: / Step 2:" scaffolding across several comments. */
const STEP_BANNER = /^step\s*\d+\s*[:.)-]/i;

/** Chat answers like to present alternatives and then pick one. */
const MULTI_APPROACH = /\b(approach|method|solution|option|version)\s*(1|2|one|two)\b\s*[:.-]|\b(alternative|optimi[sz]ed|brute[- ]force|naive)\s+(approach|solution|version|method)\b/i;

/** Lines of plain English that are NOT comments and NOT code. */
const EXPLANATION_LEAD = /^\s*(explanation|example usage|output|note|how it works|this (solution|code|program|approach|function)|the (code|solution|program) (above|below))\b\s*[:.]?/i;

function stripStrings(src) {
  // crude but adequate: blank out string literals so their contents don't
  // get mistaken for comments or identifiers
  return src
    .replace(/"""[\s\S]*?"""/g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
    .replace(/'''[\s\S]*?'''/g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}

/**
 * A comment that is really commented-out CODE (`# print(arr)`, `// x = 1;`).
 * These are debug leftovers — a HUMAN tell — and must be excluded from the
 * prose-style analysis or they dilute it in the wrong direction.
 */
function isCommentedOutCode(c) {
  const t = c.trim();
  if (!t) return true;
  if (/[;{}]$/.test(t)) return true;
  if (/^\w+\s*=[^=]/.test(t)) return true;                 // assignment
  if (/^[\w.]+\s*\(.*\)\s*;?$/.test(t)) return true;       // bare call
  if (/^(if|for|while|else|return|print|cout|console\.log)\b.*[():]/.test(t)) return true;
  if (/^(import|from|#include|using)\b/.test(t)) return true;
  return false;
}

/** Does this line look like executable code rather than English? */
function looksLikeStatement(line) {
  const t = line.trim();
  if (!t) return false;
  return /[=;{}()[\]]|^\s*(def|class|if|for|while|return|import|from|public|private|#include|using|const|let|var|function|print|cout|cin|System\.)\b/.test(t)
    || /[+\-*/%<>]=?/.test(t);
}

/**
 * Build the set of lines that came from the starter template the platform
 * itself handed the student.
 *
 * These lines are NOT deleted from the submission. An earlier version did
 * delete them and it backfired: removing `def main():` dropped the function
 * count, removing code lines shrank the sample the formatting check needs,
 * and a textbook ChatGPT answer fell from 91 to 69. The template is
 * structure the student legitimately builds on.
 *
 * What the set is used for instead is CREDIT: a comment, a docstring or a
 * main-guard that the platform wrote is not evidence about the student, so
 * those lines are excluded from the authorship signals while still counting
 * as ordinary lines of the file.
 *
 * `starter` may be a plain string or the per-language JSON map the quiz and
 * problem tables store (`{"python": "...", "cpp": "..."}`); all variants are
 * folded together, which is safe because the set is only ever consulted for
 * exact line matches.
 */
function templateLines(starter) {
  if (!starter) return null;
  let blob = '';
  if (typeof starter === 'string') {
    const t = starter.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const parsed = JSON.parse(t);
        blob = Object.values(parsed || {}).filter((v) => typeof v === 'string').join('\n');
      } catch { blob = starter; }
    } else blob = starter;
  } else if (typeof starter === 'object') {
    blob = Object.values(starter || {}).filter((v) => typeof v === 'string').join('\n');
  }
  if (!blob.trim()) return null;
  const set = new Set(blob.split('\n').map((l) => l.trim()).filter((l) => l.length > 2));
  return set.size ? set : null;
}

/**
 * Rough "is this English prose?" test for comments.
 *
 * Every model this defends against writes its comments in fluent English.
 * Students on this platform routinely comment in Hinglish or Devanagari
 * ("yahan input padhte hain", "दोनों number ko int banao"), which is a HUMAN
 * tell. Gating the comment-density and comment-register signals on
 * English-ness stops those students from collecting points for the one habit
 * that most clearly marks them as human.
 */
const EN_FUNCTION_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'to', 'of', 'and', 'or', 'in',
  'on', 'for', 'with', 'we', 'it', 'this', 'that', 'if', 'then', 'from', 'by', 'as', 'be', 'will',
  'can', 'all', 'each', 'our', 'into', 'not', 'has', 'have', 'been', 'was', 'were', 'they', 'them']);

function englishShare(comments) {
  const words = comments.join(' ').toLowerCase().match(/[a-z']+/g) || [];
  if (words.length < 8) return 0;
  const hits = words.filter((w) => EN_FUNCTION_WORDS.has(w)).length;
  return hits / words.length;
}

function classifyCode(raw, tmpl) {
  const fromTemplate = (line) => Boolean(tmpl && tmpl.has(line.trim()));
  const signals = [];
  const detail = {};
  let hard = 0;
  let artefact = false;   // an artefact no editor can produce by accident
  let medium = 0;
  let soft = 0;

  const text = String(raw);
  const allLines = text.split('\n');
  const nonBlank = allLines.filter((l) => l.trim());
  detail.lines = nonBlank.length;

  // too small to judge — a 3-line answer carries no authorship evidence
  if (nonBlank.length < 5) {
    return { score: 0, signals: [], detail: { ...detail, too_short: true }, evidence: 0 };
  }

  /* ── gather comments ── */
  const comments = [];
  let commentLineCount = 0;
  let inBlock = false;
  for (const line of allLines) {
    const t = line.trim();
    if (!t) continue;
    if (inBlock) {
      commentLineCount += 1;
      if (!fromTemplate(t)) comments.push(t.replace(/^[*\s]*/, '').replace(/\*\/\s*$/, ''));
      if (/\*\/|"""|'''/.test(t)) inBlock = false;
      continue;
    }
    if (/^(\/\*|"""|''')/.test(t) && !/(\*\/|"""[\s\S]*"""|'''[\s\S]*''')$/.test(t)) {
      inBlock = true;
      commentLineCount += 1;
      if (!fromTemplate(t)) comments.push(t.replace(/^(\/\*+|"""|''')\s?/, ''));
      continue;
    }
    const m = t.match(LINE_COMMENT) || t.match(BLOCK_COMMENT_LINE);
    if (m && m[2] !== undefined) {
      commentLineCount += 1;
      // a comment the PLATFORM wrote says nothing about this student
      if (!fromTemplate(t)) comments.push(m[2].trim());
    }
  }

  const allComments = comments.filter((c) => c.length > 2);
  const debugLeftovers = allComments.filter(isCommentedOutCode);
  // prose comments only — commented-out code is a human habit, not a style tell
  const realComments = allComments.filter((c) => !isCommentedOutCode(c));
  const codeLines = Math.max(0, nonBlank.length - commentLineCount);
  const commentRatio = codeLines > 0 ? realComments.length / codeLines : 0;
  detail.comments = realComments.length;
  detail.debug_leftovers = debugLeftovers.length;
  detail.comment_ratio = Number(commentRatio.toFixed(3));

  /* ════════════════ HARD tells ════════════════ */

  /* H1 ── a markdown fence inside a code submission is conclusive: the editor
     never produces one, it only survives a copy out of a rendered chat. */
  if (/^\s*```/m.test(text)) { hard += 55; artefact = true; signals.push('code_fence_left_in'); }

  /* H2 ── assistant boilerplate that survived the copy */
  const boiler = CHAT_BOILERPLATE.filter((re) => re.test(text)).length;
  detail.boilerplate = boiler;
  if (boiler) {
    hard += Math.min(50, 32 + (boiler - 1) * 18);
    artefact = true;
    signals.push(`assistant_boilerplate:${boiler}`);
  }

  /* H3 ── explanation prose sitting OUTSIDE the comments.
     A submission box holds code. Paragraphs of English that are neither a
     comment nor a statement mean the whole chat reply was pasted in. */
  let proseLines = 0;
  let leadIns = 0;
  inBlock = false;
  for (const line of allLines) {
    const t = line.trim();
    if (!t) continue;
    if (/^(\/\*|"""|''')/.test(t) || inBlock) {
      if (/^(\/\*|"""|''')/.test(t) && !/(\*\/|"""[\s\S]*"""|'''[\s\S]*''')$/.test(t)) inBlock = true;
      else if (/\*\/|"""|'''/.test(t)) inBlock = false;
      continue;
    }
    if (LINE_COMMENT.test(t) || /^\s*```/.test(t)) continue;
    if (EXPLANATION_LEAD.test(t)) { leadIns += 1; proseLines += 1; continue; }
    // numbered explanation bullets: "1. We read the entire input using ..."
    if (/^\d+[.)]\s+[A-Z][a-z]/.test(t) && t.split(/\s+/).length >= 5) { proseLines += 1; continue; }
    const words = t.split(/\s+/);
    if (words.length >= 5 && /^[A-Z"']/.test(t) && !looksLikeStatement(t)) proseLines += 1;
  }
  detail.prose_lines = proseLines;
  detail.explanation_leadins = leadIns;
  if (proseLines >= 2 || leadIns >= 1) {
    hard += Math.min(40, 18 + proseLines * 7 + leadIns * 8);
    artefact = true;
    signals.push(`explanation_prose:${proseLines}`);
  }

  /* H4 ── typography no keyboard produces while writing code.
     Searched in COMMENTS and in string-stripped code only: a student may
     legitimately print an em-dash or a curly apostrophe as part of the
     required OUTPUT, and that must never be read as evidence. Docstrings
     still count because the comment collector keeps their text. */
  const typoSource = `${allComments.join('\n')}\n${stripStrings(
    allLines.filter((l) => !/^\s*(#|\/\/)/.test(l)).join('\n'),
  )}`;
  const typo = AI_TYPOGRAPHY.test(typoSource);
  detail.ai_typography = typo;
  if (typo) { hard += 30; artefact = true; signals.push('chat_typography'); }

  /* H5 ── structured docstring sections (Args:/Returns:/@param) */
  const docHits = DOCSTRING_SECTIONS.filter((re) => re.test(text)).length;
  detail.docstring_sections = docHits;
  if (docHits) { hard += Math.min(28, docHits * 15); signals.push('structured_docstring'); }

  /* H6 ── explicit complexity book-keeping */
  if (COMPLEXITY_NOTE.test(text)) { hard += 16; signals.push('complexity_annotation'); }

  /* H7 ── "Step 1 / Step 2 / Step 3" banner comments */
  const steps = realComments.filter((c) => STEP_BANNER.test(c)).length;
  detail.step_banners = steps;
  if (steps >= 3) { hard += 18; signals.push(`step_banners:${steps}`); }
  else if (steps === 2) { medium += 8; signals.push('step_banners:2'); }

  /* H8 ── presenting alternative approaches, then choosing one */
  if (MULTI_APPROACH.test(text)) { hard += 14; signals.push('multi_approach_notes'); }

  /* ════════════════ MEDIUM tells ════════════════ */

  // English-ness of the comments; non-English commenting is a human habit
  const enShare = englishShare(realComments);
  detail.comment_english_share = Number(enShare.toFixed(2));
  const englishComments = enShare >= 0.12;

  /* M1 ── comment density: generated code narrates almost every step */
  if (realComments.length >= 3 && englishComments) {
    if (commentRatio >= 0.45) { medium += 20; signals.push('heavy_commenting'); }
    else if (commentRatio >= 0.25) { medium += 12; signals.push('dense_commenting'); }
  }

  /* M2 ── narration, scored by SHARE as well as count: six narrating
     comments out of six is a far stronger statement than six out of thirty. */
  const narrative = realComments.filter((c) => NARRATIVE_COMMENT.some((re) => re.test(c)));
  const narrShare = realComments.length ? narrative.length / realComments.length : 0;
  detail.narrative_comments = narrative.length;
  detail.narrative_share = Number(narrShare.toFixed(2));
  if (narrative.length >= 2) {
    medium += Math.min(30, narrative.length * 7 + (narrShare >= 0.7 ? 10 : 0));
    signals.push(`narrated_code:${narrative.length}`);
  } else if (narrative.length === 1) {
    medium += 5;
  }

  /* M3 ── comment REGISTER: models write capitalised, multi-word, verb-first
     sentences. Students write lowercase fragments ("use dict", "seen so far"). */
  if (realComments.length >= 3 && englishComments) {
    const sentenceLike = realComments.filter((c) => /^[A-Z]/.test(c) && c.split(/\s+/).length >= 4);
    const share = sentenceLike.length / realComments.length;
    const avgWords = mean(realComments.map((c) => c.split(/\s+/).length));
    detail.sentence_comment_share = Number(share.toFixed(2));
    detail.avg_comment_words = Number(avgWords.toFixed(1));
    if (share >= 0.85 && avgWords >= 5) { medium += 18; signals.push('uniform_sentence_comments'); }
    else if (share >= 0.7 && avgWords >= 4) { medium += 10; signals.push('formal_comments'); }
  }

  /* M4 ── a docstring on EVERY function, including the trivial ones */
  const funcDefs = (text.match(/^\s*(def |function |public static |private static |\w+ \w+\s*\([^)]*\)\s*\{)/gm) || []).length;
  const docstrings = allLines
    .filter((l) => /^\s*("""|'''|\/\*\*)/.test(l) && !fromTemplate(l)).length;
  detail.functions = funcDefs;
  detail.docstrings = docstrings;
  if (funcDefs >= 2 && docstrings >= funcDefs) { medium += 12; signals.push('every_function_documented'); }

  /* ════════════════ SOFT tells (capped) ════════════════ */

  const codeOnly = stripStrings(allLines.filter((l) => {
    const t = l.trim();
    return t && !LINE_COMMENT.test(t) && !BLOCK_COMMENT_LINE.test(t);
  }).join('\n'));

  /* S1 ── naming: generated code uses long descriptive identifiers, students
     under time pressure use i/j/n/x/tmp. */
  const KEYWORDS = new Set(['if', 'else', 'elif', 'for', 'while', 'return', 'def', 'class', 'int',
    'float', 'char', 'void', 'public', 'private', 'static', 'const', 'let', 'var', 'function',
    'import', 'from', 'new', 'this', 'self', 'true', 'false', 'null', 'none', 'in', 'is', 'and',
    'or', 'not', 'print', 'len', 'range', 'string', 'bool', 'double', 'long', 'auto', 'using',
    'namespace', 'std', 'include', 'main', 'args', 'struct', 'template', 'typename', 'size']);
  const idents = (codeOnly.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])
    .filter((w) => !KEYWORDS.has(w.toLowerCase()));
  const unique = [...new Set(idents)];
  detail.identifiers = unique.length;
  if (unique.length >= 6) {
    const shortShare = unique.filter((w) => w.length <= 2).length / unique.length;
    const avgLen = mean(unique.map((w) => w.length));
    detail.short_ident_share = Number(shortShare.toFixed(3));
    detail.avg_ident_len = Number(avgLen.toFixed(2));
    if (shortShare === 0 && avgLen >= 9) { soft += 14; signals.push('uniformly_verbose_naming'); }
    else if (shortShare === 0 && avgLen >= 7) { soft += 9; signals.push('verbose_naming'); }
    else if (shortShare <= 0.1 && avgLen >= 6) { soft += 5; }
  }

  /* S2 ── machine-perfect formatting. Humans are inconsistent: `a+b` on one
     line and `a + b` on the next. A model is never inconsistent.
     Weak on its own — plenty of students run a formatter. */
  const opLines = codeOnly.split('\n').filter((l) => /[A-Za-z0-9_)\]]\s*[-+*/%<>=!]=?\s*[A-Za-z0-9_("'[]/.test(l));
  if (opLines.length >= 8) {
    const spaced = opLines.filter((l) => /[A-Za-z0-9_)\]] [-+*/%<>=!]=? [A-Za-z0-9_("'[]/.test(l)).length;
    const consistency = spaced / opLines.length;
    detail.operator_spacing = Number(consistency.toFixed(2));
    if (consistency >= 0.97) { soft += 10; signals.push('machine_formatting'); }
    else if (consistency >= 0.88) { soft += 5; }
  }

  /* S3 ── defensive scaffolding students rarely add in a timed exam */
  let scaffold = 0;
  if (/\braise (ValueError|TypeError|IndexError)\s*\(/.test(codeOnly)) scaffold += 1;
  if (/\bthrow new (IllegalArgumentException|IllegalStateException)\s*\(/.test(codeOnly)) scaffold += 1;
  // type annotations count ONCE however they are written — a student who
  // annotates both the parameters and the return made one decision, not two
  if (/->\s*(List|Dict|Tuple|Optional|int|str|bool|float|None)\b/.test(codeOnly)
      || /\bdef \w+\([^)]*:\s*(int|str|float|bool|List|Dict)\b/.test(codeOnly)) scaffold += 1;
  detail.scaffolding = scaffold;
  if (scaffold >= 2) { soft += 10; signals.push('defensive_scaffolding'); }
  else if (scaffold === 1) { soft += 4; }

  /* S4 ── kitchen-sink imports: pulled in "just in case", never referenced */
  const imported = [];
  for (const m of codeOnly.matchAll(/^\s*import\s+([A-Za-z_][\w.]*)/gm)) imported.push(m[1].split('.')[0]);
  for (const m of codeOnly.matchAll(/^\s*from\s+[\w.]+\s+import\s+([^\n#]+)/gm)) {
    for (const nm of m[1].split(',')) imported.push(nm.trim().split(/\s+as\s+/)[0].trim());
  }
  if (imported.length >= 3) {
    const body = codeOnly.replace(/^\s*(import|from)\s+.*$/gm, '');
    const unused = imported.filter((nm) => nm && !new RegExp(`\\b${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(body));
    detail.imports = imported.length;
    detail.unused_imports = unused.length;
    if (unused.length >= 2) { soft += 10; signals.push(`unused_imports:${unused.length}`); }
  }

  /* S5 ── main() guard. Very common in generated code, but ALSO in the
     starter template this platform hands out, so it is worth almost nothing
     on its own. The service strips the template before calling us. */
  const guardLine = allLines.find((l) => /if\s+__name__\s*==\s*['"]__main__['"]/.test(l));
  if (guardLine && !fromTemplate(guardLine)) { soft += 4; }

  detail.tier = { hard, medium, soft: Math.min(SOFT_CAP, soft), soft_raw: soft };
  // A verdict resting on an ARTEFACT — a markdown fence, an assistant
  // preamble, explanation prose, chat typography — needs no corroboration
  // from the paste/timing streams: none of those can reach a code editor by
  // accident. Style built only from HABITS (tidy naming, narration, type
  // hints) still has to be confirmed by a second stream.
  detail.conclusive = artefact;
  const score = hard + medium + Math.min(SOFT_CAP, soft);

  return { score, signals, detail, evidence: nonBlank.length };
}

/* ══════════════════════ entry point ══════════════════════ */

/** Heuristic content sniff when the caller does not say. */
function looksLikeCode(text) {
  const t = String(text);
  if (!t.trim()) return false;
  const codeish = [
    /^\s*(def|class|public|private|function|import|#include|using namespace|package)\s/m,
    /[{};]\s*$/m,
    /^\s*(for|while|if)\s*\(.*\)\s*\{?\s*$/m,
    /\b(printf|cout|console\.log|System\.out|scanf|cin)\b/,
    /^\s{2,}\S/m,
  ].filter((re) => re.test(t)).length;
  return codeish >= 2;
}

/**
 * @param {string} rawText
 * @param {{ kind?: 'prose'|'code'|'auto', starter?: string|object }} [opts]
 *   starter — the skeleton the platform supplied for this question. Those
 *   lines are removed before analysis so the platform's own boilerplate is
 *   never scored as the student's authorship.
 */
function classify(rawText, opts = {}) {
  const raw = String(rawText || '');
  const want = opts.kind || 'auto';
  const kind = want === 'auto' ? (looksLikeCode(raw) ? 'code' : 'prose') : want;

  const text = raw;
  // only code has a template whose authorship must be discounted
  const res = kind === 'code'
    ? classifyCode(text, templateLines(opts.starter))
    : classifyProse(text);
  let score = clamp(Math.round(res.score), 0, 100);

  /* Not enough material to accuse anybody. Prose needs real sentences,
     code needs real lines — both are handled inside their analyser, this is
     the final backstop. */
  const thin = kind === 'code' ? res.evidence < 5 : (text.trim().length < 40 || res.evidence < 15);
  if (thin) score = Math.min(score, 15);

  const verdict = score >= 60 ? 'ai' : score >= 30 ? 'suspicious' : 'human';
  return { score, verdict, signals: res.signals, kind, detail: res.detail };
}

/* ══════════════════════ evidence fusion ══════════════════════ */

/**
 * Merge the independent evidence streams into ONE advisory number.
 *
 * The old code used Math.max(style, paste), which meant:
 *   • a student who drafted in their own editor and pasted scored 100 "ai"
 *     with zero AI involvement, and
 *   • a student who read a chatbot on their phone and retyped scored 0.
 * The louder signal won outright and the two could never corroborate.
 *
 * Noisy-OR over reliability-weighted evidence instead: no single stream can
 * convict on its own, but two agreeing streams push into the "ai" band.
 */
/**
 * Stream reliabilities. `style` was 0.72 when the code classifier could not
 * separate human from AI source at all (human avg 6.1 vs AI avg 6.0). It now
 * measures human max 5 vs AI min 47 on the held-out corpus
 * (backend/test/ai-code-bench.js), so the stream has earned more trust.
 * It is still below `paste`, because style is inference and a paste is a
 * recorded event.
 */
const WEIGHTS = { paste: 0.85, style: 0.80, timing: 0.80 };

/**
 * `styleConclusive` raises the reliability of the style stream for the case
 * where the evidence is a physical artefact rather than a habit — a markdown
 * fence, an assistant preamble, explanation prose, chat typography. Those
 * cannot appear by accident in a code editor, so requiring a second stream
 * to agree would simply let an obvious paste through.
 */
function fuse({ style = 0, paste = 0, timing = 0, styleConclusive = false } = {}) {
  const parts = { style, paste, timing };
  const w = { ...WEIGHTS, style: styleConclusive ? 0.95 : WEIGHTS.style };
  let survive = 1;
  for (const k of Object.keys(parts)) {
    const p = clamp(Number(parts[k]) || 0, 0, 100) / 100 * w[k];
    survive *= (1 - p);
  }
  return Math.round((1 - survive) * 100);
}

/** Shared verdict banding so the arena and the quiz never disagree. */
function band(score) {
  return score >= 70 ? 'ai' : score >= 40 ? 'suspicious' : 'human';
}

module.exports = { classify, fuse, band, templateLines };
