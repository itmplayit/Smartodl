'use strict';
/** In-app notifications for users, audiences and system events. */
const { q, q1, exec } = require('../config/db');
const events = require('./events.service');

async function ensureSchema() {
  // Broadcasts are one shared row, but read state is per-user. The old
  // notifications.is_read flag let the first person who opened a broadcast
  // mark it read for everyone (and mark-all-read never touched broadcasts).
  await exec(
    `CREATE TABLE IF NOT EXISTS notification_reads (
       notification_id BIGINT UNSIGNED NOT NULL,
       user_id INT UNSIGNED NOT NULL,
       read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (notification_id, user_id),
       KEY idx_notification_reads_user (user_id, read_at),
       CONSTRAINT fk_notification_reads_notification
         FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
       CONSTRAINT fk_notification_reads_user
         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
}

function audienceForRole(role) {
  if (role === 'student') return 'student';
  if (role === 'developer') return 'developer';
  return 'admin'; // owner + admin share the administrative audience
}

async function roleForUser(userId, suppliedRole) {
  if (suppliedRole) return suppliedRole;
  const row = await q1(
    'SELECT r.slug AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?',
    [userId],
  );
  return row ? row.role : null;
}

/**
 * 'certificate' is the newest type (awarded certificates now notify the
 * student). Older databases have an ENUM without it, and MySQL silently
 * truncates an unknown ENUM value — so the insert throws instead. Adding the
 * value is idempotent and cheap (information_schema check first).
 */
const REQUIRED_TYPES = ['course', 'note', 'quiz', 'contest', 'coding', 'achievement', 'system', 'certificate'];
let _typeEnumChecked = false;
async function ensureNotificationTypes() {
  if (_typeEnumChecked) return;
  _typeEnumChecked = true;
  try {
    const row = await q1(
      "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications' AND COLUMN_NAME='type'",
    );
    const current = String((row && row.t) || '').toLowerCase();
    const missing = REQUIRED_TYPES.filter((t) => !current.includes(`'${t}'`));
    if (missing.length) {
      await exec(`ALTER TABLE notifications MODIFY type ENUM(${REQUIRED_TYPES.map((t) => `'${t}'`).join(',')}) NOT NULL DEFAULT 'system'`);
      console.log(`[notifications] enum extended: ${missing.join(', ')}`);
    }
  } catch (_) { /* table missing on a half-migrated install */ }
}

async function notify({ userId = null, audience = 'all', title, message, type = 'system', link = null, createdBy = null }) {
  await ensureNotificationTypes();
  const res = await exec(
    `INSERT INTO notifications (user_id, audience, title, message, type, link, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [userId, audience, title, message, type, link, createdBy],
  );
  // realtime push so the navbar bell updates without a refresh
  events.publish('notification', { id: res.insertId, title, type, link }, userId ? { userId } : audience);
  return res.insertId;
}

async function listForUser(userId, role, { limit = 30, unreadOnly = false } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  return q(
    `SELECT n.id, n.user_id, n.audience, n.title, n.message, n.type, n.link,
            CASE
              WHEN n.user_id IS NOT NULL THEN n.is_read
              WHEN n.is_read = 1 OR nr.notification_id IS NOT NULL THEN 1
              ELSE 0
            END AS is_read,
            n.created_by, n.created_at
       FROM notifications n
       LEFT JOIN notification_reads nr
         ON nr.notification_id = n.id AND nr.user_id = ?
      WHERE (n.user_id = ? OR (n.user_id IS NULL AND n.audience IN ('all', ?)))
        ${unreadOnly ? `AND (CASE
              WHEN n.user_id IS NOT NULL THEN n.is_read
              WHEN n.is_read = 1 OR nr.notification_id IS NOT NULL THEN 1
              ELSE 0
            END) = 0` : ''}
      ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
    [userId, userId, audienceForRole(role), safeLimit],
  );
}

async function markRead(id, userId, role = null) {
  const notification = await q1(
    'SELECT id, user_id, audience FROM notifications WHERE id = ?',
    [id],
  );
  if (!notification) return false;

  if (notification.user_id !== null) {
    if (Number(notification.user_id) !== Number(userId)) return false;
    const result = await exec(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [id, userId],
    );
    return Number(result && result.affectedRows) > 0;
  }

  const actualRole = await roleForUser(userId, role);
  if (!actualRole) return false;
  const audience = audienceForRole(actualRole);
  if (notification.audience !== 'all' && notification.audience !== audience) return false;

  await exec(
    'INSERT IGNORE INTO notification_reads (notification_id, user_id) VALUES (?, ?)',
    [id, userId],
  );
  return true;
}

async function markAllRead(userId, role = null) {
  const actualRole = await roleForUser(userId, role);
  await exec('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [userId]);
  if (!actualRole) return;
  await exec(
    `INSERT IGNORE INTO notification_reads (notification_id, user_id)
     SELECT id, ? FROM notifications
      WHERE user_id IS NULL AND audience IN ('all', ?)`,
    [userId, audienceForRole(actualRole)],
  );
}

async function unreadCount(userId, role) {
  const rows = await q(
    `SELECT COUNT(*) AS c
       FROM notifications n
       LEFT JOIN notification_reads nr
         ON nr.notification_id = n.id AND nr.user_id = ?
      WHERE (n.user_id = ? OR (n.user_id IS NULL AND n.audience IN ('all', ?)))
        AND (CASE
              WHEN n.user_id IS NOT NULL THEN n.is_read
              WHEN n.is_read = 1 OR nr.notification_id IS NOT NULL THEN 1
              ELSE 0
            END) = 0`,
    [userId, userId, audienceForRole(role)],
  );
  return Number(rows[0].c);
}

module.exports = { ensureSchema, notify, listForUser, markRead, markAllRead, unreadCount, audienceForRole };
