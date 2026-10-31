'use strict';
/** Multi-type certificates: course completion, quiz excellence, contest winner,
 *  coding milestones. Each type has its own visual theme + printed template. */
const { q, q1, exec, tx } = require('../config/db');
const { ApiError, asyncHandler, ok } = require('../utils/helpers');
const { clientOrigin, isClientUrlConfigured } = require('../utils/clientUrl');

/** An http(s) origin and nothing else — no path, no credentials, no spaces. */
const SAFE_ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;
let warnedAboutCertOrigin = false;

/**
 * Origin printed in the "VERIFY CERTIFICATE" link.
 *
 * CLIENT_URL is the authority. When it is NOT configured the old fallback was
 * http://localhost:5173, which is wrong on every hosted / tunnelled install —
 * the certificate would print a verify link nobody can open. The browser that
 * asked for this certificate already tells us the real front-end origin, so
 * prefer that over a default that is guaranteed to be wrong.
 *
 * Only a strictly-shaped Origin/Referer is accepted, so a junk header cannot
 * inject markup or a path into the printed URL.
 */
function resolveClientOrigin(res) {
  if (isClientUrlConfigured()) return clientOrigin();

  const req = res && res.req;
  let candidate = req ? String(req.get('origin') || '').trim() : '';
  if (!candidate && req) {
    const match = /^(https?:\/\/[^/?#]+)/i.exec(String(req.get('referer') || ''));
    if (match) candidate = match[1];
  }
  if (candidate && SAFE_ORIGIN.test(candidate)) {
    if (!warnedAboutCertOrigin) {
      warnedAboutCertOrigin = true;
      console.warn('[certificate] CLIENT_URL is not configured — the verify link is being '
        + `taken from the requesting browser (${candidate}). Set CLIENT_URL in backend/.env `
        + 'so printed certificates always carry the same address.');
    }
    return candidate.replace(/\/+$/, '');
  }
  return clientOrigin();
}
const crypto = require('crypto');
const QRCode = require('qrcode');
const { buildCertificatePdf } = require('../services/certificatePdf.service');
const certTemplates = require('../services/certificateTemplates.service');
const certificateIntegrity = require('../services/certificateIntegrity.service');
const notifications = require('../services/notification.service');
const { publicUrl } = require('../middleware/upload');

/**
 * QR payload for a certificate: the public verification URL. Scanning the
 * printed sheet opens /cert/{token} — so a paper certificate is verifiable
 * without anyone typing a 24-character token.
 * Returns an inline SVG (rendered inside the certificate HTML, no extra request).
 */
async function verifyQrSvg(verifyUrl) {
  const svg = await QRCode.toString(verifyUrl, {
    type: 'svg', margin: 0, errorCorrectionLevel: 'M',
    color: { dark: '#0b1020', light: '#ffffff' },
  });
  // strip the XML prolog + fixed width/height so CSS can size it
  return String(svg)
    .replace(/<\?xml[^>]*\?>/i, '')
    .replace(/width="[^"]*"/i, 'width="100%"')
    .replace(/height="[^"]*"/i, 'height="100%"');
}

/** Plain-text versions of the HTML subject line / meta row, for the PDF. */
function pdfSubject(c) {
  const date = new Date(c.issued_at || Date.now())
    .toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  switch (c.cert_type) {
    case 'quiz': return `by achieving ${Number(c.score_percent || 0).toFixed(0)}% in the quiz:`;
    case 'contest': return 'for outstanding performance in the contest:';
    case 'milestone': return `by reaching the milestone ${tierLabel(c.tier)} on the platform.`;
    case 'path': return 'for completing every required course in the programme:';
    default: return 'has successfully completed all modules and lessons of the course';
  }
}
function pdfMeta(c) {
  const date = new Date(c.issued_at || Date.now())
    .toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  switch (c.cert_type) {
    case 'quiz':
      return [
        { label: 'Grade', value: c.grade },
        { label: 'Score', value: `${Number(c.score_percent || 0).toFixed(0)}%` },
        { label: 'Recognition', value: tierLabel(c.tier) },
        { label: 'Issued On', value: date },
      ];
    case 'contest':
      return [
        { label: 'Grade', value: c.grade || '★' },
        { label: 'Rank', value: tierLabel(c.tier) },
        { label: 'Format', value: 'Live' },
        { label: 'Issued On', value: date },
      ];
    case 'milestone':
      return [
        { label: 'Grade', value: c.grade },
        { label: 'Milestone', value: tierLabel(c.tier) },
        { label: 'Track', value: 'Coding' },
        { label: 'Issued On', value: date },
      ];
    case 'path':
      return [
        { label: 'Courses', value: 'All required' },
        { label: 'Path completion', value: '100%' },
        { label: 'Issued On', value: date },
      ];
    default:
      return [
        { label: 'Issued On', value: date },
        { label: 'Grade', value: c.grade },
        { label: 'Score', value: `${Number(c.score_percent || 0).toFixed(0)}%` },
        { label: 'Duration', value: `${Number(c.duration_hours || 0)} hrs` },
      ];
  }
}

/** PNG variant for the PDF renderer. */
async function verifyQrPng(verifyUrl, width = 320) {
  return QRCode.toBuffer(verifyUrl, {
    type: 'png', width, margin: 1, errorCorrectionLevel: 'M',
    color: { dark: '#0b1020', light: '#ffffff' },
  });
}

const TYPES = {
  course:    { prefix: 'CRS', theme: 'gold',  label: 'Course Completion' },
  quiz:      { prefix: 'QZR', theme: 'blue',  label: 'Quiz Excellence' },
  contest:   { prefix: 'WIN', theme: 'red',   label: 'Contest Champion' },
  milestone: { prefix: 'MIL', theme: 'green', label: 'Coding Milestone' },
  // Legacy: path certificates may exist from before tracks were folded into courses.
  // They stay verifiable; no new ones are issued.
  path:      { prefix: 'PTH', theme: 'purple', label: 'Programme Completion' },
};

function genCertNo(prefix) {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  // Six random bytes provide about 281 trillion values for the readable part. Previously there were only three bytes
  // (16.7 million), which made enumeration through public number search feasible.
  return `SOD-${prefix}-${y}${m}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}
function genToken() { return crypto.randomBytes(18).toString('hex'); }
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/**
 * Expands {{placeholders}} in an admin-authored template string.
 * The string is already HTML-escaped by the caller, so the only markup that
 * can reach the page is the <b> we wrap substituted values in.
 */
const SUBTITLE_TOKENS = ['student', 'title', 'score', 'grade', 'tier', 'date', 'duration', 'certificate_no'];
function renderTokens(text, values) {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) => {
    const k = key.toLowerCase();
    if (!SUBTITLE_TOKENS.includes(k)) return match;
    const v = values[k];
    return v == null || v === '' ? '' : `<b>${v}</b>`;
  });
}

function gradeOf(pct) {
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 50) return 'D';
  return 'F';
}

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round((Number(value) || 0) * 100) / 100));
const rankFromTier = (tier) => {
  if (tier === 'champion') return 1;
  if (tier === 'runner_up') return 2;
  if (tier === 'finalist') return 3;
  const match = /^top_(\d+)$/.exec(String(tier || ''));
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

async function _issue({ userId, certType, courseId = 0, contextId = null, enrollmentId = null, title, score = 100, tier = 'completion' }) {
  const t = TYPES[certType]; if (!t) throw new Error('unknown cert type: ' + certType);
  const safeScore = clampPercent(score);
  // Design binding: freeze the template this certificate is awarded under, so a
  // later template edit cannot restyle a credential that is already printed.
  const design = await certTemplates.snapshotFor(certType);
  // One certificate per (user,type,context); milestones are distinct *by
  // tier*. Locking the user makes the check-then-insert atomic, and a later
  // better qualifying result upgrades the existing credential instead of
  // being permanently stuck with the first attempt's grade.
  return tx(async (conn) => {
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    const params = [userId, certType, contextId, courseId || null];
    let sql = `SELECT * FROM certificates
                WHERE user_id=? AND cert_type=? AND context_id <=> ? AND (course_id <=> ?)`;
    if (certType === 'milestone') { sql += ' AND tier <=> ?'; params.push(tier); }
    sql += ' ORDER BY id LIMIT 1 FOR UPDATE';
    const [[existing]] = await conn.query(sql, params);
    if (existing) {
      if (existing.revoked_at) return null; // revocation is a tombstone
      const betterScore = safeScore > Number(existing.score_percent || 0);
      const betterContestRank = certType === 'contest'
        && rankFromTier(tier) < rankFromTier(existing.tier);
      if (betterScore || betterContestRank) {
        await conn.execute(
          `UPDATE certificates
              SET grade = ?, score_percent = ?, tier = ?, title = ?,
                  enrollment_id = COALESCE(?, enrollment_id)
            WHERE id = ?`,
          [gradeOf(safeScore), safeScore, tier, title, enrollmentId, existing.id],
        );
      }
      return existing.id;
    }
    const [result] = await conn.execute(
      `INSERT INTO certificates (user_id, course_id, context_id, cert_type, enrollment_id,
         template_id, design_snapshot, certificate_no, public_token, grade, score_percent, tier, title, issued_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, NOW())`,
      [userId, courseId || null, contextId, certType, enrollmentId,
        design.template_id, design.design_snapshot,
        genCertNo(t.prefix), genToken(), gradeOf(safeScore), safeScore, tier, title],
    );
    return result.insertId;
  });
}

/**
 * Certificates used to appear silently: the student only found out by visiting
 * /certificates. Every new award now also lands in the notification bell.
 * Failures here must never break issuance, hence the try/catch.
 */
async function notifyIssued(certificateId) {
  if (!certificateId) return;
  try {
    const row = await q1(
      `SELECT c.id, c.user_id, c.cert_type, c.public_token,
              COALESCE(c.title, co.title, z.title, cs.title) AS display_title
         FROM certificates c
         LEFT JOIN courses co ON co.id = c.course_id
         LEFT JOIN quizzes z ON z.id = c.context_id AND c.cert_type = 'quiz'
         LEFT JOIN contests cs ON cs.id = c.context_id AND c.cert_type = 'contest'
        WHERE c.id = ? AND c.revoked_at IS NULL`, [certificateId],
    );
    if (!row) return;
    const kind = (TYPES[row.cert_type] || {}).label || 'Certificate';
    await notifications.notify({
      userId: Number(row.user_id),
      type: 'certificate',
      title: `${kind} unlocked 🎉`,
      message: `Your certificate for “${row.display_title || 'SmartODL'}” is ready. Download the PDF or share the verification link.`,
      link: '/certificates',
    });
  } catch (err) {
    console.warn('[certificate] notification skipped:', err.message);
  }
}

// Public issuers — called when the relevant event happens.
async function issueIfEarned(enrollmentId) {
  const en = await q1('SELECT * FROM enrollments WHERE id = ?', [enrollmentId]);
  if (!en || en.status !== 'completed') return null;
  const course = await q1('SELECT id, title FROM courses WHERE id = ?', [en.course_id]);
  if (!course) return null;
  const pct = Number(en.progress_percent) || 100;
  const id = await _issue({
    userId: en.user_id, certType: 'course', courseId: course.id, enrollmentId: en.id,
    contextId: course.id, title: course.title, score: pct,
  });
  await notifyIssued(id);
  return id;
}
async function issueQuiz(attemptId) {
  const a = await q1(
    `SELECT qa.user_id, qa.status, qa.score, qa.total_marks AS attempt_total,
            q.title AS qtitle, q.total_marks AS quiz_total, q.id AS qid
       FROM quiz_attempts qa JOIN quizzes q ON q.id=qa.quiz_id WHERE qa.id=?`,
    [attemptId],
  );
  if (!a || a.status !== 'evaluated') return null;
  const total = Number(a.attempt_total || a.quiz_total || 0);
  const pct = total > 0 ? clampPercent((Number(a.score) / total) * 100) : 0;
  if (pct < 70) return null;
  // A quiz certificate certifies the score, never a provisional rank. Baking
  // an early submitter's temporary top_N into a permanent credential became
  // false as soon as later candidates scored higher.
  const tier = pct >= 90 ? 'excellence' : 'distinction';
  const id = await _issue({
    userId: a.user_id, certType: 'quiz', courseId: 0, contextId: a.qid,
    title: a.qtitle, score: pct, tier,
  });
  await notifyIssued(id);
  return id;
}
async function issueContest(contestId, userId, rank) {
  const numericRank = Number(rank);
  if (!Number.isInteger(numericRank) || numericRank < 1 || numericRank > 10) return null;
  const c = await q1(
    'SELECT id, title, status, end_at FROM contests WHERE id=?',
    [contestId],
  );
  if (!c) return null;
  const finished = c.status === 'completed'
    || (c.end_at && new Date(c.end_at).getTime() <= Date.now());
  if (!finished) return null;

  const participant = await q1(
    'SELECT score FROM contest_participants WHERE contest_id = ? AND user_id = ?',
    [contestId, userId],
  );
  if (!participant || Number(participant.score) <= 0) return null;
  const totals = await q1(
    `SELECT COALESCE(SUM(COALESCE(cp.points_override, p.points)), 0) AS total
       FROM contest_problems cp JOIN coding_problems p ON p.id = cp.problem_id
      WHERE cp.contest_id = ?`,
    [contestId],
  );
  const pct = Number(totals.total) > 0
    ? clampPercent((Number(participant.score) / Number(totals.total)) * 100)
    : 0;
  const tier = numericRank === 1 ? 'champion'
    : numericRank === 2 ? 'runner_up'
      : numericRank === 3 ? 'finalist' : `top_${numericRank}`;
  const id = await _issue({
    userId, certType: 'contest', courseId: 0, contextId: contestId,
    title: c.title, score: pct, tier,
  });
  await notifyIssued(id);
  return id;
}
async function issueMilestone(userId, milestone, title, score = 100) {
  const id = await _issue({
    userId, certType: 'milestone', courseId: 0, contextId: null,
    title, score, tier: milestone, // e.g. '100_problems', 'first_accept'
  });
  await notifyIssued(id);
  return id;
}

// ---------- endpoints ----------
const myCertificates = asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT c.*,
       COALESCE(c.title, co.title, z.title, cs.title) AS display_title,
       co.title  AS course_title, co.slug AS course_slug,
       z.title   AS quiz_title,
       cs.title  AS contest_title,
       u.full_name AS student_name, u.email AS student_email, u.college AS student_college,
       ui.full_name AS instructor_name
     FROM certificates c
     LEFT JOIN courses co ON co.id = c.course_id
     LEFT JOIN quizzes z ON z.id = c.context_id AND c.cert_type='quiz'
     LEFT JOIN contests cs ON cs.id = c.context_id AND c.cert_type='contest'
     JOIN users u ON u.id = c.user_id
     LEFT JOIN users ui ON ui.id = co.instructor_id
    WHERE c.user_id = ? AND c.revoked_at IS NULL
    ORDER BY c.issued_at DESC`, [req.user.id],
  );
  // Integrity band is attached to course certificates only, one lookup per
  // learner, and only for the holder's own list — never leaked to others.
  const withBand = await Promise.all(rows.map(async (r) => {
    let integrity = null;
    if (r.cert_type === 'course' && r.course_id) {
      try {
        integrity = await certificateIntegrity.forCertificate({ userId: req.user.id, courseId: r.course_id });
      } catch (error) {
        console.error('[certificate] integrity band lookup failed:', error.message);
      }
    }
    return {
      ...r,
      integrity,
      theme: (TYPES[r.cert_type] || TYPES.course).theme,
      type_label: (TYPES[r.cert_type] || TYPES.course).label,
    };
  }));
  ok(res, withBand);
});

const verify = asyncHandler(async (req, res) => {
  const c = await q1(
    `SELECT c.*,
       COALESCE(c.title, co.title, z.title, cs.title) AS display_title,
       co.title AS course_title, co.duration_hours,
       z.title AS quiz_title, z.total_marks AS quiz_total_marks,
       cs.title AS contest_title,
       s.full_name AS student_name, s.college AS student_college,
       u.full_name AS instructor_name
     FROM certificates c
     LEFT JOIN courses co ON co.id = c.course_id
     LEFT JOIN quizzes z ON z.id = c.context_id AND c.cert_type='quiz'
     LEFT JOIN contests cs ON cs.id = c.context_id AND c.cert_type='contest'
     JOIN users s ON s.id = c.user_id
     LEFT JOIN users u ON u.id = co.instructor_id
    WHERE c.public_token = ? OR c.certificate_no = ? LIMIT 1`,
    [req.params.token, req.params.token],
  );
  if (!c) throw ApiError.notFound('Certificate not found');
  if (c.revoked_at) {
    throw new ApiError(410, 'This certificate has been revoked', { code: 'CERT_REVOKED', valid: false });
  }
  const meta = TYPES[c.cert_type] || TYPES.course;
  const matchedByToken = String(req.params.token || '') === String(c.public_token || '');
  ok(res, {
    valid: true,
    type: c.cert_type, cert_type: c.cert_type, type_label: meta.label, theme: meta.theme,
    // The random print token is returned only to a caller who already proved
    // possession of it. Looking a certificate up by its printed number gives
    // the public summary, but never upgrades that number into a download.
    public_token: matchedByToken ? c.public_token : null,
    certificate_no: c.certificate_no, grade: c.grade, tier: c.tier,
    score_percent: Number(c.score_percent || 0), score_pct: Number(c.score_percent || 0),
    issued_at: c.issued_at,
    title: c.display_title, course_title: c.course_title,
    quiz_title: c.quiz_title, contest_title: c.contest_title,
    student_name: c.student_name, student_college: c.student_college,
    instructor_name: c.instructor_name, issuer_name: c.instructor_name,
    duration_hours: c.duration_hours,
    integrity: await integrityForView(c, { publicView: !matchedByToken }),
  });
});

/**
 * The band is shown to the certificate holder (they hold the print token) and
 * to admins. A plain certificate-number lookup is a public view, so it shows
 * the band only when an administrator has explicitly enabled that.
 */
async function integrityForView(c, { publicView = false } = {}) {
  if (c.cert_type !== 'course' || !c.course_id) return null;
  try {
    return await certificateIntegrity.forCertificate({
      userId: c.user_id, courseId: c.course_id, publicView,
    });
  } catch (error) {
    console.error('[certificate] integrity band lookup failed:', error.message);
    return null;
  }
}

/* ---------- Themed print templates ---------- */
/* Certificate designs now live in the `certificate_templates` table.
   See services/certificateTemplates.service.js (BUILT_INS seeds these four). */

const META_LABELS = {
  completion: 'Completed',
  excellence: 'Excellence',
  distinction: 'Distinction',
  champion: 'Champion',
  runner_up: 'Runner-Up',
  finalist: 'Finalist',
  top_1: '1st Place', top_2: '2nd Place', top_3: '3rd Place',
};
function tierLabel(t) {
  if (!t) return '';
  if (META_LABELS[t]) return META_LABELS[t];
  if (t.startsWith('top_')) return `Top ${t.replace('top_','')}`;
  return t.replace(/_/g, ' ');
}

/** Same row shape for the printable HTML and the PDF. */
async function loadByToken(token) {
  return q1(
    `SELECT c.*,
       COALESCE(c.title, co.title, z.title, cs.title) AS display_title,
       co.title AS course_title, co.description, co.duration_hours,
       z.title AS quiz_title, z.total_marks AS quiz_total_marks,
       cs.title AS contest_title,
       s.full_name AS student_name, s.email AS student_email, s.college AS student_college,
       u.full_name AS instructor_name
     FROM certificates c
     LEFT JOIN courses co ON co.id = c.course_id
     LEFT JOIN quizzes z ON z.id = c.context_id AND c.cert_type='quiz'
     LEFT JOIN contests cs ON cs.id = c.context_id AND c.cert_type='contest'
     JOIN users s ON s.id = c.user_id
     LEFT JOIN users u ON u.id = co.instructor_id
    WHERE c.public_token = ? LIMIT 1`,
    [token],
  );
}

/**
 * GET /api/cert/:token/pdf — the certificate as a real A4-landscape PDF.
 *
 * The student page used to offer only `window.print()`; on a phone that
 * reflows the page and often prints a cropped sheet. This returns a file the
 * browser can save/share directly, identical on every device.
 */
const pdfView = asyncHandler(async (req, res) => {
  const c = await loadByToken(req.params.token);
  if (!c) return res.status(404).json({ success: false, error: 'Certificate not found' });
  if (c.revoked_at) return res.status(410).json({ success: false, error: 'This certificate has been revoked' });

  c.integrity = await integrityForView(c, { publicView: false });
  const theme = await certTemplates.themeForCertificate(c);
  const origin = resolveClientOrigin(res);
  const verifyUrl = `${origin}/cert/${encodeURIComponent(c.public_token)}`;
  const qrPng = await verifyQrPng(verifyUrl).catch(() => null);

  const siteSettings = await q('SELECT setting_key AS k, setting_value AS v FROM settings WHERE setting_key IN (\'site_name\',\'site_tagline\')');
  const sget = (k, d) => (siteSettings.find((r) => r.k === k) || {}).v || d;

  const meta = pdfMeta(c).filter((m) => m.value);

  const pdf = await buildCertificatePdf({
    cert: c,
    theme,
    subject: pdfSubject(c),
    meta,
    integrity: c.integrity && c.integrity.shown ? c.integrity : null,
    verifyUrl,
    qrPng,
    siteName: sget('site_name', 'SmartODL'),
    tagline: sget('site_tagline', 'Learn. Practice. Compete.'),
  });

  const safeName = String(c.student_name || 'certificate').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="${safeName}-${String(c.certificate_no || 'certificate').toLowerCase()}.pdf"`);
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  return res.end(pdf);
});

const printView = asyncHandler(async (req, res) => {
  const c = await q1(
    `SELECT c.*,
       COALESCE(c.title, co.title, z.title, cs.title) AS display_title,
       co.title AS course_title, co.description, co.duration_hours,
       z.title AS quiz_title, z.total_marks AS quiz_total_marks,
       cs.title AS contest_title,
       s.full_name AS student_name, s.email AS student_email, s.college AS student_college,
       u.full_name AS instructor_name
     FROM certificates c
     LEFT JOIN courses co ON co.id = c.course_id
     LEFT JOIN quizzes z ON z.id = c.context_id AND c.cert_type='quiz'
     LEFT JOIN contests cs ON cs.id = c.context_id AND c.cert_type='contest'
     JOIN users s ON s.id = c.user_id
     LEFT JOIN users u ON u.id = co.instructor_id
    WHERE c.public_token = ? LIMIT 1`,
    [req.params.token],
  );
  if (!c) return res.status(404).send('Certificate not found');
  if (c.revoked_at) return res.status(410).send('This certificate has been revoked');
  // Print links are token-only, so this is the holder's own copy.
  c.integrity = await integrityForView(c, { publicView: false });
  res.send(await renderCertificateHtml(c, res));
});

/**
 * Builds the full certificate page for an already-loaded record.
 * `themeOverride` is used by the admin template preview to force a design
 * that is not the saved default for this certificate type.
 */
async function renderCertificateHtml(c, res, themeOverride = null, { preview = false } = {}) {
  const rawPublicToken = String(c.public_token || '');
  ['display_title', 'student_name', 'student_email', 'student_college', 'instructor_name',
    'certificate_no', 'public_token', 'grade', 'tier'].forEach((key) => { c[key] = escapeHtml(c[key]); });

  const theme = themeOverride
    || await certTemplates.themeForCertificate(c);
  // Template wording is plain text in every position below except the
  // explicitly token-expanded subtitle, which is escaped separately.
  ['headline', 'recipientLine', 'label', 'sealText'].forEach((key) => {
    theme[key] = escapeHtml(theme[key]);
  });
  const settings = await q("SELECT setting_key AS k, setting_value AS v FROM settings WHERE setting_key IN ('site_name','site_tagline','contact_email')");
  const getS = (k) => (settings.find((r) => r.k === k) || {}).v;
  const siteName = escapeHtml(getS('site_name') || 'SmartODL');
  const tagline = escapeHtml(getS('site_tagline') || 'Learn. Code. Compete. Grow.');
  const certOrigin = resolveClientOrigin(res);
  const certificateUrl = `${certOrigin}/cert/${encodeURIComponent(rawPublicToken)}`;
  // Printed sheets carry a QR that opens this same verification URL.
  const qrSvg = preview ? '' : await verifyQrSvg(certificateUrl).catch(() => '');
  const issuedDate = new Date(c.issued_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  // Integrity review band (green / yellow / red). Shown as a review indicator
  // next to the grade — it never changes the award, the grade or the score.
  const integrity = c.integrity && c.integrity.shown ? c.integrity : null;
  // green / yellow / red — 'amber' is a legacy alias kept so an older payload
  // (or a cached certificate) still prints in colour instead of grey.
  const INTEGRITY_TONE = { green: '#22c55e', yellow: '#f59e0b', amber: '#f59e0b', red: '#ef4444', muted: '#94a3b8' };
  const integrityTone = integrity ? (INTEGRITY_TONE[integrity.tone] || INTEGRITY_TONE.muted) : INTEGRITY_TONE.muted;
  const integrityBlock = !integrity ? '' : `
    <div class="integrity" style="border-color:${integrityTone}55;background:${integrityTone}18">
      <span class="integrity-dot" style="background:${integrityTone}"></span>
      <span class="integrity-label">Integrity review</span>
      <b style="color:${integrityTone}">${escapeHtml(String(integrity.label))}</b>
      <span class="integrity-meta">${integrity.available
        ? `${Number(integrity.score).toFixed(0)}/100 · ${Number(integrity.assessed_attempts)} monitored attempt(s)`
        : 'no monitored assessment in scope'}</span>
    </div>
    <div class="integrity-note">Review indicator from recorded tab-switch and proctor-violation counts. Not a finding of misconduct; it does not change this certificate.</div>`;

  // Compose the detail line per type. The template's subtitle wins when it is
  // set, so an admin can reword the line without touching code.
  const tokenValues = {
    student: c.student_name,
    title: c.display_title,
    score: `${Number(c.score_percent || 0).toFixed(0)}%`,
    grade: c.grade,
    tier: tierLabel(c.tier),
    date: issuedDate,
    duration: `${Number(c.duration_hours || 0)} hrs`,
    certificate_no: c.certificate_no,
  };
  let subjectLine, metaRow;
  switch (c.cert_type) {
    case 'quiz':
      subjectLine = `by achieving <b>${Number(c.score_percent).toFixed(0)}%</b> in the quiz:`;
      metaRow = `
        <div><b>${c.grade}</b><span>Grade</span></div>
        <div><b>${Number(c.score_percent).toFixed(0)}%</b><span>Score</span></div>
        <div><b>${tierLabel(c.tier)}</b><span>Recognition</span></div>
        <div><b>${issuedDate}</b><span>Issued On</span></div>`;
      break;
    case 'contest':
      subjectLine = `for outstanding performance in the contest:`;
      metaRow = `
        <div><b>${c.grade || '★'}</b><span>Grade</span></div>
        <div><b>${tierLabel(c.tier)}</b><span>Rank</span></div>
        <div><b>Live</b><span>Format</span></div>
        <div><b>${issuedDate}</b><span>Issued On</span></div>`;
      break;
    case 'milestone':
      subjectLine = `by reaching the milestone <b style="color:#bbf7d0">${tierLabel(c.tier)}</b> on the platform.`;
      metaRow = `
        <div><b>${c.grade}</b><span>Grade</span></div>
        <div><b>${tierLabel(c.tier)}</b><span>Milestone</span></div>
        <div><b>Coding</b><span>Track</span></div>
        <div><b>${issuedDate}</b><span>Issued On</span></div>`;
      break;
    case 'path':
      subjectLine = 'for completing every required course in the programme:';
      metaRow = `
        <div><b>All required</b><span>Courses</span></div>
        <div><b>100%</b><span>Path completion</span></div>
        <div><b>${issuedDate}</b><span>Issued On</span></div>`;
      break;
    default:
      subjectLine = 'has successfully completed all modules and lessons of the course';
      metaRow = `
        <div><b>${issuedDate}</b><span>Issued On</span></div>
        <div><b>${c.grade}</b><span>Grade</span></div>
        <div><b>${Number(c.score_percent).toFixed(0)}%</b><span>Score</span></div>
        <div><b>${Number(c.duration_hours || 0)} hrs</b><span>Duration</span></div>`;
  }
  if (theme.subtitle) subjectLine = renderTokens(escapeHtml(theme.subtitle), tokenValues);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>${theme.headline} — ${c.certificate_no}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1020;color:#fff;display:grid;place-items:center;padding:24px}
.print-controls{position:fixed;top:18px;right:18px;display:flex;gap:10px;z-index:10}
.btn{padding:10px 18px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;font-weight:600;cursor:pointer;text-decoration:none;font-size:.9rem;backdrop-filter:blur(10px)}
.btn.primary{background:linear-gradient(135deg,#6366f1,#22d3ee);border-color:transparent;box-shadow:0 8px 24px rgba(99,102,241,.4)}
.cert{width:1100px;max-width:100%;aspect-ratio:1100/775;position:relative;background:${theme.bg};
  border:1px solid ${theme.accentBorder};border-radius:24px;overflow:hidden;
  box-shadow:0 30px 80px rgba(0,0,0,.55);padding:60px 70px;display:flex;flex-direction:column}
.cert::before{content:'';position:absolute;inset:0;pointer-events:none;background:${theme.glow}}
.border-frame{position:absolute;inset:18px;border:2px solid rgba(201,209,255,.10);border-radius:16px;pointer-events:none}
.border-frame::after{content:'';position:absolute;inset:8px;border:1px solid rgba(201,209,255,.06);border-radius:12px}
.corner{position:absolute;width:64px;height:64px;border-color:${theme.corner1};border-width:0}
.corner.tl{top:28px;left:28px;border-top:3px solid;border-left:3px solid;border-top-left-radius:16px;border-color:${theme.corner1}}
.corner.tr{top:28px;right:28px;border-top:3px solid;border-right:3px solid;border-top-right-radius:16px;border-color:${theme.corner2}}
.corner.bl{bottom:28px;left:28px;border-bottom:3px solid;border-left:3px solid;border-bottom-left-radius:16px;border-color:${theme.corner3}}
.corner.br{bottom:28px;right:28px;border-bottom:3px solid;border-right:3px solid;border-bottom-right-radius:16px;border-color:${theme.corner4}}
.cert-head{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1}
.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:1.25rem}
.brand-mark{width:40px;height:40px;border-radius:10px;background:${theme.brandGradient};display:grid;place-items:center;font-size:1.4rem;box-shadow:0 8px 24px ${theme.accentSoft}}
.brand-accent{background:${theme.brandGradient};-webkit-background-clip:text;background-clip:text;color:transparent}
.brand-text{font-size:1.15rem;background:linear-gradient(180deg,#fff,#c8d0ff);-webkit-background-clip:text;background-clip:text;color:transparent;display:inline-flex;align-items:center;gap:6px}
.verify{text-align:right;font-size:.78rem;color:#94a3b8;line-height:1.4}
.verify b{color:#e2e8f0;display:block;font-size:.85rem;margin-bottom:4px;letter-spacing:.12em;text-transform:uppercase}
.verify-wrap{display:flex;align-items:center;gap:12px;justify-content:flex-end}
.verify-qr{width:78px;height:78px;flex:none;background:#fff;padding:5px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.35)}
.verify-qr svg{display:block;width:100%;height:100%}
.verify-qr-cap{font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;color:#94a3b8;margin-top:5px;text-align:center}
.brand-logo{height:46px;width:auto;max-width:190px;object-fit:contain;filter:drop-shadow(0 4px 12px rgba(0,0,0,.35))}
@media print{.verify-qr{box-shadow:none}}
.verify code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${theme.accent};background:${theme.accentSoft};padding:2px 8px;border-radius:6px;border:1px solid ${theme.accentBorder};display:inline-block;margin-top:4px;font-size:.8rem}
.cert-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;position:relative;z-index:1;margin:20px 0}
.eyebrow{font-size:.85rem;letter-spacing:.36em;text-transform:uppercase;color:${theme.eyebrow};font-weight:600;margin-bottom:10px}
h1{font-size:clamp(2.4rem,5vw,3.7rem);font-weight:800;letter-spacing:-.02em;line-height:1.05;margin-bottom:18px;background:${theme.titleGradient};-webkit-background-clip:text;background-clip:text;color:transparent}
.presented{color:#94a3b8;font-size:1.05rem;margin-bottom:14px}
.recipient{font-size:clamp(2rem,4vw,3rem);font-weight:800;margin-bottom:14px;background:${theme.recipientGradient};-webkit-background-clip:text;background-clip:text;color:transparent;padding:0 40px;position:relative}
.recipient::after{content:'';position:absolute;left:10%;right:10%;bottom:-8px;height:2px;background:linear-gradient(90deg,transparent,${theme.accent},transparent)}
.course-name{font-size:1.2rem;font-weight:600;color:#e2e8f0;max-width:720px;margin:18px auto 0;line-height:1.4}
.meta-row{display:flex;justify-content:center;gap:50px;margin-top:28px;color:#cbd5e1;font-size:.95rem}
.meta-row b{display:block;color:#fff;font-size:1.15rem;margin-bottom:4px;font-weight:700}
.meta-row span{color:#94a3b8;font-size:.78rem;letter-spacing:.16em;text-transform:uppercase}
.seal-row{display:flex;justify-content:space-between;align-items:flex-end;position:relative;z-index:1;margin-top:10px}
.seal{display:flex;flex-direction:column;align-items:center;gap:6px}
.seal-mark{width:86px;height:86px;border-radius:50%;display:grid;place-items:center;background:${theme.sealColor};color:#1a0f00;font-weight:900;font-size:.9rem;text-align:center;line-height:1.1;
  border:4px double ${theme.sealBorder};box-shadow:0 8px 22px ${theme.accent}40,inset 0 0 0 4px rgba(255,255,255,.12);transform:rotate(-8deg);font-family:Georgia,serif}
.seal-text{font-size:.7rem;letter-spacing:.24em;text-transform:uppercase;color:${theme.accent};font-weight:700}
.sig{text-align:center}
.sig-line{width:190px;height:2px;background:linear-gradient(90deg,transparent,#cbd5e1,transparent);margin-bottom:6px}
.sig-name{font-weight:700;color:#fff}
.sig-title{font-size:.72rem;color:#94a3b8;letter-spacing:.14em;text-transform:uppercase;margin-top:2px}
.integrity{display:inline-flex;align-items:center;gap:8px;margin-top:16px;padding:7px 16px;border-radius:999px;border:1px solid;font-size:.85rem;color:#e2e8f0}
.integrity-dot{width:10px;height:10px;border-radius:50%;display:inline-block;box-shadow:0 0 10px currentColor}
.integrity-label{letter-spacing:.18em;text-transform:uppercase;font-size:.68rem;color:#94a3b8;font-weight:700}
.integrity-meta{color:#94a3b8;font-size:.75rem}
.integrity-note{max-width:640px;margin-top:8px;color:#94a3b8;font-size:.68rem;line-height:1.4}
@media print{.integrity-note{color:#64748b}}
.type-tag{position:absolute;top:100px;left:70px;padding:5px 12px;border-radius:99px;font-size:.7rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;
  color:${theme.accent};background:${theme.accentSoft};border:1px solid ${theme.accentBorder}}
@media print{
  body{background:#fff;padding:0}
  .print-controls{display:none}
  .cert{box-shadow:none;border-radius:0;width:100vw;height:100vh;aspect-ratio:auto;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{size:A4 landscape;margin:0}
}
</style></head><body>
${preview ? '' : `<div class="print-controls">
  <a class="btn" href="${certOrigin}/student/certificates">← Back</a>
  <button class="btn primary" id="print-certificate" type="button">🖨 Print / Download PDF</button>
</div>`}
<div class="cert">
  <div class="border-frame"></div>
  <div class="corner tl"></div><div class="corner tr"></div>
  <div class="corner bl"></div><div class="corner br"></div>
  <div class="type-tag">${theme.label}</div>

  <div class="cert-head">
    <div class="brand">
      ${theme.logo
        ? `<img class="brand-logo" src="${escapeHtml(/^https?:/.test(theme.logo) ? theme.logo : `/uploads/${theme.logo}`)}" alt="${escapeHtml(siteName)}" />`
        : '<div class="brand-mark">⟨/⟩</div>'}
      <div><span>${siteName}</span><div style="font-size:.72rem;font-weight:500;color:#94a3b8;letter-spacing:.3em;text-transform:uppercase">${tagline}</div></div>
    </div>
    <div class="verify">
      <div class="verify-wrap">
        <div>
          <b>Verify Certificate</b>
          <code>${escapeHtml(certificateUrl)}</code>
        </div>
        ${qrSvg ? `<div><div class="verify-qr">${qrSvg}</div><div class="verify-qr-cap">Scan to verify</div></div>` : ''}
      </div>
    </div>
  </div>

  <div class="cert-body">
    <div class="eyebrow">${theme.headline}</div>
    <h1>${theme.recipientLine}</h1>
    <div class="recipient">${c.student_name}</div>
    <div class="presented">${subjectLine}</div>
    <div class="course-name">${c.display_title}</div>
    <div class="meta-row">${metaRow}</div>
    ${integrityBlock}
  </div>

  <div class="seal-row">
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-name">${c.instructor_name || 'The SmartODL Team'}</div>
      <div class="sig-title">${c.cert_type === 'milestone' || c.cert_type === 'path' ? 'Platform' : c.cert_type === 'contest' ? 'Contest Judge' : 'Instructor'}</div>
    </div>
    <div class="seal">
      <div class="seal-mark">${theme.sealText}</div>
      <div class="seal-text">Official Seal</div>
    </div>
    <div class="sig" style="text-align:right">
      <div class="sig-line"></div>
      <div class="sig-name" style="font-family:ui-monospace,monospace;font-size:.82rem;letter-spacing:.08em">${c.certificate_no}</div>
      <div class="sig-title">Certificate No.</div>
    </div>
  </div>
</div>
${preview ? '' : `<script nonce="${res.locals.cspNonce}">document.getElementById('print-certificate').addEventListener('click',()=>window.print());if(new URLSearchParams(location.search).get('print')==='1')setTimeout(()=>window.print(),400);</script>`}
</body></html>`;
  return html;
}

module.exports = {
  myCertificates, verify, printView, pdfView,
  renderCertificateHtml, TYPES, tierLabel, gradeOf,
  issueIfEarned, issueQuiz, issueContest, issueMilestone,
};
