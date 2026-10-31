'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeCourseAnalytics, describeCourseHealth, TREND_WEEKS, MIN_LEARNERS_FOR_LABEL } = require('../../utils/courseInsights');
const { recommendCourses, scoreCandidate, skillTokens } = require('../../utils/recommendations');

const now = new Date('2026-10-28T00:00:00Z');
const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

const modules = [
  { module_id: 1, title: 'Getting started', position: 1, lesson_ids: [11, 12] },
  { module_id: 2, title: 'Pointers', position: 2, lesson_ids: [13, 14] },
];

test('course analytics counts completion from the course enrolment status only', () => {
  const learners = [
    { user_id: 1, status: 'completed', progress_percent: 100, started_at: daysAgo(10), last_accessed_at: daysAgo(1) },
    { user_id: 2, status: 'active', progress_percent: 50, started_at: daysAgo(4), last_accessed_at: daysAgo(3) },
  ];
  const progress = [
    { user_id: 1, lesson_id: 11 }, { user_id: 1, lesson_id: 12 },
    { user_id: 1, lesson_id: 13 }, { user_id: 1, lesson_id: 14 },
    { user_id: 2, lesson_id: 11 }, { user_id: 2, lesson_id: 12 },
  ];
  const summary = summarizeCourseAnalytics({
    modules, learners, progress, certificates: [{ user_id: 1 }], now,
  });

  assert.equal(summary.enrolled, 2);
  assert.equal(summary.completed, 1);
  assert.equal(summary.completion_rate, 50);
  assert.equal(summary.avg_progress, 75);
  assert.equal(summary.certificates, 1);
  assert.equal(summary.total_lessons, 4);
  // Only two learners here, so the headline stays honest about the sample size.
  assert.equal(describeCourseHealth(summary), 'Not enough data yet');
});

test('a tiny cohort is labelled as insufficient data, never healthy', () => {
  const tiny = summarizeCourseAnalytics({
    modules,
    learners: [{ user_id: 9, status: 'completed', progress_percent: 100, started_at: daysAgo(3), last_accessed_at: daysAgo(1) }],
    progress: [], now,
  });
  assert.equal(tiny.completion_rate, 100);
  assert.equal(MIN_LEARNERS_FOR_LABEL, 3);
  assert.equal(describeCourseHealth(tiny), 'Not enough data yet');
  assert.equal(describeCourseHealth({ enrolled: 0 }), 'No learners yet');
});

test('a module counts as reached only when every lesson in it is complete', () => {
  const learners = [{ user_id: 3, status: 'active', progress_percent: 25, started_at: daysAgo(2), last_accessed_at: daysAgo(2) }];
  const progress = [{ user_id: 3, lesson_id: 11 }]; // half of module 1
  const summary = summarizeCourseAnalytics({ modules, learners, progress, now });
  const [first, second] = summary.modules;
  assert.equal(first.reached, 0);
  assert.equal(first.drop_rate, 100);
  assert.equal(second.reached, 0);

  const after = summarizeCourseAnalytics({
    modules,
    learners,
    progress: [{ user_id: 3, lesson_id: 11 }, { user_id: 3, lesson_id: 12 }],
    now,
  });
  assert.equal(after.modules[0].reached, 1);
  assert.equal(after.modules[0].drop_rate, 0);
  assert.equal(after.modules[1].reached, 0);
});

test('inactive learners are counted, never punished, and optional data stays zero-safe', () => {
  const learners = [
    { user_id: 4, status: 'active', started_at: daysAgo(40), last_accessed_at: daysAgo(30) },
    { user_id: 5, status: 'active', started_at: daysAgo(2), last_accessed_at: daysAgo(1) },
  ];
  const summary = summarizeCourseAnalytics({ modules, learners, progress: [], now, stallDays: 14 });
  assert.equal(summary.stalled, 1);
  assert.equal(summary.stall_days, 14);
  assert.equal(summary.avg_progress, 0);
  assert.equal(summarizeCourseAnalytics({}).enrolled, 0);
  assert.deepEqual(summarizeCourseAnalytics({}).trend, []);
});

test('weekly enrolment trend is bounded and oldest-first', () => {
  const learners = [
    { user_id: 6, status: 'active', started_at: now, last_accessed_at: now },
    { user_id: 7, status: 'active', started_at: daysAgo(12), last_accessed_at: daysAgo(12) },
  ];
  const summary = summarizeCourseAnalytics({ modules, learners, progress: [], now });
  assert.equal(summary.trend.length, TREND_WEEKS);
  const weeks = summary.trend.map((row) => row.week_start);
  assert.deepEqual(weeks, [...weeks].sort());
  assert.equal(summary.trend.reduce((total, row) => total + row.enrolled, 0), 2);
});

test('course suggestions explain themselves and skip courses already taken', () => {
  const candidates = [
    { id: 1, title: 'C basics', categories: ['Programming'], skills: '', enrollment_count: 20 },
    { id: 2, title: 'Data science with Python', categories: ['Data Science'], skills: '', enrollment_count: 3 },
    { id: 3, title: 'Quiet course', categories: ['Design'], skills: '', enrollment_count: 0 },
  ];
  const result = recommendCourses({
    candidates,
    interests: { categories: [{ name: 'Programming', count: 2 }], enrolled_ids: [1] },
  });
  assert.deepEqual(result.map((row) => row.id), [2, 3]);
  assert.match(result[0].reasons[0], /not enough of your history|Popular choice/);

  const matched = recommendCourses({ candidates, interests: { categories: [{ name: 'Data Science', count: 1 }] } });
  assert.equal(matched[0].id, 2);
  assert.match(matched[0].reasons[0], /Data Science/);
  assert.ok(!/mastery|guarantee|job/i.test(matched[0].reasons.join(' ')));
});

test('skill helpers stay tolerant of odd input', () => {
  assert.deepEqual(skillTokens(' C , pointers ,C '), ['c', 'pointers', 'c']);
  assert.equal(scoreCandidate({ categories: [] }, { categories: [], skills: [] }).score > 0, true);
});
