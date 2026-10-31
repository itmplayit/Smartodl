'use strict';
/**
 * Certificate design templates.
 *
 * The four certificate looks used to be a hardcoded `THEMES` object inside
 * certificate.controller.js — changing a colour or a headline meant editing
 * code and redeploying. They now live in `certificate_templates`, so an admin
 * can retheme certificates, add new designs and pick which one each
 * certificate type uses.
 *
 * A template stores a handful of *primitives* (three accent colours, a
 * background pair, a seal pair and the wording) rather than the ~19 raw CSS
 * strings the renderer needs. `buildTheme()` derives those strings, which is
 * what keeps the admin form small enough to be usable.
 */
const { q, q1, exec } = require('../config/db');

async function ensureColumn(table, column, ddl) {
  const row = await q1(
    'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  );
  if (!Number(row.c)) { await exec(`ALTER TABLE \`${table}\` ${ddl}`); return true; }
  return false;
}

async function ensurePathType(table) {
  const row = await q1(
    'SELECT COLUMN_TYPE AS column_type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=\'cert_type\'',
    [table],
  );
  if (!row || String(row.column_type || '').includes("'path'")) return false;
  await exec(`ALTER TABLE \`${table}\` MODIFY cert_type ENUM('course','quiz','contest','milestone','path') NOT NULL DEFAULT 'course'`);
  return true;
}

/* ---------------------------------------------------------------- colours */

/** '#fbbf24' -> '251,191,36'. Falls back to a neutral grey on bad input. */
function rgbOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '148,163,184';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
const rgba = (hex, alpha) => `rgba(${rgbOf(hex)},${alpha})`;

/* ------------------------------------------------------------ the 4 seeds */

/* Primitives reverse-engineered from the original hardcoded themes, so an
   upgrade leaves existing certificates looking exactly as they did. */
const BUILT_INS = [
  {
    slug: 'gold-course', name: 'Gold — Course Completion', cert_type: 'course',
    headline: 'Certificate of Completion',
    subtitle: 'has successfully completed all modules and lessons of the course',
    recipient_line: 'Awarded to', seal_text: '★ VERIFIED', label: 'Course Completion',
    color_bg_from: '#0f172a', color_bg_to: '#0b1020',
    color_accent: '#fbbf24', color_accent_2: '#fde68a', color_accent_3: '#f59e0b',
    color_seal_from: '#fbbf24', color_seal_to: '#b45309', color_seal_border: '#fde68a',
  },
  {
    slug: 'blue-quiz', name: 'Blue — Quiz Excellence', cert_type: 'quiz',
    headline: 'Certificate of Excellence',
    subtitle: 'by achieving {{score}} in the quiz:',
    recipient_line: 'Presented to', seal_text: '✓ EXCELLENCE', label: 'Quiz Excellence',
    color_bg_from: '#0a1530', color_bg_to: '#070f22',
    color_accent: '#60a5fa', color_accent_2: '#93c5fd', color_accent_3: '#22d3ee',
    color_seal_from: '#60a5fa', color_seal_to: '#1d4ed8', color_seal_border: '#bfdbfe',
  },
  {
    slug: 'red-contest', name: 'Crimson — Contest Champion', cert_type: 'contest',
    headline: 'Certificate of Championship',
    subtitle: 'for outstanding performance in the contest:',
    recipient_line: 'Awarded to', seal_text: '♔ CHAMPION', label: 'Contest Champion',
    color_bg_from: '#1a0b10', color_bg_to: '#0b0508',
    color_accent: '#f87171', color_accent_2: '#fecaca', color_accent_3: '#fb7185',
    color_seal_from: '#f87171', color_seal_to: '#991b1b', color_seal_border: '#fecaca',
  },
  {
    slug: 'green-milestone', name: 'Emerald — Coding Milestone', cert_type: 'milestone',
    headline: 'Coding Milestone',
    subtitle: 'by reaching the milestone {{tier}} on the platform.',
    recipient_line: 'Earned by', seal_text: '⟨/⟩ MASTERED', label: 'Coding Milestone',
    color_bg_from: '#06140f', color_bg_to: '#040b08',
    color_accent: '#4ade80', color_accent_2: '#bbf7d0', color_accent_3: '#22c55e',
    color_seal_from: '#4ade80', color_seal_to: '#166534', color_seal_border: '#bbf7d0',
  },
  {
    slug: 'violet-programme', name: 'Violet — Programme Completion', cert_type: 'path',
    headline: 'Programme Completed',
    subtitle: 'for completing every required course in the programme:',
    recipient_line: 'Awarded to', seal_text: '✓ PATH COMPLETE', label: 'Programme Completion',
    color_bg_from: '#160d2e', color_bg_to: '#0b1020',
    color_accent: '#a78bfa', color_accent_2: '#ddd6fe', color_accent_3: '#818cf8',
    color_seal_from: '#a78bfa', color_seal_to: '#5b21b6', color_seal_border: '#ddd6fe',
  },
];

const CERT_TYPES = ['course', 'quiz', 'contest', 'milestone', 'path'];

const TEXT_FIELDS = ['name', 'headline', 'subtitle', 'recipient_line', 'seal_text', 'label'];
const COLOR_FIELDS = [
  'color_bg_from', 'color_bg_to',
  'color_accent', 'color_accent_2', 'color_accent_3',
  'color_seal_from', 'color_seal_to', 'color_seal_border',
];

/* ------------------------------------------------------------------ schema */

async function ensureSchema() {
  // Durable certificate revocation. Hard-deleting a row let the next
  // leaderboard/progress check simply mint the revoked credential again.
  // Design binding: a certificate keeps the design it was issued with, so
  // editing (or deleting) a template never silently restyles old credentials.
  try {
    await ensureColumn('certificates', 'template_id', 'ADD COLUMN template_id INT NULL AFTER enrollment_id');
    await ensureColumn('certificates', 'design_snapshot', 'ADD COLUMN design_snapshot LONGTEXT NULL AFTER template_id');
  } catch (_) { /* certificates table is created by the base schema */ }
  try {
    await ensureColumn('certificates', 'revoked_at', 'ADD COLUMN revoked_at DATETIME NULL AFTER title');
    await ensureColumn('certificates', 'revoked_by', 'ADD COLUMN revoked_by INT UNSIGNED NULL AFTER revoked_at');
    await ensureColumn('certificates', 'revoke_reason', 'ADD COLUMN revoke_reason VARCHAR(255) NULL AFTER revoked_by');
  } catch (_) { /* certificates table is created by the base schema */ }
  await ensurePathType('certificates');
  await exec(
    `CREATE TABLE IF NOT EXISTS certificate_templates (
       id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
       slug VARCHAR(60) NOT NULL UNIQUE,
       name VARCHAR(120) NOT NULL,
       cert_type ENUM('course','quiz','contest','milestone') NOT NULL DEFAULT 'course',
       headline VARCHAR(120) NOT NULL DEFAULT 'Certificate of Completion',
       subtitle VARCHAR(255) NOT NULL DEFAULT '',
       recipient_line VARCHAR(60) NOT NULL DEFAULT 'Awarded to',
       seal_text VARCHAR(40) NOT NULL DEFAULT 'VERIFIED',
       label VARCHAR(60) NOT NULL DEFAULT '',
       color_bg_from VARCHAR(9) NOT NULL DEFAULT '#0f172a',
       color_bg_to VARCHAR(9) NOT NULL DEFAULT '#0b1020',
       color_accent VARCHAR(9) NOT NULL DEFAULT '#fbbf24',
       color_accent_2 VARCHAR(9) NOT NULL DEFAULT '#fde68a',
       color_accent_3 VARCHAR(9) NOT NULL DEFAULT '#f59e0b',
       color_seal_from VARCHAR(9) NOT NULL DEFAULT '#fbbf24',
       color_seal_to VARCHAR(9) NOT NULL DEFAULT '#b45309',
       color_seal_border VARCHAR(9) NOT NULL DEFAULT '#fde68a',
       is_default TINYINT(1) NOT NULL DEFAULT 0,
       is_active TINYINT(1) NOT NULL DEFAULT 1,
       is_builtin TINYINT(1) NOT NULL DEFAULT 0,
       created_by INT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       KEY idx_ct_type (cert_type, is_default, is_active)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );

  await ensurePathType('certificate_templates');
  // Per-template logo (optional). Printed on the certificate and in the PDF.
  try {
    await ensureColumn('certificate_templates', 'logo_path', 'ADD COLUMN logo_path VARCHAR(255) NULL AFTER label');
  } catch (_) { /* table just created above */ }

  const created = [];
  for (const t of BUILT_INS) {
    const existing = await q1('SELECT id FROM certificate_templates WHERE slug = ?', [t.slug]);
    if (existing) continue;
    const cols = ['slug', 'cert_type', ...TEXT_FIELDS, ...COLOR_FIELDS, 'is_default', 'is_active', 'is_builtin'];
    const values = cols.map((c) => {
      if (c === 'is_default' || c === 'is_active' || c === 'is_builtin') return 1;
      return t[c];
    });
    await exec(
      `INSERT INTO certificate_templates (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      values,
    );
    created.push(t.slug);
  }
  if (created.length) console.log(`[certificates] built-in templates seeded: ${created.join(', ')}`);
  return created;
}

/* ------------------------------------------------------- template -> theme */

/**
 * Turns the stored primitives into the exact CSS strings the certificate
 * renderer expects. Keeping this shape identical to the old hardcoded object
 * is what let the renderer stay untouched.
 */
const safeColor = (value, fallback) => (/^#[0-9a-f]{6}$/i.test(String(value || '').trim())
  ? String(value).trim().toLowerCase() : fallback);

function buildTheme(t) {
  const a = safeColor(t.color_accent, '#fbbf24');
  const a2 = safeColor(t.color_accent_2, '#fde68a');
  const a3 = safeColor(t.color_accent_3, '#f59e0b');
  return {
    bg: `linear-gradient(135deg,${safeColor(t.color_bg_from, '#0f172a')},${safeColor(t.color_bg_to, '#0b1020')})`,
    glow: `radial-gradient(500px 260px at 10% 0%,${rgba(a, 0.24)},transparent 70%),`
      + `radial-gradient(500px 260px at 90% 100%,${rgba(a3, 0.2)},transparent 70%),`
      + `radial-gradient(300px 200px at 90% 0%,${rgba(a2, 0.16)},transparent 70%)`,
    corner1: rgba(a2, 0.55),
    corner2: rgba(a3, 0.55),
    corner3: rgba(a3, 0.55),
    corner4: rgba(a2, 0.55),
    brandGradient: `linear-gradient(90deg,${a2},${a3})`,
    titleGradient: `linear-gradient(180deg,#fff,${a2})`,
    recipientGradient: `linear-gradient(90deg,${a2},${a3})`,
    accent: a,
    accentSoft: rgba(a, 0.12),
    accentBorder: rgba(a, 0.35),
    sealText: t.seal_text,
    sealColor: `radial-gradient(circle,${rgba(t.color_seal_from, 0.98)},${safeColor(t.color_seal_to, '#b45309')})`,
    sealBorder: safeColor(t.color_seal_border, '#fde68a'),
    eyebrow: a,
    statAccent: a,
    headline: t.headline,
    subtitle: t.subtitle,
    recipientLine: t.recipient_line,
    label: t.label,
    logo: t.logo_path || null,
    templateId: t.id || null,
    templateName: t.name || null,
    // raw primitives — the PDF renderer cannot use CSS strings
    pdfBgFrom: safeColor(t.color_bg_from, '#0f172a'),
    pdfBgTo: safeColor(t.color_bg_to, '#0b1020'),
    pdfAccent: a,
    pdfAccent2: a2,
    pdfAccent3: a3,
    pdfSealFrom: safeColor(t.color_seal_from, '#fbbf24'),
    pdfSealTo: safeColor(t.color_seal_to, '#b45309'),
    pdfSealBorder: safeColor(t.color_seal_border, '#fde68a'),
  };
}

/** Hardcoded last resort if the table is empty or unreachable. */
function fallbackTheme(certType) {
  const seed = BUILT_INS.find((b) => b.cert_type === certType) || BUILT_INS[0];
  return buildTheme(seed);
}

/**
 * The template ROW a certificate of `certType` should use: the one flagged
 * default for that type, else any active one, else null (built-in fallback).
 */
async function resolveTemplateRow(certType, templateId = null) {
  try {
    if (templateId) {
      const forced = await q1('SELECT * FROM certificate_templates WHERE id = ?', [templateId]);
      if (forced) return forced;
    }
    return await q1(
      `SELECT * FROM certificate_templates
        WHERE cert_type = ? AND is_active = 1
        ORDER BY is_default DESC, id ASC LIMIT 1`, [certType],
    ) || null;
  } catch (_) {
    return null; // table missing on a half-migrated install
  }
}

/**
 * The template a certificate of `certType` should be rendered with: the one
 * flagged default for that type, else any active one for that type, else the
 * built-in. `templateId` forces a specific row (used by the admin preview).
 */
async function resolveTheme(certType, templateId = null) {
  const row = await resolveTemplateRow(certType, templateId);
  return row ? buildTheme(row) : fallbackTheme(certType);
}

/**
 * Freeze the design at issue time.
 *
 * Before this, `certificates` had no reference to a template: every render
 * resolved "whatever is the default right now". Editing a colour therefore
 * restyled every certificate ever issued — including already-printed ones —
 * and deleting a template silently moved old credentials to another design.
 * The snapshot below travels with the row, so an old certificate always
 * renders with the design it was awarded under.
 */
async function snapshotFor(certType, { templateId = null } = {}) {
  const row = await resolveTemplateRow(certType, templateId);
  if (!row) return { template_id: null, design_snapshot: null, theme: fallbackTheme(certType) };
  return { template_id: row.id, design_snapshot: JSON.stringify(row), theme: buildTheme(row) };
}

/** Theme for an already-issued certificate: snapshot first, live lookup after. */
async function themeForCertificate(cert) {
  const raw = cert && cert.design_snapshot;
  if (raw) {
    try {
      const snap = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (snap && snap.headline) {
        const theme = buildTheme(snap);
        // Exception to the freeze: the LOGO is identity, not styling. If an
        // admin uploads or replaces a logo after issue, already-issued
        // certificates should show it too (a wrong logo must be fixable
        // without reissuing). The bound template is still what supplies it.
        try {
          const t = cert.template_id
            ? await q1('SELECT logo_path FROM certificate_templates WHERE id = ?', [cert.template_id])
            : null;
          if (t) theme.logo = t.logo_path || null;
        } catch (_) { /* keep the snapshotted logo */ }
        return theme;
      }
    } catch (_) { /* corrupt snapshot → fall through to the live template */ }
  }
  return resolveTheme(cert && cert.cert_type);
}

/** Admin helper: how many certificates are still on the live (un-bound) design. */
async function unboundCount() {
  try {
    const row = await q1('SELECT COUNT(*) AS n FROM certificates WHERE design_snapshot IS NULL');
    return Number(row.n) || 0;
  } catch (_) { return 0; }
}

/** Only one default per certificate type. */
async function setDefault(id) {
  const row = await q1('SELECT id, cert_type FROM certificate_templates WHERE id = ?', [id]);
  if (!row) return null;
  await exec('UPDATE certificate_templates SET is_default = 0 WHERE cert_type = ?', [row.cert_type]);
  await exec('UPDATE certificate_templates SET is_default = 1, is_active = 1 WHERE id = ?', [id]);
  return row;
}

async function list() {
  return q('SELECT * FROM certificate_templates ORDER BY cert_type, is_default DESC, name');
}

const SUBTITLE_TOKENS = ['student', 'title', 'score', 'grade', 'tier', 'date', 'duration', 'certificate_no'];

module.exports = {
  SUBTITLE_TOKENS,
  ensureSchema, buildTheme, resolveTheme, resolveTemplateRow, snapshotFor,
  themeForCertificate, unboundCount, fallbackTheme, setDefault, list,
  BUILT_INS, CERT_TYPES, TEXT_FIELDS, COLOR_FIELDS, rgba, safeColor,
};
