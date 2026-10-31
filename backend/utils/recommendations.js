'use strict';
/**
 * Transparent course suggestions.
 *
 * SmartODL deliberately does not ship a black-box recommender. Suggestions are
 * a small, explainable score built from things the learner demonstrably did —
 * the categories and skills of courses they already completed — and every
 * suggestion carries the reason it appeared. When there is no signal at all we
 * say "popular" or "new" instead of inventing a match, and nothing here is
 * ever presented as proof of skill or a guarantee of outcome.
 */

const MAX_REASONS = 3;

function skillTokens(value) {
  return String(value || '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeInterests(interests = {}) {
  const categories = (interests.categories || [])
    .map((row) => (typeof row === 'string' ? { name: row, count: 1 } : row))
    .map((row) => ({ name: String(row.name || '').trim(), count: Number(row.count) || 1 }))
    .filter((row) => row.name);
  const skills = [...new Set(skillTokens((interests.skills || []).join(',')))];
  const enrolledIds = new Set((interests.enrolled_ids || []).map(Number));
  return { categories, skills, enrolledIds };
}

/** Exact (case-insensitive) match — no fuzzy matching pretending to be insight. */
function scoreCandidate(candidate, interests) {
  const reasons = [];
  let score = 0;

  const candidateCategories = (candidate.categories || [])
    .map((name) => String(name || '').trim().toLowerCase()).filter(Boolean);
  interests.categories.forEach((interest) => {
    if (!candidateCategories.includes(interest.name.toLowerCase())) return;
    score += 2 + Math.min(2, Math.max(0, interest.count - 1)) * 0.5;
    reasons.push(`Covers ${interest.name}, a topic you have completed courses in`);
  });

  const candidateSkills = new Set(skillTokens(candidate.skills));
  const shared = interests.skills.filter((skill) => candidateSkills.has(skill));
  if (shared.length) {
    score += shared.length;
    reasons.push(`Builds on skills from courses you completed: ${shared.slice(0, 3).join(', ')}`);
  }

  if (!score) {
    const learners = Number(candidate.enrollment_count) || 0;
    if (learners >= 3) {
      score = 0.5;
      reasons.push(`Popular choice — ${learners} learners have enrolled`);
    } else {
      score = 0.1;
      reasons.push('New on SmartODL — not enough of your history to match it yet');
    }
  }

  return { score, reasons: reasons.slice(0, MAX_REASONS) };
}

/**
 * @param {object} input
 * @param {Array}  input.candidates  published courses with categories, skills, enrollment_count
 * @param {object} input.interests   { categories, skills, enrolled_ids }
 * @param {number} input.limit
 * @returns {Array} candidates plus { score, reasons }, best first
 */
function recommendCourses({ candidates = [], interests = {}, limit = 6 } = {}) {
  const normalized = normalizeInterests(interests);
  const cap = Math.min(24, Math.max(1, Number(limit) || 6));

  return candidates
    .filter((candidate) => !normalized.enrolledIds.has(Number(candidate.id)))
    .map((candidate) => {
      const { score, reasons } = scoreCandidate(candidate, normalized);
      return { ...candidate, score: Math.round(score * 10) / 10, reasons };
    })
    .sort((a, b) => (b.score - a.score)
      || (Number(b.enrollment_count) || 0) - (Number(a.enrollment_count) || 0)
      || Number(b.id) - Number(a.id))
    .slice(0, cap);
}

module.exports = { recommendCourses, scoreCandidate, skillTokens, normalizeInterests };
