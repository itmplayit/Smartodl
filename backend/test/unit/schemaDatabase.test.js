'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const mysqlDump = fs.readFileSync(path.join(root, 'database/education_platform.sql'), 'utf8');
const tidbDump = fs.readFileSync(path.join(root, 'database/education_platform.tidb.sql'), 'utf8');

test('MySQL dump creates and selects the application default database', () => {
  assert.match(mysqlDump, /CREATE DATABASE[\s\S]*?`education_platform`/i);
  assert.match(mysqlDump, /^USE `education_platform`;/im);
  assert.doesNotMatch(mysqlDump, /^USE `edu`;/im);
});

test('generated TiDB dump is database-agnostic', () => {
  assert.doesNotMatch(tidbDump, /^\s*(?:CREATE DATABASE|USE\s+)/im);
});
