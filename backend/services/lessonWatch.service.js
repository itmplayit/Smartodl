'use strict';
/**
 * Stores per-learner video watch coverage for a lesson.
 *
 * Two tables:
 *   lesson_watch          – one row per (user, lesson): canonical duration,
 *                           last reported position/rate and heartbeat time.
 *   lesson_watch_buckets  – one row per watched 10-second slice. Coverage is a
 *                           COUNT(*), so duplicate reports are free (INSERT
 *                           IGNORE) and two tabs cannot double-count.
 *
 * Why not a single "watched_seconds" counter? Because a counter can be inflated
 * by reporting position 9999 twice. A bucket can only be covered once.
 */
const { q, q1, exec } = require('../config/db');
const watch = require('../utils/watchProgress');

const TABLE = 'lesson_watch';
const BUCKETS = 'lesson_watch_buckets';

async function ensureSchema() {
  // Course-level policy column: default 'click' keeps every existing course on
  // the behaviour it already had.
  const column = await q1(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courses' AND COLUMN_NAME = 'completion_policy'`,
  );
  if (!Number(column && column.c)) {
    await exec("ALTER TABLE courses ADD COLUMN `completion_policy` VARCHAR(20) NOT NULL DEFAULT 'click'");
    console.log('[lesson-watch] added courses.completion_policy');
  }
  await exec(
    `CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
       user_id INT UNSIGNED NOT NULL,
       lesson_id INT UNSIGNED NOT NULL,
       duration_seconds DECIMAL(10,2) NOT NULL DEFAULT 0,
       last_position DECIMAL(10,2) NOT NULL DEFAULT 0,
       last_rate DECIMAL(4,2) NOT NULL DEFAULT 1,
       last_beat_at DATETIME(3) NOT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       PRIMARY KEY (user_id, lesson_id),
       KEY idx_lw_lesson (lesson_id),
       CONSTRAINT fk_lw_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
       CONSTRAINT fk_lw_lesson FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  await exec(
    `CREATE TABLE IF NOT EXISTS \`${BUCKETS}\` (
       user_id INT UNSIGNED NOT NULL,
       lesson_id INT UNSIGNED NOT NULL,
       bucket_index INT UNSIGNED NOT NULL,
       PRIMARY KEY (user_id, lesson_id, bucket_index),
       KEY idx_lwb_lesson (lesson_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
}

/** Current coverage for one learner + lesson. */
async function readProgress(userId, lessonId) {
  const row = await q1(
    `SELECT duration_seconds, last_position, last_rate, last_beat_at
       FROM \`${TABLE}\` WHERE user_id = ? AND lesson_id = ?`,
    [userId, lessonId],
  );
  const counted = await q1(
    `SELECT COUNT(*) AS covered FROM \`${BUCKETS}\` WHERE user_id = ? AND lesson_id = ?`,
    [userId, lessonId],
  );
  const covered = Number(counted && counted.covered) || 0;
  const duration = Number(row && row.duration_seconds) || 0;
  return {
    duration_seconds: duration,
    covered_buckets: covered,
    total_buckets: watch.totalBuckets(duration),
    watched_seconds: Math.min(covered * watch.BUCKET_SECONDS, Math.max(0, duration)),
    coverage_percent: duration ? watch.coveragePercent(covered, duration) : 0,
    last_position: Number(row && row.last_position) || 0,
    last_beat_at: row ? row.last_beat_at : null,
  };
}

/**
 * Records one heartbeat and returns the fresh coverage.
 *
 * `elapsedMs` is measured on the SERVER (now − last beat), never taken from the
 * request, so a client cannot claim "20 minutes passed" in one call.
 */
async function recordHeartbeat(userId, lessonId, input, { now = Date.now() } = {}) {
  const beat = watch.normaliseHeartbeat(input);
  const previous = await q1(
    `SELECT duration_seconds, last_position, last_beat_at
       FROM \`${TABLE}\` WHERE user_id = ? AND lesson_id = ?`,
    [userId, lessonId],
  );

  const duration = watch.canonicalDuration(previous && previous.duration_seconds, beat.duration);
  const elapsedMs = previous && previous.last_beat_at
    ? Math.max(0, now - new Date(previous.last_beat_at).getTime())
    : null;

  const bucketIndexes = duration
    ? watch.bucketsForHeartbeat({
      position: beat.position,
      duration,
      playing: beat.playing,
      rate: beat.rate,
      previousPosition: previous ? Number(previous.last_position) : null,
      elapsedMs,
    })
    : [];

  if (bucketIndexes.length) {
    // One multi-row insert keeps this cheap even for a 2-hour lecture.
    const placeholders = bucketIndexes.map(() => '(?,?,?)').join(',');
    const params = bucketIndexes.flatMap((index) => [userId, lessonId, index]);
    await exec(
      `INSERT IGNORE INTO \`${BUCKETS}\` (user_id, lesson_id, bucket_index) VALUES ${placeholders}`,
      params,
    );
  }

  await exec(
    `INSERT INTO \`${TABLE}\` (user_id, lesson_id, duration_seconds, last_position, last_rate, last_beat_at)
     VALUES (?,?,?,?,?,FROM_UNIXTIME(?))
     ON DUPLICATE KEY UPDATE
       duration_seconds = GREATEST(duration_seconds, VALUES(duration_seconds)),
       last_position = VALUES(last_position),
       last_rate = VALUES(last_rate),
       last_beat_at = VALUES(last_beat_at)`,
    [userId, lessonId, duration, beat.position, beat.rate, Math.floor(now / 1000)],
  );

  const progress = await readProgress(userId, lessonId);
  return { ...progress, playing: beat.playing, rate: beat.rate };
}

/** Everything the completion gate needs, for one learner in one course. */
async function coverageMap(userId, lessonIds) {
  const ids = (lessonIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return new Map();
  const rows = await q(
    `SELECT b.lesson_id, COUNT(*) AS covered, w.duration_seconds
       FROM \`${BUCKETS}\` b
       LEFT JOIN \`${TABLE}\` w ON w.user_id = b.user_id AND w.lesson_id = b.lesson_id
      WHERE b.user_id = ? AND b.lesson_id IN (${ids.map(() => '?').join(',')})
      GROUP BY b.lesson_id, w.duration_seconds`,
    [userId, ...ids],
  );
  const map = new Map();
  rows.forEach((row) => {
    const duration = Number(row.duration_seconds) || 0;
    map.set(Number(row.lesson_id), {
      duration_seconds: duration,
      covered_buckets: Number(row.covered) || 0,
      coverage_percent: duration ? watch.coveragePercent(Number(row.covered) || 0, duration) : 0,
    });
  });
  return map;
}

module.exports = { ensureSchema, readProgress, recordHeartbeat, coverageMap, TABLE, BUCKETS };
