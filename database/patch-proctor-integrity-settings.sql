-- Safe, additive repair for installations where the API/UI was updated but
-- the feature-flag migration did not run. Select the same database configured
-- by backend/.env (DB_NAME) before executing this file.
-- INSERT IGNORE preserves any value already configured by an administrator.

INSERT IGNORE INTO `settings`
  (`setting_key`, `setting_value`, `group_name`, `input_type`, `label`)
VALUES
  ('proctor_advanced_enabled', '0', 'anti_cheat', 'boolean', 'Advanced proctoring master switch'),
  ('proctor_mic_monitoring_enabled', '0', 'anti_cheat', 'boolean', 'Advanced proctoring - microphone voice activity monitoring'),
  ('proctor_recording_enabled', '0', 'anti_cheat', 'boolean', 'Advanced proctoring - consent-based manual recording'),
  ('proctor_recording_retention_days', '30', 'anti_cheat', 'number', 'Proctor recordings - retention in days'),
  ('integrity_score_enabled', '1', 'anti_cheat', 'boolean', 'Integrity score - admin-only review score master switch'),
  ('integrity_score_tab_switch_penalty', '5', 'anti_cheat', 'number', 'Integrity score - points deducted per tab switch'),
  ('integrity_score_proctor_violation_penalty', '10', 'anti_cheat', 'number', 'Integrity score - points deducted per proctor violation');
