'use strict';
/**
 * Run the idempotent schema/settings upgrades as an explicit deploy step:
 *   cd backend && npm run migrate
 * Afterwards the API can boot read-only with SMARTODL_SKIP_MIGRATIONS=1,
 * which lets the runtime database account stay least-privilege (no ALTER).
 */
require('dotenv').config();

async function main() {
  const { ping, pool } = require('../config/db');
  await ping();
  const { runMigrations } = require('../services/migrations.service');
  const { ran, failed } = await runMigrations();
  console.log(`[migrate] applied/verified: ${ran.join(', ') || '(none)'}`);
  if (failed.length) {
    console.error(`[migrate] FAILED: ${failed.join(', ')}`);
    await pool.end().catch(() => {});
    process.exit(1);
  }
  console.log('[migrate] done');
  await pool.end().catch(() => {});
}

main().catch((err) => { console.error('[migrate]', err.message); process.exit(1); });
