'use strict';
/**
 * SmartODL API server
 * ------------------
 *  Express + MySQL REST API for the SmartODL educational & coding platform.
 *
 *  Security highlights
 *   - JWT access tokens + refresh tokens stored in user_sessions (unique per login via jti)
 *   - bcrypt password hashing
 *   - role based (owner/admin/developer/student) + permission based authorization
 *   - parameterised SQL everywhere (mysql2 prepared statements)
 *   - multer file validation (extension whitelist + size limit)
 *   - helmet security headers, CORS allow-list, rate limiting
 *   - submitted code is NEVER executed here: the judge worker / Judge0 does that
 */
require('dotenv').config();
const { validateProductionEnv, ensureDevSecrets } = require('./config/validate-env');
validateProductionEnv();
// Outside production, missing JWT secrets get ephemeral dev-only values
// instead of a 500 on the first login attempt. Production stays strict.
ensureDevSecrets();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');

const { ping, ensureApplicationSchema } = require('./config/db');
const { configurePassport, passport } = require('./config/passport');
require('./services/judge.service'); // fail-fast validation of judge configuration

const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/error');
const { apiLimiter } = require('./middleware/rateLimit');
const { loadSettings } = require('./services/settings.service');

const app = express();
const trustProxy = String(process.env.TRUST_PROXY || (process.env.NODE_ENV === 'production' ? '' : '1')).trim();
app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true' ? true : false);

/* ------------------------------ security ------------------------------ */
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));

const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CLIENT_URL || (isProduction ? '' : 'http://localhost:5173'))
  .split(',').map((s) => s.trim()).filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (!isProduction) {
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      // Hosted preview domains are opt-in, never a silent credentialed-CORS
      // trust for every tenant on those platforms. Set SMARTODL_ALLOW_PREVIEW_ORIGINS=1
      // for a disposable sandbox, or list the exact preview origin in CLIENT_URL.
      if (String(process.env.SMARTODL_ALLOW_PREVIEW_ORIGINS || '') === '1'
          && (/\.e2b\.app$/.test(origin) || /\.arena\.ai$/.test(origin))) return cb(null, true);
    }
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.use(compression());
// Authenticated quiz/problem JSON packages may contain question banks and hidden
// tests; keep a bounded 5 MB ceiling while ordinary URL-encoded forms stay at 1 MB.
app.use(express.json({
  limit: '5mb',
  // The Razorpay webhook HMAC is computed over the exact bytes received, so
  // keep them for that one route (re-serialising parsed JSON would not match).
  verify: (req, res, buf) => {
    if (String(req.originalUrl || '').split('?')[0] === '/api/subscriptions/razorpay/webhook') req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
if (process.env.NODE_ENV !== 'test') {
  // Never write query strings (password-reset/OAuth parameters) or public
  // certificate tokens to application logs.
  morgan.token('safe-url', (req) => String(req.originalUrl || req.url || '')
    .split('?')[0]
    .replace(/^\/api\/cert\/[^/]+/, '/api/cert/[redacted]')
    .replace(/^\/api\/proctor\/second-camera\/[^/]+/, '/api/proctor/second-camera/[redacted]'));
  app.use(morgan('[:date[iso]] :method :safe-url :status - :response-time ms'));
}
app.use('/api', apiLimiter);

/* Public uploads are restricted to validated raster-image directories. Study
   documents are intentionally excluded and can only be fetched through the
   authorization-aware /api/notes/:id/download route. */
const uploadRoot = path.resolve(__dirname, process.env.UPLOAD_DIR || 'uploads');
const imageHeaders = (res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
};
['avatars', 'thumbnails', 'banners', 'landing'].forEach((directory) => {
  app.use(`/uploads/${directory}`, express.static(path.join(uploadRoot, directory), {
    maxAge: '7d',
    setHeaders: imageHeaders,
  }));
});

/* ------------------------------- oauth -------------------------------- */
configurePassport();
app.use(passport.initialize());

/* ------------------------------- routes ------------------------------- */
app.get('/', (req, res) => res.json({
  success: true,
  name: 'SmartODL API',
  version: '1.0.0',
  docs: '/api/health',
  message: 'Learn. Code. Compete. Grow.',
}));
app.use('/api', routes);

/* ------------------------------- errors ------------------------------- */
app.use(notFound);
app.use(errorHandler);

const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || '0.0.0.0';

/** Return a concise startup diagnosis without printing credentials. */
function dbHelp(err) {
  const lines = [
    `Database connection failed (${(err && err.code) || 'unknown error'}).`,
    'Verify the DB_* settings, database service, network policy, and TLS trust.',
  ];
  if (err && err.code === 'ER_BAD_DB_ERROR') {
    lines.push('The database is missing. Fresh install? Run database\\IMPORT-DATABASE.bat (Windows)');
    lines.push('or import database/education_platform.sql in phpMyAdmin, then start again.');
  }
  return lines;
}

async function start() {
  try {
    await ping();
    console.log(`[db] connected to MySQL ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME}`);
  } catch (err) {
    console.error('\n  ✖ Cannot start — the database connection failed.\n');
    dbHelp(err).forEach((l) => console.error(l ? `    ${l}` : ''));
    process.exit(1);
  }
  // "Connected" does not mean "imported". An empty database used to boot past
  // this point and die mid-startup with a raw `Table 'settings' doesn't exist`
  // SQL error, which told nobody that the one missing step was the schema
  // import. Check now (and auto-import when explicitly allowed for local
  // setups), then continue with a clear, actionable message otherwise.
  try {
    const schema = await ensureApplicationSchema();
    if (!schema.ok) {
      console.error('\n  ✖ Cannot start — the database is empty (no SmartODL tables yet).\n');
      if (schema.hint) console.error(`    ${schema.hint}`);
      console.error('    Fix it with ONE of these:');
      console.error('      Windows   : double-click  database\\IMPORT-DATABASE.bat  (XAMPP-aware, safe on first run)');
      console.error('      CLI       : mysql -h 127.0.0.1 -u root -p < database/education_platform.sql');
      console.error('      phpMyAdmin: Import tab -> choose database/education_platform.sql');
      console.error('      Local dev : Setup.bat generates SMARTODL_ALLOW_DB_AUTOSETUP=1 and imports automatically.');
      console.error('');
      process.exit(1);
    }
  } catch (err) {
    console.error('[db] schema readiness check failed:', err.message);
    process.exit(1);
  }
  // Schema/settings first — without them nothing else can answer honestly.
  try {
    const settings = await loadSettings(true);
    console.log(`[settings] loaded ${Object.keys(settings).length} admin-editable settings from the database`);
  } catch (err) {
    console.error('[settings] cannot start without the settings schema:', err.message);
    process.exit(1);
  }
  // Idempotent runtime migrations/upgrades (services/migrations.service.js).
  // They used to live here as ~12 try/catch blocks that logged and carried on,
  // so a half-upgraded production DB started "fine" and then failed at
  // request time. Now: production = fail-fast, and least-privilege
  // deployments can run `npm run migrate` as a deploy step instead and set
  // SMARTODL_SKIP_MIGRATIONS=1.
  if (String(process.env.SMARTODL_SKIP_MIGRATIONS || '') === '1') {
    console.warn('[migrations] SMARTODL_SKIP_MIGRATIONS=1 — skipping runtime schema upgrades (assumes `npm run migrate` already ran)');
    // Do not merely *assume* the deploy step ran: prove the critical schema is
    // there, or the first symptom is "unknown column" mid-exam/mid-payment.
    try {
      const { verifyCriticalSchema } = require('./services/migrations.service');
      const check = await verifyCriticalSchema();
      if (check.ok) {
        console.log('[migrations] critical schema verified (all migration-owned tables/columns present)');
      } else {
        console.error(`[migrations] critical schema is INCOMPLETE — missing: ${check.missing.join(', ')}`);
        console.error('[migrations] run `npm run migrate` with a privileged database account, then start again.');
        if (process.env.NODE_ENV === 'production') process.exit(1);
      }
    } catch (err) {
      console.error('[migrations] critical schema could not be verified:', err.message);
      if (process.env.NODE_ENV === 'production') process.exit(1);
    }
  } else {
    const { runMigrations } = require('./services/migrations.service');
    const result = await runMigrations();
    if (result.failed.length) {
      console.error(`[migrations] ${result.failed.length} upgrade(s) FAILED: ${result.failed.join(', ')}`);
      if (process.env.NODE_ENV === 'production') {
        console.error('[migrations] refusing to start on a half-upgraded schema. Fix the cause above, or run `npm run migrate` as a privileged deploy step and set SMARTODL_SKIP_MIGRATIONS=1.');
        process.exit(1);
      }
    } else {
      console.log(`[migrations] ${result.ran.length} runtime upgrades applied/verified`);
    }
  }
  // Housekeeping: attempts left in_progress for over a day (browser closed,
  // network gone) used to be flat-marked 'abandoned', silently throwing away
  // answers the student had actually saved. They are now GRADED from whatever
  // was stored (that is what a late submit would do), and only attempts that
  // cannot be graded at all fall back to 'abandoned'. Hourly, unref'd so
  // tests can exit.
  const sweepAbandonedAttempts = async () => {
    try {
      const { q, exec } = require('./config/db');
      const { evaluateAttempt } = require('./controllers/quiz.controller');
      const stale = await q(
        `SELECT qa.id, q.status AS quiz_status, q.end_at, q.time_limit_minutes
           FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id
          WHERE qa.status = 'in_progress' AND qa.started_at < (NOW() - INTERVAL 24 HOUR)
          LIMIT 200`,
      );
      let graded = 0, abandoned = 0;
      for (const a of stale) {
        // A live session that is genuinely still open must not be graded
        // behind the host's back — leave it for endLive to handle.
        if (a.quiz_status === 'live' && !(a.end_at && new Date(a.end_at).getTime() < Date.now())) continue;
        try {
          await evaluateAttempt(a.id);
          graded += 1;
        } catch (err) {
          await exec("UPDATE quiz_attempts SET status = 'abandoned' WHERE id = ? AND status = 'in_progress'", [a.id])
            .catch(() => {});
          abandoned += 1;
        }
      }
      if (graded || abandoned) console.log(`[housekeeping] stale attempts: ${graded} graded from saved answers, ${abandoned} abandoned`);
    } catch (err) { console.warn('[housekeeping] attempt sweep failed:', err.message); }
  };
  setInterval(sweepAbandonedAttempts, 60 * 60 * 1000).unref();
  app.listen(PORT, HOST, () => {
    console.log(`[api] SmartODL API listening on http://${HOST}:${PORT}`);
    if (String(process.env.DEV_SHOW_RESET_LINK || '').trim().toLowerCase() === 'true'
        && process.env.NODE_ENV !== 'production') {
      console.warn(
        '[security] DEV_SHOW_RESET_LINK=true — /auth/forgot-password returns a reset token to any caller. '
        + 'This is acceptable only on a closed, local-only machine. If this server is reachable through a tunnel '
        + 'or public IP, set it to false in .env immediately.',
      );
    }
    if (process.env.NODE_ENV === 'production' && !String(process.env.UPLOAD_DIR || '').trim()) {
      console.warn('[uploads] UPLOAD_DIR is not set — uploads go to backend/uploads on local disk. '
        + 'On a host with an ephemeral filesystem (containers/PaaS) every redeploy will delete them; '
        + 'point UPLOAD_DIR at persistent storage there.');
    }
    console.log(`[api] CLIENT_URL = ${process.env.CLIENT_URL}`);
    {
      const { clientOrigin, isClientUrlConfigured } = require('./utils/clientUrl');
      if (!isClientUrlConfigured()) {
        console.warn(
          `[config] CLIENT_URL is not configured correctly — certificate links, password-reset links, and `
          + `OAuth redirects will use "${clientOrigin()}". Enter the complete URL in .env, `
          + `including the scheme (for example https://your-domain.com).`,
        );
      }
    }
    console.log(`[api] code execution mode = ${process.env.JUDGE_MODE || 'local'} (never inside this process)`);
  });
}

if (require.main === module) start();
module.exports = app;
