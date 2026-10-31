'use strict';
/**
 * What must be true before a lesson may be marked complete.
 *
 * The old gate proved only that the lesson page had been fetched and that 15
 * seconds had passed — a learner could open a lesson and click "complete"
 * without watching anything. Each course now picks a policy:
 *
 *   click           – old behaviour (page opened + dwell time). Default, so no
 *                     existing course changes behaviour by surprise.
 *   watch           – at least COVERAGE_TARGET% of the video timeline played.
 *   quiz            – a quiz linked to the course must be passed.
 *   watch_and_quiz  – both.
 *
 * Deliberate fairness rules:
 *   - A lesson with no video cannot demand watch coverage (that would trap the
 *     learner forever); the requirement degrades to the non-video half.
 *   - An external YouTube/Vimeo embed cannot be measured, so it is graded like
 *     "no video" — we do not pretend to know whether it was watched.
 *   - Nothing here blocks the certificate of an already-completed course.
 */
const { COVERAGE_TARGET } = require('./watchProgress');

const POLICIES = ['click', 'watch', 'quiz', 'watch_and_quiz'];

const POLICY_LABELS = {
  click: 'Open + dwell time (default)',
  watch: 'Watch 90% of the video',
  quiz: 'Pass a linked quiz',
  watch_and_quiz: 'Watch 90% + pass a linked quiz',
};

function normalisePolicy(value) {
  const raw = String(value || '').trim().toLowerCase();
  return POLICIES.includes(raw) ? raw : 'click';
}

const requiresWatch = (policy) => policy === 'watch' || policy === 'watch_and_quiz';
const requiresQuiz = (policy) => policy === 'quiz' || policy === 'watch_and_quiz';

/**
 * Decides whether the click is allowed, and why not.
 *
 * @param {object} input
 * @param {string} input.policy           course completion policy
 * @param {boolean} input.hasMeasurableVideo uploaded video exists (coverage is meaningful)
 * @param {number} input.coveragePercent  measured watch coverage for this lesson
 * @param {boolean} input.quizPassed      any linked course quiz passed
 * @param {number} [input.target]         coverage target (default 90)
 * @returns {{ allowed: boolean, reason: string, checks: object }}
 */
/**
 * Which quiz must be passed for one lesson?
 *
 * - If the lesson's own module has a quiz, THAT quiz is the requirement: a
 *   module quiz is the assessment of the material in front of the learner.
 * - Otherwise any quiz linked to the course counts (course-level quiz).
 *
 * Returns the quiz id that must be passed, or null when nothing is linked.
 */
function requiredQuizForModule({ moduleQuizId = null, courseQuizIds = [] } = {}) {
  const moduleQuiz = Number(moduleQuizId);
  if (Number.isInteger(moduleQuiz) && moduleQuiz > 0) return moduleQuiz;
  const courseIds = (courseQuizIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  return courseIds.length ? courseIds[0] : null;
}

function evaluateCompletion({
  policy, hasMeasurableVideo = false, coveragePercent = 0, quizPassed = false, target = COVERAGE_TARGET,
  quizLabel = '',
}) {
  const normalised = normalisePolicy(policy);
  const coverage = Number(coveragePercent) || 0;
  const targetPercent = Number(target) || COVERAGE_TARGET;

  const watchRequired = requiresWatch(normalised) && !!hasMeasurableVideo;
  const quizRequired = requiresQuiz(normalised);
  const watchOk = !watchRequired || coverage >= targetPercent;
  const quizOk = !quizRequired || !!quizPassed;

  const checks = {
    policy: normalised,
    watch_required: watchRequired,
    watch_ok: watchOk,
    coverage_percent: Math.round(coverage * 10) / 10,
    coverage_target: targetPercent,
    quiz_required: quizRequired,
    quiz_ok: quizOk,
    // Told to the learner in plain words when we could not measure anything.
    measurement_available: !!hasMeasurableVideo,
  };

  if (watchOk && quizOk) return { allowed: true, reason: '', checks };

  const reasons = [];
  if (!watchOk) {
    const left = Math.max(0, Math.round((targetPercent - coverage) * 10) / 10);
    reasons.push(
      `Video ka ${checks.coverage_percent}% dekha gaya hai — complete karne ke liye ${targetPercent}% chahiye (about ${left}% baaki). `
      + 'Video ko wahan se chalayein jahan chhoda tha.',
    );
  }
  if (!quizOk) {
    // Say WHERE the quiz is: a module quiz sits inside the module, a course-level
    // one in the assessments section. Sending the learner to the wrong place is
    // the difference between "blocked" and "stuck forever".
    const where = quizLabel
      ? `${quizLabel} pass karna zaroori hai — quiz us module ke andar diya hai.`
      : 'Is course ka linked quiz pass karna zaroori hai — Course assessments section se quiz attempt karein.';
    reasons.push(where);
  }
  return { allowed: false, reason: reasons.join(' '), checks };
}

module.exports = {
  POLICIES, POLICY_LABELS, normalisePolicy, requiresWatch, requiresQuiz,
  requiredQuizForModule, evaluateCompletion,
};
