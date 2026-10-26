'use strict';

/**
 * First-run helper for the Windows Setup.bat launcher.
 *
 * It creates ignored, development-only .env files without shipping default
 * credentials. Database details are supplied by the operator; JWT and judge
 * secrets are generated locally with crypto.randomBytes(). Existing files are
 * never overwritten.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const backendDir = path.resolve(__dirname, '..');
const projectDir = path.resolve(backendDir, '..');
const apiEnvPath = path.join(backendDir, '.env');
const judgeEnvPath = path.join(backendDir, 'judge-service', '.env');

function parseEnv(file) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch (_) { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    result[match[1]] = value;
  }
  return result;
}

const quote = (value) => JSON.stringify(String(value == null ? '' : value));
const randomSecret = (bytes = 48) => crypto.randomBytes(bytes).toString('hex');

function restrictSecretFile(file) {
  // POSIX: DB password + JWT/judge secrets must not inherit a world-readable
  // 0644 mode. Windows primarily uses ACLs and Node chmod is best-effort
  // there, so a platform that cannot apply the mode must not abort setup.
  try { fs.chmodSync(file, 0o600); } catch (_) { /* best effort */ }
}

function writeSecretFile(file, content) {
  fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  restrictSecretFile(file);
}

async function maskedPrompt(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Run Setup.bat directly in an interactive Command Prompt.');
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
      for (const char of buffer.toString('utf8')) {
        if (char === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Setup cancelled.'));
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

async function createApiEnv(existingJudge) {
  console.log('\nSmartODL local setup — database connection');
  console.log('The database/schema must already exist. Values are saved only in ignored backend/.env.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (label, fallback) => {
    const answer = (await rl.question(`${label} [${fallback}]: `)).trim();
    return answer || fallback;
  };

  let dbHost;
  let dbPort;
  let dbName;
  let dbUser;
  try {
    dbHost = process.env.SMARTODL_DB_HOST || await ask('Database host', '127.0.0.1');
    dbPort = process.env.SMARTODL_DB_PORT || await ask('Database port', '3306');
    dbName = process.env.SMARTODL_DB_NAME || await ask('Database name', 'education_platform');
    dbUser = process.env.SMARTODL_DB_USER || await ask('Database user', 'smartodl_app');
  } finally {
    rl.close();
  }

  const dbPassword = process.env.SMARTODL_DB_PASSWORD !== undefined
    ? process.env.SMARTODL_DB_PASSWORD
    : await maskedPrompt('Database password (blank is allowed only for a local development DB): ');

  if (!/^\d{1,5}$/.test(dbPort) || Number(dbPort) < 1 || Number(dbPort) > 65535) {
    throw new Error('Database port must be between 1 and 65535.');
  }
  for (const [name, value] of Object.entries({ dbHost, dbName, dbUser })) {
    if (!value || /[\r\n]/.test(value)) throw new Error(`${name} is invalid.`);
  }

  // A previously copied-from-example token is public knowledge — never keep it.
  const leaked = String(existingJudge.JUDGE_SERVICE_TOKEN || '').toLowerCase().startsWith('294676c6c5bf4357');
  const judgeToken = !leaked && existingJudge.JUDGE_SERVICE_TOKEN && existingJudge.JUDGE_SERVICE_TOKEN.length >= 32
    ? existingJudge.JUDGE_SERVICE_TOKEN
    : randomSecret(32);

  const content = `# Generated by Setup.bat for local Windows development. Never commit this file.\nNODE_ENV=development\nHOST=0.0.0.0\nPORT=5000\nCLIENT_URL=http://localhost:5173\nTRUST_PROXY=false\n\nDB_HOST=${quote(dbHost)}\nDB_PORT=${dbPort}\nDB_USER=${quote(dbUser)}\nDB_PASSWORD=${quote(dbPassword)}\nDB_NAME=${quote(dbName)}\nDB_CONNECTION_LIMIT=10\nDB_SSL=false\nDB_SSL_REJECT_UNAUTHORIZED=true\n\nJWT_ACCESS_SECRET=${randomSecret(64)}\nJWT_REFRESH_SECRET=${randomSecret(64)}\nJWT_ACCESS_EXPIRES=15m\nJWT_REFRESH_EXPIRES=30d\n\nJUDGE_MODE=local\nJUDGE_SERVICE_URL=http://127.0.0.1:2358\nJUDGE_SERVICE_TOKEN=${judgeToken}\n\nUPLOAD_DIR=uploads\nMAX_FILE_SIZE_MB=25\nMAIL_MODE=disabled\nHINT_COST_POINTS=5\n\nRATE_LIMIT_WINDOW_MS=900000\nRATE_LIMIT_MAX=3000\nAUTH_RATE_LIMIT_MAX=30\nEXECUTION_RATE_LIMIT_MAX=60\nSUBMIT_RATE_LIMIT_MAX=20\nWRITE_RATE_LIMIT_MAX=180\nRATE_LIMIT_DISABLED=false\nSMARTODL_ALLOW_DB_AUTOSETUP=1\n`;
  writeSecretFile(apiEnvPath, content);
  console.log('Created backend/.env with generated JWT and judge secrets.');
  return parseEnv(apiEnvPath);
}

function createJudgeEnv(api) {
  const token = String(api.JUDGE_SERVICE_TOKEN || '');
  if (token.length < 32) throw new Error('JUDGE_SERVICE_TOKEN in backend/.env must contain at least 32 characters.');
  const content = `# Generated by Setup.bat for local Windows development. Never commit this file.\nNODE_ENV=development\nJUDGE_HOST=127.0.0.1\nJUDGE_PORT=2358\nJUDGE_SERVICE_TOKEN=${token}\nJUDGE_CONCURRENCY=2\nSQL_SANDBOX_ENABLED=false\n`;
  writeSecretFile(judgeEnvPath, content);
  console.log('Created backend/judge-service/.env with the matching service token.');
  return parseEnv(judgeEnvPath);
}

async function ensureLocalEnv() {
  if (fs.existsSync(apiEnvPath)) restrictSecretFile(apiEnvPath);
  if (fs.existsSync(judgeEnvPath)) restrictSecretFile(judgeEnvPath);
  let api = parseEnv(apiEnvPath);
  let judge = parseEnv(judgeEnvPath);

  if (!fs.existsSync(apiEnvPath)) api = await createApiEnv(judge);

  const judgeMode = String(api.JUDGE_MODE || '').trim();
  if (!['local', 'judge0'].includes(judgeMode)) {
    throw new Error('backend/.env must set JUDGE_MODE=local or JUDGE_MODE=judge0.');
  }

  if (judgeMode === 'local') {
    if (!fs.existsSync(judgeEnvPath)) judge = createJudgeEnv(api);
    const apiToken = String(api.JUDGE_SERVICE_TOKEN || '');
    const judgeToken = String(judge.JUDGE_SERVICE_TOKEN || '');
    if (apiToken.length < 32 || judgeToken.length < 32 || apiToken !== judgeToken) {
      throw new Error('API and judge JUDGE_SERVICE_TOKEN values are missing or do not match. Correct the ignored .env files before starting.');
    }
  }

  if (!api.DB_HOST || !api.DB_PORT || !api.DB_USER || !api.DB_NAME) {
    throw new Error('backend/.env is missing one or more required DB_* settings.');
  }

  return { judgeMode };
}

function backupExistingLocalConfig() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  for (const file of [apiEnvPath, judgeEnvPath]) {
    if (!fs.existsSync(file)) continue;
    const backup = `${file}.backup-${stamp}`;
    fs.renameSync(file, backup);
    console.log(`Backed up ${path.relative(projectDir, file)} to ${path.basename(backup)}.`);
  }
}

async function main() {
  if (process.argv.includes('--reset-local')) {
    backupExistingLocalConfig();
    await ensureLocalEnv();
    console.log(`Local configuration is ready in ${path.relative(projectDir, backendDir)}.`);
    return;
  }

  const api = parseEnv(apiEnvPath);
  if (process.argv.includes('--print-judge-mode')) {
    process.stdout.write(String(api.JUDGE_MODE || ''));
    return;
  }
  if (process.argv.includes('--print-db-host')) {
    process.stdout.write(String(api.DB_HOST || ''));
    return;
  }
  if (process.argv.includes('--print-db-port')) {
    process.stdout.write(String(api.DB_PORT || ''));
    return;
  }
  await ensureLocalEnv();
  console.log(`Local configuration is ready in ${path.relative(projectDir, backendDir)}.`);
}

main().catch((error) => {
  console.error(`Setup configuration failed: ${error.message}`);
  process.exitCode = 1;
});
