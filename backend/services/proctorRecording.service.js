'use strict';
/** Private, disk-backed live proctor recordings. Files are never served statically. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { q, q1, exec, tx } = require('../config/db');
const { UPLOAD_ROOT, ensureDir } = require('../middleware/upload');
const { readSetting } = require('./settings.service');
const { ApiError } = require('../utils/helpers');

const RECORDING_ROOT = path.resolve(UPLOAD_ROOT, 'proctor-recordings');
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_SESSION_BYTES = 2 * 1024 * 1024 * 1024;
const ACTIVE_STATUSES = ['requested', 'recording', 'stopping'];
const writeQueues = new Map();

function uuid(value) {
  const clean = String(value || '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean);
}

function normalizeRecordingMime(value) {
  const base = String(value || '').split(';', 1)[0].trim().toLowerCase();
  return ['video/webm', 'video/mp4'].includes(base) ? base : null;
}

function finalRecordingStatus({ interrupted = false, totalBytes = 0, cameraBytes = 0, screenBytes = 0 } = {}) {
  if (interrupted) return 'interrupted';
  const hasCamera = Number(cameraBytes) > 0;
  const hasScreen = Number(screenBytes) > 0;
  if (hasCamera && hasScreen) return 'completed';
  return Number(totalBytes) > 0 ? 'interrupted' : 'failed';
}

function filePath(relativePath) {
  const absolute = path.resolve(UPLOAD_ROOT, String(relativePath || ''));
  const rel = path.relative(RECORDING_ROOT, absolute);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw ApiError.forbidden('Invalid recording path');
  return absolute;
}

async function ensureSchema() {
  ensureDir(RECORDING_ROOT);
  try { await fs.promises.chmod(RECORDING_ROOT, 0o700); } catch (_) { /* Windows ACLs govern local installs */ }
  await exec(
    `CREATE TABLE IF NOT EXISTS proctor_recording_sessions (
       session_id CHAR(36) NOT NULL PRIMARY KEY,
       attempt_id BIGINT UNSIGNED NOT NULL,
       quiz_id BIGINT UNSIGNED NOT NULL,
       user_id INT UNSIGNED NOT NULL,
       requested_by INT UNSIGNED NOT NULL,
       status ENUM('requested','recording','stopping','completed','declined','cancelled','interrupted','failed') NOT NULL DEFAULT 'requested',
       total_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
       requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       consented_at TIMESTAMP NULL DEFAULT NULL,
       started_at TIMESTAMP NULL DEFAULT NULL,
       ended_at TIMESTAMP NULL DEFAULT NULL,
       last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_proctor_recording_attempt (attempt_id, requested_at),
       INDEX idx_proctor_recording_cleanup (status, ended_at, last_activity_at),
       CONSTRAINT fk_proctor_recording_attempt FOREIGN KEY (attempt_id)
         REFERENCES quiz_attempts(id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  await exec(
    `CREATE TABLE IF NOT EXISTS proctor_recording_files (
       id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       session_id CHAR(36) NOT NULL,
       feed ENUM('camera','screen') NOT NULL,
       storage_path VARCHAR(255) NOT NULL,
       mime_type VARCHAR(80) NOT NULL DEFAULT 'video/webm',
       byte_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
       next_chunk INT UNSIGNED NOT NULL DEFAULT 0,
       duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY uq_proctor_recording_feed (session_id, feed),
       CONSTRAINT fk_proctor_recording_file_session FOREIGN KEY (session_id)
         REFERENCES proctor_recording_sessions(session_id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  await cleanupExpired().catch((error) => console.warn('[proctor-recording] initial cleanup failed:', error.message));
  startCleanupTimer();
}

async function requestRecording(attempt, requesterId) {
  if (!attempt || !attempt.id || !attempt.quiz_id || !attempt.user_id) throw ApiError.badRequest('Invalid quiz attempt');
  const sessionId = crypto.randomUUID();
  await tx(async (conn) => {
    const [[locked]] = await conn.query('SELECT id, status FROM quiz_attempts WHERE id = ? FOR UPDATE', [attempt.id]);
    if (!locked || locked.status !== 'in_progress') throw ApiError.conflict('This quiz attempt is not running');
    const [existing] = await conn.query(
      "SELECT session_id FROM proctor_recording_sessions WHERE attempt_id = ? AND status IN ('requested','recording','stopping') FOR UPDATE",
      [attempt.id],
    );
    if (existing.length) throw ApiError.conflict('A recording request or recording is already active');
    await conn.execute(
      `INSERT INTO proctor_recording_sessions
         (session_id, attempt_id, quiz_id, user_id, requested_by, status)
       VALUES (?, ?, ?, ?, ?, 'requested')`,
      [sessionId, attempt.id, attempt.quiz_id, attempt.user_id, requesterId],
    );
  });
  return { session_id: sessionId, attempt_id: Number(attempt.id), status: 'requested' };
}

async function consentRecording({ sessionId, attemptId, userId, accepted, mimeTypes = {} }) {
  if (!uuid(sessionId)) throw ApiError.badRequest('Invalid recording session');
  return tx(async (conn) => {
    const [[session]] = await conn.query(
      'SELECT session_id, attempt_id, user_id, status FROM proctor_recording_sessions WHERE session_id = ? FOR UPDATE',
      [sessionId],
    );
    if (!session || Number(session.attempt_id) !== Number(attemptId) || Number(session.user_id) !== Number(userId)) {
      throw ApiError.notFound('Recording request not found');
    }
    if (session.status === 'recording' && accepted) {
      // A consent request may have committed on the server while its response
      // was lost. Let the same authenticated student retry Allow safely.
      const [storedFiles] = await conn.query(
        'SELECT feed, mime_type FROM proctor_recording_files WHERE session_id=?',
        [sessionId],
      );
      const cameraMime = normalizeRecordingMime(mimeTypes.camera || 'video/webm');
      const screenMime = normalizeRecordingMime(mimeTypes.screen || 'video/webm');
      const sameCamera = storedFiles.some((file) => file.feed === 'camera' && normalizeRecordingMime(file.mime_type) === cameraMime);
      const sameScreen = storedFiles.some((file) => file.feed === 'screen' && normalizeRecordingMime(file.mime_type) === screenMime);
      if (cameraMime && screenMime && sameCamera && sameScreen) return { session_id: sessionId, status: 'recording' };
    }
    if (session.status === 'declined' && !accepted) return { session_id: sessionId, status: 'declined' };
    if (session.status !== 'requested') throw ApiError.conflict('This recording request is no longer active');
    if (!accepted) {
      await conn.execute(
        "UPDATE proctor_recording_sessions SET status='declined', ended_at=NOW(), last_activity_at=NOW() WHERE session_id = ?",
        [sessionId],
      );
      return { session_id: sessionId, status: 'declined' };
    }
    const cameraMime = normalizeRecordingMime(mimeTypes.camera || 'video/webm');
    const screenMime = normalizeRecordingMime(mimeTypes.screen || 'video/webm');
    if (!cameraMime || !screenMime) {
      throw ApiError.badRequest('This browser must support WebM or MP4 recording for both webcam and screen.');
    }
    const relativeBase = path.join('proctor-recordings', `${sessionId}`);
    const cameraExt = cameraMime === 'video/mp4' ? 'mp4' : 'webm';
    const screenExt = screenMime === 'video/mp4' ? 'mp4' : 'webm';
    await conn.execute(
      `INSERT INTO proctor_recording_files (session_id, feed, storage_path, mime_type)
       VALUES (?, 'camera', ?, ?), (?, 'screen', ?, ?)`,
      [sessionId, `${relativeBase}-camera.${cameraExt}`, cameraMime,
        sessionId, `${relativeBase}-screen.${screenExt}`, screenMime],
    );
    await conn.execute(
      `UPDATE proctor_recording_sessions
          SET status='recording', consented_at=NOW(), started_at=NOW(), last_activity_at=NOW()
        WHERE session_id = ? AND status='requested'`,
      [sessionId],
    );
    return { session_id: sessionId, status: 'recording' };
  });
}

function serializeWrite(key, job) {
  const previous = writeQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(job);
  writeQueues.set(key, current);
  return current.finally(() => { if (writeQueues.get(key) === current) writeQueues.delete(key); });
}

async function appendChunkOnce({ sessionId, attemptId, userId, feed, chunkIndex, mimeType, chunk }) {
  if (!uuid(sessionId)) throw ApiError.badRequest('Invalid recording session');
  if (!['camera', 'screen'].includes(feed)) throw ApiError.badRequest('feed must be camera or screen');
  const index = Number(chunkIndex);
  if (!Number.isInteger(index) || index < 0 || index > 100000) throw ApiError.badRequest('Invalid recording chunk number');
  if (!Buffer.isBuffer(chunk) || chunk.length < 1 || chunk.length > MAX_CHUNK_BYTES) throw ApiError.badRequest('Recording chunk is empty or too large');
  const chunkMime = normalizeRecordingMime(mimeType);
  if (!chunkMime) throw ApiError.badRequest('Only WebM or MP4 video chunks are accepted');

  let file;
  await tx(async (conn) => {
    const [[session]] = await conn.query(
      `SELECT session_id, attempt_id, user_id, status, total_bytes
         FROM proctor_recording_sessions WHERE session_id = ? FOR UPDATE`,
      [sessionId],
    );
    if (!session || Number(session.attempt_id) !== Number(attemptId) || Number(session.user_id) !== Number(userId)) {
      throw ApiError.notFound('Recording session not found');
    }
    if (!['recording', 'stopping'].includes(session.status)) throw ApiError.conflict('Recording is not accepting data');
    if (Number(session.total_bytes) + chunk.length > MAX_SESSION_BYTES) {
      await conn.execute(
        "UPDATE proctor_recording_sessions SET status='stopping', last_activity_at=NOW() WHERE session_id = ?",
        [sessionId],
      );
      throw new ApiError(413, 'This recording reached the 2 GB per-attempt storage limit');
    }
    const [[stored]] = await conn.query(
      'SELECT id, storage_path, mime_type, byte_size, next_chunk FROM proctor_recording_files WHERE session_id = ? AND feed = ? FOR UPDATE',
      [sessionId, feed],
    );
    if (!stored) throw ApiError.conflict('Recording file has not been initialized');
    if (normalizeRecordingMime(stored.mime_type) !== chunkMime) {
      throw ApiError.badRequest('The uploaded recording format does not match the format accepted at consent.');
    }
    if (Number(stored.next_chunk) !== index) throw ApiError.conflict('Recording chunk is out of order');
    await conn.execute(
      'UPDATE proctor_recording_files SET byte_size = byte_size + ?, next_chunk = next_chunk + 1 WHERE id = ? AND next_chunk = ?',
      [chunk.length, stored.id, index],
    );
    await conn.execute(
      'UPDATE proctor_recording_sessions SET total_bytes = total_bytes + ?, last_activity_at=NOW() WHERE session_id = ?',
      [chunk.length, sessionId],
    );
    file = { ...stored, storage_path: stored.storage_path, priorBytes: Number(stored.byte_size || 0) };
  });

  const absolute = filePath(file.storage_path);
  try {
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
    await fs.promises.appendFile(absolute, chunk, { mode: 0o600 });
  } catch (error) {
    // Roll back the reservation and truncate a partial write before allowing a retry.
    await fs.promises.truncate(absolute, file.priorBytes).catch(() => {});
    await tx(async (conn) => {
      await conn.execute(
        'UPDATE proctor_recording_files SET byte_size = GREATEST(0, byte_size - ?), next_chunk = GREATEST(0, next_chunk - 1) WHERE id = ?',
        [chunk.length, file.id],
      );
      await conn.execute(
        'UPDATE proctor_recording_sessions SET total_bytes = GREATEST(0, total_bytes - ?) WHERE session_id = ?',
        [chunk.length, sessionId],
      );
    }).catch(() => {});
    throw error;
  }
  return { accepted: true, feed, chunk_index: index, bytes: chunk.length };
}

async function appendChunk(input) {
  const key = `${input.sessionId}:${input.feed}`;
  return serializeWrite(key, () => appendChunkOnce(input));
}

async function finalizeRecording({ sessionId, attemptId, userId, durations = {}, interrupted = false }) {
  if (!uuid(sessionId)) throw ApiError.badRequest('Invalid recording session');
  const [[session]] = await q(
    'SELECT session_id, attempt_id, user_id, status, total_bytes FROM proctor_recording_sessions WHERE session_id = ?',
    [sessionId],
  );
  if (!session || Number(session.attempt_id) !== Number(attemptId) || Number(session.user_id) !== Number(userId)) {
    throw ApiError.notFound('Recording session not found');
  }
  if (!['recording', 'stopping'].includes(session.status)) {
    if (['completed', 'interrupted', 'failed'].includes(session.status)) return { session_id: sessionId, status: session.status };
    throw ApiError.conflict('Recording is not active');
  }
  const feedRows = await q(
    'SELECT feed, byte_size FROM proctor_recording_files WHERE session_id=?',
    [sessionId],
  );
  const bytesByFeed = Object.fromEntries(feedRows.map((row) => [row.feed, Number(row.byte_size) || 0]));
  const nextStatus = finalRecordingStatus({
    interrupted,
    totalBytes: session.total_bytes,
    cameraBytes: bytesByFeed.camera,
    screenBytes: bytesByFeed.screen,
  });
  await tx(async (conn) => {
    await conn.execute(
      `UPDATE proctor_recording_sessions SET status=?, ended_at=NOW(), last_activity_at=NOW()
        WHERE session_id=? AND status IN ('recording','stopping')`,
      [nextStatus, sessionId],
    );
    for (const feed of ['camera', 'screen']) {
      const duration = Math.max(0, Math.min(8 * 60 * 60 * 1000, Number(durations[feed]) || 0));
      await conn.execute(
        'UPDATE proctor_recording_files SET duration_ms=? WHERE session_id=? AND feed=?',
        [duration, sessionId, feed],
      );
    }
  });
  return { session_id: sessionId, status: nextStatus };
}

async function failRecording(sessionId, attemptId, userId) {
  if (!uuid(sessionId)) return;
  await exec(
    `UPDATE proctor_recording_sessions SET status='interrupted', ended_at=NOW(), last_activity_at=NOW()
      WHERE session_id=? AND attempt_id=? AND user_id=? AND status IN ('recording','stopping')`,
    [sessionId, attemptId, userId],
  );
}

async function requestStop(sessionId, attemptId) {
  const existing = await q1(
    'SELECT session_id, status FROM proctor_recording_sessions WHERE session_id=? AND attempt_id=?',
    [sessionId, attemptId],
  );
  if (!existing) throw ApiError.notFound('Recording session not found');
  if (existing.status === 'requested') {
    await exec("UPDATE proctor_recording_sessions SET status='cancelled', ended_at=NOW() WHERE session_id=?", [sessionId]);
    return { session_id: sessionId, status: 'cancelled' };
  }
  if (existing.status === 'recording') {
    await exec("UPDATE proctor_recording_sessions SET status='stopping', last_activity_at=NOW() WHERE session_id=?", [sessionId]);
    return { session_id: sessionId, status: 'stopping' };
  }
  return { session_id: sessionId, status: existing.status };
}

async function stopAttempt(attemptId) {
  const active = await q(
    `SELECT session_id, status FROM proctor_recording_sessions
      WHERE attempt_id = ? AND status IN ('requested','recording','stopping') ORDER BY requested_at DESC`,
    [attemptId],
  );
  const stopped = [];
  for (const row of active) {
    // eslint-disable-next-line no-await-in-loop
    stopped.push(await requestStop(row.session_id, attemptId));
  }
  return stopped;
}

async function statusForAttempt(attemptId) {
  const session = await q1(
    `SELECT session_id, attempt_id, status, requested_at, consented_at, started_at, ended_at, total_bytes
       FROM proctor_recording_sessions WHERE attempt_id=? ORDER BY requested_at DESC LIMIT 1`,
    [attemptId],
  );
  if (!session) return null;
  const files = await q(
    'SELECT feed, byte_size, duration_ms FROM proctor_recording_files WHERE session_id=? ORDER BY feed',
    [session.session_id],
  );
  return { ...session, files };
}

async function listAdmin({ limit = 100 } = {}) {
  const sessions = await q(
    `SELECT s.session_id, s.attempt_id, s.quiz_id, s.user_id, s.status, s.total_bytes,
            s.requested_at, s.consented_at, s.started_at, s.ended_at,
            u.full_name AS student_name, z.title AS quiz_title
       FROM proctor_recording_sessions s
       JOIN users u ON u.id=s.user_id
       JOIN quizzes z ON z.id=s.quiz_id
      WHERE s.status IN ('completed','interrupted','failed')
        AND s.total_bytes > 0
      ORDER BY COALESCE(s.ended_at, s.started_at, s.requested_at) DESC
      LIMIT ?`,
    [Math.max(1, Math.min(500, Number(limit) || 100))],
  );
  if (!sessions.length) return [];
  const ids = sessions.map((session) => session.session_id);
  const placeholders = ids.map(() => '?').join(',');
  const files = await q(
    `SELECT id, session_id, feed, mime_type, byte_size, duration_ms
       FROM proctor_recording_files WHERE session_id IN (${placeholders}) AND byte_size > 0 ORDER BY feed`,
    ids,
  );
  const bySession = new Map();
  files.forEach((file) => {
    const list = bySession.get(file.session_id) || [];
    list.push(file);
    bySession.set(file.session_id, list);
  });
  return sessions.map((session) => ({ ...session, files: bySession.get(session.session_id) || [] }));
}

async function fileForAdmin(fileId) {
  const id = Number(fileId);
  if (!Number.isSafeInteger(id) || id < 1) throw ApiError.notFound('Recording file not found');
  const file = await q1(
    `SELECT f.id, f.session_id, f.feed, f.storage_path, f.mime_type, f.byte_size, s.status
       FROM proctor_recording_files f JOIN proctor_recording_sessions s ON s.session_id=f.session_id
      WHERE f.id=?`, [id],
  );
  if (!file || !['completed','interrupted','failed'].includes(file.status) || Number(file.byte_size) < 1) {
    throw ApiError.notFound('Recording file not found');
  }
  const absolutePath = filePath(file.storage_path);
  const stat = await fs.promises.stat(absolutePath).catch(() => null);
  if (!stat || !stat.isFile()) throw ApiError.notFound('Recording file not found');
  return { ...file, absolutePath };
}

async function deleteAdminSession(sessionId) {
  if (!uuid(sessionId)) throw ApiError.notFound('Recording not found');
  const session = await q1('SELECT status FROM proctor_recording_sessions WHERE session_id=?', [sessionId]);
  if (!session) throw ApiError.notFound('Recording not found');
  if (ACTIVE_STATUSES.includes(session.status)) throw ApiError.conflict('Stop or close the recording before deleting it');
  const files = await q('SELECT storage_path FROM proctor_recording_files WHERE session_id=?', [sessionId]);
  for (const row of files) {
    try { await fs.promises.unlink(filePath(row.storage_path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const result = await exec('DELETE FROM proctor_recording_sessions WHERE session_id=?', [sessionId]);
  if (!Number(result.affectedRows)) throw ApiError.notFound('Recording not found');
  return { deleted: true };
}

async function cleanupExpired(now = new Date()) {
  const configured = Number(await readSetting('proctor_recording_retention_days', '30')) || 30;
  const days = Math.max(1, Math.min(3650, configured));
  // Abandoned consent prompts and disconnected uploads are closed, never left
  // looking "recording" forever. Partial files remain reviewable until expiry.
  await exec(
    `UPDATE proctor_recording_sessions
        SET status=IF(total_bytes > 0, 'interrupted', 'failed'), ended_at=COALESCE(ended_at, NOW())
      WHERE status IN ('recording','stopping') AND last_activity_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)`,
  );
  await exec(
    `UPDATE proctor_recording_sessions SET status='cancelled', ended_at=NOW()
      WHERE status='requested' AND requested_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)`,
  );
  const expired = await q(
    `SELECT session_id FROM proctor_recording_sessions
      WHERE ended_at IS NOT NULL AND ended_at < DATE_SUB(?, INTERVAL ${days} DAY)`,
    [now],
  );
  for (const row of expired) {
    // eslint-disable-next-line no-await-in-loop
    await deleteAdminSession(row.session_id).catch((error) => console.warn('[proctor-recording] expired file removal failed:', error.message));
  }
  return { deleted: expired.length, retention_days: days };
}

let cleanupTimer = null;
function startCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    cleanupExpired().catch((error) => console.warn('[proctor-recording] cleanup failed:', error.message));
  }, 60 * 60 * 1000);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

module.exports = {
  RECORDING_ROOT, MAX_CHUNK_BYTES, MAX_SESSION_BYTES, ensureSchema,
  requestRecording, consentRecording, appendChunk, finalizeRecording, failRecording,
  requestStop, stopAttempt, statusForAttempt, listAdmin, fileForAdmin, deleteAdminSession,
  cleanupExpired, startCleanupTimer, uuid, normalizeRecordingMime, finalRecordingStatus,
};
