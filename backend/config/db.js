'use strict';
/**
 * MySQL connection pool (mysql2/promise). All queries go through prepared
 * statements (parameterised) which prevents SQL injection.
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const __dbHost = String(process.env.DB_HOST || '127.0.0.1').toLowerCase();
const __isLocalDb = ['localhost', '127.0.0.1', '::1', ''].includes(__dbHost);
const __useDbSsl = process.env.DB_SSL === 'true' || (!__isLocalDb && process.env.DB_SSL !== 'false');
let __dbSsl;
if (__useDbSsl) {
  __dbSsl = { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
  if (process.env.DB_SSL_CA) {
    const caPath = path.resolve(process.env.DB_SSL_CA);
    try { __dbSsl.ca = fs.readFileSync(caPath, 'utf8'); }
    catch (error) { throw new Error(`Unable to read DB_SSL_CA (${caPath}): ${error.message}`); }
  }
  if (process.env.DB_SSL_SERVERNAME) __dbSsl.servername = process.env.DB_SSL_SERVERNAME;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'education_platform',
  ssl: __dbSsl,
  // utf8mb4 is required: titles/badges/notifications carry emoji and other
  // 4-byte characters, and XAMPP's MySQL still defaults to latin1 on many installs.
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  // Always run on UTC. time_zone is SET on every fresh connection using the
  // numeric-offset form (`+00:00`) which works on every MySQL/MariaDB build
  // — including default XAMPP installs where named-zone time zones (like
  // 'UTC') fail because the mysql.time_zone* tables aren't populated.
  // Without this, NOW() returns local wall-clock (e.g. IST on an Indian
  // Windows machine) while the driver decodes values as UTC, shifting them
  // ~5h30m into the future — which caused live-quiz joins to hit "This live
  // quiz has not started yet" right after the host pressed Start.
  timezone: 'Z',
  dateStrings: false,
  namedPlaceholders: false,
});

// Force UTC on every new connection. Use promise-compatible .query() on the
// underlying non-promise connection so we don't deadlock with the pool.
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'", (err) => {
    if (err) console.warn('[db] could not set UTC time_zone:', err.message);
  });
});

/** Run a parameterised query and return the rows. */
async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** Run a query and return the first row (or null). */
async function q1(sql, params = []) {
  const rows = await q(sql, params);
  return rows.length ? rows[0] : null;
}

/** Run an INSERT/UPDATE/DELETE and return the result metadata. */
async function exec(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* --------------- first-run automatic database setup --------------- */

const SCHEMA_FILE = path.resolve(__dirname, '..', '..', 'database', 'education_platform.sql');

/** Split a mysqldump-style .sql file into statements (terminator: ';' at a line end). */
function splitSqlStatements(sqlText) {
  const statements = [];
  let buffer = '';
  for (const line of String(sqlText).split(/\r?\n/)) {
    buffer += line + '\n';
    if (line.replace(/\s+$/, '').endsWith(';')) {
      statements.push(buffer);
      buffer = '';
    }
  }
  if (buffer.trim()) statements.push(buffer);
  return statements;
}

/**
 * ER_BAD_DB_ERROR recovery for fresh local installs: the configured database
 * does not exist yet, so create it and import the bundled schema
 * (database/education_platform.sql) using the same credentials the pool uses.
 * Explicit opt-in in EVERY environment (SMARTODL_ALLOW_DB_AUTOSETUP=1; the
 * generated local dev .env sets it). The bundled schema DROPs and recreates
 * every table, so this must never fire merely because NODE_ENV was not
 * exactly "production" while the app pointed at the wrong database host.
 */
/**
 * Runs the bundled schema dump (which itself contains
 * CREATE DATABASE IF NOT EXISTS + USE, so it is safe against a connection
 * with no default database). Returns true when the file was found and the
 * statements executed; false when there is nothing to import.
 */
async function importBundledSchema(admin) {
  const dbName = String(process.env.DB_NAME || 'education_platform');
  if (dbName !== 'education_platform' || !fs.existsSync(SCHEMA_FILE)) return false;
  const statements = splitSqlStatements(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  console.log(`[db] importing ${statements.length} statements from database/education_platform.sql ...`);
  for (const statement of statements) {
    // eslint-disable-next-line no-await-in-loop
    await admin.query(statement);
  }
  return true;
}

/**
 * The "database exists but was never imported" guard.
 *
 * `ping()` only catches ER_BAD_DB_ERROR (missing database), so an empty but
 * existing database — created by a failed earlier import, or by an admin
 * typing CREATE DATABASE — used to connect fine and then die mid-boot with
 * "Table 'education_platform.settings' doesn't exist". This closes that gap:
 * auto-imports the bundled schema when SMARTODL_ALLOW_DB_AUTOSETUP=1, and
 * otherwise returns an actionable reason instead of a raw SQL error.
 */
async function ensureApplicationSchema() {
  const marker = await q1(
    'SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    ['settings'],
  );
  if (Number(marker && marker.c) > 0) return { ok: true };

  const dbName = String(process.env.DB_NAME || 'education_platform');
  if (process.env.SMARTODL_ALLOW_DB_AUTOSETUP === '1' && dbName === 'education_platform' && fs.existsSync(SCHEMA_FILE)) {
    console.warn(`[db] "${dbName}" exists but has no tables - importing the bundled schema (SMARTODL_ALLOW_DB_AUTOSETUP=1)...`);
    let admin = null;
    try {
      admin = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        ssl: __dbSsl,
        charset: 'utf8mb4',
      });
      await importBundledSchema(admin);
    } catch (err) {
      console.error(`[db] automatic schema import failed: ${err.message}`);
      return { ok: false, reason: 'import-failed' };
    } finally {
      if (admin) { try { await admin.end(); } catch (_) { /* ignore */ } }
    }
    const after = await q1(
      'SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      ['settings'],
    );
    if (Number(after && after.c) > 0) {
      console.log(`[db] schema imported - "${dbName}" is ready.`);
      return { ok: true, imported: true };
    }
    return { ok: false, reason: 'import-failed' };
  }

  const hint = dbName === 'education_platform'
    ? 'The database exists but is EMPTY - no tables have been imported yet.'
    : `The database "${dbName}" exists but has no tables (the bundled schema only bootstraps DB_NAME=education_platform).`;
  return { ok: false, reason: 'empty-database', hint };
}

async function provisionMissingDatabase() {
  const dbName = String(process.env.DB_NAME || 'education_platform');
  if (process.env.SMARTODL_ALLOW_DB_AUTOSETUP !== '1') {
    console.error('[db] automatic database setup is disabled (set SMARTODL_ALLOW_DB_AUTOSETUP=1 for a fresh local install, or import the schema as a deploy step).');
    return false;
  }
  let admin;
  try {
    console.log(`[db] database "${dbName}" does not exist - running first-time automatic setup...`);
    admin = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      ssl: __dbSsl,
      charset: 'utf8mb4',
    });
    const bundledImport = await importBundledSchema(admin);
    if (!bundledImport) {
      if (dbName !== 'education_platform') {
        console.warn(`[db] DB_NAME="${dbName}" differs from the bundled schema name ("education_platform"); creating an empty database only.`);
      } else {
        console.warn(`[db] schema file not found at ${SCHEMA_FILE}; creating an empty database only.`);
      }
      await admin.query(
        `CREATE DATABASE IF NOT EXISTS \`${dbName.replace(/`/g, '``')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
    }
    const [rows] = await admin.query(
      'SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema = ?',
      [dbName],
    );
    const tableCount = Number(rows[0].tableCount);
    console.log(`[db] first-time setup finished - "${dbName}" now contains ${tableCount} tables.`);
    if (bundledImport && tableCount < 20) {
      console.error('[db] schema import looks incomplete; the database may be unusable.');
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[db] automatic database setup failed: ${err.message}`);
    console.error('      Import the schema yourself, then restart:');
    console.error('        Manual    : mysql -u root -p education_platform < database\\education_platform.sql');
    console.error('        phpMyAdmin: Import tab -> database/education_platform.sql');
    return false;
  } finally {
    if (admin) { try { await admin.end(); } catch (_) { /* ignore */ } }
  }
}

async function ping() {
  try {
    const rows = await q('SELECT 1 AS ok');
    return rows[0].ok === 1;
  } catch (err) {
    // Fresh install (schema not imported yet): create + import the database, then retry once.
    if (err && err.code === 'ER_BAD_DB_ERROR' && (await provisionMissingDatabase())) {
      const rows = await q('SELECT 1 AS ok');
      return rows[0].ok === 1;
    }
    throw err;
  }
}

module.exports = { pool, q, q1, exec, tx, ping, ensureApplicationSchema };
