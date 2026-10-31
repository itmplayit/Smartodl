'use strict';
/**
 * Ephemeral live-proctoring relay.
 *
 * The administrator-selected evidence policy for advanced proctoring is
 * "live view only — save nothing". Snapshot frames therefore live only in
 * this process's memory, are keyed by quiz attempt, and expire quickly.
 * Nothing in this module writes an image or video frame to MySQL or disk.
 * WebRTC media does not pass through here at all; this module only remembers
 * which signed-in host owns a signalling session.
 *
 * A multi-process deployment needs sticky routing (or an external realtime
 * layer) for snapshot frames and signalling, exactly like the existing SSE
 * hub. The bounded maps below keep a busy/malicious exam from turning this
 * convenience cache into unbounded memory growth.
 */
const crypto = require('crypto');

const FRAME_TTL_MS = 45 * 1000;
/**
 * Freshness is per FEED, never per bundle: a screen frame arriving every
 * 20 s must not keep a dead camera's last picture alive beside it. Each TTL
 * is roughly 2–3 missed publish intervals (camera 10 s, screen 20 s,
 * second camera 5 s) plus network slack.
 */
const FRAME_TTL_BY_KIND = {
  camera: 25 * 1000,
  screen: 45 * 1000,
  second_camera: 30 * 1000,
};
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const VIEWER_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_FRAME_ATTEMPTS = 500;
/** Hard ceiling on retained frame characters (~96 MiB), not just attempts. */
const MAX_FRAME_BYTES = 96 * 1024 * 1024;
const MAX_SECOND_SESSIONS = 1000;
const MAX_VIEWERS = 500;

const FRAME_KINDS = new Set(['camera', 'screen', 'second_camera']);
const FRAME_LIMITS = {
  camera: 260 * 1024,
  screen: 520 * 1024,
  second_camera: 320 * 1024,
};

const frames = new Map();          // attemptId -> frame bundle
const secondSessions = new Map();  // token -> session
const viewers = new Map();         // WebRTC signalling sessionId -> host
let frameBytes = 0;                // approximate characters held in `frames`

function keyOf(value) {
  return String(value || '');
}

function evictOldest(map, max) {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

const frameLength = (frame) => (frame && typeof frame.image === 'string' ? frame.image.length : 0);

function bundleBytes(bundle) {
  if (!bundle) return 0;
  return Array.from(FRAME_KINDS).reduce((sum, kind) => sum + frameLength(bundle[kind]), 0);
}

function deleteFrameBundle(attemptId) {
  const key = keyOf(attemptId);
  const bundle = frames.get(key);
  if (!bundle) return;
  frameBytes = Math.max(0, frameBytes - bundleBytes(bundle));
  frames.delete(key);
}

function removeFrameKinds(attemptId, kinds = []) {
  const key = keyOf(attemptId);
  const bundle = frames.get(key);
  if (!bundle) return;
  for (const kind of kinds) {
    if (!FRAME_KINDS.has(kind) || !bundle[kind]) continue;
    frameBytes = Math.max(0, frameBytes - frameLength(bundle[kind]));
    delete bundle[kind];
  }
  if (!bundleBytes(bundle)) frames.delete(key);
  else {
    const newest = Array.from(FRAME_KINDS)
      .reduce((at, kind) => Math.max(at, Number((bundle[kind] && bundle[kind].at) || 0)), 0);
    bundle.updatedAt = newest;
  }
}

function evictFrames() {
  while (frames.size > MAX_FRAME_ATTEMPTS || frameBytes > MAX_FRAME_BYTES) {
    const oldest = frames.keys().next().value;
    if (oldest === undefined) break;
    deleteFrameBundle(oldest);
  }
}

/** Drop stale feeds individually; a bundle survives only while a feed does. */
function pruneBundle(bundle, now) {
  if (!bundle) return false;
  let newest = 0;
  FRAME_KINDS.forEach((kind) => {
    const frame = bundle[kind];
    if (!frame) return;
    if (now - Number(frame.at || 0) > (FRAME_TTL_BY_KIND[kind] || FRAME_TTL_MS)) {
      frameBytes = Math.max(0, frameBytes - frameLength(frame));
      delete bundle[kind];
    } else {
      newest = Math.max(newest, Number(frame.at || 0));
    }
  });
  bundle.updatedAt = newest;
  return newest > 0;
}

function cleanup(now = Date.now()) {
  for (const [attemptId, bundle] of Array.from(frames.entries())) {
    if (!bundle || !pruneBundle(bundle, now)) {
      // pruneBundle already subtracted any frames it dropped; a bundle with
      // nothing left contributes 0, so a plain delete cannot double-count.
      if (bundle && bundleBytes(bundle) > 0) deleteFrameBundle(attemptId);
      else frames.delete(attemptId);
    }
  }
  for (const [token, session] of secondSessions.entries()) {
    if (!session || Number(session.expiresAt || 0) <= now) secondSessions.delete(token);
  }
  for (const [sessionId, viewer] of viewers.entries()) {
    if (!viewer || Number(viewer.expiresAt || 0) <= now) viewers.delete(sessionId);
  }
  evictFrames();
  evictOldest(secondSessions, MAX_SECOND_SESSIONS);
  evictOldest(viewers, MAX_VIEWERS);
}

const cleanupTimer = setInterval(cleanup, 30 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

/** Validate a small JPEG/WebP data URL without retaining decoded bytes. */
function validateFrame(kind, image) {
  if (!FRAME_KINDS.has(kind)) return null;
  if (typeof image !== 'string') return null;
  const max = FRAME_LIMITS[kind] || FRAME_LIMITS.camera;
  if (!image || image.length > max) return null;
  if (!/^data:image\/(?:jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return null;
  return image;
}

function putFrame(attempt, kind, image, now = Date.now()) {
  const clean = validateFrame(kind, image);
  if (!attempt || !attempt.id || !clean) return null;
  cleanup(now);
  const attemptId = keyOf(attempt.id);
  const previous = frames.get(attemptId) || {
    attemptId: Number(attempt.id),
    quiz_id: Number(attempt.quiz_id || attempt.quizId || 0) || null,
    user_id: Number(attempt.user_id || attempt.userId || 0) || null,
    updatedAt: now,
  };
  previous.quiz_id = Number(attempt.quiz_id || attempt.quizId || previous.quiz_id || 0) || null;
  previous.user_id = Number(attempt.user_id || attempt.userId || previous.user_id || 0) || null;
  frameBytes += clean.length - frameLength(previous[kind]);
  previous[kind] = { image: clean, at: now };
  previous.updatedAt = now;
  // Delete + set refreshes insertion order for the bounded eviction policy.
  frames.delete(attemptId);
  frames.set(attemptId, previous);
  evictFrames();
  // Eviction can remove the bundle just written when the byte ceiling is
  // already saturated by newer bundles — report that honestly.
  return frames.get(attemptId) === previous ? previous[kind] : null;
}

function getFrames(attemptId, now = Date.now()) {
  cleanup(now);
  return frames.get(keyOf(attemptId)) || null;
}

function framesForQuiz(quizId, now = Date.now(), { since = 0 } = {}) {
  cleanup(now);
  const sinceMs = Math.max(0, Number(since) || 0);
  const out = {};
  for (const bundle of frames.values()) {
    if (Number(bundle.quiz_id) !== Number(quizId)) continue;
    // `since` lets the host poll incrementally: unchanged thumbnails are
    // not re-sent every five seconds for a whole class. Absence in an
    // incremental response means "unchanged"; expiry is still enforced
    // above and the host re-checks each frame's own timestamp.
    const changed = (kind) => {
      const frame = bundle[kind] || null;
      return frame && Number(frame.at || 0) > sinceMs ? frame : null;
    };
    const entry = {
      camera: changed('camera'),
      screen: changed('screen'),
      second_camera: changed('second_camera'),
      updated_at: bundle.updatedAt,
    };
    if (!sinceMs || entry.camera || entry.screen || entry.second_camera) {
      if (!sinceMs) {
        entry.camera = bundle.camera || null;
        entry.screen = bundle.screen || null;
        entry.second_camera = bundle.second_camera || null;
      }
      out[String(bundle.attemptId)] = entry;
    }
  }
  return out;
}

function removeSecondCameraSessions(attemptId) {
  for (const [token, session] of secondSessions.entries()) {
    if (keyOf(session.attemptId) === keyOf(attemptId)) secondSessions.delete(token);
  }
  removeFrameKinds(attemptId, ['second_camera']);
}

function removeAttempt(attemptId) {
  deleteFrameBundle(attemptId);
  removeSecondCameraSessions(attemptId);
}

function publicSecondSession(session, now = Date.now()) {
  if (!session) return null;
  return {
    token: session.token,
    expires_at: new Date(session.expiresAt).toISOString(),
    connected: !!(session.lastFrameAt && now - session.lastFrameAt <= 30 * 1000),
    ever_connected: !!session.connectedAt,
    last_frame_at: session.lastFrameAt ? new Date(session.lastFrameAt).toISOString() : null,
  };
}

function findSecondSessionByAttempt(attemptId, now = Date.now()) {
  cleanup(now);
  let found = null;
  for (const session of secondSessions.values()) {
    if (keyOf(session.attemptId) === keyOf(attemptId)) {
      if (!found || session.createdAt > found.createdAt) found = session;
    }
  }
  return found;
}

function createSecondCameraSession(attempt, now = Date.now(), { rotate = false } = {}) {
  if (!attempt || !attempt.id) return null;
  if (rotate) {
    // A leaked screenshot of the old QR/link stops working the moment the
    // student asks for a fresh pairing code.
    for (const [token, session] of Array.from(secondSessions.entries())) {
      if (keyOf(session.attemptId) === keyOf(attempt.id)) secondSessions.delete(token);
    }
  }
  const existing = findSecondSessionByAttempt(attempt.id, now);
  if (existing) return publicSecondSession(existing, now);

  const token = crypto.randomBytes(24).toString('hex');
  const session = {
    token,
    attemptId: Number(attempt.id),
    quizId: Number(attempt.quiz_id || attempt.quizId || 0),
    userId: Number(attempt.user_id || attempt.userId || 0),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    connectedAt: 0,
    lastFrameAt: 0,
  };
  secondSessions.set(token, session);
  evictOldest(secondSessions, MAX_SECOND_SESSIONS);
  return publicSecondSession(session, now);
}

function getSecondCameraSession(token, now = Date.now()) {
  cleanup(now);
  return secondSessions.get(String(token || '')) || null;
}

function putSecondCameraFrame(token, image, now = Date.now()) {
  const session = getSecondCameraSession(token, now);
  if (!session) return null;
  const saved = putFrame({
    id: session.attemptId,
    quiz_id: session.quizId,
    user_id: session.userId,
  }, 'second_camera', image, now);
  if (!saved) return null;
  if (!session.connectedAt) session.connectedAt = now;
  session.lastFrameAt = now;
  return publicSecondSession(session, now);
}

function secondCameraStatus(attemptId, now = Date.now()) {
  const session = findSecondSessionByAttempt(attemptId, now);
  const status = publicSecondSession(session, now);
  if (status) {
    // The token is a bearer credential for an unauthenticated camera upload.
    // Return it only once to the student creating the pairing link, never in
    // polling/status payloads visible to hosts or quiz participants.
    delete status.token;
    return status;
  }
  return { connected: false, ever_connected: false, last_frame_at: null };
}

function registerViewer(sessionId, hostUserId, quizId, now = Date.now(), attemptId = null) {
  const id = String(sessionId || '').slice(0, 96);
  if (!id || !hostUserId) return null;
  cleanup(now);
  const existing = viewers.get(id);
  // A session id belongs to the first host/quiz that registered it. Letting
  // a later caller silently overwrite the row would reroute another host's
  // students' SDP answers to the wrong browser.
  if (existing && (Number(existing.hostUserId) !== Number(hostUserId)
    || Number(existing.quizId) !== Number(quizId || 0))) {
    return null;
  }
  const viewer = existing || {
    sessionId: id,
    hostUserId: Number(hostUserId),
    quizId: Number(quizId || 0),
    attemptIds: new Set(),
    expiresAt: now + VIEWER_TTL_MS,
  };
  if (!(viewer.attemptIds instanceof Set)) viewer.attemptIds = new Set(viewer.attemptIds || []);
  if (attemptId) viewer.attemptIds.add(String(attemptId));
  viewer.expiresAt = now + VIEWER_TTL_MS;
  viewers.delete(id);
  viewers.set(id, viewer);
  evictOldest(viewers, MAX_VIEWERS);
  return viewers.get(id) === viewer ? viewer : null;
}

function viewerFor(sessionId, now = Date.now()) {
  cleanup(now);
  return viewers.get(String(sessionId || '').slice(0, 96)) || null;
}

function forgetViewer(sessionId, hostUserId, attemptId = null) {
  const id = String(sessionId || '').slice(0, 96);
  const viewer = viewers.get(id);
  if (!viewer || (hostUserId && Number(viewer.hostUserId) !== Number(hostUserId))) return;
  // One host monitor uses one session id for the whole class grid. Closing
  // ONE student's peer must retire only that attempt's routing — forgetting
  // the whole session dropped every other student's pending answer.
  if (attemptId && viewer.attemptIds instanceof Set && viewer.attemptIds.size) {
    viewer.attemptIds.delete(String(attemptId));
    if (viewer.attemptIds.size) return;
  }
  viewers.delete(id);
}

/** True when this viewer session may receive signals for `attemptId`. */
function viewerAllowsAttempt(viewer, attemptId) {
  if (!viewer) return false;
  if (!(viewer.attemptIds instanceof Set) || viewer.attemptIds.size === 0) return true;
  return viewer.attemptIds.has(String(attemptId));
}

function stats(now = Date.now()) {
  cleanup(now);
  return {
    frame_attempts: frames.size,
    frame_bytes: frameBytes,
    second_camera_sessions: secondSessions.size,
    webrtc_viewers: viewers.size,
    storage: 'memory-only',
  };
}

function _resetForTests() {
  frames.clear();
  secondSessions.clear();
  viewers.clear();
  frameBytes = 0;
}

module.exports = {
  FRAME_KINDS,
  FRAME_TTL_BY_KIND,
  MAX_FRAME_BYTES,
  validateFrame,
  putFrame,
  getFrames,
  framesForQuiz,
  removeFrameKinds,
  removeAttempt,
  removeSecondCameraSessions,
  createSecondCameraSession,
  getSecondCameraSession,
  putSecondCameraFrame,
  secondCameraStatus,
  registerViewer,
  viewerFor,
  viewerAllowsAttempt,
  forgetViewer,
  stats,
  _resetForTests,
};
