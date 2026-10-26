'use strict';
/**
 * Generic, SQL-injection-safe CRUD handlers for simple admin resources
 * (categories, modules, lessons, achievements, notifications, test cases, users...).
 * Column names are validated against a whitelist, values are always parameterised.
 */
const { q, q1, exec } = require('../config/db');
const { ApiError, asyncHandler, ok, created, parsePagination } = require('./helpers');

function pick(body, fields) {
  const out = {};
  for (const f of Object.keys(fields)) {
    if (body[f] !== undefined) out[f] = body[f];
  }
  return out;
}

function makeCrud({ table, fields, orderBy = 'id DESC', searchable = [], publicWhere = null, slugFrom = null }) {
  const cols = Object.keys(fields);

  const list = asyncHandler(async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const where = [];
    const params = [];
    if (publicWhere && !(req.user && ['owner', 'admin', 'developer'].includes(req.user.role))) {
      where.push(publicWhere);
    }
    for (const f of Object.keys(fields)) {
      if (req.query[f] !== undefined && req.query[f] !== '') { where.push(`${f} = ?`); params.push(req.query[f]); }
    }
    if (req.query.search && searchable.length) {
      where.push(`(${searchable.map((s) => `${s} LIKE ?`).join(' OR ')})`);
      searchable.forEach(() => params.push(`%${req.query.search}%`));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await q(`SELECT * FROM \`${table}\` ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const [{ total }] = await q(`SELECT COUNT(*) AS total FROM \`${table}\` ${whereSql}`, params);
    ok(res, rows, { page, limit, total, pages: Math.ceil(total / limit) });
  });

  const get = asyncHandler(async (req, res) => {
    const row = await q1(`SELECT * FROM \`${table}\` WHERE id = ?`, [req.params.id]);
    if (!row) throw ApiError.notFound();
    ok(res, row);
  });

  const create = asyncHandler(async (req, res) => {
    const data = pick(req.body, fields);
    if (slugFrom && !data.slug) data.slug = require('./helpers').slugify(data[slugFrom]);
    if (!Object.keys(data).length) throw ApiError.badRequest('No valid fields provided');
    const keys = Object.keys(data);
    const result = await exec(
      `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => data[k]),
    );
    const row = await q1(`SELECT * FROM \`${table}\` WHERE id = ?`, [result.insertId]);
    created(res, row);
  });

  const update = asyncHandler(async (req, res) => {
    const data = pick(req.body, fields);
    if (!Object.keys(data).length) throw ApiError.badRequest('No valid fields provided');
    const existing = await q1(`SELECT id FROM \`${table}\` WHERE id = ?`, [req.params.id]);
    if (!existing) throw ApiError.notFound();
    const keys = Object.keys(data);
    await exec(
      `UPDATE \`${table}\` SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`,
      [...keys.map((k) => data[k]), req.params.id],
    );
    const row = await q1(`SELECT * FROM \`${table}\` WHERE id = ?`, [req.params.id]);
    ok(res, row);
  });

  const remove = asyncHandler(async (req, res) => {
    const existing = await q1(`SELECT id FROM \`${table}\` WHERE id = ?`, [req.params.id]);
    if (!existing) throw ApiError.notFound();
    await exec(`DELETE FROM \`${table}\` WHERE id = ?`, [req.params.id]);
    res.json({ success: true, data: { id: Number(req.params.id), deleted: true } });
  });

  return { list, get, create, update, remove, cols };
}

module.exports = { makeCrud };
