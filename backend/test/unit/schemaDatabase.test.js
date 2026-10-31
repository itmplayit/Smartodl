'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const mysqlDump = fs.readFileSync(path.join(root, 'database/education_platform.sql'), 'utf8');

test('MySQL dump creates and selects the application default database', () => {
  assert.match(mysqlDump, /CREATE DATABASE[\s\S]*?`education_platform`/i);
  assert.match(mysqlDump, /^USE `education_platform`;/im);
  assert.doesNotMatch(mysqlDump, /^USE `edu`;/im);
});

test('dump carries the full schema (database/ has a single SQL file by design)', () => {
  // 53 tables ship in one file; a stale dump used to be missing newer columns.
  const tables = mysqlDump.match(/CREATE TABLE `/g) || [];
  assert.ok(tables.length >= 50, `expected the full schema, found ${tables.length} tables`);
  for (const col of [
    'completion_policy',            // courses
    'video_path', 'pdf_path',       // lessons
    'module_id', 'require_all_viewed', 'individualized_order', // quizzes
  ]) {
    assert.match(mysqlDump, new RegExp('`' + col + '`'), `dump is missing column ${col}`);
  }
});

test('dump ships reference data but no demo/learner data', () => {
  for (const t of ['roles', 'permissions', 'settings', 'plans', 'categories', 'site_pages']) {
    assert.match(mysqlDump, new RegExp('INSERT INTO `' + t + '`'), `reference data missing: ${t}`);
  }
  for (const t of ['courses', 'course_modules', 'lessons', 'quizzes', 'quiz_questions', 'users']) {
    assert.doesNotMatch(mysqlDump, new RegExp('INSERT INTO `' + t + '`'), `demo data should not be in the dump: ${t}`);
  }
});

test('dump carries the certificate columns the app reads', () => {
  // These three were missing once (added at runtime by ensureSchema), which made
  // the dump an incomplete description of the schema.
  for (const col of ['template_id', 'design_snapshot', 'logo_path']) {
    assert.match(mysqlDump, new RegExp('`' + col + '`'), `dump is missing column ${col}`);
  }
});

test('dump declares the certificate deletion rules (FK), not only indexes', () => {
  assert.match(mysqlDump, /ADD CONSTRAINT `fk_cert_user` FOREIGN KEY \(`user_id`\) REFERENCES `users` \(`id`\) ON DELETE CASCADE/);
  assert.match(mysqlDump, /ADD CONSTRAINT `fk_cert_course` FOREIGN KEY \(`course_id`\) REFERENCES `courses` \(`id`\) ON DELETE SET NULL/);
  // declared after every CREATE TABLE, so import order can never matter
  assert.ok(mysqlDump.indexOf('ADD CONSTRAINT `fk_cert_user`') > mysqlDump.lastIndexOf('CREATE TABLE `'));
});
