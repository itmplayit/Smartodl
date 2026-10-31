-- Module quizzes: one quiz per course module, with anti-cheat but no camera.
--
-- `npm run migrate` adds the column, the index and the two Feature Control
-- switches on startup. Run this file only for a manual upgrade, e.g. a deploy
-- that uses SMARTODL_SKIP_MIGRATIONS=1.
--
--   mysql -u root -p education_platform < database/patch-module-quizzes.sql
--
-- Safe to re-run.

SET @db := DATABASE();

-- 1. quizzes.module_id — NULL means "course-level quiz" (the old behaviour).
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'quizzes' AND COLUMN_NAME = 'module_id') > 0,
  'SELECT ''quizzes.module_id already exists'' AS note',
  'ALTER TABLE quizzes ADD COLUMN `module_id` INT UNSIGNED NULL AFTER `course_id`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'quizzes' AND INDEX_NAME = 'idx_quizzes_module') > 0,
  'SELECT ''idx_quizzes_module already exists'' AS note',
  'ALTER TABLE quizzes ADD INDEX `idx_quizzes_module` (`module_id`)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. The two Feature Control switches (separate buttons, as requested).
INSERT INTO settings (setting_key, setting_value, group_name, input_type, label)
SELECT 'module_quizzes_enabled', '1', 'features', 'boolean',
       'Module quizzes (course ke andar har module ka quiz) - separate ON/OFF'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE setting_key = 'module_quizzes_enabled');

INSERT INTO settings (setting_key, setting_value, group_name, input_type, label)
SELECT 'module_quiz_anticheat_enabled', '1', 'anti_cheat', 'boolean',
       'Module quiz anti-cheat floor (tab guard + fullscreen + copy-paste + screenshot block; NO webcam, NO screen share)'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE setting_key = 'module_quiz_anticheat_enabled');

-- 3. Existing module quizzes must never be live (that is what keeps camera and
--    screen share out of them). Report anything that looks wrong.
SELECT z.id, z.title, 'live module quiz — change type to normal' AS problem
  FROM quizzes z
 WHERE z.module_id IS NOT NULL AND z.quiz_type = 'live';

SELECT 'module quizzes ready' AS status,
       (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'quizzes' AND COLUMN_NAME = 'module_id') AS module_column,
       (SELECT COUNT(*) FROM quizzes WHERE module_id IS NOT NULL) AS linked_quizzes;
