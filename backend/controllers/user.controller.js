'use strict';
const bcrypt = require('bcryptjs');
const path = require('path');
const { q, q1, exec, tx } = require('../config/db');
const { notify } = require('../services/notification.service');
const { ApiError, asyncHandler, ok, created, parsePagination, safeExternalUrl } = require('../utils/helpers');
const { publicUrl } = require('../middleware/upload');
const { isAdminRole } = require('../middleware/auth');

const MANAGEABLE_ROLES = ['student', 'developer', 'admin'];
const OWNER_PROTECTED_MESSAGE = 'The Owner account is protected and cannot be changed through user management';

function assertStrongPassword(password) {
  // policy: minimum 10 characters (kept in sync with auth.controller)
  if (typeof password !== 'string' || password.length < 10 || Buffer.byteLength(password, 'utf8') > 72) {
    throw ApiError.badRequest('The password must be at least 10 characters long (maximum 72 bytes)');
  }
}

const USER_COLUMNS = `u.id, u.full_name, u.email, u.avatar, u.college, u.bio, u.github_url, u.linkedin_url,
  u.provider, u.status, u.email_verified, u.points, u.problems_solved, u.quizzes_completed,
  u.courses_completed, u.streak_days, u.last_login_at, u.created_at, r.slug AS role, r.name AS role_name`;

/** GET /api/users  (admin) with filters */
const list = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const where = [], params = [];
  if (req.query.role) { where.push('r.slug = ?'); params.push(req.query.role); }
  if (req.query.status) { where.push('u.status = ?'); params.push(req.query.status); }
  if (req.query.search) { where.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.college LIKE ?)'); params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`); }
  // Exact college match (case- and space-insensitive), used by the Colleges members view.
  if (req.query.college) { where.push("LOWER(REPLACE(TRIM(u.college), ' ', '')) = LOWER(REPLACE(TRIM(?), ' ', ''))"); params.push(String(req.query.college).trim()); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await q(
    `SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id ${whereSql} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [{ total }] = await q(`SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id ${whereSql}`, params);
  ok(res, rows, { page, limit, total, pages: Math.ceil(total / limit) });
});

/** GET /api/users/:id */
const getOne = asyncHandler(async (req, res) => {
  /* This returns the full administrative record — email, college, bio, last
   * login, plus the person's enrolments, submissions and quiz attempts. The
   * route sat on bare `authenticate` while every neighbouring /users/:id route
   * is admin-only, so any logged-in student could walk ids 1..n and harvest
   * every account's email address and activity, including every admin's.
   * Restricted to admins, or the person themselves. */
  const isSelf = Number(req.params.id) === Number(req.user.id);
  const isAdmin = ['owner', 'admin'].includes(req.user.role);
  if (!isSelf && !isAdmin) throw ApiError.forbidden('You can only view your own profile');

  const user = await q1(`SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [req.params.id]);
  if (!user) throw ApiError.notFound('User not found');
  const [enrollments, submissions, quizzes, achievements] = await Promise.all([
    q('SELECT e.*, c.title AS course_title FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = ?', [user.id]),
    q('SELECT s.id, s.problem_id, p.title, s.language, s.status, s.score, s.submitted_at FROM coding_submissions s JOIN coding_problems p ON p.id = s.problem_id WHERE s.user_id = ? ORDER BY s.submitted_at DESC LIMIT 25', [user.id]),
    q('SELECT qa.id, qa.quiz_id, z.title, qa.score, qa.total_marks, qa.accuracy, qa.rank_position, qa.status FROM quiz_attempts qa JOIN quizzes z ON z.id = qa.quiz_id WHERE qa.user_id = ? ORDER BY qa.started_at DESC LIMIT 25', [user.id]),
    q('SELECT a.* FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id WHERE ua.user_id = ?', [user.id]),
  ]);
  ok(res, { ...user, enrollments, submissions, quiz_attempts: quizzes, achievements });
});

/** PATCH /api/users/me — profile update */
const updateMe = asyncHandler(async (req, res) => {
  const allowed = ['full_name', 'college', 'bio', 'github_url', 'linkedin_url'];
  const data = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) data[k] = String(req.body[k] || '').trim(); });
  if (!Object.keys(data).length) throw ApiError.badRequest('Nothing to update');
  if (data.full_name !== undefined && (data.full_name.length < 2 || data.full_name.length > 120)) throw ApiError.badRequest('Full name must be between 2 and 120 characters');
  if (data.college && data.college.length > 160) throw ApiError.badRequest('College name is too long');
  if (data.bio && data.bio.length > 500) throw ApiError.badRequest('Bio is too long');
  for (const key of ['github_url', 'linkedin_url']) {
    if (data[key] !== undefined) {
      data[key] = safeExternalUrl(data[key], { label: key, httpsOnly: true }) || '';
    }
  }
  const keys = Object.keys(data);
  await exec(`UPDATE users SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), req.user.id]);
  ok(res, await q1(`SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [req.user.id]));
});

/** POST /api/users/me/avatar (multipart) */
const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No image uploaded');
  const url = publicUrl(req.file);
  await exec('UPDATE users SET avatar = ? WHERE id = ?', [url, req.user.id]);
  ok(res, { avatar: url });
});

/** POST /api/users (Owner/Admin creates a normal managed account; Owner is bootstrap-only) */
const createUser = asyncHandler(async (req, res) => {
  const { password, role = 'student', status = 'active' } = req.body;
  const fullName = String(req.body.full_name || '').trim().replace(/\s+/g, ' ');
  const email = String(req.body.email || '').trim().toLowerCase();
  const college = String(req.body.college || '').trim().slice(0, 160) || null;
  if (fullName.length < 2 || fullName.length > 120) throw ApiError.badRequest('Full name must be between 2 and 120 characters');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) throw ApiError.badRequest('A valid email address is required');
  assertStrongPassword(password);
  if (!['active', 'pending', 'suspended'].includes(status)) throw ApiError.badRequest('Invalid status');
  if (!MANAGEABLE_ROLES.includes(role)) throw ApiError.badRequest('Role must be student, developer, or admin');
  const roleRow = await q1('SELECT id FROM roles WHERE slug = ?', [role]);
  if (!roleRow) throw ApiError.badRequest('Invalid role');
  if (await q1('SELECT id FROM users WHERE email = ?', [email])) throw ApiError.conflict('Email already registered');
  const result = await exec(
    `INSERT INTO users (full_name, email, password_hash, role_id, college, status, email_verified) VALUES (?,?,?,?,?,?,1)`,
    [fullName, email, await bcrypt.hash(password, 12), roleRow.id, college, status],
  );
  created(res, await q1(`SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [result.insertId]));
});

/** PATCH /api/users/:id (Owner/Admin) — role, status, profile; Owner targets are immutable here */
const updateUser = asyncHandler(async (req, res) => {
  const target = await q1(
    'SELECT u.id, r.slug AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?',
    [req.params.id],
  );
  if (!target) throw ApiError.notFound('User not found');
  if (target.role === 'owner') throw ApiError.forbidden(OWNER_PROTECTED_MESSAGE);

  const { full_name, email, role, status, college, bio, points, password } = req.body;
  const fields = {}, params = [];
  // Optional administrator password reset from the edit modal's Reset password field; this was previously ignored silently.
  if (password !== undefined && String(password).trim() !== '') {
    assertStrongPassword(password);
    fields.password_hash = await bcrypt.hash(String(password), 12);
  }
  if (full_name !== undefined) { fields.full_name = full_name; }
  if (email !== undefined) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 160) {
      throw ApiError.badRequest('A valid email address (max 160 characters) is required');
    }
    fields.email = normalized;
  }
  if (college !== undefined) { fields.college = college; }
  if (bio !== undefined) { fields.bio = bio; }
  // `points` is NOT written straight into the column: it is a materialised
  // total that points.service recomputes from scratch, so a direct write is
  // erased by the next submission. Booked as a ledger entry further down.
  const pointsTarget = points === undefined || points === null || points === ''
    ? null : Number(points);
  if (pointsTarget !== null && !Number.isFinite(pointsTarget)) {
    throw ApiError.badRequest('points must be a number');
  }
  if (status !== undefined) {
    if (!['active', 'pending', 'suspended'].includes(status)) throw ApiError.badRequest('Invalid status');
    fields.status = status;
  }
  if (role !== undefined) {
    if (!MANAGEABLE_ROLES.includes(role)) throw ApiError.badRequest('Role must be student, developer, or admin');
    const roleRow = await q1('SELECT id FROM roles WHERE slug = ?', [role]);
    if (!roleRow) throw ApiError.badRequest('Invalid role');
    fields.role_id = roleRow.id;
  }
  const keys = Object.keys(fields);
  if (!keys.length && pointsTarget === null) throw ApiError.badRequest('Nothing to update');
  if (keys.length) {
    keys.forEach((k) => params.push(fields[k]));
    try {
      await exec(`UPDATE users SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...params, req.params.id]);
    } catch (e) {
      // A taken email is a normal collision (register handles it the same way);
      // surfacing the raw ER_DUP_ENTRY as a 500 was just a confusing crash.
      if (e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062)) {
        throw ApiError.conflict('An account with this email already exists');
      }
      throw e;
    }
  }
  if (fields.password_hash) {
    // An admin-initiated reset must also invalidate existing tokens/sessions.
    try { await exec('UPDATE users SET password_changed_at = NOW() WHERE id = ?', [req.params.id]); }
    catch (e) { if (!e || e.code !== 'ER_BAD_FIELD_ERROR') throw e; }
    await exec('UPDATE user_sessions SET revoked = 1 WHERE user_id = ?', [req.params.id]);
  }
  if (pointsTarget !== null) {
    // Land the user exactly on the requested total by booking the difference
    // against the ledger, which every recompute honours.
    const pointsSvc = require('../services/points.service');
    const b = await pointsSvc.computeBreakdown(req.params.id);
    const delta = Math.round(pointsTarget) - Math.round(b.raw);
    if (delta !== 0) {
      await pointsSvc.addAdjustment({
        userId: Number(req.params.id), delta,
        reason: 'Points set from the user editor', actorId: req.user.id,
      });
    }
  }
  ok(res, await q1(`SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [req.params.id]));
});

/** DELETE /api/users/:id (Owner/Admin; protected Owner cannot be deleted) */
const removeUser = asyncHandler(async (req, res) => {
  if (Number(req.params.id) === Number(req.user.id)) throw ApiError.badRequest('You cannot delete your own account');
  const user = await q1(
    'SELECT u.id, r.slug AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?',
    [req.params.id],
  );
  if (!user) throw ApiError.notFound('User not found');
  if (user.role === 'owner') throw ApiError.forbidden(OWNER_PROTECTED_MESSAGE);
  await exec('DELETE FROM users WHERE id = ?', [req.params.id]);
  ok(res, { id: Number(req.params.id), deleted: true });
});

/** GET /api/users/:id/permissions — developer permission matrix */
const getPermissions = asyncHandler(async (req, res) => {
  const permissions = await q('SELECT * FROM permissions ORDER BY group_name, id');
  const granted = await q('SELECT permission_id, allowed FROM user_permissions WHERE user_id = ?', [req.params.id]);
  const map = granted.reduce((acc, g) => { acc[g.permission_id] = !!g.allowed; return acc; }, {});
  ok(res, permissions.map((p) => ({ ...p, allowed: !!map[p.id] })));
});

/** PUT /api/users/:id/permissions (admin) — bulk grant/revoke
 *
 *  Body: { permissions: [{ code|permission_id, allowed }] }   (plain ["code", …] also accepted)
 *
 *  Side effects that make an admin's grant actually usable by the developer:
 *   • a developer still in `pending` is activated as soon as they hold ≥1 permission
 *   • the developer gets an in-app notification naming what was granted/revoked
 *   • the response reports exactly what changed, so the admin UI can show it
 *  The caller's own session picks the change up automatically (the frontend re-reads
 *  /auth/me on focus, on a timer and whenever the API answers 403).
 */
const setPermissions = asyncHandler(async (req, res) => {
  const { permissions } = req.body;
  if (!Array.isArray(permissions)) throw ApiError.badRequest('permissions[] is required');

  const target = await q1(
    `SELECT u.id, u.full_name, u.email, u.status, r.slug AS role
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [req.params.id],
  );
  if (!target) throw ApiError.notFound('User not found');
  if (target.role === 'owner') throw ApiError.forbidden(OWNER_PROTECTED_MESSAGE);

  const all = await q('SELECT id, code FROM permissions');
  const byCode = all.reduce((a, p) => { a[p.code] = p.id; return a; }, {});
  const codeById = all.reduce((a, p) => { a[p.id] = p.code; return a; }, {});

  // ---- normalise the payload: accept {code}, {permission_id} or a bare "code" ----
  const wanted = new Map();                       // permission_id -> allowed
  for (const item of permissions) {
    if (typeof item === 'string') {
      const pid = byCode[item];
      if (pid) wanted.set(pid, true);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const pid = item.permission_id || byCode[item.code];
    if (pid) wanted.set(Number(pid), item.allowed !== false && item.allowed !== 0);
  }
  if (!wanted.size) throw ApiError.badRequest('No valid permission codes in the request');

  const current = await q('SELECT permission_id, allowed FROM user_permissions WHERE user_id = ?', [req.params.id]);
  const before = new Map(current.map((r) => [Number(r.permission_id), !!r.allowed]));

  const granted = [];
  const revoked = [];
  for (const [pid, allowed] of wanted) {
    const was = before.get(pid) || false;
    if (allowed && !was) granted.push(codeById[pid]);
    if (!allowed && was) revoked.push(codeById[pid]);
  }

  // ---- write everything in one transaction so a failure cannot half-apply ----
  await tx(async (conn) => {
    for (const [pid, allowed] of wanted) {
      await conn.query(
        `INSERT INTO user_permissions (user_id, permission_id, allowed) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE allowed = VALUES(allowed)`,
        [req.params.id, pid, allowed ? 1 : 0],
      );
    }
  });

  // ---- a pending developer who can now do something is effectively approved ----
  let approved = false;
  const holdsSomething = [...wanted.values()].some(Boolean);
  if (target.role === 'developer' && target.status === 'pending' && holdsSomething) {
    await exec("UPDATE users SET status = 'active' WHERE id = ? AND status = 'pending'", [req.params.id]);
    approved = true;
  }

  // ---- tell the developer what changed, in plain words ----
  if (granted.length || revoked.length || approved) {
    const parts = [];
    if (granted.length) parts.push(`granted: ${granted.map((c) => c.replace(/_/g, ' ')).join(', ')}`);
    if (revoked.length) parts.push(`revoked: ${revoked.map((c) => c.replace(/_/g, ' ')).join(', ')}`);
    if (approved) parts.push('your developer account is now active');
    await notify({
      userId: target.id,
      title: '🔑 Your permissions were updated',
      message: `An administrator updated your access — ${parts.join(' · ')}. The dashboard has already refreshed.`,
      type: 'system',
      link: '/developer',
      createdBy: req.user && req.user.id,
    }).catch(() => { /* a failed notification must not fail the grant */ });
  }

  const rows = await q(
    `SELECT p.*, up.allowed FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id
      WHERE up.user_id = ? ORDER BY p.group_name, p.id`, [req.params.id],
  );

  ok(res, {
    user_id: Number(req.params.id),
    user: { id: target.id, full_name: target.full_name, email: target.email, role: target.role },
    status: approved ? 'active' : target.status,
    approved,
    granted,
    revoked,
    permissions: rows,
  });
});

/** GET /api/users/me/permissions */
const myPermissions = asyncHandler(async (req, res) => {
  const permissions = await q('SELECT * FROM permissions ORDER BY group_name, id');
  const mine = new Set(req.user.permissions || []);
  ok(res, {
    role: req.user.role,
    all_access: isAdminRole(req.user.role),
    permissions: permissions.map((p) => ({ ...p, allowed: isAdminRole(req.user.role) ? true : mine.has(p.code) })),
  });
});

/** GET /api/admin/colleges — college-wise students/developers counts (admin only).
 *  Only student and developer roles are grouped; administrators and the owner are never listed.
 */
const collegeSummary = asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim();
  const params = [];
  const having = search ? ' HAVING LOWER(grp) LIKE LOWER(?)' : '';
  if (search) params.push(`%${search}%`);
  const rows = await q(
    `SELECT grp AS college, students, developers, total FROM (
       SELECT MIN(TRIM(u.college)) AS grp,
              SUM(CASE WHEN r.slug = 'student' THEN 1 ELSE 0 END) AS students,
              SUM(CASE WHEN r.slug = 'developer' THEN 1 ELSE 0 END) AS developers,
              COUNT(*) AS total
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE r.slug IN ('student', 'developer')
          AND u.college IS NOT NULL AND TRIM(u.college) <> ''
        GROUP BY LOWER(REPLACE(TRIM(u.college), ' ', ''))
     ) t${having} ORDER BY total DESC, grp ASC`,
    params,
  );
  const [unset] = await q(
    `SELECT SUM(CASE WHEN r.slug = 'student' THEN 1 ELSE 0 END) AS students,
            SUM(CASE WHEN r.slug = 'developer' THEN 1 ELSE 0 END) AS developers,
            COUNT(*) AS total
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.slug IN ('student', 'developer')
        AND (u.college IS NULL OR TRIM(u.college) = '')`,
  );
  ok(res, {
    colleges: rows.map((row) => ({
      college: row.college,
      students: Number(row.students), developers: Number(row.developers), total: Number(row.total),
    })),
    unset: { students: Number(unset.students || 0), developers: Number(unset.developers || 0), total: Number(unset.total || 0) },
  });
});

/** GET /api/admin/colleges/members?college=Name (&unset=1 &role=student|developer) */
const collegeMembers = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const base = ["r.slug IN ('student', 'developer')"];
  const baseParams = [];
  if (req.query.unset === '1') {
    base.push("(u.college IS NULL OR TRIM(u.college) = '')");
  } else {
    if (!String(req.query.college || '').trim()) throw ApiError.badRequest('college is required');
    base.push("LOWER(REPLACE(TRIM(u.college), ' ', '')) = LOWER(REPLACE(TRIM(?), ' ', ''))");
    baseParams.push(String(req.query.college).trim());
  }
  const extra = [];
  const extraParams = [];
  if (req.query.role && ['student', 'developer'].includes(req.query.role)) { extra.push('r.slug = ?'); extraParams.push(req.query.role); }
  if (req.query.search) { extra.push('(u.full_name LIKE ? OR u.email LIKE ?)'); extraParams.push(`%${req.query.search}%`, `%${req.query.search}%`); }
  const whereSql = `WHERE ${[...base, ...extra].join(' AND ')}`;
  const rows = await q(
    `SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id ${whereSql}
      ORDER BY r.slug ASC, u.full_name ASC LIMIT ? OFFSET ?`,
    [...baseParams, ...extraParams, limit, offset],
  );
  // header chips role-filter se independent rahen
  const [totals] = await q(
    `SELECT SUM(CASE WHEN r.slug = 'student' THEN 1 ELSE 0 END) AS students,
            SUM(CASE WHEN r.slug = 'developer' THEN 1 ELSE 0 END) AS developers,
            COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id WHERE ${base.join(' AND ')}`,
    baseParams,
  );
  const [filtered] = await q(
    `SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id ${whereSql}`,
    [...baseParams, ...extraParams],
  );
  ok(res, rows, {
    page, limit, total: Number(filtered.total),
    summary: { students: Number(totals.students || 0), developers: Number(totals.developers || 0), total: Number(totals.total || 0) },
  });
});

module.exports = { list, getOne, updateMe, uploadAvatar, createUser, updateUser, removeUser, getPermissions, setPermissions, myPermissions, collegeSummary, collegeMembers, USER_COLUMNS };
