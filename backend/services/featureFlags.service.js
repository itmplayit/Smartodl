'use strict';
/**
 * Feature-flag rows that must exist in `settings` before the admin panel can
 * show them.
 *
 * There is no migration framework in this project, and `updateSettings()`
 * rejects any key that has no row, so a new switch is invisible and
 * unsettable until something inserts it. This module is that something, and
 * it is the ONE place that owns flag migrations — seeding them from two
 * different services was how the AI toggles and the lockdown toggles drifted
 * apart in the first place.
 *
 * Every migration here is:
 *   - idempotent — safe to run on every boot;
 *   - value-preserving — a new switch inherits the behaviour the old one
 *     already had, so upgrading an existing install changes nothing until
 *     the admin deliberately flips something.
 */
const { q1, exec } = require('../config/db');

/**
 * Insert a flag if it is missing.
 *
 * @param {object}  spec
 * @param {string}  spec.key       new setting key
 * @param {string}  spec.label     human label shown in Settings
 * @param {string} [spec.seedFrom] existing key whose value to inherit
 * @param {string} [spec.dflt]     value when there is nothing to inherit
 * @param {string} [spec.group]    settings group
 * @returns {Promise<boolean>} true when a row was created
 */
async function ensureFlag({ key, label, seedFrom, dflt = '1', group = 'anti_cheat', inputType = 'boolean' }) {
  const existing = await q1('SELECT id FROM settings WHERE setting_key = ?', [key]);
  if (existing) return false;

  let value = dflt;
  if (seedFrom) {
    const src = await q1('SELECT setting_value FROM settings WHERE setting_key = ?', [seedFrom]);
    if (src) value = src.setting_value;
  }
  await exec(
    `INSERT INTO settings (setting_key, setting_value, group_name, input_type, label)
     VALUES (?, ?, ?, ?, ?)`,
    [key, value, group, inputType, label],
  );
  return true;
}

async function ensureFeatureFlags() {
  const created = [];

  /* ── 1. AI detection: one switch per surface ──────────────────────────
     The Coding Arena and the live quiz are run by different people for
     different reasons; an admin may want submission screening in the arena
     while leaving a low-stakes classroom quiz alone. The legacy combined
     key is removed afterwards, because a switch that silently does nothing
     is worse than no switch at all. */
  for (const [key, label] of [
    ['ai_classifier_arena_enabled', 'AI detection - Coding Arena'],
    ['ai_classifier_quiz_enabled', 'AI detection - Live Quiz'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    if (await ensureFlag({ key, label, seedFrom: 'ai_classifier_enabled' })) created.push(key);
  }
  const legacyAi = await q1("SELECT id FROM settings WHERE setting_key = 'ai_classifier_enabled'");
  if (legacyAi) {
    await exec("DELETE FROM settings WHERE setting_key = 'ai_classifier_enabled'");
    created.push('-ai_classifier_enabled');
  }

  /* ── 2. live-quiz copy-paste block, split out of Fullscreen Lockdown ──
     `quiz_lockdown_enabled` used to mean two unrelated things at once:
     "keep the student in fullscreen" and "disable the clipboard". An
     invigilator who wants a fullscreen exam where students may still copy
     a snippet out of the question had no way to express that.

     Unlike the AI split, the old key is KEPT — it still owns fullscreen
     enforcement and the escape-key blocking. Only the clipboard half moved
     out, and it inherits the lockdown's current value so nothing changes on
     upgrade. */
  if (await ensureFlag({
    key: 'quiz_cp_block',
    label: 'Live Quiz copy-paste block',
    seedFrom: 'quiz_lockdown_enabled',
  })) created.push('quiz_cp_block');

  /* ── 2c. module quizzes (course ke andar, har module ka apna quiz) ──
     Two separate admin switches, deliberately:
       - module_quizzes_enabled         : the feature itself (UI + API),
       - module_quiz_anticheat_enabled  : the anti-cheat floor for those quizzes
                                          (tab guard + fullscreen + copy-paste
                                          + screenshot block, never a camera).
     A module quiz is a normal quiz, so the webcam/screen-share switches (which
     only ever apply to LIVE quizzes) can never touch it. */
  if (await ensureFlag({
    key: 'module_quizzes_enabled',
    label: 'Module quizzes (course ke andar har module ka quiz) - separate ON/OFF',
    dflt: '1',
    group: 'features',
  })) created.push('module_quizzes_enabled');
  if (await ensureFlag({
    key: 'module_quiz_anticheat_enabled',
    label: 'Module quiz anti-cheat floor (tab guard + fullscreen + copy-paste + screenshot block; NO webcam, NO screen share)',
    dflt: '1',
    group: 'anti_cheat',
  })) created.push('module_quiz_anticheat_enabled');

  /* ── 3. live proctoring (webcam + screen share) ──
     Both default to OFF. Pointing a camera at a student is an institutional
     decision with consent implications; it must never switch itself on
     because somebody upgraded. */
  const proctorFlags = [
    ['proctor_camera_enabled', 'Proctoring - webcam presence check (live quiz)', '0', 'boolean'],
    ['proctor_screen_enabled', 'Proctoring - require full screen share (live quiz)', '0', 'boolean'],
    ['proctor_max_violations', 'Proctoring - auto-submit after this many violations (0 = never)', '0', 'number'],
  ];
  for (const [key, label, dflt, inputType] of proctorFlags) {
    // eslint-disable-next-line no-await-in-loop
    if (await ensureFlag({ key, label, dflt, inputType })) created.push(key);
  }

  /* ── 3b. advanced live proctoring ──
     These are deliberately separate from the per-developer anti-cheat keys:
     live viewing, a second camera, identity checks and microphone analysis
     have institution-wide privacy/consent implications, so only an admin can
     enable them from Feature Control. Every switch starts OFF. */
  const advancedProctorFlags = [
    ['proctor_advanced_enabled', 'Advanced proctoring master switch', '0'],
    ['proctor_body_detection_enabled', 'Advanced proctoring - body and person detection', '0'],
    ['proctor_head_pose_enabled', 'Advanced proctoring - head pose and looking-away detection', '0'],
    ['proctor_live_snapshot_enabled', 'Advanced proctoring - live snapshot grid', '0'],
    ['proctor_live_webrtc_enabled', 'Advanced proctoring - live WebRTC camera and screen view', '0'],
    ['proctor_second_camera_enabled', 'Advanced proctoring - mobile second camera', '0'],
    ['proctor_room_scan_enabled', 'Advanced proctoring - pre-exam room scan', '0'],
    ['proctor_identity_check_enabled', 'Advanced proctoring - face and ID identity check', '0'],
    ['proctor_mic_monitoring_enabled', 'Advanced proctoring - microphone voice activity monitoring', '0'],
    ['proctor_dual_monitor_enabled', 'Advanced proctoring - multiple display detection', '0'],
    ['proctor_live_warnings_enabled', 'Advanced proctoring - host live warnings', '0'],
  ];
  for (const [key, label, dflt] of advancedProctorFlags) {
    // eslint-disable-next-line no-await-in-loop
    if (await ensureFlag({ key, label, dflt })) created.push(key);
  }
  if (await ensureFlag({
    key: 'proctor_recording_enabled',
    label: 'Advanced proctoring - consent-based manual recording',
    dflt: '0',
    group: 'anti_cheat',
    inputType: 'boolean',
  })) created.push('proctor_recording_enabled');
  if (await ensureFlag({
    key: 'proctor_recording_retention_days',
    label: 'Proctor recordings - retention in days',
    dflt: '30',
    group: 'anti_cheat',
    inputType: 'number',
  })) created.push('proctor_recording_retention_days');
  if (await ensureFlag({
    key: 'integrity_score_enabled',
    label: 'Integrity score - admin-only review score master switch',
    dflt: '1',
    group: 'anti_cheat',
    inputType: 'boolean',
  })) created.push('integrity_score_enabled');
  if (await ensureFlag({
    key: 'integrity_score_tab_switch_penalty',
    label: 'Integrity score - points deducted per tab switch',
    dflt: '5',
    group: 'anti_cheat',
    inputType: 'number',
  })) created.push('integrity_score_tab_switch_penalty');
  if (await ensureFlag({
    key: 'integrity_score_proctor_violation_penalty',
    label: 'Integrity score - points deducted per proctor violation',
    dflt: '10',
    group: 'anti_cheat',
    inputType: 'number',
  })) created.push('integrity_score_proctor_violation_penalty');
  if (await ensureFlag({
    key: 'certificate_integrity_band_enabled',
    label: 'Certificates - show green/yellow/red integrity review band',
    dflt: '1',
    group: 'anti_cheat',
    inputType: 'boolean',
  })) created.push('certificate_integrity_band_enabled');
  if (await ensureFlag({
    key: 'certificate_integrity_band_public',
    label: 'Certificates - also show the integrity band on public verification pages',
    dflt: '0',
    group: 'anti_cheat',
    inputType: 'boolean',
  })) created.push('certificate_integrity_band_public');
  if (await ensureFlag({
    key: 'certificate_integrity_scope',
    label: 'Certificates - integrity band scope (course or overall)',
    dflt: 'course',
    group: 'anti_cheat',
    inputType: 'text',
  })) created.push('certificate_integrity_scope');
  if (await ensureFlag({
    key: 'proctor_webrtc_ice_servers',
    label: 'Advanced proctoring - WebRTC ICE servers (JSON)',
    dflt: '[{"urls":"stun:stun.l.google.com:19302"},{"urls":"stun:stun1.l.google.com:19302"}]',
    inputType: 'text',
  })) created.push('proctor_webrtc_ice_servers');

  /* ── 4. proctoring folded down to TWO switches ──
     There used to be five, and the split caused real confusion: turning on
     "Webcam" alone looked like proctoring was fully on while phone/book
     detection silently never ran, because it had its own switch. Everything
     camera-related now rides on the camera switch.

     • proctor_object_enabled -> gone; object detection follows the camera
     • proctor_object_strict  -> gone; object hits stay ADVISORY, which is the
       only defensible default at ~60-97% accuracy on a cheap webcam
     • proctor_auto_submit    -> folded into proctor_max_violations, where
       0 now means "never auto-submit"
     Existing behaviour is preserved: a site that had auto-submit ON keeps its
     limit, one that had it OFF gets 0. */
  const legacyAuto = await q1("SELECT setting_value FROM settings WHERE setting_key = 'proctor_auto_submit'");
  if (legacyAuto) {
    if (!['1', 'true', 'yes', 'on'].includes(String(legacyAuto.setting_value).toLowerCase())) {
      await exec("UPDATE settings SET setting_value = '0' WHERE setting_key = 'proctor_max_violations'");
    }
    await exec("DELETE FROM settings WHERE setting_key = 'proctor_auto_submit'");
    created.push('-proctor_auto_submit');
  }
  for (const dead of ['proctor_object_enabled', 'proctor_object_strict']) {
    const row = await q1('SELECT id FROM settings WHERE setting_key = ?', [dead]);
    if (row) { await exec('DELETE FROM settings WHERE setting_key = ?', [dead]); created.push(`-${dead}`); }
  }
  await exec(
    `UPDATE settings SET label = 'Proctoring - auto-submit after this many violations (0 = never)'
      WHERE setting_key = 'proctor_max_violations' AND label <> 'Proctoring - auto-submit after this many violations (0 = never)'`,
  );

  if (created.length) {
    require('./settings.service').invalidate();
    console.log(`[flags] feature switches migrated: ${created.join(', ')}`);
  }
  return created;
}

module.exports = { ensureFeatureFlags, ensureFlag };
