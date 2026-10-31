'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyCriticalSchema, CRITICAL_COLUMNS, CRITICAL_ENUM_VALUES, CRITICAL_TABLES, CRITICAL_SETTINGS } = require('../../services/migrations.service');

test('critical schema list is well-formed (no duplicates, dotted names)', () => {
  const cols = CRITICAL_COLUMNS.map(([t, c]) => `${t}.${c}`);
  assert.equal(new Set(cols).size, cols.length);
  assert.ok(cols.includes('quiz_attempts.proctor_policy'));
  assert.ok(cols.includes('users.password_changed_at'));
  assert.equal(new Set(CRITICAL_TABLES).size, CRITICAL_TABLES.length);
  assert.ok(CRITICAL_TABLES.includes('proctor_events'));
  assert.ok(CRITICAL_COLUMNS.some(([table, column]) => table === 'quizzes' && column === 'course_id'));
  assert.ok(!CRITICAL_TABLES.some((table) => table.startsWith('learning_path')));
  assert.ok(CRITICAL_ENUM_VALUES.some(([table, column, value]) => table === 'certificates'
    && column === 'cert_type' && value === 'path'));
  assert.ok(CRITICAL_SETTINGS.includes('proctor_recording_enabled'));
  assert.ok(CRITICAL_SETTINGS.includes('integrity_score_enabled'));
  assert.equal(new Set(CRITICAL_SETTINGS).size, CRITICAL_SETTINGS.length);
});

/** Fake information_schema answering like MySQL would for a given presence set. */
function fakeQuery({ tables, columns, settings = new Set(CRITICAL_SETTINGS), omitEnums = new Set() }) {
  return async (sql) => {
    if (sql.includes('information_schema.TABLES')) return [...tables].map((t) => ({ t }));
    if (sql.includes('information_schema.COLUMNS')) {
      const requiredEnumColumns = [...new Set(CRITICAL_ENUM_VALUES.map(([t, c]) => `${t}.${c}`))];
      return [...new Set([...columns, ...requiredEnumColumns])].map((entry) => {
        const i = entry.indexOf('.');
        const t = entry.slice(0, i);
        const c = entry.slice(i + 1);
        const values = ['course', 'quiz', 'contest', 'milestone',
          ...(omitEnums.has(`${t}.${c}`) ? [] : ['path'])];
        return { t, c, column_type: c === 'cert_type' ? `enum(${values.map((v) => `'${v}'`).join(',')})` : 'varchar(64)' };
      });
    }
    if (sql.includes('FROM settings')) return [...settings].map((k) => ({ k }));
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

test('verifyCriticalSchema reports missing tables, columns, and feature-setting rows', async () => {
  const tables = new Set([...CRITICAL_TABLES, ...CRITICAL_COLUMNS.map(([t]) => t)]);
  tables.delete('proctor_events');
  const columns = new Set(CRITICAL_COLUMNS.map(([t, c]) => `${t}.${c}`));
  columns.delete('quiz_attempts.proctor_policy');
  columns.delete('users.password_changed_at');
  const settings = new Set(CRITICAL_SETTINGS);
  settings.delete('proctor_recording_enabled');
  const result = await verifyCriticalSchema(fakeQuery({ tables, columns, settings }));
  assert.equal(result.ok, false);
  assert.deepEqual([...result.missing].sort(), [
    'proctor_events (table)',
    'quiz_attempts.proctor_policy',
    'settings.proctor_recording_enabled (setting)',
    'users.password_changed_at',
  ].sort());
});

test('verifyCriticalSchema reports a certificate table still missing the path type', async () => {
  const tables = new Set([...CRITICAL_TABLES, ...CRITICAL_COLUMNS.map(([t]) => t)]);
  const columns = new Set(CRITICAL_COLUMNS.map(([t, c]) => `${t}.${c}`));
  const result = await verifyCriticalSchema(fakeQuery({
    tables, columns, omitEnums: new Set(['certificate_templates.cert_type']),
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["certificate_templates.cert_type enum('path')"]);
});
