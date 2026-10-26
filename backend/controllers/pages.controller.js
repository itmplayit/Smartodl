'use strict';
/** Public reads + admin CRUD for the site information pages. */
const { q, q1, exec } = require('../config/db');
const { asyncHandler, ok, created, noContent, ApiError, slugify } = require('../utils/helpers');
const pages = require('../services/sitePages.service');

/* ----------------------------------------------------------------- public */

/** Slim list used to build the footer and the help index. */
const listPublic = asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT slug, title, eyebrow, summary, page_type, footer_group, sort_order
       FROM site_pages WHERE is_published = 1 ORDER BY sort_order, title`,
  );
  const values = await pages.tokenValues();
  ok(res, rows.map((r) => ({
    slug: r.slug,
    title: pages.expand(r.title, values),
    eyebrow: pages.expand(r.eyebrow, values),
    summary: pages.expand(r.summary, values),
    page_type: r.page_type,
    footer_group: r.footer_group,
  })));
});

const getPublic = asyncHandler(async (req, res) => {
  const row = await q1('SELECT * FROM site_pages WHERE slug = ? AND is_published = 1', [req.params.slug]);
  if (!row) throw ApiError.notFound('Page not found');
  ok(res, pages.expandPage(row, await pages.tokenValues()));
});

/* ------------------------------------------------------------------ admin */

const listAdmin = asyncHandler(async (req, res) => {
  const rows = await q('SELECT * FROM site_pages ORDER BY sort_order, title');
  ok(res, {
    pages: rows.map((r) => ({ ...r, body: pages.parseBody(r) })),
    page_types: pages.PAGE_TYPES,
    footer_groups: pages.FOOTER_GROUPS,
    tokens: pages.TOKEN_KEYS,
  });
});

const getAdmin = asyncHandler(async (req, res) => {
  const row = await q1('SELECT * FROM site_pages WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Page not found');
  ok(res, { ...row, body: pages.parseBody(row) });
});

/** Rejects anything that would render as an empty or malformed page. */
function cleanBody(body, pageType) {
  if (!Array.isArray(body)) throw ApiError.badRequest('Page body must be a list of sections');
  if (!body.length) throw ApiError.badRequest('Add at least one section');

  if (pageType === 'faq') {
    return body.map((sec, i) => {
      const category = String(sec?.category ?? '').trim();
      if (!category) throw ApiError.badRequest(`Section ${i + 1} needs a category name`);
      const items = Array.isArray(sec.items) ? sec.items : [];
      if (!items.length) throw ApiError.badRequest(`“${category}” needs at least one question`);
      return {
        category: category.slice(0, 120),
        items: items.map((it, j) => {
          const question = String(it?.q ?? '').trim();
          const answer = String(it?.a ?? '').trim();
          if (!question) throw ApiError.badRequest(`Question ${j + 1} in “${category}” is empty`);
          if (!answer) throw ApiError.badRequest(`“${question.slice(0, 40)}” has no answer`);
          return { q: question.slice(0, 300), a: answer.slice(0, 4000) };
        }),
      };
    });
  }

  return body.map((sec, i) => {
    const heading = String(sec?.heading ?? '').trim();
    const text = String(sec?.text ?? '').trim();
    if (!heading) throw ApiError.badRequest(`Section ${i + 1} needs a heading`);
    if (!text) throw ApiError.badRequest(`“${heading}” has no text`);
    return { heading: heading.slice(0, 160), text: text.slice(0, 6000) };
  });
}

function cleanMeta(body, { partial = false } = {}) {
  const out = {};
  const str = (key, max, required) => {
    if (body[key] === undefined) {
      if (partial || !required) return;
      throw ApiError.badRequest(`${key.replace(/_/g, ' ')} is required`);
    }
    const v = String(body[key] ?? '').trim();
    if (required && !v) throw ApiError.badRequest(`${key.replace(/_/g, ' ')} cannot be empty`);
    if (v.length > max) throw ApiError.badRequest(`${key.replace(/_/g, ' ')} must be ${max} characters or fewer`);
    out[key] = v;
  };
  str('title', 160, true);
  str('eyebrow', 80, false);
  str('summary', 400, false);

  if (body.page_type !== undefined) {
    if (!pages.PAGE_TYPES.includes(body.page_type)) throw ApiError.badRequest(`Page type must be one of: ${pages.PAGE_TYPES.join(', ')}`);
    out.page_type = body.page_type;
  } else if (!partial) out.page_type = 'legal';

  if (body.footer_group !== undefined) {
    if (!pages.FOOTER_GROUPS.includes(body.footer_group)) throw ApiError.badRequest(`Footer group must be one of: ${pages.FOOTER_GROUPS.join(', ')}`);
    out.footer_group = body.footer_group;
  }
  if (body.sort_order !== undefined) {
    const n = Number(body.sort_order);
    if (!Number.isFinite(n) || n < 0 || n > 9999) throw ApiError.badRequest('Sort order must be between 0 and 9999');
    out.sort_order = Math.round(n);
  }
  if (body.is_published !== undefined) out.is_published = body.is_published ? 1 : 0;
  return out;
}

async function uniqueSlug(base, ignoreId = null) {
  const root = (slugify(base) || 'page').slice(0, 50);
  for (let i = 0; i < 60; i += 1) {
    const candidate = i ? `${root}-${i + 1}` : root;
    const clash = await q1('SELECT id FROM site_pages WHERE slug = ?', [candidate]);
    if (!clash || clash.id === ignoreId) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

const createPage = asyncHandler(async (req, res) => {
  const meta = cleanMeta(req.body || {});
  const body = cleanBody(req.body?.body, meta.page_type);
  const slug = await uniqueSlug(req.body?.slug || meta.title);
  const r = await exec(
    `INSERT INTO site_pages (slug, title, eyebrow, summary, page_type, body, footer_group, sort_order, is_published, is_builtin, updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,0,?)`,
    [slug, meta.title, meta.eyebrow || '', meta.summary || '', meta.page_type, JSON.stringify(body),
      meta.footer_group || 'legal', meta.sort_order ?? 100, meta.is_published ?? 1, req.user.id],
  );
  created(res, { ...(await q1('SELECT * FROM site_pages WHERE id = ?', [r.insertId])), body });
});

const updatePage = asyncHandler(async (req, res) => {
  const row = await q1('SELECT * FROM site_pages WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Page not found');

  const meta = cleanMeta(req.body || {}, { partial: true });
  const type = meta.page_type || row.page_type;
  const patch = { ...meta };
  if (req.body?.body !== undefined) patch.body = JSON.stringify(cleanBody(req.body.body, type));
  // A built-in slug is wired into the router and the footer; renaming it would
  // 404 every existing link to the page.
  if (req.body?.slug !== undefined && !row.is_builtin) {
    patch.slug = await uniqueSlug(req.body.slug, row.id);
  }
  if (!Object.keys(patch).length) throw ApiError.badRequest('Nothing to update');
  patch.updated_by = req.user.id;

  const cols = Object.keys(patch);
  await exec(`UPDATE site_pages SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map((c) => patch[c]), row.id]);
  const fresh = await q1('SELECT * FROM site_pages WHERE id = ?', [row.id]);
  ok(res, { ...fresh, body: pages.parseBody(fresh) });
});

const removePage = asyncHandler(async (req, res) => {
  const row = await q1('SELECT id, is_builtin FROM site_pages WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Page not found');
  if (row.is_builtin) throw ApiError.badRequest('Built-in pages cannot be deleted — unpublish it instead');
  await exec('DELETE FROM site_pages WHERE id = ?', [row.id]);
  noContent(res);
});

/** Puts a built-in page back to the wording it shipped with. */
const resetPage = asyncHandler(async (req, res) => {
  const row = await q1('SELECT * FROM site_pages WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Page not found');
  const seed = pages.SEED.find((p) => p.slug === row.slug);
  if (!seed) throw ApiError.badRequest('This page has no shipped version to restore');
  await exec(
    `UPDATE site_pages SET title = ?, eyebrow = ?, summary = ?, page_type = ?, body = ?,
            footer_group = ?, sort_order = ?, updated_by = ? WHERE id = ?`,
    [seed.title, seed.eyebrow, seed.summary, seed.page_type, JSON.stringify(seed.body),
      seed.footer_group, seed.sort_order, req.user.id, row.id],
  );
  const fresh = await q1('SELECT * FROM site_pages WHERE id = ?', [row.id]);
  ok(res, { ...fresh, body: pages.parseBody(fresh) });
});

module.exports = { listPublic, getPublic, listAdmin, getAdmin, createPage, updatePage, removePage, resetPage };
