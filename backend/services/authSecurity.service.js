'use strict';
/** Auth-security schema bits: password-change invalidation + refresh rotation. */
const { q1, exec } = require('../config/db');

async function ensureColumn(table, column, ddl) {
  const row = await q1(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  if (!Number(row.c)) await exec(`ALTER TABLE \`${table}\` ${ddl}`);
}

async function ensureSchema() {
  await ensureColumn(
    'users',
    'password_changed_at',
    'ADD COLUMN `password_changed_at` datetime DEFAULT NULL AFTER `password_hash`',
  );
  await ensureColumn(
    'user_sessions',
    'previous_refresh_token',
    'ADD COLUMN `previous_refresh_token` varchar(255) DEFAULT NULL AFTER `refresh_token`',
  );
  await ensureColumn(
    'user_sessions',
    'refresh_rotated_at',
    'ADD COLUMN `refresh_rotated_at` datetime DEFAULT NULL AFTER `previous_refresh_token`',
  );
}

module.exports = { ensureSchema, ensureColumn };
