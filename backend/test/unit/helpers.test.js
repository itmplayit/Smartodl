'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  slugify, parsePagination, sorting, toBool, normaliseText, arraysEqual, randomToken, fromJson, safeExternalUrl,
} = require('../../utils/helpers');

test('slugify produces url-safe slugs', () => {
  assert.equal(slugify('Hello World! DSA 2026'), 'hello-world-dsa-2026');
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
  assert.equal(slugify('Café déjà vu'), 'cafe-deja-vu');
});

test('parsePagination clamps page/limit', () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 12, offset: 0 });
  assert.deepEqual(parsePagination({ page: '3', limit: '5000' }), { page: 3, limit: 100, offset: 200 });
  assert.deepEqual(parsePagination({ page: '-2', limit: '0' }), { page: 1, limit: 12, offset: 0 });
});

test('sorting only allows whitelisted columns (SQL injection guard)', () => {
  const evil = sorting({ sort: 'id; DROP TABLE users', order: 'ASC;--' }, ['created_at'], 'created_at');
  assert.equal(evil.sort, 'created_at');
  assert.equal(evil.order, 'DESC');
  assert.deepEqual(sorting({ sort: 'created_at', order: 'asc' }, ['created_at'], 'x'), { sort: 'created_at', order: 'ASC' });
});

test('small helpers behave', () => {
  assert.equal(toBool('true'), true);
  assert.equal(toBool('0'), false);
  assert.equal(toBool(undefined, true), true);
  assert.equal(normaliseText('  Hello   WORLD '), 'hello world');
  assert.equal(arraysEqual(['a', 'B'], ['b', 'A']), true);
  assert.equal(arraysEqual(['a'], ['a', 'b']), false);
  assert.equal(randomToken(16).length, 32);
  assert.deepEqual(fromJson('{"a":1}'), { a: 1 });
  assert.equal(fromJson(null, 'x'), 'x');
});


test('safeExternalUrl rejects script-bearing and protocol-relative URLs', () => {
  assert.equal(safeExternalUrl('https://example.com/watch?v=1'), 'https://example.com/watch?v=1');
  assert.equal(safeExternalUrl('/uploads/a.png', { allowRelative: true }), '/uploads/a.png');
  assert.equal(safeExternalUrl(''), null);
  assert.throws(() => safeExternalUrl('javascript:alert(1)'), /must be a valid/);
  assert.throws(() => safeExternalUrl('//evil.example/x', { allowRelative: true }), /must be a valid/);
  assert.throws(() => safeExternalUrl('data:text/html,hi'), /must be a valid/);
  assert.throws(() => safeExternalUrl('https://user:pass@example.com/'), /must be a valid/);
});
