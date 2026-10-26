'use strict';
/**
 * UPI Direct — take subscription payments straight into the institution's UPI
 * account, with no payment gateway in the middle.
 *
 * Flow: student picks UPI → we mint an order with a unique reference and show a
 * UPI intent URI plus a QR code → the student pays from any UPI app and submits
 * the 12-digit UTR → an admin approves it (or auto-approve activates straight
 * away). It runs alongside Paytm Business, and the two are independent.
 *
 * NOTE: a direct UPI collection is NOT verified by any gateway. The UTR a
 * student types is a *claim*; approval is a human decision unless the admin
 * explicitly switches auto-approve on. That trade-off is surfaced in the UI.
 */
const { q, q1, exec } = require('../config/db');
const settings = require('./settings.service');

const SETTING_KEYS = [
  'upi_enabled', 'upi_vpa', 'upi_payee_name', 'upi_auto_approve',
  'upi_instructions', 'upi_require_utr',
];

const SEED = [
  ['upi_enabled', '0', 'boolean', 'Accept UPI payments (no gateway needed)'],
  ['upi_vpa', '', 'text', 'Institution UPI ID / VPA (e.g. college@okicici)'],
  ['upi_payee_name', '', 'text', 'Payee name shown in the UPI app'],
  ['upi_auto_approve', '0', 'boolean', '⚠️ Auto-activate on UTR submit — NO bank check. Keep OFF unless you reconcile statements separately'],
  ['upi_require_utr', '1', 'boolean', 'Require the 12-digit UTR / reference number'],
  ['upi_instructions', 'Scan the QR with any UPI app, pay the exact amount, then enter the 12-digit UTR from your payment receipt.', 'textarea', 'Instructions shown on the payment screen'],
];

async function ensureColumn(table, column, ddl) {
  const row = await q1(
    'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  );
  if (!Number(row.c)) { await exec(`ALTER TABLE \`${table}\` ${ddl}`); return true; }
  return false;
}

/** Widens an ENUM only when the wanted value is missing, preserving existing rows. */
async function ensureEnumValue(table, column, value) {
  const row = await q1(
    'SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  );
  if (!row || !row.t.startsWith('enum(')) return false;
  if (row.t.includes(`'${value}'`)) return false;
  const widened = row.t.replace(/^enum\((.*)\)$/, (_, inner) => `enum(${inner},'${value}')`);
  await exec(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ${widened} NOT NULL`);
  return true;
}

async function ensureIndex(table, index, ddl) {
  const row = await q1(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index],
  );
  if (Number(row.c)) return false;
  await exec(ddl);
  return true;
}

async function ensureUtrClaimIndex() {
  // `upi_utr_claim` is non-NULL only while a UTR is actively claimed
  // (pending_review/paid). Rejected/cancelled attempts release it, while the
  // unique index closes the check-then-update race between two submissions.
  await ensureColumn(
    'subscription_orders',
    'upi_utr_claim',
    `ADD COLUMN upi_utr_claim VARCHAR(40)
       GENERATED ALWAYS AS (
         CASE WHEN status IN ('paid','pending_review')
                   AND upi_utr IS NOT NULL AND upi_utr <> ''
              THEN UPPER(upi_utr) ELSE NULL END
       ) VIRTUAL AFTER upi_utr`,
  );
  const duplicates = await q(
    `SELECT upi_utr_claim, COUNT(*) AS c FROM subscription_orders
      WHERE upi_utr_claim IS NOT NULL
      GROUP BY upi_utr_claim HAVING COUNT(*) > 1 LIMIT 10`,
  );
  if (duplicates.length) {
    console.warn(
      '[upi] duplicate active UTR claim(s) found; unique index skipped until an admin resolves them:',
      duplicates.map((row) => `${row.upi_utr_claim}×${row.c}`).join(', '),
    );
    return false;
  }
  return ensureIndex(
    'subscription_orders',
    'uq_so_upi_utr_claim',
    'ALTER TABLE `subscription_orders` ADD UNIQUE KEY `uq_so_upi_utr_claim` (`upi_utr_claim`)',
  );
}

async function ensureSchema() {
  const changed = [];
  if (await ensureEnumValue('subscription_orders', 'gateway', 'upi')) changed.push('gateway+upi');
  if (await ensureEnumValue('subscription_orders', 'status', 'pending_review')) changed.push('status+pending_review');
  const cols = [
    ['upi_reference', "ADD COLUMN upi_reference VARCHAR(40) NULL AFTER gateway_payment_id"],
    ['upi_utr', 'ADD COLUMN upi_utr VARCHAR(40) NULL AFTER upi_reference'],
    ['upi_payer_vpa', 'ADD COLUMN upi_payer_vpa VARCHAR(120) NULL AFTER upi_utr'],
    ['upi_submitted_at', 'ADD COLUMN upi_submitted_at DATETIME NULL AFTER upi_payer_vpa'],
    ['upi_reviewed_by', 'ADD COLUMN upi_reviewed_by INT NULL AFTER upi_submitted_at'],
    ['upi_reviewed_at', 'ADD COLUMN upi_reviewed_at DATETIME NULL AFTER upi_reviewed_by'],
    ['upi_review_note', 'ADD COLUMN upi_review_note VARCHAR(255) NULL AFTER upi_reviewed_at'],
  ];
  for (const [name, ddl] of cols) {
    // eslint-disable-next-line no-await-in-loop
    if (await ensureColumn('subscription_orders', name, ddl)) changed.push(name);
  }
  if (await ensureUtrClaimIndex()) changed.push('uq_so_upi_utr_claim');
  for (const [key, value, inputType, label] of SEED) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await q1('SELECT id FROM settings WHERE setting_key = ?', [key]);
    if (existing) continue;
    // eslint-disable-next-line no-await-in-loop
    await exec(
      'INSERT INTO settings (setting_key, setting_value, group_name, input_type, label) VALUES (?,?,?,?,?)',
      [key, value, 'payments', inputType, label],
    );
    changed.push(key);
  }
  // Display-text refresh for existing installs: the old auto-approve label hid
  // what the switch really does (activate a plan with NO bank verification).
  // Only ever touches the exact legacy string, so an admin-customised label is
  // preserved. Value is never modified.
  const legacyLabel = await q1(
    "SELECT id FROM settings WHERE setting_key = 'upi_auto_approve' AND label = ?",
    ['Auto-activate on UTR submit (no manual check)'],
  );
  if (legacyLabel) {
    const seedLabel = (SEED.find((s) => s[0] === 'upi_auto_approve') || [])[3];
    await exec('UPDATE settings SET label = ? WHERE id = ?', [seedLabel, legacyLabel.id]);
    changed.push('upi_auto_approve label');
  }
  if (changed.length) console.log(`[upi] schema/settings ensured: ${changed.join(', ')}`);
  return changed;
}

/** A VPA looks like name@handle — deliberately permissive, banks vary a lot. */
const VPA_RE = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9.\-_]{1,30}$/;
const isValidVpa = (v) => VPA_RE.test(String(v || '').trim());

/** UTR / RRN: banks issue 12 digits, some apps show up to 22 alphanumerics. */
const UTR_RE = /^[a-zA-Z0-9]{8,24}$/;
const isValidUtr = (v) => UTR_RE.test(String(v || '').trim());

async function config({ force = false } = {}) {
  const all = await settings.loadSettings(force);
  const get = (k, d = '') => {
    const row = all[k];
    if (row === undefined || row === null) return d;
    const raw = (typeof row === 'object' && 'setting_value' in row) ? row.setting_value : row;
    return raw === undefined || raw === null ? d : String(raw);
  };
  const vpa = get('upi_vpa').trim();
  return {
    enabled: get('upi_enabled', '0') === '1' && isValidVpa(vpa),
    configured: isValidVpa(vpa),
    vpa,
    payee: get('upi_payee_name').trim() || get('site_name', 'SmartODL'),
    autoApprove: get('upi_auto_approve', '0') === '1',
    requireUtr: get('upi_require_utr', '1') === '1',
    instructions: get('upi_instructions'),
  };
}

/** Short, collision-resistant, human-readable payment reference. */
const makeReference = (orderId) => `SODL${String(orderId).padStart(6, '0')}`;

/**
 * Builds a UPI intent URI (NPCI deep-link spec).
 * `tr` is our order reference and comes back in the bank statement narration.
 */
function buildUri({ vpa, payee, amountPaise, reference, note }) {
  const amount = (Number(amountPaise) / 100).toFixed(2);
  const params = [
    ['pa', vpa],
    ['pn', payee],
    ['am', amount],
    ['cu', 'INR'],
    ['tr', reference],
    ['tn', note || `Payment ${reference}`],
  ];
  return `upi://pay?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

module.exports = {
  ensureSchema, ensureColumn, ensureEnumValue, ensureIndex, config,
  buildUri, makeReference, isValidVpa, isValidUtr,
  SETTING_KEYS, SEED,
};
