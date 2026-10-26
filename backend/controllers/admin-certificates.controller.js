'use strict';
/** Admin endpoints for managing certificates across all users. */
const { q, q1, exec } = require('../config/db');
const { asyncHandler, ok, ApiError } = require('../utils/helpers');
const crypto = require('crypto');

/** GET /api/admin/certificates?search=&type=&page=1&limit=20 */
const listAll = asyncHandler(async (req, res) => {
  const { search = '', type = '', page = 1, limit = 20 } = req.query;
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(100, Math.max(1, Number(limit) || 20));
  const off = (p - 1) * l;
  const params = [];
  let where = 'WHERE 1=1';
  if (type && ['course', 'quiz', 'contest', 'milestone'].includes(type)) {
    where += ' AND c.cert_type = ?'; params.push(type);
  }
  if (search && search.trim()) {
    where += ' AND (u.full_name LIKE ? OR u.email LIKE ? OR c.certificate_no LIKE ? OR COALESCE(c.title, co.title, z.title, cs.title) LIKE ?)';
    const s = `%${search.trim()}%`; params.push(s, s, s, s);
  }
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

/** DELETE /api/admin/certificates/:id — durable (soft) revoke */
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

/** POST /api/admin/certificates/:id/reissue — rotate the private print token */
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

module.exports = { listAll, stats, revoke, reissue };
