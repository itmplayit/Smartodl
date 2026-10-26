'use strict';
/** Admin CRUD + live preview for certificate design templates. */
const { q1, exec } = require('../config/db');
const { asyncHandler, ok, created, noContent, ApiError, slugify } = require('../utils/helpers');
const tpl = require('../services/certificateTemplates.service');
const { renderCertificateHtml } = require('./certificate.controller');

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_LEN = {
  name: 120, headline: 120, subtitle: 255, recipient_line: 60, seal_text: 40, label: 60,
};

/** Validates and normalises a template payload. Throws on the first problem. */
function clean(body, { partial = false } = {}) {
  const out = {};

  for (const f of tpl.TEXT_FIELDS) {
    if (body[f] === undefined) {
      if (partial) continue;
      if (f === 'subtitle' || f === 'label') { out[f] = ''; continue; }
      throw ApiError.badRequest(`${f.replace(/_/g, ' ')} is required`);
    }
    const v = String(body[f] ?? '').trim();
    if (!v && (f === 'name' || f === 'headline')) {
      throw ApiError.badRequest(`${f === 'name' ? 'Template name' : 'Headline'} cannot be empty`);
    }
    if (v.length > MAX_LEN[f]) throw ApiError.badRequest(`${f.replace(/_/g, ' ')} must be ${MAX_LEN[f]} characters or fewer`);
    out[f] = v;
  }

  for (const f of tpl.COLOR_FIELDS) {
    if (body[f] === undefined) {
      if (partial) continue;
      throw ApiError.badRequest(`${f.replace(/_/g, ' ')} is required`);
    }
    const v = String(body[f] ?? '').trim();
    if (!HEX.test(v)) throw ApiError.badRequest(`${f.replace(/_/g, ' ')} must be a hex colour like #1a2b3c`);
    out[f] = v.toLowerCase();
  }

  if (body.cert_type !== undefined) {
    if (!tpl.CERT_TYPES.includes(body.cert_type)) {
      throw ApiError.badRequest(`Certificate type must be one of: ${tpl.CERT_TYPES.join(', ')}`);
    }
    out.cert_type = body.cert_type;
  } else if (!partial) {
    throw ApiError.badRequest('Certificate type is required');
  }

  if (body.is_active !== undefined) out.is_active = body.is_active ? 1 : 0;
  return out;
}

async function uniqueSlug(base, ignoreId = null) {
  const root = (slugify(base) || 'template').slice(0, 50);
  for (let i = 0; i < 60; i += 1) {
    const candidate = i ? `${root}-${i + 1}` : root;
    const clash = await q1('SELECT id FROM certificate_templates WHERE slug = ?', [candidate]);
    if (!clash || clash.id === ignoreId) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/* --------------------------------------------------------------- handlers */

const list = asyncHandler(async (req, res) => {
  const rows = await tpl.list();
  ok(res, {
    templates: rows,
    cert_types: tpl.CERT_TYPES,
    fields: { text: tpl.TEXT_FIELDS, color: tpl.COLOR_FIELDS },
  });
});

const getOne = asyncHandler(async (req, res) => {
  const row = await q1('SELECT * FROM certificate_templates WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Template not found');
  ok(res, row);
});

const create = asyncHandler(async (req, res) => {
  const data = clean(req.body || {});
  data.slug = await uniqueSlug(data.name);
  data.created_by = req.user.id;
  const cols = Object.keys(data);
  const r = await exec(
    `INSERT INTO certificate_templates (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    cols.map((c) => data[c]),
  );
  if (req.body?.make_default) await tpl.setDefault(r.insertId);
  created(res, await q1('SELECT * FROM certificate_templates WHERE id = ?', [r.insertId]));
});

const update = asyncHandler(async (req, res) => {
  const row = await q1('SELECT * FROM certificate_templates WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Template not found');

  const data = clean(req.body || {}, { partial: true });
  // A built-in may be restyled, but moving it to another certificate type
  // would silently orphan that type's default.
  if (row.is_builtin && data.cert_type && data.cert_type !== row.cert_type) {
    throw ApiError.badRequest('A built-in template cannot change its certificate type — duplicate it instead');
  }
  if (row.is_default && data.is_active === 0) {
    throw ApiError.badRequest('This is the default template for its type — make another one default first');
  }
  if (!Object.keys(data).length) throw ApiError.badRequest('Nothing to update');

  const cols = Object.keys(data);
  await exec(
    `UPDATE certificate_templates SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map((c) => data[c]), row.id],
  );
  if (req.body?.make_default) await tpl.setDefault(row.id);
  ok(res, await q1('SELECT * FROM certificate_templates WHERE id = ?', [row.id]));
});

const duplicate = asyncHandler(async (req, res) => {
  const row = await q1('SELECT * FROM certificate_templates WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Template not found');

  const data = {};
  for (const f of [...tpl.TEXT_FIELDS, ...tpl.COLOR_FIELDS]) data[f] = row[f];
  data.name = `${row.name} (copy)`.slice(0, 120);
  data.cert_type = row.cert_type;
  data.slug = await uniqueSlug(data.name);
  data.is_active = 1;
  data.is_default = 0;
  data.is_builtin = 0;
  data.created_by = req.user.id;

  const cols = Object.keys(data);
  const r = await exec(
    `INSERT INTO certificate_templates (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    cols.map((c) => data[c]),
  );
  created(res, await q1('SELECT * FROM certificate_templates WHERE id = ?', [r.insertId]));
});

const setDefault = asyncHandler(async (req, res) => {
  const row = await tpl.setDefault(req.params.id);
  if (!row) throw ApiError.notFound('Template not found');
  ok(res, await q1('SELECT * FROM certificate_templates WHERE id = ?', [req.params.id]));
});

const remove = asyncHandler(async (req, res) => {
  const row = await q1('SELECT * FROM certificate_templates WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Template not found');
  if (row.is_builtin) throw ApiError.badRequest('Built-in templates cannot be deleted — deactivate it instead');
  if (row.is_default) throw ApiError.badRequest('Make another template the default for this type first');
  await exec('DELETE FROM certificate_templates WHERE id = ?', [row.id]);
  noContent(res);
});

/* ---------------------------------------------------------------- preview */

/** A believable certificate record so the preview shows real-looking output. */
function sampleCertificate(certType) {
  const meta = tpl.BUILT_INS.find((b) => b.cert_type === certType) || tpl.BUILT_INS[0];
  const titles = {
    course: 'Full Stack Web Development',
    quiz: 'Data Structures — Final Assessment',
    contest: 'Weekly Code Sprint #42',
    milestone: 'Problem Solving Streak',
  };
  return {
    id: 0,
    cert_type: certType,
    display_title: titles[certType] || meta.label,
    course_title: titles.course,
    quiz_title: titles.quiz,
    contest_title: titles.contest,
    description: 'A sample certificate rendered from this template.',
    duration_hours: 42,
    quiz_total_marks: 100,
    student_name: 'Priya Sharma',
    student_email: 'priya@example.com',
    student_college: 'Sample Institute of Technology',
    instructor_name: 'Dr. A. Verma',
    certificate_no: 'SOD-PRV-202601-SAMPLE',
    public_token: 'preview-not-a-real-certificate',
    grade: 'A+',
    tier: certType === 'contest' ? 'champion' : 'excellence',
    score_percent: 94,
    issued_at: new Date(),
  };
}

/**
 * Renders the live preview with the *unsaved* form values when a body is
 * posted, so an admin sees a colour change before committing it.
 */
const preview = asyncHandler(async (req, res) => {
  const body = req.body || {};
  let theme;
  let certType = tpl.CERT_TYPES.includes(body.cert_type) ? body.cert_type : null;

  if (req.params.id && req.params.id !== 'draft') {
    const row = await q1('SELECT * FROM certificate_templates WHERE id = ?', [req.params.id]);
    if (!row) throw ApiError.notFound('Template not found');
    certType = certType || row.cert_type;
    theme = tpl.buildTheme({ ...row, ...clean(body, { partial: true }) });
  } else {
    const seed = tpl.BUILT_INS.find((b) => b.cert_type === (certType || 'course')) || tpl.BUILT_INS[0];
    theme = tpl.buildTheme({ ...seed, ...clean(body, { partial: true }) });
  }

  const html = await renderCertificateHtml(sampleCertificate(certType || 'course'), res, theme, { preview: true });
  res.type('html').send(html);
});

module.exports = { list, getOne, create, update, duplicate, setDefault, remove, preview };
