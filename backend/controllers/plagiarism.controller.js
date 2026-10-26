'use strict';
/**
 * Similarity / plagiarism checker for staff.
 * Compares accepted submissions per problem using token n-gram Jaccard
 * similarity and returns the most similar pairs between different users.
 */
const { q } = require('../config/db');
const { ApiError, asyncHandler, ok } = require('../utils/helpers');
const { similarity } = require('../services/similarity.service');

/** Problems worth checking: at least 2 accepted submissions from distinct users. */
const listCheckable = asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT p.id, p.title, p.difficulty,
            COUNT(DISTINCT s.user_id) AS users, COUNT(*) AS submissions
       FROM coding_problems p
       JOIN coding_submissions s ON s.problem_id = p.id AND s.status = 'accepted'
      GROUP BY p.id HAVING users >= 2
      ORDER BY submissions DESC`,
  );
  ok(res, rows);
});

const checkProblem = asyncHandler(async (req, res) => {
  const problemId = Number(req.params.id);
  const rows = await q(
    `SELECT s.id, s.user_id, s.language, s.source_code, s.score, s.submitted_at,
            u.full_name, u.email
       FROM coding_submissions s JOIN users u ON u.id = s.user_id
      WHERE s.problem_id = ? AND s.status = 'accepted'
      ORDER BY s.user_id, s.submitted_at DESC`,
    [problemId],
  );
  // newest accepted submission per user
  const byUser = new Map();
  rows.forEach((r) => { if (!byUser.has(r.user_id)) byUser.set(r.user_id, r); });
  const list = [...byUser.values()];

  const threshold = Math.max(0.2, Math.min(0.95, Number(req.query.threshold || 0.5)));
  const pairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const score = similarity(list[i].source_code, list[j].source_code);
      if (score >= threshold) {
        pairs.push({
          similarity: Number(score.toFixed(3)),
          a: { id: list[i].id, user_id: list[i].user_id, name: list[i].full_name, email: list[i].email, language: list[i].language, submitted_at: list[i].submitted_at, source_code: list[i].source_code },
          b: { id: list[j].id, user_id: list[j].user_id, name: list[j].full_name, email: list[j].email, language: list[j].language, submitted_at: list[j].submitted_at, source_code: list[j].source_code },
        });
      }
    }
  }
  pairs.sort((x, y) => y.similarity - x.similarity);
  ok(res, { problem_id: problemId, checked: list.length, threshold, pairs: pairs.slice(0, 100) });
});

module.exports = { listCheckable, checkProblem };
