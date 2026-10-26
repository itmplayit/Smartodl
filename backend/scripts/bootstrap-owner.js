'use strict';

/**
 * One-time, interactive first-owner bootstrap.
 * The password is read from a masked TTY prompt and is never accepted via
 * command-line arguments or environment variables.
 */
require('dotenv').config();
const readline = require('readline/promises');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

function maskedPrompt(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('A real interactive terminal is required for the masked password prompt.');
  }
  return new Promise((resolve, reject) => {
    let answer = '';
    const stdin = process.stdin;
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };
    const onData = (buffer) => {
      const input = buffer.toString('utf8');
      for (const char of input) {
        if (char === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(answer);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (answer.length) {
            answer = answer.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (char >= ' ' && char !== '\u007f') {
          answer += char;
          process.stdout.write('*');
        }
      }
    };
    process.stdout.write(label);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.on('data', onData);
  });
}

function validatePassword(password) {
  if (password.length < 14) return 'Password must be at least 14 characters.';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password must be no more than 72 UTF-8 bytes.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include lowercase, uppercase, a number, and a symbol.';
  }
  return null;
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command directly in an interactive terminal.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('SmartODL first-owner bootstrap');
    console.log('This command works only while the users table is empty.\n');
    const fullName = (await rl.question('Full name: ')).trim().replace(/\s+/g, ' ');
    const email = (await rl.question('Email: ')).trim().toLowerCase();
    if (fullName.length < 2 || fullName.length > 120) throw new Error('Full name must be between 2 and 120 characters.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) throw new Error('Enter a valid email address.');
    rl.close();

    const password = await maskedPrompt('Password: ');
    const passwordError = validatePassword(password);
    if (passwordError) throw new Error(passwordError);
    const confirmation = await maskedPrompt('Confirm password: ');
    if (password !== confirmation) throw new Error('Passwords do not match.');

    const passwordHash = await bcrypt.hash(password, 12);
    const conn = await pool.getConnection();
    let transactionStarted = false;
    let committed = false;
    let lockAcquired = false;
    try {
      const [lockRows] = await conn.query("SELECT GET_LOCK('smartodl_first_owner', 10) AS acquired");
      lockAcquired = !!lockRows[0] && Number(lockRows[0].acquired) === 1;
      if (!lockAcquired) throw new Error('Could not acquire the bootstrap lock. Try again.');
      await conn.beginTransaction();
      transactionStarted = true;
      const [counts] = await conn.query('SELECT COUNT(*) AS total FROM users');
      if (Number(counts[0].total) !== 0) throw new Error('Bootstrap refused: the users table is not empty. Manage accounts from the authenticated administration centre.');
      const [roles] = await conn.execute("SELECT id FROM roles WHERE slug = 'owner' LIMIT 1");
      if (!roles.length) throw new Error('Owner role is missing. Import the clean database schema first.');
      await conn.execute(
        `INSERT INTO users
           (full_name, email, password_hash, role_id, provider, status, email_verified)
         VALUES (?, ?, ?, ?, 'local', 'active', 1)`,
        [fullName, email, passwordHash, roles[0].id],
      );
      await conn.commit();
      committed = true;
    } catch (error) {
      if (transactionStarted && !committed) await conn.rollback().catch(() => {});
      throw error;
    } finally {
      if (lockAcquired) await conn.query("SELECT RELEASE_LOCK('smartodl_first_owner')").catch(() => {});
      conn.release();
    }
    console.log('\nOwner created successfully. No password was stored outside the database hash.');
  } finally {
    rl.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Bootstrap failed: ${error.message}`);
  process.exitCode = 1;
});
