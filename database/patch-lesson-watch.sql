-- Lesson completion policy + video watch coverage.
--
-- `npm run migrate` does all of this on startup. Run this file only for a manual
-- upgrade, e.g. a deploy that uses SMARTODL_SKIP_MIGRATIONS=1.
--
--   mysql -u root -p education_platform < database/patch-lesson-watch.sql
--
-- Safe to re-run.

SET @db := DATABASE();

-- 1. Per-course completion policy. Default 'click' = the behaviour every course
--    already had, so nothing changes until an admin picks something stricter.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'courses' AND COLUMN_NAME = 'completion_policy') > 0,
  'SELECT ''courses.completion_policy already exists'' AS note',
  'ALTER TABLE courses ADD COLUMN `completion_policy` VARCHAR(20) NOT NULL DEFAULT ''click'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. One summary row per (learner, lesson): canonical video duration and the
--    last heartbeat position/time.
CREATE TABLE IF NOT EXISTS `lesson_watch` (
  `user_id` int(10) unsigned NOT NULL,
  `lesson_id` int(10) unsigned NOT NULL,
  `duration_seconds` decimal(10,2) NOT NULL DEFAULT 0.00,
  `last_position` decimal(10,2) NOT NULL DEFAULT 0.00,
  `last_rate` decimal(4,2) NOT NULL DEFAULT 1.00,
  `last_beat_at` datetime(3) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`,`lesson_id`),
  KEY `idx_lw_lesson` (`lesson_id`),
  CONSTRAINT `fk_lw_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lw_lesson` FOREIGN KEY (`lesson_id`) REFERENCES `lessons` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. One row per watched 10-second slice. Coverage = COUNT(*), so repeated
--    reports never inflate it and two open tabs cannot double-count.
CREATE TABLE IF NOT EXISTS `lesson_watch_buckets` (
  `user_id` int(10) unsigned NOT NULL,
  `lesson_id` int(10) unsigned NOT NULL,
  `bucket_index` int(10) unsigned NOT NULL,
  PRIMARY KEY (`user_id`,`lesson_id`,`bucket_index`),
  KEY `idx_lwb_lesson` (`lesson_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'completion policy + watch coverage ready' AS status,
       (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'courses' AND COLUMN_NAME = 'completion_policy') AS policy_column,
       (SELECT COUNT(*) FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = @db AND TABLE_NAME IN ('lesson_watch', 'lesson_watch_buckets')) AS watch_tables;
