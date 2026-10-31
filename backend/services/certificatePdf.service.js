'use strict';
/**
 * certificatePdf.service.js — server-side PDF of a certificate.
 *
 * Why this exists: the only "download" used to be `window.print()` on the
 * print view. On phones that opens the share sheet with a reflowed page (or
 * prints a cropped A4), and it depends on the student's printer dialog. This
 * renderer produces the same design as a real A4-landscape PDF, so the file is
 * identical on desktop, Android and iOS.
 *
 * It draws with pdfkit (pure JS, no Chromium) from the same design primitives
 * the HTML renderer uses: background gradient, frame, corners, logo, headline,
 * recipient, subject, meta row, integrity band, seal, signatures and the QR
 * code that points at the verification page.
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const W = 841.89;   // A4 landscape, points
const H = 595.28;

const hex = (value, fallback = '#ffffff') => (/^#[0-9a-f]{6}$/i.test(String(value || '').trim())
  ? String(value).trim().toLowerCase() : fallback);

function hexToRgb(value) {
  const h = hex(value).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * pdfkit does NOT accept rgba() objects: `{r,g,b,a}` is read as a colour name
 * lookup and silently renders as black/white. Every translucent surface is
 * therefore pre-blended against the colour behind it.
 *   mix('#22c55e', '#0b1020', 0.14)  →  the 14% green tint on the dark sheet
 */
function mix(fgHex, bgHex, a) {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  const ch = (f, b) => Math.round(f * a + b * (1 - a)).toString(16).padStart(2, '0');
  return `#${ch(fg.r, bg.r)}${ch(fg.g, bg.g)}${ch(fg.b, bg.b)}`;
}
/** Ink that stays readable on the dark sheet whatever the template says. */
const onDark = (value, fallback = '#ffffff') => {
  const c = hexToRgb(hex(value, fallback));
  const l = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  return l < 0.55 ? mix(value, '#ffffff', 0.35) : hex(value);
};

/** Read a stored upload (relative path) from UPLOAD_ROOT; null when missing. */
function readUpload(relativePath) {
  if (!relativePath) return null;
  try {
    const root = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
    const abs = path.resolve(root, String(relativePath).replace(/^uploads[\\/]/, ''));
    if (!abs.startsWith(root)) return null;      // never escape the upload root
    return fs.existsSync(abs) ? abs : null;
  } catch (_) { return null; }
}

/**
 * @param {object} opts
 *   cert     row with student_name, display_title, certificate_no, issued_at,
 *            score_percent, grade, tier, cert_type, instructor_name
 *   theme    object from certificateTemplates.buildTheme()
 *   subject  one-line description, e.g. "has completed every module of the course:"
 *   integrity { label, tone, score, available } | null
 *   verifyUrl absolute URL printed/encoded on the sheet
 *   siteName / tagline
 * @returns {Promise<Buffer>}
 */
function buildCertificatePdf({
  cert, theme, subject = '', meta = [], integrity = null, verifyUrl = '',
  siteName = 'SmartODL', tagline = 'Learn. Practice. Compete.', qrPng = null,
}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4', layout: 'landscape', margin: 0,
        info: {
          Title: `Certificate — ${cert.student_name || ''}`,
          Author: siteName,
          Subject: cert.display_title || 'Certificate',
          Keywords: cert.certificate_no || '',
        },
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      /* ---------------------------------------------------- background */
      // Diagonal blend painted as thin bands: pdfkit's gradient helper is
      // version-sensitive, and a banded blend renders identically everywhere.
      const from = hexToRgb(hex(theme.pdfBgFrom, '#0f172a'));
      const to = hexToRgb(hex(theme.pdfBgTo, '#0b1020'));
      const BANDS = 90;
      const bandH = H / BANDS;
      for (let i = 0; i < BANDS; i += 1) {
        const t = i / (BANDS - 1);
        const col = {
          r: Math.round(from.r + (to.r - from.r) * t),
          g: Math.round(from.g + (to.g - from.g) * t),
          b: Math.round(from.b + (to.b - from.b) * t),
        };
        doc.rect(0, i * bandH, W, bandH + 0.6).fill([col.r, col.g, col.b]);
      }

      // soft accent glow (two translucent circles, like the HTML radial gradients)
      const accent = hex(theme.pdfAccent, '#fbbf24');
      const sheet = hex(theme.pdfBgTo, '#0b1020');
      doc.save().fillColor(mix(accent, sheet, 0.16)).circle(60, 20, 260).fill().restore();
      doc.save().fillColor(mix(hex(theme.pdfAccent3 || accent), sheet, 0.12)).circle(W - 40, H - 10, 240).fill().restore();

      /* ---------------------------------------------------- frame + corners */
      doc.save()
        .lineWidth(2).strokeColor(mix('#c9d1ff', sheet, 0.22))
        .roundedRect(18, 18, W - 36, H - 36, 16).stroke()
        .restore();
      const corner = (x, y, dx, dy) => {
        doc.save().lineWidth(3).strokeColor(mix(accent, sheet, 0.75)).lineCap('round');
        doc.moveTo(x + dx * 56, y).lineTo(x, y).lineTo(x, y + dy * 56).stroke().restore();
      };
      corner(30, 30, 1, 1); corner(W - 30, 30, -1, 1);
      corner(30, H - 30, 1, -1); corner(W - 30, H - 30, -1, -1);

      /* ---------------------------------------------------- header: logo + brand */
      let headerLeft = 48;
      const logoAbs = readUpload(theme.logo);
      if (logoAbs) {
        try {
          doc.image(logoAbs, 48, 40, { fit: [170, 46] });
          headerLeft = 48 + 185;
        } catch (_) { /* unreadable image → keep the text brand */ }
      }
      if (!logoAbs) {
        doc.save().roundedRect(48, 40, 42, 42, 10).fillColor(accent).fill().restore();
        doc.fillColor('#0b1020').font('Helvetica-Bold').fontSize(14).text('</>', 48, 55, { width: 42, align: 'center' });
        headerLeft = 102;
      }
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15)
        .text(String(siteName), headerLeft, 44, { width: 320 });
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(7.5)
        .text(String(tagline).toUpperCase(), headerLeft, 64, { width: 320, characterSpacing: 2 });

      /* ---------------------------------------------------- header: QR + verify */
      const qrSize = 74;
      const qrX = W - 48 - qrSize;
      if (qrPng) {
        try {
          doc.save().roundedRect(qrX - 5, 35, qrSize + 10, qrSize + 10, 8).fillColor('#ffffff').fill().restore();
          doc.image(qrPng, qrX, 40, { width: qrSize, height: qrSize });
          doc.fillColor('#94a3b8').font('Helvetica').fontSize(6.5)
            .text('SCAN TO VERIFY', qrX - 20, 40 + qrSize + 12, { width: qrSize + 40, align: 'center', characterSpacing: 1.4 });
        } catch (_) { /* QR optional */ }
      }
      const verifyWidth = W - 120 - qrSize - 30;
      doc.fillColor('#e2e8f0').font('Helvetica-Bold').fontSize(8)
        .text('VERIFY CERTIFICATE', W - 48 - qrSize - 16 - verifyWidth, 46, {
          width: verifyWidth, align: 'right', characterSpacing: 1.6,
        });
      doc.fillColor(hex(accent)).font('Helvetica').fontSize(9)
        .text(String(verifyUrl), W - 48 - qrSize - 16 - verifyWidth, 62, {
          width: verifyWidth, align: 'right',
        });

      /* ---------------------------------------------------- center block */
      let y = 132;
      doc.fillColor(onDark(accent)).font('Helvetica-Bold').fontSize(10)
        .text(String(theme.headline || 'Certificate').toUpperCase(), 0, y, { width: W, align: 'center', characterSpacing: 4 });

      y += 26;
      doc.fillColor('#ffffff').font('Helvetica').fontSize(17)
        .text(String(theme.recipientLine || 'Awarded to'), 0, y, { width: W, align: 'center' });

      y += 30;
      doc.fillColor(onDark(theme.pdfAccent2 || accent)).font('Helvetica-Bold').fontSize(38)
        .text(String(cert.student_name || 'Student'), 0, y, { width: W, align: 'center', elipsis: true });

      y += 56;
      if (subject) {
        doc.fillColor('#cbd5e1').font('Helvetica').fontSize(12)
          .text(String(subject), 60, y, { width: W - 120, align: 'center' });
        y += 22;
      }
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(19)
        .text(String(cert.display_title || ''), 60, y, { width: W - 120, align: 'center' });

      /* ---------------------------------------------------- meta row */
      y += 40;
      if (meta.length) {
        const gap = 18;
        const widths = meta.map(() => 118);
        const totalW = widths.reduce((a, b) => a + b, 0) + gap * (meta.length - 1);
        let x = (W - totalW) / 2;
        meta.forEach((m, i) => {
          doc.fillColor('#94a3b8').font('Helvetica').fontSize(7)
            .text(String(m.label).toUpperCase(), x, y, { width: widths[i], align: 'center', characterSpacing: 1.2 });
          doc.fillColor('#f1f5f9').font('Helvetica-Bold').fontSize(11)
            .text(String(m.value), x, y + 11, { width: widths[i], align: 'center' });
          x += widths[i] + gap;
        });
        y += 34;
      }

      /* ---------------------------------------------------- integrity band */
      if (integrity && integrity.label) {
        const toneColour = { green: '#22c55e', yellow: '#f59e0b', red: '#ef4444' }[integrity.tone] || '#94a3b8';
        const text = `INTEGRITY REVIEW  ·  ${String(integrity.label).toUpperCase()}`
          + (integrity.available ? `  ·  ${Math.round(Number(integrity.score))}/100` : '  ·  NO MONITORED ASSESSMENT');
        const w = 340;
        const x = (W - w) / 2;
        doc.save().roundedRect(x, y, w, 22, 11)
          .lineWidth(1)
          .strokeColor(mix(toneColour, sheet, 0.55))
          .fillColor(mix(toneColour, sheet, 0.18))
          .fillAndStroke().restore();
        doc.save().circle(x + 16, y + 11, 3.6).fillColor(toneColour).fill().restore();
        doc.fillColor(mix(toneColour, '#ffffff', 0.45)).font('Helvetica-Bold').fontSize(8)
          .text(text, x + 26, y + 7, { width: w - 36, characterSpacing: 0.8 });
        y += 26;
        doc.fillColor('#94a3b8').font('Helvetica').fontSize(6.5).text(
          'Review indicator from recorded tab-switch and proctor-violation counts. Not a finding of misconduct; it does not change this certificate.',
          60, y, { width: W - 120, align: 'center' },
        );
      }

      /* ---------------------------------------------------- footer: signatures + seal */
      const footY = H - 96;
      const signLine = (x, w) => {
        doc.save().lineWidth(1).strokeColor(mix('#cbd5e1', sheet, 0.6))
          .moveTo(x, footY).lineTo(x + w, footY).stroke().restore();
      };
      // left — instructor
      signLine(70, 190);
      doc.fillColor('#e2e8f0').font('Helvetica-Bold').fontSize(10)
        .text(String(cert.instructor_name || 'The SmartODL Team'), 70, footY + 6, { width: 190 });
      const leftRole = cert.cert_type === 'milestone' || cert.cert_type === 'path' ? 'Platform'
        : cert.cert_type === 'contest' ? 'Contest Judge' : 'Instructor';
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(8).text(leftRole, 70, footY + 20, { width: 190 });

      // centre — seal
      const sealR = 40;
      const cx = W / 2;
      const cy = footY - 6;
      doc.save().circle(cx, cy, sealR).fillColor(hex(theme.pdfSealFrom || accent)).fill().restore();
      doc.save().circle(cx, cy, sealR).lineWidth(2).strokeColor(hex(theme.pdfSealBorder || accent)).stroke().restore();
      // strip glyphs the built-in PDF fonts cannot draw (★ ✓ ♔ ⟨/⟩ …)
      const sealWords = String(theme.sealText || 'VERIFIED')
        .replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim() || 'VERIFIED';
      doc.fillColor('#1a0f00').font('Helvetica-Bold').fontSize(sealWords.length > 12 ? 6.5 : 8)
        .text(sealWords.toUpperCase(), cx - sealR + 8, cy - 5, {
          width: sealR * 2 - 16, align: 'center', lineGap: 1,
        });
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(7)
        .text('OFFICIAL SEAL', cx - sealR, cy + sealR + 7, { width: sealR * 2, align: 'center', characterSpacing: 1.2 });

      // right — certificate number
      signLine(W - 260, 190);
      doc.fillColor('#e2e8f0').font('Courier-Bold').fontSize(9)
        .text(String(cert.certificate_no || ''), W - 260, footY + 6, { width: 190, align: 'right' });
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(8)
        .text('Certificate No.', W - 260, footY + 20, { width: 190, align: 'right' });

      // hidden tamper-evident fingerprint (also printed small, bottom-left)
      const fingerprint = crypto.createHash('sha256')
        .update(`${cert.certificate_no}|${cert.student_name}|${cert.display_title}|${cert.issued_at}`)
        .digest('hex').slice(0, 32).toUpperCase();
      doc.fillColor(mix('#94a3b8', sheet, 0.9)).font('Helvetica').fontSize(5.5)
        .text(`SIG ${fingerprint}`, 30, H - 26, { width: 420 });
      doc.fillColor(mix('#94a3b8', sheet, 0.9)).font('Helvetica').fontSize(5.5)
        .text(`Issued ${new Date(cert.issued_at || Date.now()).toISOString().slice(0, 10)} · ${siteName}`,
          W - 330, H - 26, { width: 300, align: 'right' });

      doc.end();
    } catch (err) { reject(err); }
  });
}

module.exports = { buildCertificatePdf, W, H };
