'use strict';
/** Admin endpoints for managing certificates across all users. */
const { q, q1, exec } = require('../config/db');
const { asyncHandler, ok, ApiError } = require('../utils/helpers');
const crypto = require('crypto');

/**
 * One filter builder for the list, the counts and the CSV export, so an export
 * can never contain a different set of rows than the screen it was taken from.
 *   search, type, status (active|revoked|all), from, to (YYYY-MM-DD), course
 */
function buildFilters(query = {}) {
  const { search = '', type = '', status = 'all', from = '', to = '', course = '' } = query;
  const params = [];
  let where = 'WHERE 1=1';
  if (type && ['course', 'quiz', 'contest', 'milestone', 'path'].includes(type)) {
    where += ' AND c.cert_type = ?'; params.push(type);
  }
  if (status === 'active') where += ' AND c.revoked_at IS NULL';
  if (status === 'revoked') where += ' AND c.revoked_at IS NOT NULL';
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where += ' AND DATE(c.issued_at) >= ?'; params.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where += ' AND DATE(c.issued_at) <= ?'; params.push(to); }
  if (course && Number.isFinite(Number(course))) { where += ' AND c.course_id = ?'; params.push(Number(course)); }
  if (search && search.trim()) {
    where += ' AND (u.full_name LIKE ? OR u.email LIKE ? OR c.certificate_no LIKE ? OR COALESCE(c.title, co.title, z.title, cs.title) LIKE ?)';
    const s = `%${search.trim()}%`; params.push(s, s, s, s);
  }
  return { where, params };
}

const LIST_JOINS = `LEFT JOIN courses co ON co.id = c.course_id
     LEFT JOIN quizzes z ON z.id = c.context_id AND c.cert_type='quiz'
     LEFT JOIN contests cs ON cs.id = c.context_id AND c.cert_type='contest'`;

/** GET /api/admin/certificates?search=&type=&status=&from=&to=&course=&page=1&limit=20 */
const listAll = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(100, Math.max(1, Number(limit) || 20));
  const off = (p - 1) * l;
  const { where, params } = buildFilters(req.query);
  const rows = await q(
    `SELECT c.id, c.certificate_no, c.public_token, c.cert_type, c.grade, c.tier, c.score_percent, c.issued_at, c.title,
       c.revoked_at, c.revoked_by, c.revoke_reason,
       c.user_id, u.full_name AS student_name, u.email AS student_email, u.college,
       COALESCE(c.title, co.title, z.title, cs.title) AS display_title,
       co.title AS course_title, z.title AS quiz_title, cs.title AS contest_title
     FROM certificates c
     JOIN users u ON u.id = c.user_id
     LEFT JOIN courses co ON co.id = c.course_id
     LEFT JOIN quizzes z ON z.id = c.context_id AND c.cert_type='quiz'
     LEFT JOIN contests cs ON cs.id = c.context_id AND c.cert_type='contest'
     ${where}
     ORDER BY c.issued_at DESC
     LIMIT ? OFFSET ?`, [...params, l, off]
  );
  const [{ total }] = await q(
    `SELECT COUNT(*) AS total FROM certificates c
     JOIN users u ON u.id = c.user_id
     LEFT JOIN courses co ON co.id = c.course_id
     LEFT JOIN quizzes z ON z.id = c.context_id AND c.cert_type='quiz'
     LEFT JOIN contests cs ON cs.id = c.context_id AND c.cert_type='contest'
     ${where}`, params
  );
  ok(res, { rows, total: Number(total), page: p, pages: Math.ceil(total / l) });
});

/** GET /api/admin/certificates/stats */
const stats = asyncHandler(async (req, res) => {
  const total = await q1('SELECT COUNT(*) AS n, SUM(revoked_at IS NOT NULL) AS revoked FROM certificates');
  const byType = await q(`SELECT cert_type, COUNT(*) AS n FROM certificates GROUP BY cert_type`);
  const byGrade = await q(`SELECT grade, COUNT(*) AS n FROM certificates GROUP BY grade ORDER BY grade`);
  const recent = await q(
    `SELECT c.*, u.full_name AS student_name, COALESCE(c.title, co.title, z.title, cs.title) AS display_title
     FROM certificates c JOIN users u ON u.id=c.user_id
     LEFT JOIN courses co ON co.id=c.course_id
     LEFT JOIN quizzes z ON z.id=c.context_id AND c.cert_type='quiz'
     LEFT JOIN contests cs ON cs.id=c.context_id AND c.cert_type='contest'
     ORDER BY c.issued_at DESC LIMIT 5`
  );
  ok(res, { total: Number(total.n), revoked: Number(total.revoked || 0), active: Number(total.n) - Number(total.revoked || 0), byType, byGrade, recent });
});

/**
 * DELETE /api/admin/certificates/:id — durable (soft) revoke.
 * Body or query: { reason }. A revocation used to be irreversible from the UI
 * (and stored no reason), which is why `restore` exists below.
 */
const revoke = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await q1('SELECT id, revoked_at FROM certificates WHERE id=?', [id]);
  if (!existing) throw ApiError.notFound('Certificate not found');
  if (existing.revoked_at) return ok(res, { revoked: true, already: true });
  const reason = String(req.body?.reason || req.query.reason || '').trim().slice(0, 255) || null;
  const result = await exec(
    `UPDATE certificates
        SET revoked_at = NOW(), revoked_by = ?, revoke_reason = ?
      WHERE id = ? AND revoked_at IS NULL`,
    [req.user.id, reason, id],
  );
  ok(res, { revoked: true, already: Number(result.affectedRows) !== 1 });
});

/**
 * GET /api/admin/certificates/export.csv — the filtered list as CSV.
 *
 * Excel opens a UTF-8 CSV as mojibake unless it starts with a BOM, and a value
 * beginning with =, +, - or @ is executed as a formula, so both are handled.
 */
const exportCsv = asyncHandler(async (req, res) => {
  const { where, params } = buildFilters(req.query);
  const rows = await q(
    `SELECT c.certificate_no, c.cert_type, c.grade, c.tier, c.score_percent, c.issued_at,
            c.revoked_at, c.revoke_reason, c.public_token,
            u.full_name AS student_name, u.email AS student_email, u.college,
            COALESCE(c.title, co.title, z.title, cs.title) AS display_title
       FROM certificates c
       JOIN users u ON u.id = c.user_id
       ${LIST_JOINS}
       ${where}
       ORDER BY c.issued_at DESC
       LIMIT 20000`, params,
  );
  const header = ['Certificate No', 'Type', 'Student', 'Email', 'College', 'Title',
    'Grade', 'Tier', 'Score %', 'Issued', 'Status', 'Revoke reason', 'Verify URL'];
  const origin = (process.env.CLIENT_URL || '').replace(/\/+$/, '');
  const cell = (value) => {
    let v = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@]/.test(v)) v = `'${v}`;            // CSV formula injection guard
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.certificate_no, r.cert_type, r.student_name, r.student_email, r.college, r.display_title,
      r.grade, r.tier, r.score_percent,
      r.issued_at ? new Date(r.issued_at).toISOString().slice(0, 10) : '',
      r.revoked_at ? 'Revoked' : 'Active', r.revoke_reason || '',
      r.public_token ? `${origin}/cert/${r.public_token}` : '',
    ].map(cell).join(','));
  }
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="certificates-${stamp}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(`\uFEFF${lines.join('\r\n')}\r\n`);
});

/** POST /api/admin/certificates/:id/restore — undo a revocation */
const reissue = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const c = await q1('SELECT id, certificate_no, revoked_at FROM certificates WHERE id=?', [id]);
  if (!c) throw ApiError.notFound('Certificate not found');
  if (c.revoked_at) throw ApiError.badRequest('A revoked certificate cannot be reissued');
  const publicToken = crypto.randomBytes(18).toString('hex');
  await exec(
    'UPDATE certificates SET public_token=? WHERE id=? AND revoked_at IS NULL',
    [publicToken, id],
  );
  ok(res, { reissued: true, public_token: publicToken, certificate_no: c.certificate_no });
});

/**
 * POST /api/admin/certificates/:id/restore — bring a revoked certificate back.
 *
 * The row was never deleted (revocation is a tombstone, by design, so nothing
 * silently re-issues), so restoring is just clearing the tombstone. The public
 * token and certificate number stay the same: a link that was shared before
 * the revocation works again, which is what "undo" has to mean.
 */
const restore = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await q1('SELECT id, revoked_at, certificate_no FROM certificates WHERE id=?', [id]);
  if (!existing) throw ApiError.notFound('Certificate not found');
  if (!existing.revoked_at) return ok(res, { restored: true, already: true, certificate_no: existing.certificate_no });
  await exec(
    'UPDATE certificates SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE id = ? AND revoked_at IS NOT NULL',
    [id],
  );
  ok(res, { restored: true, already: false, certificate_no: existing.certificate_no });
});

module.exports = { listAll, stats, revoke, reissue, restore, exportCsv };
