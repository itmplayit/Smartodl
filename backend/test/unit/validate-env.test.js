'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProductionEnv } = require('../../config/validate-env');

const validEnv = () => ({
  NODE_ENV: 'production',
  CLIENT_URL: 'https://smartodl.example.com',
  TRUST_PROXY: '1',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'smartodl_app',
  DB_PASSWORD: 'a-very-long-db-password-123',
  DB_NAME: 'education_platform',
  DB_CONNECTION_LIMIT: '10',
  DB_SSL: 'false',
  DB_SSL_REJECT_UNAUTHORIZED: 'true',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'b'.repeat(64),
  JUDGE_MODE: 'local',
  JUDGE_SERVICE_URL: 'http://127.0.0.1:2358',
  JUDGE_SERVICE_TOKEN: 'c'.repeat(48),
  MAIL_MODE: 'disabled',
  PORT: '5000',
  MAX_FILE_SIZE_MB: '25',
  RATE_LIMIT_WINDOW_MS: '900000',
  RATE_LIMIT_MAX: '3000',
  AUTH_RATE_LIMIT_MAX: '30',
  EXECUTION_RATE_LIMIT_MAX: '60',
  SUBMIT_RATE_LIMIT_MAX: '20',
  WRITE_RATE_LIMIT_MAX: '180',
});

test('a fully valid production env passes', () => {
  assert.equal(validateProductionEnv(validEnv()), true);
});

test('non-production skips validation', () => {
  assert.equal(validateProductionEnv({ NODE_ENV: 'development' }), true);
});

test('the leaked example judge token is refused', () => {
  const env = validEnv();
  env.JUDGE_SERVICE_TOKEN = `294676c6c5bf4357${'d'.repeat(48)}`;
  assert.throws(() => validateProductionEnv(env), /JUDGE_SERVICE_TOKEN/);
});

test('demo payments cannot be enabled in production', () => {
  const env = validEnv();
  env.ALLOW_DEMO_PAYMENTS = 'true';
  assert.throws(() => validateProductionEnv(env), /ALLOW_DEMO_PAYMENTS/);
});

test('automatic DB setup cannot be enabled in production', () => {
  const env = validEnv();
  env.SMARTODL_ALLOW_DB_AUTOSETUP = '1';
  assert.throws(() => validateProductionEnv(env), /SMARTODL_ALLOW_DB_AUTOSETUP/);
});

test('root DB user and identical JWT secrets are refused', () => {
  const env = validEnv();
  env.DB_USER = 'root';
  env.JWT_REFRESH_SECRET = env.JWT_ACCESS_SECRET;
  assert.throws(() => validateProductionEnv(env), /DB_USER|JWT/);
});
