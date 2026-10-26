/**
 * Lightweight code-similarity (plagiarism) detector.
 *
 * Approach: normalise each submission (strip comments, whitespace, unify
 * literal identifiers), build a bag of token n-grams and compare two
 * submissions with Jaccard similarity over the n-gram sets.
 * No external dependencies — fast enough for per-problem batch checks.
 */

const NGRAM = 5;

// Roughly strip line and block comments (best-effort, language-agnostic).
function stripComments(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/(^|\s)#[^\n]*/g, '$1');
}

/** Tokenise into normalised tokens: identifiers/keywords as-is, numbers → N, strings → S. */
function tokens(src) {
  const cleaned = stripComments(src)
    .replace(/"(?:\\.|[^"\\])*"/g, ' S ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' S ')
    .replace(/\b\d+(\.\d+)?\b/g, ' N ')
    .toLowerCase();
  return cleaned.match(/[a-z_][a-z0-9_]*|[^\s]/g) || [];
}

/** Set of token n-grams; tiny inputs fall back to whole-token set. */
function ngrams(src) {
  const t = tokens(src);
  if (t.length <= NGRAM) return new Set(t.join('|') ? [t.join('|')] : []);
  const out = new Set();
  for (let i = 0; i + NGRAM <= t.length; i += 1) out.add(t.slice(i, i + NGRAM).join(' '));
  return out;
}

/** Jaccard similarity 0..1 between two source strings. */
function similarity(a, b) {
  const A = ngrams(a);
  const B = ngrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  small.forEach((g) => { if (big.has(g)) inter += 1; });
  return inter / (A.size + B.size - inter);
}

module.exports = { similarity, ngrams, tokens };
