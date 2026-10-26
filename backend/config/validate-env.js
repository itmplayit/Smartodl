'use strict';

const DEFAULT_MARKERS = [
  'change_this', 'changeme', 'replace_me', 'replace-with', 'dev_access_secret',
  'dev_refresh_secret', 'change_this_judge_secret', 'secret123', 'password123',
  // Prefix of a judge token that was once shipped in judge-service/.env.example
  // and is therefore public knowledge — a production start carrying it is a
  // remotely exploitable code-execution service.
  '294676c6c5bf4357',
];

const value = (env, name) => String(env[name] || '').trim();
const isLocalHost = (host) => ['localhost', '127.0.0.1', '::1'].includes(String(host || '').toLowerCase());
const looksDefault = (input) => {
  const lower = String(input || '').toLowerCase();
  return DEFAULT_MARKERS.some((marker) => lower.includes(marker));
};

function positiveInteger(env, name, errors, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = value(env, name);
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < min || n > max) errors.push(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

function validUrl(raw, name, errors, { https = false, originOnly = false } = {}) {
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    if (https && parsed.protocol !== 'https:') errors.push(`${name} must use https:// in production`);
    if (parsed.username || parsed.password) errors.push(`${name} must not contain embedded credentials`);
    if (originOnly && (parsed.pathname !== '/' || parsed.search || parsed.hash)) errors.push(`${name} must be an origin only (no path, query, or fragment)`);
    return parsed;
  } catch (_) {
    errors.push(`${name} must be a valid http(s) URL`);
    return null;
  }
}

function validateProductionEnv(env = process.env) {
  if (env.NODE_ENV !== 'production') return true;
  const errors = [];
  const required = ['CLIENT_URL', 'TRUST_PROXY', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JUDGE_MODE', 'MAIL_MODE'];
  required.forEach((name) => { if (!value(env, name)) errors.push(`${name} is required`); });

  const origins = value(env, 'CLIENT_URL').split(',').map((item) => item.trim()).filter(Boolean);
  if (origins.length !== 1) errors.push('CLIENT_URL must contain exactly one production origin');
  origins.forEach((origin) => validUrl(origin, 'CLIENT_URL', errors, { https: true, originOnly: true }));

  const dbUser = value(env, 'DB_USER').toLowerCase();
  if (['root', 'administrator', 'admin'].includes(dbUser)) errors.push('DB_USER must be a dedicated least-privilege application user, not root/admin');
  if (value(env, 'DB_PASSWORD').length < 12 || looksDefault(value(env, 'DB_PASSWORD'))) errors.push('DB_PASSWORD must be a non-default value of at least 12 characters');
  positiveInteger(env, 'DB_PORT', errors, { min: 1, max: 65535 });
  positiveInteger(env, 'DB_CONNECTION_LIMIT', errors, { min: 1, max: 200 });
  if (!isLocalHost(value(env, 'DB_HOST')) && value(env, 'DB_SSL').toLowerCase() === 'false') errors.push('DB_SSL cannot be disabled for a remote production database');
  if (value(env, 'DB_SSL_REJECT_UNAUTHORIZED').toLowerCase() === 'false') errors.push('DB_SSL_REJECT_UNAUTHORIZED cannot be false in production');

  const access = value(env, 'JWT_ACCESS_SECRET');
  const refresh = value(env, 'JWT_REFRESH_SECRET');
  if (access.length < 48 || looksDefault(access)) errors.push('JWT_ACCESS_SECRET must be a non-default random value of at least 48 characters');
  if (refresh.length < 48 || looksDefault(refresh)) errors.push('JWT_REFRESH_SECRET must be a non-default random value of at least 48 characters');
  if (access && refresh && access === refresh) errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');

  const judgeMode = value(env, 'JUDGE_MODE');
  if (!['local', 'judge0'].includes(judgeMode)) errors.push('JUDGE_MODE must be local or judge0');
  if (judgeMode === 'local') {
    let judgeServiceHost = '';
    try { judgeServiceHost = new URL(value(env, 'JUDGE_SERVICE_URL')).hostname; } catch (_) { /* validated below */ }
    validUrl(value(env, 'JUDGE_SERVICE_URL'), 'JUDGE_SERVICE_URL', errors, { https: !isLocalHost(judgeServiceHost) });
    const token = value(env, 'JUDGE_SERVICE_TOKEN');
    if (token.length < 32 || looksDefault(token)) errors.push('JUDGE_SERVICE_TOKEN must be a non-default random value of at least 32 characters');
  }
  if (judgeMode === 'judge0') {
    const judgeUrl = value(env, 'JUDGE0_URL');
    let judgeHost = '';
    try { judgeHost = new URL(judgeUrl).hostname; } catch (_) { /* validated below */ }
    validUrl(judgeUrl, 'JUDGE0_URL', errors, { https: !isLocalHost(judgeHost) });
    if (judgeUrl === 'https://ce.judge0.com' && !value(env, 'JUDGE0_RAPIDAPI_KEY')) errors.push('Configure a managed/private JUDGE0_URL (or credentials) instead of the public default endpoint');
  }

  for (const provider of ['GOOGLE', 'GITHUB']) {
    const id = value(env, `${provider}_CLIENT_ID`);
    const secret = value(env, `${provider}_CLIENT_SECRET`);
    if (!!id !== !!secret) errors.push(`${provider}_CLIENT_ID and ${provider}_CLIENT_SECRET must either both be set or both be empty`);
    if (id && secret) validUrl(value(env, `${provider}_CALLBACK_URL`), `${provider}_CALLBACK_URL`, errors, { https: true });
  }

  const mailMode = value(env, 'MAIL_MODE');
  if (!['smtp', 'disabled'].includes(mailMode)) errors.push('MAIL_MODE must be smtp or disabled');
  if (mailMode === 'smtp') {
    ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'].forEach((name) => { if (!value(env, name)) errors.push(`${name} is required when MAIL_MODE=smtp`); });
    positiveInteger(env, 'SMTP_PORT', errors, { min: 1, max: 65535 });
    if (looksDefault(value(env, 'SMTP_PASS'))) errors.push('SMTP_PASS must not be a placeholder/default value');
    if (value(env, 'SMTP_TLS_REJECT_UNAUTHORIZED').toLowerCase() === 'false') errors.push('SMTP_TLS_REJECT_UNAUTHORIZED cannot be false in production');
  }

  if (['1', 'true', 'yes', 'on'].includes(value(env, 'RATE_LIMIT_DISABLED').toLowerCase())) errors.push('RATE_LIMIT_DISABLED must be false in production');
  if (value(env, 'ALLOW_DEMO_PAYMENTS').toLowerCase() === 'true') errors.push('ALLOW_DEMO_PAYMENTS must not be true in production (demo checkout activates paid plans/courses without any payment)');
  if (value(env, 'SMARTODL_ALLOW_DB_AUTOSETUP') === '1') errors.push('SMARTODL_ALLOW_DB_AUTOSETUP must not be 1 in production (it imports the destructive schema with app credentials)');
  ['RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX', 'AUTH_RATE_LIMIT_MAX', 'EXECUTION_RATE_LIMIT_MAX', 'SUBMIT_RATE_LIMIT_MAX', 'WRITE_RATE_LIMIT_MAX']
    .forEach((name) => positiveInteger(env, name, errors, { min: 1, max: name.endsWith('_MS') ? 86400000 : 1000000 }));

  const redisUrl = value(env, 'REDIS_URL');
  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      if (!['redis:', 'rediss:'].includes(parsed.protocol)) throw new Error('protocol');
    } catch (_) { errors.push('REDIS_URL must be a valid redis:// or rediss:// URL when set'); }
  }

  const trustProxy = value(env, 'TRUST_PROXY').toLowerCase();
  if (trustProxy === 'true' || (!/^\d+$/.test(trustProxy) && trustProxy !== 'false')) errors.push('TRUST_PROXY must be false or a specific proxy-hop count (for example 1), never true');
  positiveInteger(env, 'PORT', errors, { min: 1, max: 65535 });
  positiveInteger(env, 'MAX_FILE_SIZE_MB', errors, { min: 1, max: 250 });

  if (errors.length) {
    const error = new Error(`Invalid production environment:\n - ${errors.join('\n - ')}`);
    error.code = 'INVALID_PRODUCTION_ENV';
    throw error;
  }
  return true;
}

/**
 * Non-production convenience: a dev run without .env used to boot fine and
 * then return 500 on every login attempt ("secretOrPrivateKey must have a
 * value"). Out-of-the-box development gets ephemeral per-boot secrets instead;
 * production validation above still refuses to start without real ones.
 */
function ensureDevSecrets(env = process.env) {
  if (env.NODE_ENV === 'production') return false;
  const crypto = require('crypto');
  let created = false;
  for (const [name, other] of [['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'], ['JWT_REFRESH_SECRET', 'JWT_ACCESS_SECRET']]) {
    if (!String(env[name] || '').trim()) {
      let candidate = crypto.randomBytes(48).toString('hex');
      while (candidate === env[other]) candidate = crypto.randomBytes(48).toString('hex');
      env[name] = candidate;
      created = true;
    }
  }
  if (created) {
    console.warn('[security] JWT secrets are not configured — generated ephemeral dev-only secrets for this process. '
      + 'Every restart logs everyone out. Create a real .env (Setup.bat does this automatically) before sharing this install.');
  }
  return created;
}

if (require.main === module) {
  try {
    validateProductionEnv();
    console.log(process.env.NODE_ENV === 'production' ? 'Production environment is valid.' : 'Production validation skipped (NODE_ENV is not production).');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { validateProductionEnv, ensureDevSecrets };
