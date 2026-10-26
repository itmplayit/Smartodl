'use strict';
/**
 * Coding Arena: problems, test cases, online compiler (run), submissions (judge)
 * and contests. Submitted code is executed ONLY by the external judge service.
 */
const crypto = require('crypto');
const { q, q1, exec, tx } = require('../config/db');
const { ApiError, asyncHandler, ok, created, slugify, parsePagination, sorting, assignRanks, fromJson } = require('../utils/helpers');
const judge = require('../services/judge.service');
const aiDetect = require('../services/aiDetection.service');
const antiCheat = require('../services/anticheatSettings.service');
const { recalcUser, awardAchievements } = require('../services/points.service');
const { notify } = require('../services/notification.service');
const events = require('../services/events.service');
const { touchActivity } = require('../services/gamification.service');

const subs = require('../services/subscription.service');

const isAdminUser = (user) => !!user && ['owner', 'admin'].includes(user.role);
const isProblemManager = (user, problem) => isAdminUser(user)
  || !!(user && problem && user.role === 'developer' && Number(problem.created_by) === Number(user.id));
const isContestManager = (user, contest) => isAdminUser(user)
  || !!(user && contest && user.role === 'developer' && Number(contest.created_by) === Number(user.id));

async function validatedCategoryId(value) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw ApiError.badRequest('category_id is invalid');
  const category = await q1('SELECT id FROM categories WHERE id = ?', [id]);
  if (!category) throw ApiError.badRequest('category_id does not exist');
  return id;
}
const spreadsheetLabel = (index) => {
  let n = Number(index) + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label || 'A';
};

const PROBLEM_SELECT = `p.*, cat.name AS category_name, cat.slug AS category_slug, u.full_name AS created_by_name,
  (SELECT COUNT(*) FROM coding_test_cases tc WHERE tc.problem_id = p.id) AS test_cases_count,
  (SELECT COUNT(*) FROM coding_test_cases tc WHERE tc.problem_id = p.id AND tc.is_hidden = 1) AS hidden_test_cases_count`;

/* ------------------------------ problems ------------------------------ */
const listProblems = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const where = [], params = [];
  const isAdmin = isAdminUser(req.user);
  const isDeveloper = !!(req.user && req.user.role === 'developer');
  const isStaff = isAdmin || isDeveloper;
  // Developers are not a blanket "see every draft" role. They see the public
  // catalogue plus their own work; only owner/admin see everyone's drafts.
  if (!isStaff) where.push("p.status = 'published'");
  else if (isDeveloper) {
    where.push("(p.status = 'published' OR p.created_by = ?)");
    params.push(req.user.id);
  }
  if (isStaff && req.query.status) { where.push('p.status = ?'); params.push(req.query.status); }
  if (req.query.difficulty) { where.push('p.difficulty = ?'); params.push(req.query.difficulty); }
  if (req.query.category) { where.push('(cat.slug = ? OR p.category_id = ?)'); params.push(req.query.category, Number(req.query.category) || 0); }
  // tags are stored as a JSON array (LONGTEXT) — a LIKE match on the quoted value is
  // portable across MySQL 5.7 / MariaDB 10.1 where JSON_SEARCH is unavailable.
  if (req.query.tag) { where.push('p.tags LIKE ?'); params.push(`%"${req.query.tag}"%`); }
  if (req.query.search) { where.push('(p.title LIKE ? OR p.description LIKE ?)'); params.push(`%${req.query.search}%`, `%${req.query.search}%`); }
  // Role-scoped management lists (staff only): ?mine=1 returns the developer's own content;
  // ?creator_role=developer|admin|owner applies the admin panel's creator filter.
  if (isStaff && req.query.mine === '1' && req.user) { where.push('p.created_by = ?'); params.push(req.user.id); }
  const creatorRoleFilter = isStaff && ['developer', 'admin', 'owner'].includes(String(req.query.creator_role || '')) ? String(req.query.creator_role) : null;
  if (creatorRoleFilter) { where.push('ur.slug = ?'); params.push(creatorRoleFilter); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { sort, order } = sorting(req.query, ['created_at', 'points', 'acceptance_rate', 'total_submissions', 'title', 'difficulty'], 'created_at');
  const rows = await q(
    `SELECT ${PROBLEM_SELECT}${isStaff ? ', ur.slug AS created_by_role' : ''} FROM coding_problems p
       LEFT JOIN categories cat ON cat.id = p.category_id
       LEFT JOIN users u ON u.id = p.created_by${isStaff ? ' LEFT JOIN roles ur ON ur.id = u.role_id' : ''}
       ${whereSql} ORDER BY p.${sort} ${order} LIMIT ? OFFSET ?`, [...params, limit, offset],
  );
  const [{ total }] = await q(`SELECT COUNT(*) AS total FROM coding_problems p LEFT JOIN categories cat ON cat.id = p.category_id${creatorRoleFilter ? ' LEFT JOIN users u ON u.id = p.created_by LEFT JOIN roles ur ON ur.id = u.role_id' : ''} ${whereSql}`, params);

  let solvedIds = [];
  if (req.user) {
    const rows2 = await q("SELECT DISTINCT problem_id FROM coding_submissions WHERE user_id = ? AND status = 'accepted'", [req.user.id]);
    solvedIds = rows2.map((r) => r.problem_id);
  }
  // p.* contains paid hint text. The list never needs hint content; detail
  // returns it only after unlock/author checks.
  ok(res, rows.map((r) => ({
    ...r,
    hints: isProblemManager(req.user, r) ? r.hints : null,
    solved: solvedIds.includes(r.id),
  })), { page, limit, total, pages: Math.ceil(total / limit) });
});

const getProblem = asyncHandler(async (req, res) => {
  const key = req.params.id;
  const problem = await q1(
    `SELECT ${PROBLEM_SELECT} FROM coding_problems p
       LEFT JOIN categories cat ON cat.id = p.category_id
       LEFT JOIN users u ON u.id = p.created_by WHERE p.id = ? OR p.slug = ? LIMIT 1`,
    [Number(key) || 0, key],
  );
  if (!problem) throw ApiError.notFound('Problem not found');
  const canManage = isProblemManager(req.user, problem);

  // A contest-only draft may be opened by a registered participant while the
  // contest window is live. Outside that narrow context, drafts are author-only.
  let contestAccess = null;
  const contestId = Number(req.query.contest_id || req.query.contest || 0) || null;
  if (contestId && req.user && !canManage) {
    const contest = await q1(
      `SELECT c.id, c.status, c.start_at, c.end_at
         FROM contests c
         JOIN contest_problems cp ON cp.contest_id = c.id AND cp.problem_id = ?
         JOIN contest_participants part ON part.contest_id = c.id AND part.user_id = ?
        WHERE c.id = ? LIMIT 1`,
      [problem.id, req.user.id, contestId],
    );
    if (contest && !['draft', 'cancelled', 'completed'].includes(contest.status)) {
      const now = Date.now();
      if (new Date(contest.start_at).getTime() <= now && new Date(contest.end_at).getTime() >= now) {
        contestAccess = contest;
      }
    }
  }

  if (problem.status !== 'published' && !canManage && !contestAccess) {
    throw ApiError.forbidden('This problem is not published yet');
  }
  // Premium problem: the statement and editor are unavailable without an active subscription.
  // Authors/admin retain access so they can maintain the problem.
  if (Number(problem.is_premium) && !canManage && !(await subs.hasPremiumAccess(req.user))) {
    throw subs.premiumError('coding problem');
  }

  // students only ever receive PUBLIC examples; hidden tests stay server-side
  const examples = await q(
    'SELECT id, input, expected_output, points FROM coding_test_cases WHERE problem_id = ? AND is_hidden = 0 ORDER BY position LIMIT 3',
    [problem.id],
  );
  let mySubmission = null;
  let solved = false;
  if (req.user) {
    mySubmission = await q1(
      'SELECT * FROM coding_submissions WHERE user_id = ? AND problem_id = ? ORDER BY submitted_at DESC LIMIT 1',
      [req.user.id, problem.id],
    );
    solved = !!(await q1(
      "SELECT id FROM coding_submissions WHERE user_id = ? AND problem_id = ? AND status = 'accepted' LIMIT 1",
      [req.user.id, problem.id],
    ));
  }
  // Hints cost points: only revealed once unlocked (or to the author/admin).
  const { hintInfo } = require('./community.controller');
  const hint = await hintInfo(req.user && req.user.id, problem.id, !!(problem.hints && String(problem.hints).trim()));
  if (canManage) hint.hint_unlocked = true;
  if (!canManage && !hint.hint_unlocked) problem.hints = null;
  // Arena anti-cheat (copy-paste block, screenshot block, AI detection)
  // resolves per problem CREATOR — each developer controls their own set.
  const effectiveAntiCheat = await antiCheat.resolveForUser(problem.created_by);
  ok(res, {
    ...problem,
    anticheat: effectiveAntiCheat,
    examples,
    starter_code: problem.starter_code || {},
    my_submission: mySubmission,
    solved,
    hint,
    contest_id: contestAccess ? contestAccess.id : null,
  });
});

const createProblem = asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!String(b.title || '').trim() || !String(b.description || '').trim()) {
    throw ApiError.badRequest('title and description are required');
  }
  const slug = `${slugify(b.title) || 'problem'}-${Date.now().toString().slice(-4)}`;
  const categoryId = await validatedCategoryId(b.category_id);
  const result = await exec(
    `INSERT INTO coding_problems (title, slug, description, difficulty, category_id, points, constraints,
        input_format, output_format, explanation, starter_code, tags, hints, time_limit_ms, memory_limit_kb, created_by, status, time_limit_minutes, is_premium)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.title, slug, b.description, b.difficulty || 'easy', categoryId, b.points ?? 10, b.constraints || null,
      b.input_format || null, b.output_format || null, b.explanation || null, JSON.stringify(b.starter_code || {}),
      JSON.stringify(b.tags || []), b.hints || null, b.time_limit_ms || 2000, b.memory_limit_kb || 262144, req.user.id, b.status || 'draft',
      b.time_limit_minutes ? Number(b.time_limit_minutes) : null,
      ['owner', 'admin'].includes(req.user.role) && b.is_premium ? 1 : 0],
  );
  created(res, await q1('SELECT * FROM coding_problems WHERE id = ?', [result.insertId]));
});

const updateProblem = asyncHandler(async (req, res) => {
  const existing = await q1('SELECT id, created_by FROM coding_problems WHERE id = ?', [req.params.id]);
  if (!existing) throw ApiError.notFound('Problem not found');
  // Ownership rule: admin/owner-created problems cannot be changed by developers.
  if (req.user.role === 'developer' && Number(existing.created_by) !== Number(req.user.id)) {
    throw ApiError.forbidden('This problem belongs to an administrator or another creator — a developer may edit only problems they created.');
  }
  if (req.body.is_premium !== undefined && !['owner', 'admin'].includes(req.user.role)) {
    throw ApiError.forbidden('⭐ Only an ADMIN may mark content as premium or remove that marking');
  }
  const allowed = ['title', 'description', 'difficulty', 'category_id', 'points', 'constraints', 'input_format',
    'output_format', 'explanation', 'starter_code', 'tags', 'hints', 'time_limit_ms', 'memory_limit_kb', 'status', 'time_limit_minutes'];
  const data = {};
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) data[k] = ['starter_code', 'tags'].includes(k) ? JSON.stringify(req.body[k]) : req.body[k];
  });
  if (req.body.is_premium !== undefined) data.is_premium = req.body.is_premium ? 1 : 0;
  if (data.category_id !== undefined) data.category_id = await validatedCategoryId(data.category_id);
  const keys = Object.keys(data);
  if (!keys.length) throw ApiError.badRequest('Nothing to update');
  await exec(`UPDATE coding_problems SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), req.params.id]);
  ok(res, await q1('SELECT * FROM coding_problems WHERE id = ?', [req.params.id]));
});

const removeProblem = asyncHandler(async (req, res) => {
  const existing = await q1('SELECT id, created_by FROM coding_problems WHERE id = ?', [req.params.id]);
  if (!existing) throw ApiError.notFound('Problem not found');
  if (req.user.role === 'developer' && Number(existing.created_by) !== Number(req.user.id)) {
    throw ApiError.forbidden('This problem belongs to an administrator or another creator — a developer may delete only problems they created.');
  }
  await exec('DELETE FROM coding_problems WHERE id = ?', [req.params.id]);
  ok(res, { deleted: true });
});

/* ----------------------- JSON import / export ----------------------- */
const TRANSFER_SCHEMA = 'smartodl-transfer';
const TRANSFER_VERSION = 1;
const MAX_IMPORT_ITEMS = 1000;

const jsonArray = (value) => {
  const parsed = fromJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
};
const jsonObject = (value) => {
  const parsed = fromJson(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};
const limitedText = (value, max, fallback = '') => String(value == null ? fallback : value).slice(0, max);
const boundedNumber = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

async function problemTransferItems(problems) {
  if (!problems.length) return [];
  const ids = problems.map((problem) => Number(problem.id));
  const placeholders = ids.map(() => '?').join(',');
  const tests = await q(
    `SELECT problem_id, input, expected_output, is_hidden, points, position
       FROM coding_test_cases WHERE problem_id IN (${placeholders}) ORDER BY problem_id, position, id`,
    ids,
  );
  const grouped = tests.reduce((map, test) => {
    (map[test.problem_id] = map[test.problem_id] || []).push({
      input: test.input || '', expected_output: test.expected_output,
      is_hidden: !!test.is_hidden, points: Number(test.points), position: Number(test.position),
    });
    return map;
  }, {});
  return problems.map((problem) => ({
    problem: {
      title: problem.title,
      description: problem.description,
      difficulty: problem.difficulty,
      category: problem.category_slug || problem.category_name
        ? { slug: problem.category_slug || null, name: problem.category_name || null }
        : null,
      points: Number(problem.points),
      constraints: problem.constraints,
      input_format: problem.input_format,
      output_format: problem.output_format,
      explanation: problem.explanation,
      starter_code: jsonObject(problem.starter_code),
      tags: jsonArray(problem.tags),
      hints: problem.hints,
      time_limit_ms: Number(problem.time_limit_ms),
      memory_limit_kb: Number(problem.memory_limit_kb),
      time_limit_minutes: problem.time_limit_minutes == null ? null : Number(problem.time_limit_minutes),
    },
    test_cases: grouped[problem.id] || [],
  }));
}

function makeProblemPackage(items) {
  return {
    schema: TRANSFER_SCHEMA,
    version: TRANSFER_VERSION,
    kind: 'coding-problems',
    exported_at: new Date().toISOString(),
    safety: {
      imported_status: 'draft',
      excluded: ['ids', 'submissions', 'statistics', 'creator account'],
      contains_hidden_tests: true,
    },
    items,
  };
}

const exportProblems = asyncHandler(async (req, res) => {
  // Export packages contain hidden tests, so a developer may export only
  // their own problems. Owner/admin retain the whole-library export.
  const scoped = req.user && req.user.role === 'developer';
  const rows = await q(
    `SELECT p.*, cat.name AS category_name, cat.slug AS category_slug
       FROM coding_problems p LEFT JOIN categories cat ON cat.id = p.category_id
       ${scoped ? 'WHERE p.created_by = ?' : ''}
       ORDER BY p.created_at DESC`,
    scoped ? [req.user.id] : [],
  );
  ok(res, makeProblemPackage(await problemTransferItems(rows)));
});

const exportProblem = asyncHandler(async (req, res) => {
  const problem = await q1(
    `SELECT p.*, cat.name AS category_name, cat.slug AS category_slug
       FROM coding_problems p LEFT JOIN categories cat ON cat.id = p.category_id
      WHERE p.id = ?`, [req.params.id],
  );
  if (!problem) throw ApiError.notFound('Problem not found');
  if (!isProblemManager(req.user, problem)) {
    throw ApiError.forbidden('A developer may export only problems they created.');
  }
  ok(res, makeProblemPackage(await problemTransferItems([problem])));
});

function readProblemPackage(body) {
  const pack = body && body.package ? body.package : body;
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw ApiError.badRequest('A JSON package object is required');
  if (pack.kind === 'quizzes') {
    throw ApiError.badRequest('This is a Quiz package, not a standalone Coding Problems package. Import it from Quiz Management or Live Hosting.');
  }
  if (pack.schema !== TRANSFER_SCHEMA || Number(pack.version) !== TRANSFER_VERSION || pack.kind !== 'coding-problems') {
    throw ApiError.badRequest('Unsupported Coding Problems JSON package. Expected smartodl-transfer version 1 with kind "coding-problems".');
  }
  if (!Array.isArray(pack.items) || !pack.items.length) throw ApiError.badRequest('The package contains no coding problems');
  if (pack.items.length > MAX_IMPORT_ITEMS) throw ApiError.badRequest(`A maximum of ${MAX_IMPORT_ITEMS} problems can be imported at once`);
  return pack.items;
}

const importProblems = asyncHandler(async (req, res) => {
  const items = readProblemPackage(req.body);
  let totalTests = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object' || !item.problem || typeof item.problem !== 'object') throw ApiError.badRequest('Every item must contain a problem object');
    if (!limitedText(item.problem.title, 200).trim() || !limitedText(item.problem.description, 200000).trim()) {
      throw ApiError.badRequest('Every imported problem requires a title and description');
    }
    if (!Array.isArray(item.test_cases)) throw ApiError.badRequest('Every problem must contain a test_cases array');
    totalTests += item.test_cases.length;
  }
  if (totalTests > 10000) throw ApiError.badRequest('A package can contain at most 10000 test cases');

  const imported = await tx(async (conn) => {
    const output = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const source = item.problem;
      const baseTitle = limitedText(source.title, 200).trim();
      const [duplicates] = await conn.execute('SELECT id FROM coding_problems WHERE title = ? LIMIT 1', [baseTitle]);
      const title = duplicates.length ? `${baseTitle.slice(0, 189)} (Imported)` : baseTitle;
      let categoryId = null;
      if (source.category && typeof source.category === 'object') {
        const [categories] = await conn.execute(
          'SELECT id FROM categories WHERE slug = ? OR name = ? LIMIT 1',
          [limitedText(source.category.slug, 180), limitedText(source.category.name, 120)],
        );
        if (categories.length) categoryId = categories[0].id;
      }
      const difficulty = ['easy', 'medium', 'hard'].includes(source.difficulty) ? source.difficulty : 'easy';
      const slug = `${slugify(title).slice(0, 175) || 'problem'}-import-${Date.now().toString(36)}-${index}-${crypto.randomBytes(4).toString('hex')}`;
      const [result] = await conn.execute(
        `INSERT INTO coding_problems (title, slug, description, difficulty, category_id, points, constraints,
           input_format, output_format, explanation, starter_code, tags, hints, time_limit_ms,
           memory_limit_kb, time_limit_minutes, created_by, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft')`,
        [title, slug, limitedText(source.description, 200000), difficulty, categoryId,
          Math.round(boundedNumber(source.points, 10, 1, 100000)), limitedText(source.constraints, 65000) || null,
          limitedText(source.input_format, 65000) || null, limitedText(source.output_format, 65000) || null,
          limitedText(source.explanation, 65000) || null, JSON.stringify(jsonObject(source.starter_code)),
          JSON.stringify(jsonArray(source.tags).map((tag) => limitedText(tag, 80)).slice(0, 50)),
          limitedText(source.hints, 200000) || null, Math.round(boundedNumber(source.time_limit_ms, 2000, 100, 60000)),
          Math.round(boundedNumber(source.memory_limit_kb, 262144, 16384, 4194304)),
          source.time_limit_minutes == null ? null : Math.round(boundedNumber(source.time_limit_minutes, 0, 0, 1440)),
          req.user.id],
      );
      const problemId = result.insertId;
      for (let testIndex = 0; testIndex < item.test_cases.length; testIndex += 1) {
        const test = item.test_cases[testIndex] || {};
        if (test.expected_output === undefined) throw ApiError.badRequest(`Test case ${testIndex + 1} for “${title}” has no expected_output`);
        await conn.execute(
          'INSERT INTO coding_test_cases (problem_id, input, expected_output, is_hidden, points, position) VALUES (?,?,?,?,?,?)',
          [problemId, limitedText(test.input, 65000), limitedText(test.expected_output, 65000), test.is_hidden ? 1 : 0,
            Math.round(boundedNumber(test.points, 5, 1, 100000)), Math.round(boundedNumber(test.position, testIndex + 1, 1, 100000))],
        );
      }
      output.push({ id: problemId, title, test_cases: item.test_cases.length, status: 'draft' });
    }
    return output;
  });
  created(res, { imported_count: imported.length, items: imported, status: 'draft' });
});

/* ----------------------------- test cases ----------------------------- */

/** Hidden test data is visible/editable only to admins and the owning developer. */
async function assertCanEditProblem(req, problemId) {
  if (!req.user || req.user.role !== 'developer') return;
  const problem = await q1('SELECT created_by FROM coding_problems WHERE id = ?', [problemId]);
  if (!problem) throw ApiError.notFound('Problem not found');
  if (Number(problem.created_by) !== Number(req.user.id)) {
    throw ApiError.forbidden('This problem belongs to an administrator or another creator — a developer may view or change test cases only for problems they created.');
  }
}

const listTestCases = asyncHandler(async (req, res) => {
  await assertCanEditProblem(req, req.params.id);
  const includeHidden = req.query.include_hidden === '1';
  const rows = await q(
    `SELECT * FROM coding_test_cases WHERE problem_id = ? ${includeHidden ? '' : 'AND is_hidden = 0'} ORDER BY position, id`,
    [req.params.id],
  );
  ok(res, rows);
});

const createTestCase = asyncHandler(async (req, res) => {
  await assertCanEditProblem(req, req.params.id);
  const { input, expected_output, is_hidden, points, position } = req.body;
  if (expected_output === undefined) throw ApiError.badRequest('expected_output is required');
  const [{ pos }] = await q('SELECT COALESCE(MAX(position),0)+1 AS pos FROM coding_test_cases WHERE problem_id = ?', [req.params.id]);
  const result = await exec(
    'INSERT INTO coding_test_cases (problem_id, input, expected_output, is_hidden, points, position) VALUES (?,?,?,?,?,?)',
    [req.params.id, input ?? '', expected_output, is_hidden ? 1 : 0, points ?? 5, position || pos],
  );
  created(res, await q1('SELECT * FROM coding_test_cases WHERE id = ?', [result.insertId]));
});

const updateTestCase = asyncHandler(async (req, res) => {
  const tc = await q1('SELECT problem_id FROM coding_test_cases WHERE id = ?', [req.params.id]);
  if (!tc) throw ApiError.notFound('Test case not found');
  await assertCanEditProblem(req, tc.problem_id);
  const allowed = ['input', 'expected_output', 'is_hidden', 'points', 'position'];
  const data = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) data[k] = req.body[k]; });
  const keys = Object.keys(data);
  if (!keys.length) throw ApiError.badRequest('Nothing to update');
  await exec(`UPDATE coding_test_cases SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), req.params.id]);
  ok(res, await q1('SELECT * FROM coding_test_cases WHERE id = ?', [req.params.id]));
});

const removeTestCase = asyncHandler(async (req, res) => {
  const tc = await q1('SELECT problem_id FROM coding_test_cases WHERE id = ?', [req.params.id]);
  if (!tc) throw ApiError.notFound('Test case not found');
  await assertCanEditProblem(req, tc.problem_id);
  await exec('DELETE FROM coding_test_cases WHERE id = ?', [req.params.id]);
  ok(res, { deleted: true });
});

/* -------------------------- languages + run -------------------------- */
const languages = asyncHandler(async (req, res) => {
  ok(res, await q('SELECT * FROM coding_languages WHERE is_active = 1 ORDER BY id'));
});

/** POST /api/coding/run — LeetCode-style "Run Code":
 *  If custom input is supplied, run with it; otherwise, run automatically against the problem's PUBLIC sample
 *  test cases. No submission is recorded and no score is awarded. */
const runCode = asyncHandler(async (req, res) => {
  const { language, source_code, stdin, problem_id } = req.body;
  if (typeof language !== 'string' || !language || typeof source_code !== 'string' || !source_code) {
    throw ApiError.badRequest('language and source_code are required');
  }
  if (source_code.length > 100000) throw ApiError.badRequest('Source code is too large (max 100 KB)');
  const problem = problem_id
    ? await q1('SELECT id, status, created_by, time_limit_ms, memory_limit_kb, is_premium FROM coding_problems WHERE id = ?', [problem_id])
    : null;
  if (problem_id && !problem) throw ApiError.notFound('Problem not found');
  const canManageProblem = isProblemManager(req.user, problem);
  let contestRunAllowed = false;
  const runContestId = Number(req.body.contest_id || 0) || null;
  if (problem && runContestId && req.user && !canManageProblem) {
    const contest = await q1(
      `SELECT c.id FROM contests c
         JOIN contest_problems cp ON cp.contest_id = c.id AND cp.problem_id = ?
         JOIN contest_participants part ON part.contest_id = c.id AND part.user_id = ?
        WHERE c.id = ? AND c.status NOT IN ('draft','cancelled','completed')
          AND c.start_at <= NOW() AND c.end_at >= NOW() LIMIT 1`,
      [problem.id, req.user.id, runContestId],
    );
    contestRunAllowed = !!contest;
  }
  if (problem && problem.status !== 'published' && !canManageProblem && !contestRunAllowed) {
    throw ApiError.forbidden('This problem is not published yet');
  }
  if (problem && Number(problem.is_premium) && !canManageProblem && !(await subs.hasPremiumAccess(req.user))) {
    throw subs.premiumError('coding problem (Run Code)');
  }

  // ---- sample-testcases mode (LeetCode Run Code) ----
  if (problem && !String(stdin || '').trim()) {
    const tests = await q(
      'SELECT input, expected_output FROM coding_test_cases WHERE problem_id = ? AND is_hidden = 0 ORDER BY position LIMIT 5',
      [problem_id],
    );
    if (tests.length) {
      const results = await judge.runBatch({
        language, sourceCode: source_code,
        tests: tests.map((t) => ({ input: t.input, expected_output: t.expected_output })),
        timeLimitMs: problem.time_limit_ms, memoryLimitKb: problem.memory_limit_kb,
      });
      const agg = judge.aggregate(results);
      return ok(res, {
        mode: 'sample',
        status: agg.status,
        output: agg.results[0] ? agg.results[0].output : '',
        stderr: (agg.results.find((r) => r.stderr) || {}).stderr || '',
        compile_output: (agg.results.find((r) => r.compileOutput) || {}).compileOutput || '',
        execution_time: agg.time, memory: agg.memory, memory_used: agg.memory,
        test_cases_passed: agg.passed, total_test_cases: agg.total,
        test_results: tests.map((t, i) => ({
          hidden: false,
          passed: !!(results[i] && results[i].passed),
          input: t.input,
          expected_output: t.expected_output,
          got: results[i] ? results[i].output : '',
          status: results[i] ? results[i].status : 'internal_error',
          time: results[i] ? results[i].time : 0,
        })),
      });
    }
    // There are no public test cases, so fall through to normal custom-input mode below.
  }

  // ---- custom input mode (the original behaviour) ----
  const result = await judge.runCode({
    language, sourceCode: source_code, stdin: stdin || '',
    timeLimitMs: problem ? problem.time_limit_ms : 2000,
    memoryLimitKb: problem ? problem.memory_limit_kb : 262144,
  });
  ok(res, {
    mode: 'custom',
    status: result.status, output: result.output, stderr: result.stderr,
    compile_output: result.compileOutput, execution_time: result.time, memory: result.memory,
  });
});

/** POST /api/coding/submit — judged against public + hidden test cases */
const submitCode = asyncHandler(async (req, res) => {
  const { problem_id, language, source_code, contest_id } = req.body;
  if (!problem_id || typeof language !== 'string' || !language || typeof source_code !== 'string' || !source_code) {
    throw ApiError.badRequest('problem_id, language and source_code are required');
  }
  if (source_code.length > 100000) throw ApiError.badRequest('Source code is too large (max 100 KB)');

  /* `contest_id` arrives from the client and used to be written to the row
     unchecked, so anyone could tag a practice submission onto any contest —
     one that had closed, one they never entered, with a problem that was not
     even on the problem set. Those rows then fed the standings. Validate it
     here and reject loudly; a practice submission simply omits the field. */
  let contestRef = null;
  if (contest_id !== undefined && contest_id !== null && contest_id !== '') {
    const contest = await q1('SELECT id, status, start_at, end_at FROM contests WHERE id = ?', [contest_id]);
    if (!contest) throw ApiError.badRequest('That contest does not exist');
    const now = Date.now();
    const open = !['completed', 'cancelled', 'draft'].includes(contest.status)
      && (!contest.start_at || new Date(contest.start_at).getTime() <= now)
      && (!contest.end_at || new Date(contest.end_at).getTime() >= now);
    if (!open) throw ApiError.forbidden('This contest is not accepting submissions right now');
    const entered = await q1(
      'SELECT 1 AS x FROM contest_participants WHERE contest_id = ? AND user_id = ?', [contest.id, req.user.id],
    );
    if (!entered) throw ApiError.forbidden('Register for the contest before submitting to it');
    const onSet = await q1(
      'SELECT 1 AS x FROM contest_problems WHERE contest_id = ? AND problem_id = ?', [contest.id, problem_id],
    );
    if (!onSet) throw ApiError.badRequest('That problem is not part of this contest');
    contestRef = contest.id;
  }

  /* ---- AI detection: style + paste + timing, fused (see services/aiDetection.service.js) ----
     The old code ran a PROSE classifier over source code and merged it with
     Math.max(paste%). Both halves were broken: the classifier could not tell
     AI code from human code at all, and with the admin copy-paste block ON
     the paste share is always 0, so every arena submission scored ~0. */
  const tele = aiDetect.readTelemetry(req.body);
  const pasteEvents = tele.events;
  const pastedChars = tele.pasted;
  const typedChars = tele.typed;
  let aiScore = null, aiSignals = null, aiStyle = null, aiPaste = null,
    aiTiming = null, aiVerdict = null, aiTrusted = 0, pasteRatio = 0;
  const problemCreator = await q1('SELECT created_by FROM coding_problems WHERE id = ?', [problem_id]);
  if (await antiCheat.resolveBoolForUser(problemCreator && problemCreator.created_by, 'ai_classifier_arena_enabled', true)) {
    // The skeleton we handed out is not the student's authorship, so it is
    // subtracted before the code is judged. Two sources: the problem's own
    // per-language starter map, and the language's generic template.
    let starter;
    try {
      const [sc, tpl] = await Promise.all([
        q1('SELECT starter_code FROM coding_problems WHERE id = ?', [problem_id]),
        q1('SELECT template_code FROM coding_languages WHERE slug = ?', [language]),
      ]);
      starter = [sc && sc.starter_code, tpl && tpl.template_code].filter(Boolean).join('\n');
    } catch { starter = undefined; }   // never block a submission over this
    const r = aiDetect.analyse([{ text: source_code, kind: 'code', starter }], tele);
    aiScore = r.score; aiSignals = r.signals; aiStyle = r.style;
    aiPaste = r.paste; aiTiming = r.timing; aiVerdict = r.verdict;
    aiTrusted = r.trusted ? 1 : 0; pasteRatio = r.pasteRatio;
  }

  const problem = await q1('SELECT * FROM coding_problems WHERE id = ?', [problem_id]);
  if (!problem) throw ApiError.notFound('Problem not found');
  const canManageProblem = isProblemManager(req.user, problem);
  if (problem.status !== 'published' && !canManageProblem && !contestRef) {
    throw ApiError.forbidden('This problem is not published yet');
  }
  if (Number(problem.is_premium) && !canManageProblem && !(await subs.hasPremiumAccess(req.user))) {
    throw subs.premiumError('coding problem (Submit)');
  }

  const tests = await q('SELECT id, input, expected_output, is_hidden, points FROM coding_test_cases WHERE problem_id = ? ORDER BY is_hidden, position', [problem_id]);
  if (!tests.length) throw ApiError.badRequest('This problem has no test cases yet');

  const insert = await exec(
    `INSERT INTO coding_submissions (user_id, problem_id, contest_id, language, source_code, status, total_test_cases,
       ai_score, ai_signals, paste_events, pasted_chars, typed_chars, paste_ratio,
       ai_style_score, ai_paste_score, ai_timing_score, ai_verdict, ai_trusted,
       blocked_pastes, keystrokes, typing_ms, fast_intervals, uniform_ratio)
     VALUES (?,?,?,?,?,'running',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.user.id, problem_id, contestRef, language, source_code, tests.length,
      aiScore, aiSignals, pasteEvents, pastedChars, typedChars, Number(pasteRatio.toFixed(3)),
      aiStyle, aiPaste, aiTiming, aiVerdict, aiTrusted,
      tele.blocked, tele.keystrokes, tele.typingMs, tele.fast, Number(tele.uniform.toFixed(3))],
  );
  const submissionId = insert.insertId;

  try {
    const results = await judge.runBatch({
      language, sourceCode: source_code, tests: tests.map((t) => ({ input: t.input, expected_output: t.expected_output })),
      timeLimitMs: problem.time_limit_ms, memoryLimitKb: problem.memory_limit_kb,
    });
    // score = sum of points of the test cases that passed (public + hidden)
    let score = 0;
    tests.forEach((t, i) => { if (results[i] && results[i].passed) score += Number(t.points || 0); });
    const agg = judge.aggregate(results);
    const status = agg.status;
    if (status === 'accepted') score = Number(problem.points);
    else if (agg.passed > 0) score = Math.min(score, Math.round(Number(problem.points) * (agg.passed / agg.total)));

    // Persist the verdicts exactly as judged now; later test edits must not
    // rewrite this submission's history.
    try { for (let i = 0; i < tests.length; i += 1) {
      const result = results[i] || {};
      await exec(
        `INSERT INTO coding_submission_results
           (submission_id, test_case_id, is_hidden, passed, status, execution_time, position)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE test_case_id = VALUES(test_case_id), is_hidden = VALUES(is_hidden),
           passed = VALUES(passed), status = VALUES(status), execution_time = VALUES(execution_time)`,
        [submissionId, tests[i].id, tests[i].is_hidden ? 1 : 0, result.passed ? 1 : 0,
          result.status || 'internal_error', Number(result.time || 0), i + 1],
      );
    } } catch (persistError) {
      console.error('[coding] could not persist per-test verdicts:', persistError.message);
    }

    await exec(
      `UPDATE coding_submissions SET status=?, test_cases_passed=?, total_test_cases=?, execution_time=?,
         memory_used=?, score=?, stdout=?, stderr=?, compile_output=?, evaluated_at=NOW() WHERE id=?`,
      [status, agg.passed, agg.total, agg.time, agg.memory,
        status === 'accepted' ? Number(problem.points) : score,
        (agg.results[0] && agg.results[0].output || '').slice(0, 20000),
        (agg.results.find((r) => r.stderr) || {}).stderr || null,
        (agg.results.find((r) => r.compileOutput) || {}).compileOutput || null,
        submissionId],
    );

    // gamification: count today's activity for the streak (idempotent per day)
    touchActivity(req.user.id).catch(() => {});
    if (contestRef) {
      try { await recalcContest(contestRef); }
      catch (recalcError) { console.error('[contest] standings recalc failed:', recalcError.message); }
    }
    // realtime: live-contest standings + dashboards refresh without polling
    events.publish('submission_judged', { problem_id, contest_id: contestRef, user_id: req.user.id, status: agg.status });

    await exec(
      `UPDATE coding_problems SET total_submissions = (SELECT COUNT(*) FROM coding_submissions WHERE problem_id = ?),
         accepted_submissions = (SELECT COUNT(*) FROM coding_submissions WHERE problem_id = ? AND status='accepted') WHERE id = ?`,
      [problem_id, problem_id, problem_id],
    );
    await exec(
      `UPDATE coding_problems SET acceptance_rate = CASE WHEN total_submissions = 0 THEN 0
         ELSE ROUND(100 * accepted_submissions / total_submissions, 2) END WHERE id = ?`, [problem_id],
    );

    if (status === 'accepted') {
      await notify({
        userId: req.user.id, audience: 'user', type: 'coding', link: `/coding/${problem_id}`,
        title: `Accepted ✓ — ${problem.title}`,
        message: `${agg.passed}/${agg.total} test cases passed in ${agg.time.toFixed(3)}s. +${problem.points} points.`,
      });
    }
    await recalcUser(req.user.id);
    await awardAchievements(req.user.id);

    const saved = await q1('SELECT * FROM coding_submissions WHERE id = ?', [submissionId]);
    ok(res, {
      ...saved,
      // only public-case detail is exposed back to the client
      test_results: tests.map((t, i) => ({
        test_case_id: t.is_hidden ? null : t.id,
        hidden: !!t.is_hidden,
        passed: !!(results[i] && results[i].passed),
        // hidden test data is NEVER sent to the client — only pass/fail is reported
        expected_output: t.is_hidden ? null : t.expected_output,
        got: t.is_hidden ? null : (results[i] ? results[i].output : ''),
        status: results[i] ? results[i].status : 'internal_error',
        time: results[i] ? results[i].time : 0,
      })),
    });
  } catch (err) {
    await exec("UPDATE coding_submissions SET status='internal_error', stderr=? WHERE id=?", [String(err.message || err).slice(0, 1000), submissionId]);
    throw ApiError.internal('Code execution service is unavailable right now. Please try again.');
  }
});

const mySubmissions = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query, { limit: 20 });
  const where = ['s.user_id = ?'], params = [req.user ? req.user.id : req.query.user_id];
  if (req.query.problem_id) { where.push('s.problem_id = ?'); params.push(req.query.problem_id); }
  if (req.query.status) { where.push('s.status = ?'); params.push(req.query.status); }
  const rows = await q(
    `SELECT s.id, s.problem_id, p.title, p.difficulty, s.language, s.status, s.test_cases_passed, s.total_test_cases,
            s.execution_time, s.memory_used, s.score, s.submitted_at
       FROM coding_submissions s JOIN coding_problems p ON p.id = s.problem_id
      WHERE ${where.join(' AND ')} ORDER BY s.submitted_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset],
  );
  const [{ total }] = await q(`SELECT COUNT(*) AS total FROM coding_submissions s WHERE ${where.join(' AND ')}`, params);
  ok(res, rows, { page, limit, total, pages: Math.ceil(total / limit) });
});

const allSubmissions = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query, { limit: 20 });
  const where = [], params = [];
  if (req.query.problem_id) { where.push('s.problem_id = ?'); params.push(req.query.problem_id); }
  if (req.query.user_id) { where.push('s.user_id = ?'); params.push(req.query.user_id); }
  if (req.query.status) { where.push('s.status = ?'); params.push(req.query.status); }
  if (req.query.language) { where.push('s.language = ?'); params.push(req.query.language); }
  if (req.query.contest_id) { where.push('s.contest_id = ?'); params.push(req.query.contest_id); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await q(
    `SELECT s.id, s.user_id, u.full_name, u.email, u.college, s.problem_id, p.title, p.title AS problem_title,
            p.difficulty, s.language, s.status, s.contest_id,
            s.test_cases_passed, s.total_test_cases, s.execution_time, s.memory_used, s.score, s.submitted_at,
            s.ai_score, s.ai_signals, s.paste_events, s.pasted_chars, s.typed_chars, s.paste_ratio,
            s.ai_style_score, s.ai_paste_score, s.ai_timing_score, s.ai_verdict, s.ai_trusted,
            s.blocked_pastes, s.keystrokes, s.typing_ms
       FROM coding_submissions s JOIN users u ON u.id = s.user_id JOIN coding_problems p ON p.id = s.problem_id
       ${whereSql} ORDER BY s.submitted_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset],
  );
  const [{ total }] = await q('SELECT COUNT(*) AS total FROM coding_submissions s ' + whereSql, params);
  ok(res, rows, { page, limit, total, pages: Math.ceil(total / limit) });
});

const submissionDetail = asyncHandler(async (req, res) => {
  const submission = await q1(
    `SELECT s.*, p.title, p.title AS problem_title, p.difficulty, u.full_name, u.college
       FROM coding_submissions s
       JOIN coding_problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id WHERE s.id = ?`, [req.params.id],
  );
  if (!submission) throw ApiError.notFound('Submission not found');
  const isOwner = req.user && submission.user_id === req.user.id;
  // `isStaff` was referenced here but never declared in this handler, so EVERY
  // call threw ReferenceError and returned 500 — staff could not open a
  // submission at all, which is also where the AI-detection breakdown lives.
  const isStaff = req.user && ['owner', 'admin', 'developer'].includes(req.user.role);
  if (!isOwner && !isStaff) throw ApiError.forbidden('You can only view your own submissions');
  let resultRows = [];
  try {
    resultRows = await q(
      `SELECT csr.is_hidden, csr.passed, csr.status, csr.execution_time, csr.position,
              tc.expected_output
         FROM coding_submission_results csr
         LEFT JOIN coding_test_cases tc ON tc.id = csr.test_case_id
        WHERE csr.submission_id = ?
        ORDER BY csr.position`,
      [submission.id],
    );
  } catch (e) {
    if (!e || e.code !== 'ER_NO_SUCH_TABLE') throw e;
  }
  submission.test_results = resultRows.map((row) => ({
    hidden: !!row.is_hidden,
    passed: !!row.passed,
    // A public test may have been edited/deleted later; the pass/fail and
    // status above are the immutable facts from judgement time.
    expected_output: row.is_hidden ? null : row.expected_output,
    status: row.status,
    time: Number(row.execution_time || 0),
  }));
  submission.test_results_available = resultRows.length > 0;
  ok(res, submission);
});

/* ------------------------------- contests ------------------------------- */
const listContests = asyncHandler(async (req, res) => {
  const where = [], params = [];
  const isAdmin = isAdminUser(req.user);
  const isDeveloper = !!(req.user && req.user.role === 'developer');
  if (!isAdmin && !isDeveloper) {
    where.push("c.status IN ('published','live','completed','scheduled')");
  } else if (isDeveloper) {
    // Public contests plus the developer's own drafts/cancelled contests.
    where.push("(c.status IN ('published','live','completed','scheduled') OR c.created_by = ?)");
    params.push(req.user.id);
  }
  if (req.query.status) { where.push('c.status = ?'); params.push(req.query.status); }
  if (req.query.contest_type) { where.push('c.contest_type = ?'); params.push(req.query.contest_type); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await q(
    `SELECT c.*, u.full_name AS created_by_name,
            (SELECT COUNT(*) FROM contest_problems cp WHERE cp.contest_id = c.id) AS problem_count
       FROM contests c LEFT JOIN users u ON u.id = c.created_by ${whereSql}
      ORDER BY FIELD(c.status,'live','scheduled','published','completed','draft','cancelled'), c.start_at DESC`,
    params,
  );
  let registeredIds = [];
  if (req.user) {
    const rows2 = await q('SELECT contest_id FROM contest_participants WHERE user_id = ?', [req.user.id]);
    registeredIds = rows2.map((r) => r.contest_id);
  }
  ok(res, rows.map((r) => ({
    ...r,
    participant_count: Number(r.registered_count || 0),
    registered: registeredIds.includes(r.id),
  })));
});

const getContest = asyncHandler(async (req, res) => {
  const contest = await q1('SELECT * FROM contests WHERE id = ? OR slug = ? LIMIT 1', [Number(req.params.id) || 0, req.params.id]);
  if (!contest) throw ApiError.notFound('Contest not found');
  const canManage = isContestManager(req.user, contest);
  if (['draft', 'cancelled'].includes(contest.status) && !canManage) {
    throw ApiError.notFound('Contest not found');
  }

  const started = contest.start_at && new Date(contest.start_at) <= new Date();
  const ended = contest.status === 'completed' || (contest.end_at && new Date(contest.end_at) < new Date());
  const problems = await q(
    `SELECT cp.label, cp.points_override, cp.position, cp.solved_count,
            p.id, p.title, p.slug, p.difficulty, p.points, p.status AS problem_status
       FROM contest_problems cp JOIN coding_problems p ON p.id = cp.problem_id
      WHERE cp.contest_id = ? ORDER BY cp.position`, [contest.id],
  );
  const registered = req.user
    ? await q1('SELECT * FROM contest_participants WHERE contest_id = ? AND user_id = ?', [contest.id, req.user.id])
    : null;

  const canUseDraftProblems = canManage
    || !!(registered && started && !ended && !['draft', 'cancelled'].includes(contest.status));
  const accessibleProblems = problems.filter(
    (problem) => problem.problem_status === 'published' || canUseDraftProblems,
  );
  // Before start, return slots only—not IDs/slugs that would let a student
  // open or search for the underlying problems early.
  const visible = canManage || started
    ? accessibleProblems.map(({ problem_status, ...problem }) => problem)
    : problems.map((problem) => ({
      label: problem.label,
      points_override: problem.points_override,
      position: problem.position,
      solved_count: null,
      id: null,
      title: `Problem ${problem.label}`,
      slug: null,
      difficulty: null,
      points: problem.points_override || null,
      locked: true,
    }));

  if (!canManage && !ended) contest.editorial = null;
  ok(res, {
    ...contest,
    participant_count: Number(contest.registered_count || 0),
    problems: visible,
    registered: !!registered,
    participant: registered,
    server_time: new Date().toISOString(),
    starts_in_seconds: started ? 0 : Math.max(0, Math.floor((new Date(contest.start_at) - Date.now()) / 1000)),
  });
});

const registerContest = asyncHandler(async (req, res) => {
  const outcome = await tx(async (conn) => {
    const [[contest]] = await conn.query(
      'SELECT * FROM contests WHERE id = ? FOR UPDATE',
      [req.params.id],
    );
    if (!contest) return { kind: 'missing' };
    if (!['scheduled', 'published', 'live'].includes(contest.status)
        || new Date(contest.end_at).getTime() <= Date.now()) {
      return { kind: 'closed', contest };
    }
    const [[existing]] = await conn.query(
      'SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?',
      [contest.id, req.user.id],
    );
    if (existing) return { kind: 'already', contest };
    if (contest.max_participants) {
      const [[row]] = await conn.query(
        'SELECT COUNT(*) AS c FROM contest_participants WHERE contest_id = ?',
        [contest.id],
      );
      if (Number(row.c) >= Number(contest.max_participants)) return { kind: 'full', contest };
    }
    await conn.execute(
      'INSERT INTO contest_participants (contest_id, user_id) VALUES (?,?)',
      [contest.id, req.user.id],
    );
    await conn.execute(
      'UPDATE contests SET registered_count = (SELECT COUNT(*) FROM contest_participants WHERE contest_id = ?) WHERE id = ?',
      [contest.id, contest.id],
    );
    return { kind: 'created', contest };
  });

  if (outcome.kind === 'missing') throw ApiError.notFound('Contest not found');
  if (outcome.kind === 'closed') throw ApiError.badRequest('This contest is not open for registration');
  if (outcome.kind === 'full') throw ApiError.forbidden('This contest is full');
  if (outcome.kind === 'already') return ok(res, { registered: true, already: true });

  await notify({
    userId: req.user.id, audience: 'user', type: 'contest', link: `/contests/${outcome.contest.id}`,
    title: `Registered: ${outcome.contest.title}`, message: 'You are registered. The countdown is on — good luck!',
  });
  created(res, { registered: true });
});

const contestLeaderboard = asyncHandler(async (req, res) => {
  const contestId = Number(req.params.id) || 0;
  let contest = await q1('SELECT * FROM contests WHERE id = ?', [contestId]);
  if (!contest) throw ApiError.notFound('Contest not found');
  const canManage = isContestManager(req.user, contest);
  if (['draft', 'cancelled'].includes(contest.status) && !canManage) {
    throw ApiError.notFound('Contest not found');
  }

  const finished = contest.status === 'completed'
    || (!['draft', 'cancelled'].includes(contest.status)
      && new Date(contest.end_at).getTime() < Date.now());
  if (finished && contest.status !== 'completed') {
    const transitioned = await exec(
      "UPDATE contests SET status = 'completed' WHERE id = ? AND status NOT IN ('completed','cancelled','draft')",
      [contest.id],
    );
    if (Number(transitioned.affectedRows) > 0) await recalcContest(contest.id);
    contest = await q1('SELECT * FROM contests WHERE id = ?', [contest.id]);
  }

  const rows = await q(
    `SELECT cp.id, cp.contest_id, cp.user_id, cp.score, cp.solved_count, cp.penalty_minutes,
            cp.rank_position, cp.last_submission_at, cp.registered_at,
            u.full_name, u.college, u.avatar
       FROM contest_participants cp JOIN users u ON u.id = cp.user_id
      WHERE cp.contest_id = ?
      ORDER BY cp.score DESC, cp.solved_count DESC, cp.penalty_minutes ASC, cp.registered_at ASC`,
    [contest.id],
  );
  const ranked = rows.map((row, index) => ({ ...row, rank_position: index + 1 }));

  if (finished && contest.status === 'completed') {
    try {
      const { issueContest } = require('./certificate.controller');
      for (const row of ranked.slice(0, 10)) {
        if (row.score > 0) await issueContest(contest.id, row.user_id, row.rank_position);
      }
    } catch (_) { /* cert issuance failure must not break leaderboard */ }
  }
  ok(res, ranked);
});

/** Recompute contest standings from submissions inside the contest window. */
async function recalcContest(contestId) {
  const contest = await q1('SELECT * FROM contests WHERE id = ?', [contestId]);
  if (!contest) return;
  const problems = await q(
    'SELECT cp.problem_id, COALESCE(cp.points_override, p.points) AS points FROM contest_problems cp JOIN coding_problems p ON p.id = cp.problem_id WHERE cp.contest_id = ?',
    [contestId],
  );
  const pointsMap = problems.reduce((acc, problem) => {
    acc[problem.problem_id] = Number(problem.points);
    return acc;
  }, {});
  const perProblemSolved = problems.reduce((acc, problem) => {
    acc[problem.problem_id] = new Set();
    return acc;
  }, {});

  const submissions = await q(
    `SELECT user_id, problem_id, status, submitted_at FROM coding_submissions
      WHERE contest_id = ?
        AND (? IS NULL OR submitted_at >= ?)
        AND (? IS NULL OR submitted_at <= ?)
      ORDER BY submitted_at, id`,
    [contestId, contest.start_at, contest.start_at, contest.end_at, contest.end_at],
  );
  const perUser = {};
  for (const submission of submissions) {
    if (!Object.prototype.hasOwnProperty.call(pointsMap, submission.problem_id)) continue;
    perUser[submission.user_id] = perUser[submission.user_id]
      || { score: 0, solved: new Set(), last: null, penalty: 0 };
    const aggregate = perUser[submission.user_id];
    aggregate.last = submission.submitted_at;
    if (submission.status === 'accepted' && !aggregate.solved.has(submission.problem_id)) {
      aggregate.solved.add(submission.problem_id);
      aggregate.score += pointsMap[submission.problem_id] || 0;
      perProblemSolved[submission.problem_id].add(submission.user_id);
      const minutes = Math.max(
        0,
        Math.floor((new Date(submission.submitted_at) - new Date(contest.start_at)) / 60000),
      );
      aggregate.penalty += minutes;
    }
  }

  await exec(
    'UPDATE contest_participants SET score = 0, solved_count = 0, penalty_minutes = 0, last_submission_at = NULL WHERE contest_id = ?',
    [contestId],
  );
  await exec('UPDATE contest_problems SET solved_count = 0 WHERE contest_id = ?', [contestId]);
  for (const [userId, aggregate] of Object.entries(perUser)) {
    await exec(
      `UPDATE contest_participants SET score = ?, solved_count = ?, penalty_minutes = ?, last_submission_at = ?
        WHERE contest_id = ? AND user_id = ?`,
      [aggregate.score, aggregate.solved.size, aggregate.penalty, aggregate.last, contestId, userId],
    );
  }
  for (const [problemId, users] of Object.entries(perProblemSolved)) {
    await exec(
      'UPDATE contest_problems SET solved_count = ? WHERE contest_id = ? AND problem_id = ?',
      [users.size, contestId, problemId],
    );
  }
  await assignRanks({ q, exec }, 'contest_participants',
    'score DESC, solved_count DESC, penalty_minutes ASC', 'contest_id = ?', [contestId]);
  await exec(
    "INSERT INTO leaderboard (user_id, scope, scope_ref, problems_solved, points, submissions, accuracy) SELECT cp.user_id,'contest',cp.contest_id,cp.solved_count,cp.score,0,0 FROM contest_participants cp WHERE cp.contest_id = ? ON DUPLICATE KEY UPDATE points = VALUES(points), problems_solved = VALUES(problems_solved)",
    [contestId],
  );
  await assignRanks({ q, exec }, 'leaderboard',
    'points DESC, problems_solved DESC', "scope = 'contest' AND scope_ref = ?", [contestId]);
}

const CONTEST_STATUSES = ['draft', 'scheduled', 'published', 'live', 'completed', 'cancelled'];
const CONTEST_TYPES = ['coding', 'quiz'];

function contestDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw ApiError.badRequest(`${label} must be a valid date/time`);
  return date;
}

function normalizeContestProblemIds(input) {
  if (!Array.isArray(input)) return [];
  if (input.length > 200) throw ApiError.badRequest('A contest can contain at most 200 problems');
  const ids = input.map((value) => Number(value));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw ApiError.badRequest('Every contest problem must be a valid problem id');
  }
  return [...new Set(ids)];
}

async function insertContestProblems(conn, contestId, problemIds, overrides) {
  if (!problemIds.length) return;
  const placeholders = problemIds.map(() => '?').join(',');
  const [found] = await conn.execute(
    `SELECT id FROM coding_problems WHERE id IN (${placeholders})`,
    problemIds,
  );
  if (found.length !== problemIds.length) {
    throw ApiError.badRequest('One or more selected contest problems do not exist');
  }
  for (let index = 0; index < problemIds.length; index += 1) {
    const rawOverride = overrides ? overrides[index] : null;
    const override = rawOverride === null || rawOverride === undefined || rawOverride === ''
      ? null
      : Math.round(boundedNumber(rawOverride, 0, 0, 100000));
    await conn.execute(
      'INSERT INTO contest_problems (contest_id, problem_id, label, points_override, position) VALUES (?,?,?,?,?)',
      [contestId, problemIds[index], spreadsheetLabel(index), override, index + 1],
    );
  }
}

const createContest = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim().slice(0, 200);
  if (!title) throw ApiError.badRequest('title, start_at and end_at are required');
  const startAt = contestDate(body.start_at, 'start_at');
  const endAt = contestDate(body.end_at, 'end_at');
  if (endAt <= startAt) throw ApiError.badRequest('end_at must be after start_at');
  const contestType = CONTEST_TYPES.includes(body.contest_type) ? body.contest_type : 'coding';
  const status = body.status === undefined ? 'draft' : body.status;
  if (!CONTEST_STATUSES.includes(status)) throw ApiError.badRequest('Invalid contest status');
  const maxParticipants = body.max_participants === null || body.max_participants === undefined || body.max_participants === ''
    ? null
    : Math.round(boundedNumber(body.max_participants, 0, 1, 1000000));
  const problemIds = normalizeContestProblemIds(body.problem_ids);
  const slug = `${slugify(title).slice(0, 200) || 'contest'}-${Date.now().toString().slice(-4)}`;

  const contestId = await tx(async (conn) => {
    const [result] = await conn.execute(
      `INSERT INTO contests (title, slug, description, contest_type, start_at, end_at, duration_minutes,
          max_participants, is_rated, rules, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [title, slug, body.description || null, contestType, startAt, endAt,
        Math.max(1, Math.round((endAt - startAt) / 60000)), maxParticipants,
        body.is_rated ? 1 : 0, body.rules || null, status, req.user.id],
    );
    await insertContestProblems(conn, result.insertId, problemIds, body.points_overrides);
    return result.insertId;
  });
  created(res, await q1('SELECT * FROM contests WHERE id = ?', [contestId]));
});

const updateContest = asyncHandler(async (req, res) => {
  const contest = await q1('SELECT * FROM contests WHERE id = ?', [req.params.id]);
  if (!contest) throw ApiError.notFound('Contest not found');
  if (!isContestManager(req.user, contest)) {
    throw ApiError.forbidden('A developer may edit only contests they created.');
  }

  const body = req.body || {};
  const data = {};
  const allowed = ['title', 'description', 'contest_type', 'start_at', 'end_at', 'duration_minutes',
    'max_participants', 'is_rated', 'rules', 'status', 'editorial'];
  allowed.forEach((key) => { if (body[key] !== undefined) data[key] = body[key]; });

  if (data.title !== undefined) {
    data.title = String(data.title || '').trim().slice(0, 200);
    if (!data.title) throw ApiError.badRequest('Contest title cannot be empty');
  }
  if (data.contest_type !== undefined && !CONTEST_TYPES.includes(data.contest_type)) {
    throw ApiError.badRequest('Invalid contest type');
  }
  if (data.status !== undefined && !CONTEST_STATUSES.includes(data.status)) {
    throw ApiError.badRequest('Invalid contest status');
  }
  if (data.start_at !== undefined || data.end_at !== undefined) {
    const startAt = contestDate(data.start_at === undefined ? contest.start_at : data.start_at, 'start_at');
    const endAt = contestDate(data.end_at === undefined ? contest.end_at : data.end_at, 'end_at');
    if (endAt <= startAt) throw ApiError.badRequest('end_at must be after start_at');
    data.start_at = startAt;
    data.end_at = endAt;
    data.duration_minutes = Math.max(1, Math.round((endAt - startAt) / 60000));
  } else if (data.duration_minutes !== undefined) {
    data.duration_minutes = Math.round(boundedNumber(data.duration_minutes, contest.duration_minutes, 1, 525600));
  }
  if (data.max_participants !== undefined) {
    data.max_participants = data.max_participants === null || data.max_participants === ''
      ? null
      : Math.round(boundedNumber(data.max_participants, 0, 1, 1000000));
  }
  if (data.is_rated !== undefined) data.is_rated = data.is_rated ? 1 : 0;

  const replaceProblems = Array.isArray(body.problem_ids);
  const problemIds = replaceProblems ? normalizeContestProblemIds(body.problem_ids) : [];
  if (!Object.keys(data).length && !replaceProblems) throw ApiError.badRequest('Nothing to update');

  await tx(async (conn) => {
    const keys = Object.keys(data);
    if (keys.length) {
      await conn.execute(
        `UPDATE contests SET ${keys.map((key) => `\`${key}\` = ?`).join(', ')} WHERE id = ?`,
        [...keys.map((key) => data[key]), contest.id],
      );
    }
    if (replaceProblems) {
      // Validate before deleting the old set; otherwise one stale problem ID
      // in a form could atomically leave the contest with no problems.
      if (problemIds.length) {
        const placeholders = problemIds.map(() => '?').join(',');
        const [found] = await conn.execute(
          `SELECT id FROM coding_problems WHERE id IN (${placeholders})`,
          problemIds,
        );
        if (found.length !== problemIds.length) {
          throw ApiError.badRequest('One or more selected contest problems do not exist');
        }
      }
      await conn.execute('DELETE FROM contest_problems WHERE contest_id = ?', [contest.id]);
      await insertContestProblems(conn, contest.id, problemIds, body.points_overrides);
    }
  });

  if (data.status && ['live', 'published'].includes(data.status) && contest.status !== data.status) {
    await notify({
      audience: 'student', type: 'contest', link: `/contests/${contest.id}`, createdBy: req.user.id,
      title: `Contest ${data.status === 'live' ? 'started' : 'published'}: ${data.title || contest.title}`,
      message: data.status === 'live' ? 'The contest is live — join now!' : 'A new contest has been announced. Register to participate.',
    });
  }
  await recalcContest(contest.id);
  ok(res, await q1('SELECT * FROM contests WHERE id = ?', [contest.id]));
});

const removeContest = asyncHandler(async (req, res) => {
  const contest = await q1('SELECT id, created_by FROM contests WHERE id = ?', [req.params.id]);
  if (!contest) throw ApiError.notFound('Contest not found');
  if (!isContestManager(req.user, contest)) {
    throw ApiError.forbidden('A developer may delete only contests they created.');
  }
  await exec('DELETE FROM contests WHERE id = ?', [contest.id]);
  ok(res, { deleted: true });
});

module.exports = {
  listProblems, getProblem, createProblem, updateProblem, removeProblem,
  exportProblems, exportProblem, importProblems,
  listTestCases, createTestCase, updateTestCase, removeTestCase,
  languages, runCode, submitCode, mySubmissions, allSubmissions, submissionDetail,
  listContests, getContest, registerContest, contestLeaderboard, createContest, updateContest, removeContest, recalcContest,
};
