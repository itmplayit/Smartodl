'use strict';
/**
 * Public information pages (FAQ, terms, privacy, refund, cookies …).
 *
 * The content ships as seed data but lives in `site_pages`, because every
 * institution needs its own address, jurisdiction and policy wording. Admins
 * edit them from Admin → Site Pages; nothing here requires a redeploy.
 */
const { q, q1, exec } = require('../config/db');
const SEED = require('./sitePages.seed');

const PAGE_TYPES = ['legal', 'faq'];
const FOOTER_GROUPS = ['legal', 'support', 'none'];

async function ensureSchema() {
  await exec(
    `CREATE TABLE IF NOT EXISTS site_pages (
       id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
       slug VARCHAR(60) NOT NULL UNIQUE,
       title VARCHAR(160) NOT NULL,
       eyebrow VARCHAR(80) NOT NULL DEFAULT '',
       summary VARCHAR(400) NOT NULL DEFAULT '',
       page_type ENUM('legal','faq') NOT NULL DEFAULT 'legal',
       body LONGTEXT NOT NULL,
       footer_group ENUM('legal','support','none') NOT NULL DEFAULT 'legal',
       sort_order INT NOT NULL DEFAULT 100,
       is_published TINYINT(1) NOT NULL DEFAULT 1,
       is_builtin TINYINT(1) NOT NULL DEFAULT 0,
       updated_by INT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       KEY idx_sp_pub (is_published, footer_group, sort_order)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );

  const created = [];
  for (const p of SEED) {
    const existing = await q1('SELECT id FROM site_pages WHERE slug = ?', [p.slug]);
    if (existing) continue;
    await exec(
      `INSERT INTO site_pages (slug, title, eyebrow, summary, page_type, body, footer_group, sort_order, is_published, is_builtin)
       VALUES (?,?,?,?,?,?,?,?,1,1)`,
      [p.slug, p.title, p.eyebrow, p.summary, p.page_type, JSON.stringify(p.body), p.footer_group, p.sort_order],
    );
    created.push(p.slug);
  }
  if (created.length) console.log(`[pages] site pages seeded: ${created.join(', ')}`);
  return created;
}

/** Tolerates a body that is already an array (older rows) or a JSON string. */
function parseBody(row) {
  if (Array.isArray(row.body)) return row.body;
  try {
    const parsed = JSON.parse(row.body || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

/** `{{site_name}}` / `{{contact_email}}` resolved from Website Settings. */
async function tokenValues() {
  const rows = await q(
    "SELECT setting_key AS k, setting_value AS v FROM settings WHERE setting_key IN ('site_name','contact_email','site_tagline','contact_address','contact_phone')",
  );
  const get = (k, dflt) => String((rows.find((r) => r.k === k) || {}).v || '').trim() || dflt;
  return {
    site_name: get('site_name', 'SmartODL'),
    contact_email: get('contact_email', 'the Contact page'),
    site_tagline: get('site_tagline', 'Learn. Code. Compete. Grow.'),
    contact_address: get('contact_address', ''),
    contact_phone: get('contact_phone', ''),
  };
}

const TOKEN_KEYS = ['site_name', 'contact_email', 'site_tagline', 'contact_address', 'contact_phone'];

function expand(text, values) {
  return String(text == null ? '' : text).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) => {
    const k = key.toLowerCase();
    return TOKEN_KEYS.includes(k) ? (values[k] || '') : match;
  });
}

/** Walks a page and expands every token in its text, body included. */
function expandPage(row, values) {
  const body = parseBody(row).map((section) => {
    if (section && Array.isArray(section.items)) {
      return {
        category: expand(section.category, values),
        items: section.items.map((it) => ({ q: expand(it.q, values), a: expand(it.a, values) })),
      };
    }
    return { heading: expand(section?.heading, values), text: expand(section?.text, values) };
  });
  return {
    id: row.id,
    slug: row.slug,
    title: expand(row.title, values),
    eyebrow: expand(row.eyebrow, values),
    summary: expand(row.summary, values),
    page_type: row.page_type,
    footer_group: row.footer_group,
    sort_order: row.sort_order,
    is_published: row.is_published,
    is_builtin: row.is_builtin,
    updated_at: row.updated_at,
    body,
  };
}

module.exports = {
  ensureSchema, parseBody, expandPage, expand, tokenValues,
  PAGE_TYPES, FOOTER_GROUPS, TOKEN_KEYS, SEED,
};
