'use strict';
/**
 * Quiz supervision: the live-quiz safety net, applied to the other quiz types.
 *
 * Live quizzes have always run with tab guard, fullscreen lockdown, copy-paste
 * block, screenshot block, Safe Exam Mode, per-question timers and the
 * "open every question before you submit" rule. A normal (course) quiz and a
 * practice quiz had NONE of that, even though they are graded assessments.
 *
 * This service decides, per quiz, which of those switches apply:
 *
 *   live            → unchanged (the runner already enforces everything)
 *   module quiz     → institutional floor, never a camera (unchanged)
 *   normal/practice → floor when `normal_quiz_supervision_enabled` is ON
 *                     (default ON), so a course quiz cannot be weakened by a
 *                     teacher who turned their own switches off.
 *
 * Camera and screen share stay a separate, explicit decision:
 *   - a module quiz never gets them (hard rule, unchanged)
 *   - a normal/practice quiz only gets them when the admin turns on
 *     `normal_quiz_proctoring_enabled` (default OFF) AND the creator asked
 *     for them. A practice quiz must never silently turn on a webcam.
 *
 * Advanced live-view proctoring (snapshot, WebRTC, room scan, second camera,
 * recording, live warnings) stays live-only: it needs a host session.
 */
const { q1, exec } = require('../config/db');
const { readBool } = require('./settings.service');

const FLAG_SUPERVISION = 'normal_quiz_supervision_enabled';
const FLAG_PROCTORING = 'normal_quiz_proctoring_enabled';

/** Switches the institutional floor forces ON for supervised non-live quizzes. */
const FLOOR_KEYS = ['tab_guard_enabled', 'quiz_lockdown_enabled', 'quiz_cp_block', 'screenshot_block_enabled', 'exam_safe_mode'];

async function ensureSchema() {
  const columns = [
    ['require_all_viewed', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['individualized_order', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ];
  for (const [name, definition] of columns) {
    const row = await q1(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quizzes' AND COLUMN_NAME = ?`,
      [name],
    );
    if (!Number(row && row.c)) {
      await exec(`ALTER TABLE quizzes ADD COLUMN \`${name}\` ${definition}`);
      console.log(`[quiz-supervision] added quizzes.${name}`);
    }
  }
  // The two Feature Control switches live with the other feature flags.
  await require('./featureFlags.service').ensureFeatureFlags();
}

async function supervisionEnabled() {
  try { return await readBool(FLAG_SUPERVISION, true); } catch { return true; }
}

async function proctoringEnabled() {
  try { return await readBool(FLAG_PROCTORING, false); } catch { return false; }
}

const isLive = (quiz) => !!quiz && quiz.quiz_type === 'live';
const isModuleQuiz = (quiz) => !!quiz && Number(quiz.module_id) > 0;

/**
 * Which extra rules apply to this quiz's runner.
 * Live quizzes keep both rules unconditionally (that is their contract).
 */
function rulesFor(quiz) {
  if (!quiz) return { require_all_viewed: false, individualized_order: false };
  if (isLive(quiz)) return { require_all_viewed: true, individualized_order: true };
  return {
    require_all_viewed: Number(quiz.require_all_viewed) === 1,
    individualized_order: Number(quiz.individualized_order) === 1,
  };
}

/**
 * Merge the applicable floor over the creator's resolved switches.
 *
 * @param {object} quiz               quizzes row (quiz_type, module_id, …)
 * @param {object} creatorSettings    resolved per-creator anti-cheat settings
 * @param {{supervision?: boolean, proctoring?: boolean}} flags
 * @returns {object} the anti-cheat payload for the runner
 */
function resolveAntiCheat(quiz, creatorSettings = {}, flags = {}) {
  const supervision = flags.supervision !== false;
  const proctoring = flags.proctoring === true;
  const live = isLive(quiz);
  const moduleQuiz = isModuleQuiz(quiz);

  const base = { ...creatorSettings };

  if (live) {
    // Live behaviour is untouched: the creator's own switches, as before.
    return { ...base, quiz_scope: 'live', enforced: false };
  }

  if (moduleQuiz) {
    // Module quizzes already carry the institutional floor; keep it exactly.
    return {
      ...base,
      ...(supervision ? Object.fromEntries(FLOOR_KEYS.map((key) => [key, true])) : {}),
      // Never part of the floor — a module quiz must not ask for a camera.
      proctor_camera_enabled: false,
      proctor_screen_enabled: false,
      quiz_scope: 'module',
      module_quiz: true,
      enforced: true,
      camera_allowed: false,
      screen_allowed: false,
    };
  }

  const out = { ...base };

  // Explicit either way: the runner reads `enforced` to decide whether the
  // lockdown/guard/block suite is in force, so it must never be undefined here.
  out.enforced = !!supervision;
  if (supervision) {
    // Institutional floor: a graded quiz runs supervised even if the teacher
    // switched their personal anti-cheat settings off.
    for (const key of FLOOR_KEYS) out[key] = true;
  }

  // Webcam / screen share: only when the admin explicitly allows it for
  // non-live quizzes. Otherwise a practice quiz never asks for a camera.
  if (!proctoring) {
    out.proctor_camera_enabled = false;
    out.proctor_screen_enabled = false;
    out.camera_allowed = false;
    out.screen_allowed = false;
  } else {
    out.camera_allowed = out.proctor_camera_enabled === true || out.proctor_camera_enabled === '1' || out.proctor_camera_enabled === 1;
    out.screen_allowed = out.proctor_screen_enabled === true || out.proctor_screen_enabled === '1' || out.proctor_screen_enabled === 1;
  }

  out.quiz_scope = quiz && quiz.quiz_type === 'practice' ? 'practice' : 'course';
  return out;
}

module.exports = {
  FLAG_SUPERVISION, FLAG_PROCTORING, FLOOR_KEYS,
  ensureSchema, supervisionEnabled, proctoringEnabled,
  rulesFor, resolveAntiCheat, isLive, isModuleQuiz,
};
