'use strict';
/**
 * Lesson watch coverage.
 *
 * The problem: a learner could open a lesson, wait 15 seconds and press
 * "Mark complete" without watching anything. That gate only proved the page
 * was fetched, not that the video was seen.
 *
 * The rule here: a video is "watched" when at least COVERAGE_TARGET percent of
 * its timeline has actually been played. The timeline is cut into fixed
 * BUCKET_SECONDS slices; a slice counts only when the player reported being
 * inside it while playing. Coverage is therefore a set of slices, not the
 * furthest position — jumping to the end (or holding the seek bar) covers one
 * slice, not the whole video.
 *
 * Everything in this file is pure so it can be unit-tested without a browser,
 * a database or a real video file.
 */

const BUCKET_SECONDS = 10;
const COVERAGE_TARGET = 90; // percent of the timeline
const MAX_PLAYBACK_RATE = 2.0; // 2x is allowed; 10x fast-forward is not "watching"
const MAX_VIDEO_SECONDS = 6 * 60 * 60; // sanity cap: 6 hours
const MIN_VIDEO_SECONDS = 5; // anything shorter is not a lesson video
// Buffering, a tab switch or a slow heartbeat must not look like a seek. We
// allow 15s of slack on top of elapsed × rate before treating a jump as a seek.
const JUMP_TOLERANCE_SECONDS = 15;

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

/** Normalises whatever the player reported into numbers we can trust shape-wise. */
function normaliseHeartbeat(input = {}) {
  const position = clamp(input.position, 0, MAX_VIDEO_SECONDS);
  const duration = clamp(input.duration, 0, MAX_VIDEO_SECONDS);
  const rawRate = Number(input.rate);
  const rate = Number.isFinite(rawRate) ? clamp(rawRate, 0.25, 4) : 1;
  return {
    position,
    duration,
    playing: input.playing === true || input.playing === 1 || input.playing === 'true',
    rate,
  };
}

/** A duration is only usable if it looks like a real lesson video. */
function durationIsUsable(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value >= MIN_VIDEO_SECONDS && value <= MAX_VIDEO_SECONDS;
}

/**
 * Which slices this heartbeat proves were watched.
 *
 * - playing=false contributes nothing (a paused tab is not watching),
 * - a plausible forward step covers every slice between the previous report and
 *   the current one (that is honest continuous playback),
 * - an implausible jump (seek forward, or a resumed session much later in the
 *   video) covers only the slice under the current position,
 * - backwards movement covers only the current slice.
 */
function bucketsForHeartbeat({
  position,
  duration,
  playing,
  rate = 1,
  previousPosition = null,
  elapsedMs = null,
  bucketSeconds = BUCKET_SECONDS,
}) {
  if (!playing) return [];
  if (!durationIsUsable(duration)) return [];
  const pos = clamp(position, 0, duration);

  const bucketOf = (seconds) => Math.floor(clamp(seconds, 0, duration - 0.001) / bucketSeconds);
  const indexes = new Set([bucketOf(pos)]);

  const prev = Number(previousPosition);
  const elapsed = Number(elapsedMs);
  if (Number.isFinite(prev) && Number.isFinite(elapsed) && prev >= 0 && elapsed > 0) {
    const elapsedSeconds = elapsed / 1000;
    const rateUsed = Number.isFinite(Number(rate)) && Number(rate) > 0 ? Math.min(Number(rate), MAX_PLAYBACK_RATE) : 1;
    // How far continuous playback could plausibly have moved since last time.
    const allowedStep = elapsedSeconds * rateUsed + JUMP_TOLERANCE_SECONDS;
    const delta = pos - prev;
    const plausible = delta >= -1 && delta <= allowedStep;
    if (plausible && delta > 0) {
      for (let cursor = prev; cursor <= pos; cursor += bucketSeconds) {
        indexes.add(bucketOf(cursor));
      }
      // also fill the last slice the position lands inside
      indexes.add(bucketOf(pos));
    }
  }
  return [...indexes].filter((index) => index >= 0).sort((a, b) => a - b);
}

/** Total slices the video is cut into (at least 1). */
function totalBuckets(duration, bucketSeconds = BUCKET_SECONDS) {
  if (!durationIsUsable(duration)) return 0;
  return Math.max(1, Math.ceil(Number(duration) / bucketSeconds));
}

/** Coverage in percent, rounded to one decimal. */
function coveragePercent(coveredCount, duration, bucketSeconds = BUCKET_SECONDS) {
  const total = totalBuckets(duration, bucketSeconds);
  if (!total) return 0;
  const covered = clamp(coveredCount, 0, total);
  return Math.round((covered / total) * 1000) / 10;
}

/** True when enough of the timeline has been played. */
function isCoverageComplete(coveredCount, duration, target = COVERAGE_TARGET) {
  return coveragePercent(coveredCount, duration) >= Number(target);
}

/**
 * The duration we agree to grade against: the first sane value the player
 * reported, and never re-opened by a later, shorter claim (a 1-second
 * "duration" would otherwise make 90% coverage trivial).
 */
function canonicalDuration(stored, reported) {
  if (durationIsUsable(stored)) return Number(stored);
  if (durationIsUsable(reported)) return Number(reported);
  return 0;
}

module.exports = {
  BUCKET_SECONDS, COVERAGE_TARGET, MAX_PLAYBACK_RATE, MAX_VIDEO_SECONDS, MIN_VIDEO_SECONDS,
  JUMP_TOLERANCE_SECONDS,
  normaliseHeartbeat, durationIsUsable, bucketsForHeartbeat, totalBuckets, coveragePercent,
  isCoverageComplete, canonicalDuration,
};
