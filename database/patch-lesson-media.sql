-- Lesson video + PDF attachments (course page player and PDF reader).
--
-- `npm run migrate` adds these columns automatically on startup. Run this file
-- only when you want the schema change in one manual step, e.g. before a
-- deploy that runs with SMARTODL_SKIP_MIGRATIONS=1.
--
-- Run the whole file in ONE mysql session:
--   mysql -u root -p education_platform < database/patch-lesson-media.sql
-- Safe to re-run: every column is checked first.

SET @db := DATABASE();

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'lessons' AND COLUMN_NAME = 'video_path') > 0,
  'SELECT ''lessons.video_path already exists'' AS note',
  'ALTER TABLE lessons ADD COLUMN `video_path` VARCHAR(255) NULL AFTER `resource_url`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'lessons' AND COLUMN_NAME = 'video_name') > 0,
  'SELECT ''lessons.video_name already exists'' AS note',
  'ALTER TABLE lessons ADD COLUMN `video_name` VARCHAR(180) NULL AFTER `video_path`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'lessons' AND COLUMN_NAME = 'pdf_path') > 0,
  'SELECT ''lessons.pdf_path already exists'' AS note',
  'ALTER TABLE lessons ADD COLUMN `pdf_path` VARCHAR(255) NULL AFTER `video_name`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'lessons' AND COLUMN_NAME = 'pdf_name') > 0,
  'SELECT ''lessons.pdf_name already exists'' AS note',
  'ALTER TABLE lessons ADD COLUMN `pdf_name` VARCHAR(180) NULL AFTER `pdf_path`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'lessons'
   AND COLUMN_NAME IN ('video_path', 'video_name', 'pdf_path', 'pdf_name')
 ORDER BY ORDINAL_POSITION;
