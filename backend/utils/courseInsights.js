'use strict';
/**
 * Pure course analytics.
 *
 * Course-level replacement for the old Learning Path analytics: everything is
 * derived from the records SmartODL already trusts — enrolments, lesson
 * progress and issued certificates. Deliberately absent: time-on-task,
 * "engagement scores", or anything that could be read as proof of learning.
 * "Inactive" learners are a nudge signal for the instructor, never a penalty.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALL_DAYS = 14;
const TREND_WEEKS = 8;

const round1 = (value) => Math.round((Number(value) || 0) * 10) / 10;

function toTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function weekStart(time) {
  const date = new Date(time);
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime() - day * DAY_MS;
}

/**
 * @param {object} input
 * @param {Array} input.modules   [{ module_id, title, position, lesson_ids: [1,2,3] }]
 * @param {Array} input.learners  [{ user_id, status, progress_percent, started_at, last_accessed_at, completed_at, has_certificate }]
 * @param {Array} input.progress  [{ user_id, lesson_id }]  (completed lessons)
 * @param {Array} input.certificates [{ user_id }]          (issued, not revoked)
 */
function summarizeCourseAnalytics({
  modules = [], learners = [], progress = [], certificates = [], now = new Date(), stallDays = DEFAULT_STALL_DAYS,
} = {}) {
  const nowTime = toTime(now) || Date.now();
  const stallMs = Math.max(1, Number(stallDays) || DEFAULT_STALL_DAYS) * DAY_MS;
  const ordered = [...modules].sort((a, b) => Number(a.position) - Number(b.position));

  const lessonsByUser = new Map();
  progress.forEach((row) => {
    const userId = Number(row.user_id);
    if (!lessonsByUser.has(userId)) lessonsByUser.set(userId, new Set());
    lessonsByUser.get(userId).add(Number(row.lesson_id));
  });
  const certUsers = new Set(certificates.map((row) => Number(row.user_id)));

  let completedLearners = 0;
  let stalledLearners = 0;
  let progressSum = 0;
  const starts = [];
  const reachedModule = new Map(ordered.map((module) => [Number(module.module_id), 0]));

  learners.forEach((learner) => {
    const done = lessonsByUser.get(Number(learner.user_id)) || new Set();
    const status = String(learner.status || '');
    if (status === 'completed') completedLearners += 1;
    progressSum += Number(learner.progress_percent) || 0;

    // A module counts as reached when every one of its lessons is complete —
    // the same rule the course itself uses to mark a course complete.
    ordered.forEach((module) => {
      const ids = (module.lesson_ids || []).map(Number);
      if (ids.length && ids.every((id) => done.has(id))) {
        const key = Number(module.module_id);
        reachedModule.set(key, (reachedModule.get(key) || 0) + 1);
      }
    });

    if (status !== 'completed') {
      const lastSeen = toTime(learner.last_accessed_at) || toTime(learner.started_at);
      if (lastSeen && nowTime - lastSeen > stallMs) stalledLearners += 1;
    }
    const started = toTime(learner.started_at);
    if (started) starts.push(started);
  });

  const modulesOut = ordered.map((module) => {
    const key = Number(module.module_id);
    const reached = reachedModule.get(key) || 0;
    return {
      module_id: key,
      title: module.title || `Module #${key}`,
      position: Number(module.position),
      lessons: (module.lesson_ids || []).length,
      reached,
      not_reached: Math.max(0, learners.length - reached),
      drop_rate: learners.length ? round1(((learners.length - reached) / learners.length) * 100) : 0,
    };
  });

  const totalLessons = ordered.reduce((sum, module) => sum + (module.lesson_ids || []).length, 0);
  return {
    enrolled: learners.length,
    completed: completedLearners,
    in_progress: Math.max(0, learners.length - completedLearners),
    stalled: stalledLearners,
    stall_days: Math.max(1, Number(stallDays) || DEFAULT_STALL_DAYS),
    completion_rate: learners.length ? round1((completedLearners / learners.length) * 100) : 0,
    avg_progress: learners.length ? round1(progressSum / learners.length) : 0,
    certificates: learners.filter((learner) => certUsers.has(Number(learner.user_id))).length,
    modules: modulesOut,
    total_lessons: totalLessons,
    trend: buildTrend(starts, nowTime),
    generated_at: new Date(nowTime).toISOString(),
  };
}

/** Enrolment starts per week for the last TREND_WEEKS weeks (oldest first). */
function buildTrend(starts, nowTime) {
  if (!starts.length) return [];
  const currentWeek = weekStart(nowTime);
  const buckets = new Map();
  for (let i = TREND_WEEKS - 1; i >= 0; i -= 1) {
    buckets.set(currentWeek - i * 7 * DAY_MS, 0);
  }
  starts.forEach((time) => {
    const key = weekStart(time);
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
  });
  return [...buckets.entries()].map(([start, enrolled]) => ({
    week_start: new Date(start).toISOString().slice(0, 10), enrolled,
  }));
}

/** One-line reading shown to the course owner. */
/** Below this many learners a rate is too noisy to label, so we say so instead of guessing. */
const MIN_LEARNERS_FOR_LABEL = 3;

function describeCourseHealth(summary) {
  if (!summary || !summary.enrolled) return 'No learners yet';
  // Never call a course "healthy" (or unhealthy) on a sample this small.
  if (summary.enrolled < MIN_LEARNERS_FOR_LABEL) return 'Not enough data yet';
  if (summary.completion_rate >= 75) return 'Healthy completion';
  if (summary.stalled > summary.enrolled / 2) return 'Many learners inactive';
  if (summary.completion_rate < 25) return 'Early-stage cohort';
  return 'Steady progress';
}

module.exports = {
  summarizeCourseAnalytics, buildTrend, describeCourseHealth,
  DEFAULT_STALL_DAYS, TREND_WEEKS, MIN_LEARNERS_FOR_LABEL,
};
