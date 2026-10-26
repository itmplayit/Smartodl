'use strict';
/**
 * Live proctoring: webcam presence + screen-share monitoring for live quizzes.
 *
 * DESIGN NOTE — what this does and deliberately does NOT do.
 *
 * No photo, no video and no screen frame ever leaves the student's browser.
 * Everything is analysed client-side and only a small EVENT ("no_face",
 * "screen_stopped", …) is posted here. That is a deliberate choice:
 *
 *   • A self-hosted install would otherwise accumulate gigabytes of webcam
 *     footage on the operator's own disk within a single exam.
 *   • Storing a student's face/desktop turns the install into a serious
 *     privacy liability that an institution has to have consent and a
 *     retention policy for.
 *   • The pedagogical value is in the SIGNAL ("camera was covered for 4
 *     minutes"), which the event already carries.
 *
 * Both switches default to OFF. Proctoring is intrusive, so it has to be an
 * explicit decision by an administrator rather than something that silently
 * turns itself on after an upgrade.
 */
const { q, q1, exec } = require('../config/db');

/**
 * Whitelisted event types. Anything else from the client is dropped — the
 * browser is not trusted to name its own violations.
 *
 * `weight` is how much the event counts toward the violation total:
 *   0 = informational only (consent/bookkeeping, never punishes the student)
 *   1 = a real violation
 */
const EVENTS = {
  camera_granted:     { weight: 0, label: 'Camera allowed' },
  camera_denied:      { weight: 1, label: 'Camera permission refused' },
  camera_off:         { weight: 1, label: 'Camera switched off mid-exam' },
  // weight 0 — the camera coming back is good news. Like screen_resumed, the
  // outage that preceded it already carries the single penalty.
  camera_resumed:     { weight: 0, label: 'Camera recovered after an outage' },
  camera_dark:        { weight: 1, label: 'Camera covered or room dark' },
  camera_frozen:      { weight: 1, label: 'Camera image frozen (still picture?)' },
  no_face:            { weight: 1, label: 'No face visible' },
  multiple_faces:     { weight: 1, label: 'More than one face visible' },
  face_check_unsupported: { weight: 0, label: 'Browser cannot do face detection' },
  screen_granted:     { weight: 0, label: 'Screen share started' },
  screen_denied:      { weight: 1, label: 'Screen share refused' },
  screen_stopped:     { weight: 1, label: 'Screen share stopped mid-exam' },
  // weight 0: resuming is the student doing the right thing. The stop that
  // preceded it already carries the penalty, and it is counted exactly once
  // per outage — not once per poll while the share is down.
  screen_resumed:     { weight: 0, label: 'Screen share restarted after a stop' },
  screen_wrong_surface: { weight: 1, label: 'Shared a single window/tab instead of the whole screen' },

  /* Object detection. weight 0 ON PURPOSE.
     A 320x240 webcam in a badly lit room will happily call a TV remote, a
     calculator or a dark wallet a "cell phone". Auto-submitting a student's
     exam on that would be indefensible, so by default these are evidence for
     a human invigilator to look at, not punishment. There is deliberately no
     switch to make them count: at ~60-97% accuracy on a cheap webcam, ending
     a student's exam over a misread TV remote is not defensible. */
  /* Recorded at SUBMIT when proctoring was required but the student's browser
     never reported the camera/screen starting. Without this a student who
     simply blocks the proctoring requests looks spotless — cleaner, in fact,
     than an honest student whose webcam hiccuped once. weight 1: refusing to
     be proctored on a proctored exam is itself the finding. */
  camera_never_started: { weight: 1, label: 'Camera never started for a proctored quiz' },
  screen_never_started: { weight: 1, label: 'Screen share never started for a proctored quiz' },

  /* Advanced, admin-enabled checks. Browser-side body/head/voice/display
     heuristics stay advisory: they can prove something deserves a human
     look, not that cheating occurred. */
  // Body/person detections are advisory, like phone/book detection: a small
  // browser model can miss a head-and-shoulders framing or mistake a poster
  // for a second person, so it must never feed an auto-submit threshold.
  body_missing:       { weight: 0, label: 'Body/person not visible on camera' },
  multiple_people:    { weight: 0, label: 'More than one person visible on camera' },
  body_out_of_frame:  { weight: 0, label: 'Body is poorly framed or partly out of view' },
  looking_away:       { weight: 0, label: 'Head turned away from the screen' },
  body_check_unavailable: { weight: 0, label: 'Body detection could not load' },
  mic_granted:        { weight: 0, label: 'Microphone allowed' },
  mic_denied:         { weight: 1, label: 'Microphone permission refused' },
  mic_off:            { weight: 1, label: 'Microphone stopped mid-exam' },
  mic_resumed:        { weight: 0, label: 'Microphone recovered after an outage' },
  voice_detected:     { weight: 0, label: 'Voice-level sound detected' },
  multiple_displays_detected: { weight: 0, label: 'More than one display appears to be connected' },
  dual_monitor_check_unavailable: { weight: 0, label: 'Browser cannot report connected displays' },
  room_scan_started:  { weight: 0, label: 'Pre-exam room scan started' },
  room_scan_completed:{ weight: 0, label: 'Pre-exam room scan completed' },
  room_scan_missing:  { weight: 1, label: 'Required room scan was not completed' },
  second_camera_connected: { weight: 0, label: 'Mobile second camera connected' },
  second_camera_disconnected: { weight: 1, label: 'Mobile second camera disconnected' },
  second_camera_never_started: { weight: 1, label: 'Mobile second camera never started' },
  identity_check_completed: { weight: 0, label: 'Student completed the identity self-check' },
  identity_verified:  { weight: 0, label: 'Host verified the student identity' },
  identity_check_missing: { weight: 1, label: 'Required identity check was not completed' },
  host_warning_sent:  { weight: 0, label: 'Host sent a live proctoring warning' },
  live_view_started:  { weight: 0, label: 'Live proctoring view started' },

  phone_detected:     { weight: 0, label: 'Phone visible in camera' },
  book_detected:      { weight: 0, label: 'Book / notes visible in camera' },
  device_detected:    { weight: 0, label: 'Another device visible in camera' },
  object_check_unavailable: { weight: 0, label: 'Object detection could not load' },
};

/** Object detections are flagged for review even though they never score. */
const OBJECT_EVENTS = ['phone_detected', 'book_detected', 'device_detected'];

/** Zero-weight advanced signals that still deserve a visible host flag. */
const ADVISORY_FLAG_EVENTS = [
  ...OBJECT_EVENTS,
  'body_missing',
  'multiple_people',
  'body_out_of_frame',
  'looking_away',
  'voice_detected',
  'multiple_displays_detected',
  'host_warning_sent',
  'identity_verified',
];

const EVENT_KEYS = Object.keys(EVENTS);

/**
 * Event provenance is part of the trust boundary. A student's browser may
 * report what its own sensors observed, but it must never be able to mint a
 * host decision ("identity_verified") or a server-side attestation
 * ("second_camera_connected", submit-time "*_missing" findings). The public
 * student endpoint therefore accepts CLIENT_EVENTS only; trusted server code
 * passes an explicit source when it records the rest.
 */
const HOST_ONLY_EVENTS = new Set(['identity_verified', 'host_warning_sent']);
const SERVER_ONLY_EVENTS = new Set([
  'camera_never_started',
  'screen_never_started',
  'room_scan_missing',
  'second_camera_connected',
  'second_camera_never_started',
  'identity_check_missing',
]);
const CLIENT_EVENTS = new Set(EVENT_KEYS.filter(
  (type) => !HOST_ONLY_EVENTS.has(type) && !SERVER_ONLY_EVENTS.has(type),
));

function eventsForSource(source = 'client') {
  if (source === 'host') return HOST_ONLY_EVENTS;
  if (source === 'server') return SERVER_ONLY_EVENTS;
  return CLIENT_EVENTS;
}

/* ----------------------- per-attempt policy snapshot -----------------------
 * The switches an admin flips are live platform settings, but an exam that
 * has already started must be judged by the rules the student actually saw
 * and consented to. The first runner payload for an attempt therefore
 * freezes this object on the attempt row; later setting changes can only
 * switch live transports OFF for that attempt, never silently add a new
 * camera/screen/second-camera requirement halfway through the paper. */
const ADVANCED_POLICY_KEYS = [
  'master', 'body', 'head_pose', 'snapshot', 'webrtc', 'second_camera',
  'room_scan', 'identity', 'mic', 'dual_monitor', 'warnings',
];

function emptyAdvancedPolicy() {
  return Object.fromEntries(ADVANCED_POLICY_KEYS.map((key) => [key, false]));
}

function emptyProctorPolicy(live = false) {
  return {
    version: 1,
    live: !!live,
    captured_at: null,
    camera_required: false,
    screen_required: false,
    advanced: emptyAdvancedPolicy(),
  };
}

function normalizeAdvancedPolicy(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const pick = (...keys) => keys.some((key) => !!source[key]);
  return {
    master: !!source.master,
    body: !!source.body,
    head_pose: pick('head_pose', 'headPose'),
    snapshot: !!source.snapshot,
    webrtc: !!source.webrtc,
    second_camera: pick('second_camera', 'secondCamera'),
    room_scan: pick('room_scan', 'roomScan'),
    identity: !!source.identity,
    mic: !!source.mic,
    dual_monitor: pick('dual_monitor', 'dualMonitor'),
    warnings: !!source.warnings,
  };
}

function normalizeProctorPolicy(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const advanced = normalizeAdvancedPolicy(raw.advanced || {});
  const live = !!raw.live;
  return {
    version: 1,
    live,
    captured_at: raw.captured_at || raw.capturedAt || null,
    camera_required: live && !!(raw.camera_required ?? raw.cameraRequired),
    screen_required: live && !!(raw.screen_required ?? raw.screenRequired),
    advanced: live ? advanced : emptyAdvancedPolicy(),
  };
}

function parseProctorPolicy(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return normalizeProctorPolicy(raw);
  try { return normalizeProctorPolicy(JSON.parse(String(raw))); }
  catch (_) { return null; }
}

function advancedSensorRequirements(advanced = {}) {
  const a = normalizeAdvancedPolicy(advanced);
  return {
    camera: !!(a.body || a.head_pose || a.snapshot || a.webrtc || a.room_scan || a.identity),
    screen: !!(a.snapshot || a.webrtc || a.dual_monitor),
  };
}

/** Build the frozen policy for one attempt from the settings in force now. */
function buildProctorPolicy({ live = false, creatorCamera = false, creatorScreen = false, advanced = {}, capturedAt = null } = {}) {
  if (!live) return { ...emptyProctorPolicy(false), captured_at: capturedAt };
  const normalizedAdvanced = normalizeAdvancedPolicy(advanced);
  const forced = advancedSensorRequirements(normalizedAdvanced);
  return normalizeProctorPolicy({
    version: 1,
    live: true,
    captured_at: capturedAt,
    camera_required: !!creatorCamera || forced.camera,
    screen_required: !!creatorScreen || forced.screen,
    advanced: normalizedAdvanced,
  });
}

/**
 * Intersect a frozen attempt policy with the platform switches as they are
 * right now. Turning a switch OFF mid-exam stops that transport/check for
 * the attempt; turning one ON mid-exam does not add it to an attempt whose
 * policy never included it.
 */
function effectiveAdvancedPolicy(policy, currentAdvanced = {}) {
  const frozen = normalizeProctorPolicy(policy);
  if (!frozen || !frozen.live) return emptyAdvancedPolicy();
  const current = normalizeAdvancedPolicy(currentAdvanced);
  const out = emptyAdvancedPolicy();
  ADVANCED_POLICY_KEYS.forEach((key) => { out[key] = !!(frozen.advanced[key] && current[key]); });
  out.master = !!(frozen.advanced.master && current.master);
  if (!out.master) return emptyAdvancedPolicy();
  return out;
}

/** Join flags without slicing one in half; newest flags win the 255 chars. */
function joinFlags(flags, maxLength = 255) {
  const list = Array.from(flags || []).map((f) => String(f || '').trim()).filter(Boolean);
  const kept = [];
  let length = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const extra = list[i].length + (kept.length ? 1 : 0);
    if (length + extra > maxLength) break;
    kept.unshift(list[i]);
    length += extra;
  }
  return kept.join(',');
}

/** Idempotent, runs every boot — same contract as the other ensureSchema()s. */
async function ensureColumn(table, column, ddl) {
  const [row] = await q(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  if (Number(row.n) === 0) await exec(`ALTER TABLE \`${table}\` ${ddl}`);
}

async function ensureSchema() {
  const cols = [
    ['proctor_camera', "ADD COLUMN proctor_camera TINYINT(1) NOT NULL DEFAULT 0"],
    ['proctor_screen', "ADD COLUMN proctor_screen TINYINT(1) NOT NULL DEFAULT 0"],
    ['proctor_violations', 'ADD COLUMN proctor_violations INT UNSIGNED NOT NULL DEFAULT 0'],
    ['proctor_flags', 'ADD COLUMN proctor_flags VARCHAR(255) NULL'],
    ['proctor_policy', 'ADD COLUMN proctor_policy TEXT NULL'],
  ];
  for (const [col, ddl] of cols) {
    await ensureColumn('quiz_attempts', col, ddl); // eslint-disable-line no-await-in-loop
  }

  // The attempt row keeps the running totals; this table keeps the timeline an
  // invigilator needs to tell "glanced away once" from "left the room".
  await exec(
    // attempt_id/user_id types must match quiz_attempts.id (BIGINT UNSIGNED)
    // and users.id (INT UNSIGNED) exactly, or InnoDB rejects the foreign key
    // with the famously unhelpful errno 150.
    `CREATE TABLE IF NOT EXISTS proctor_events (
       id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       attempt_id BIGINT UNSIGNED NOT NULL,
       user_id INT UNSIGNED NOT NULL,
       event_type VARCHAR(32) NOT NULL,
       detail VARCHAR(255) NULL,
       occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_proctor_attempt (attempt_id, occurred_at),
       CONSTRAINT fk_proctor_attempt FOREIGN KEY (attempt_id)
         REFERENCES quiz_attempts(id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

/**
 * Take a batch of client-reported events.
 *
 * The client batches rather than posting per event, so a flaky camera cannot
 * be used to hammer the API. Everything is clamped and whitelisted here.
 */
async function recordEvents(attempt, rawEvents, { source = 'client' } = {}) {
  const weightOf = (type) => EVENTS[type].weight;
  const allowed = eventsForSource(source);
  const list = (Array.isArray(rawEvents) ? rawEvents : []).slice(0, 40);
  const accepted = [];
  let rejected = 0;
  for (const raw of list) {
    const type = String((raw && raw.type) || '');
    // Unknown types AND types this source may not mint are both dropped: a
    // student posting "identity_verified" must be exactly as ineffective as
    // a student posting a made-up event name.
    if (!allowed.has(type)) { rejected += 1; continue; }
    const detail = raw && raw.detail != null ? String(raw.detail).slice(0, 255) : null;
    accepted.push({ type, detail });
  }
  if (!accepted.length) {
    return {
      violations: Number(attempt.proctor_violations || 0),
      flags: splitFlags(attempt.proctor_flags),
      accepted: 0,
      rejected,
    };
  }

  const values = [];
  const params = [];
  for (const e of accepted) {
    values.push('(?,?,?,?)');
    params.push(attempt.id, attempt.user_id, e.type, e.detail);
  }
  await exec(
    `INSERT INTO proctor_events (attempt_id, user_id, event_type, detail) VALUES ${values.join(',')}`,
    params,
  );

  // Consent/bookkeeping events must not count against the student.
  const added = accepted.reduce((n, e) => n + weightOf(e.type), 0);
  const flags = new Set(splitFlags(attempt.proctor_flags));
  // Objects are flagged for review even when they do not score, otherwise an
  // invigilator would have no idea a phone was seen.
  accepted.forEach((e) => {
    if (weightOf(e.type) > 0 || ADVISORY_FLAG_EVENTS.includes(e.type)) flags.add(e.type);
  });

  const grantedCamera = accepted.some((e) => e.type === 'camera_granted') ? 1 : null;
  const grantedScreen = accepted.some((e) => e.type === 'screen_granted') ? 1 : null;

  const sets = ['proctor_violations = proctor_violations + ?', 'proctor_flags = ?'];
  const upd = [added, joinFlags(flags) || null];
  if (grantedCamera) { sets.push('proctor_camera = 1'); }
  if (grantedScreen) { sets.push('proctor_screen = 1'); }
  upd.push(attempt.id);
  await exec(`UPDATE quiz_attempts SET ${sets.join(', ')} WHERE id = ?`, upd);

  const fresh = await q1('SELECT proctor_violations FROM quiz_attempts WHERE id = ?', [attempt.id]);
  return {
    violations: Number(fresh ? fresh.proctor_violations : 0),
    flags: Array.from(flags),
    accepted: accepted.length,
    rejected,
  };
}

const splitFlags = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * Called once as an attempt is graded. Turns "no proctoring data at all" from
 * an invisible gap into an explicit, reviewable event.
 */
async function closeAttempt(attemptId, {
  cameraRequired,
  screenRequired,
  secondCameraRequired = false,
  roomScanRequired = false,
  identityRequired = false,
} = {}) {
  if (!cameraRequired && !screenRequired && !secondCameraRequired && !roomScanRequired && !identityRequired) return;
  const a = await q1(
    'SELECT id, user_id, proctor_camera, proctor_screen, proctor_flags FROM quiz_attempts WHERE id = ?',
    [attemptId],
  );
  if (!a) return;
  const missing = [];
  if (cameraRequired && !Number(a.proctor_camera)) missing.push('camera_never_started');
  if (screenRequired && !Number(a.proctor_screen)) missing.push('screen_never_started');

  if (secondCameraRequired || roomScanRequired || identityRequired) {
    const seen = new Set((await q(
      `SELECT DISTINCT event_type FROM proctor_events
        WHERE attempt_id = ? AND event_type IN (
          'second_camera_connected', 'room_scan_completed',
          'identity_check_completed', 'identity_verified'
        )`,
      [attemptId],
    )).map((row) => row.event_type));
    if (secondCameraRequired && !seen.has('second_camera_connected')) missing.push('second_camera_never_started');
    if (roomScanRequired && !seen.has('room_scan_completed')) missing.push('room_scan_missing');
    if (identityRequired && !seen.has('identity_check_completed') && !seen.has('identity_verified')) {
      missing.push('identity_check_missing');
    }
  }
  if (!missing.length) return;
  await recordEvents(
    { id: a.id, user_id: a.user_id, proctor_violations: 0, proctor_flags: a.proctor_flags },
    missing.map((type) => ({ type, detail: 'no report received from the browser' })),
    { source: 'server' },
  );
}

/** Timeline + rollup for the invigilator's review screen. */
async function summaryFor(attemptId) {
  const rows = await q(
    `SELECT event_type, COUNT(*) AS n, MIN(occurred_at) AS first_at, MAX(occurred_at) AS last_at
       FROM proctor_events WHERE attempt_id = ?
      GROUP BY event_type ORDER BY n DESC`,
    [attemptId],
  );
  return rows.map((r) => ({
    type: r.event_type,
    label: (EVENTS[r.event_type] || {}).label || r.event_type,
    counts_as_violation: Boolean((EVENTS[r.event_type] || {}).weight),
    count: Number(r.n),
    first_at: r.first_at,
    last_at: r.last_at,
  }));
}

async function timelineFor(attemptId, limit = 200) {
  const rows = await q(
    `SELECT event_type, detail, occurred_at FROM proctor_events
      WHERE attempt_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    [attemptId, Math.max(1, Math.min(500, Number(limit) || 200))],
  );
  return rows.map((r) => ({
    type: r.event_type,
    label: (EVENTS[r.event_type] || {}).label || r.event_type,
    detail: r.detail,
    at: r.occurred_at,
  }));
}

module.exports = {
  ensureSchema, recordEvents, closeAttempt, summaryFor, timelineFor,
  EVENTS, EVENT_KEYS, OBJECT_EVENTS, ADVISORY_FLAG_EVENTS,
  CLIENT_EVENTS, HOST_ONLY_EVENTS, SERVER_ONLY_EVENTS, eventsForSource,
  emptyProctorPolicy, normalizeProctorPolicy, parseProctorPolicy,
  buildProctorPolicy, effectiveAdvancedPolicy, joinFlags,
};
