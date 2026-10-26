'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyCriticalSchema, CRITICAL_COLUMNS, CRITICAL_TABLES } = require('../../services/migrations.service');

test('critical schema list is well-formed (no duplicates, dotted names)', () => {
  const cols = CRITICAL_COLUMNS.map(([t, c]) => `${t}.${c}`);
  assert.equal(new Set(cols).size, cols.length);
  assert.ok(cols.includes('quiz_attempts.proctor_policy'));
  assert.ok(cols.includes('users.password_changed_at'));
  assert.equal(new Set(CRITICAL_TABLES).size, CRITICAL_TABLES.length);
  assert.ok(CRITICAL_TABLES.includes('proctor_events'));
});

/** Fake information_schema answering like MySQL would for a given presence set. */
function fakeQuery({ tables, columns }) {
  return async (sql) => {
    if (sql.includes('information_schema.TABLES')) return [...tables].map((t) => ({ t }));
    if (sql.includes('information_schema.COLUMNS')) return [...columns].map((entry) => {
      const i = entry.indexOf('.');
      return { t: entry.slice(0, i), c: entry.slice(i + 1) };
    });
    throw new Error('unexpected query: ' + sql);
  };
}

test('verifyCriticalSchema passes when everything is present', async () => {
  const tables = new Set([...CRITICAL_TABLES, ...CRITICAL_COLUMNS.map(([t]) => t)]);
  const columns = new Set(CRITICAL_COLUMNS.map(([t, c]) => `${t}.${c}`));
  const result = await verifyCriticalSchema(fakeQuery({ tables, columns }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('verifyCriticalSchema reports exactly what is missing', async () => {
  const tables = new Set([...CRITICAL_TABLES, ...CRITICAL_COLUMNS.map(([t]) => t)]);
  tables.delete('proctor_events');
  const columns = new Set(CRITICAL_COLUMNS.map(([t, c]) => `${t}.${c}`));
  columns.delete('quiz_attempts.proctor_policy');
  columns.delete('users.password_changed_at');
  const result = await verifyCriticalSchema(fakeQuery({ tables, columns }));
  assert.equal(result.ok, false);
  assert.deepEqual([...result.missing].sort(), [
    'proctor_events (table)',
    'quiz_attempts.proctor_policy',
    'users.password_changed_at',
  ].sort());
});
