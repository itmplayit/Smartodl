'use strict';
/**
 * Permission-catalogue migrations.
 *
 * `permissions` is a lookup table: each row is something a developer account
 * can be granted from Admin → All Users → Permissions. Adding a capability to
 * the product therefore means adding a row here, and existing installations
 * have to pick it up on boot because the project has no migration framework.
 *
 * Granting is NOT done here — that stays a deliberate admin action per user.
 * This only makes the permission appear in the catalogue.
 */
const { q1, exec } = require('../config/db');

/** Inserts a permission if its code is not already present. */
async function ensurePermission({ code, label, group = 'general', description = '' }) {
  const existing = await q1('SELECT id FROM permissions WHERE code = ?', [code]);
  if (existing) return false;
  await exec(
    'INSERT INTO permissions (code, label, group_name, description) VALUES (?, ?, ?, ?)',
    [code, label, group, description],
  );
  return true;
}

async function ensurePermissions() {
  const created = [];

  /* ── Anti-cheat control ────────────────────────────────────────────────
     Until now every anti-cheat switch was admin-only, which meant the
     instructor actually running an exam had to phone an admin to turn on
     fullscreen lockdown. This permission hands that specific control to a
     developer without exposing the rest of Website Settings. */
  if (await ensurePermission({
    code: 'manage_anticheat',
    label: 'Manage Anti-cheat',
    group: 'quizzes',
    description: 'Turn tab guard, fullscreen lockdown, copy-paste blocking, screenshot blocking and AI detection on or off.',
  })) created.push('manage_anticheat');

  if (created.length) console.log(`[permissions] catalogue updated: ${created.join(', ')}`);
  return created;
}

module.exports = { ensurePermissions, ensurePermission };
