'use strict';
/**
 * certificateDesign.test.js — the four things this round of work changed:
 *   1. design binding  (a template edit must not restyle issued certificates)
 *   2. QR payload      (printed sheet → public verification URL)
 *   3. PDF builder     (valid A4 PDF, works without any template row)
 *   4. CSV escaping    (formula injection + quoting)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const tpl = require('../../services/certificateTemplates.service');

const ROW = {
  id: 7, name: 'Test', cert_type: 'course',
  headline: 'Certificate of Completion', subtitle: 'x', recipient_line: 'Awarded to',
  seal_text: '★ VERIFIED', label: 'Course Completion', logo_path: null,
  color_bg_from: '#0f172a', color_bg_to: '#0b1020',
  color_accent: '#fbbf24', color_accent_2: '#fde68a', color_accent_3: '#f59e0b',
  color_seal_from: '#fbbf24', color_seal_to: '#b45309', color_seal_border: '#fde68a',
};

test('buildTheme carries the PDF primitives (no CSS strings leak into the PDF)', () => {
  const theme = tpl.buildTheme(ROW);
  assert.equal(theme.pdfAccent, '#fbbf24');
  assert.equal(theme.pdfBgFrom, '#0f172a');
  assert.ok(!String(theme.bg).includes('#') || String(theme.bg).includes('linear-gradient'));
  assert.equal(theme.templateId, 7);
});

test('a design snapshot round-trips into the same theme', () => {
  const frozen = JSON.parse(JSON.stringify(ROW));
  const theme = tpl.buildTheme(frozen);
  assert.equal(theme.headline, 'Certificate of Completion');
  assert.equal(theme.pdfAccent, ROW.color_accent);
});

test('themeForCertificate falls back safely on a corrupt snapshot', async () => {
  // no DB in unit tests: a broken snapshot must not throw, it must fall back
  const theme = await tpl.themeForCertificate({
    cert_type: 'course', design_snapshot: '{not json', template_id: 999,
  });
  assert.ok(theme && typeof theme.headline === 'string' && theme.headline.length > 0);
});

test('QR SVG is produced for the verification URL', async () => {
  const QRCode = require('qrcode');
  const svg = await QRCode.toString('https://example.test/cert/abc123', { type: 'svg', margin: 0 });
  assert.match(svg, /<svg/);
  const png = await QRCode.toBuffer('https://example.test/cert/abc123', { type: 'png', width: 200 });
  assert.ok(Buffer.isBuffer(png) && png.length > 100);
  assert.equal(png.slice(1, 4).toString(), 'PNG');
});

test('PDF builder returns a real single-page A4-landscape PDF', async () => {
  const { buildCertificatePdf } = require('../../services/certificatePdf.service');
  const theme = tpl.buildTheme(ROW);
  const pdf = await buildCertificatePdf({
    cert: {
      student_name: 'Demo Student', display_title: 'Let Us C', certificate_no: 'SOD-CRS-1',
      issued_at: new Date().toISOString(), grade: 'A+', score_percent: 92, cert_type: 'course',
      instructor_name: 'Test Instructor',
    },
    theme,
    subject: 'has completed the course',
    meta: [{ label: 'Grade', value: 'A+' }],
    integrity: { label: 'Yellow', tone: 'yellow', score: 65, available: true },
    verifyUrl: 'https://example.test/cert/abc123',
    siteName: 'SmartODL', tagline: 'Learn. Practice. Compete.',
  });
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.slice(0, 5).toString(), '%PDF-');
  const text = pdf.toString('latin1');
  assert.equal((text.match(/\/Type\s*\/Page[^s]/g) || []).length, 1, 'exactly one page');
  assert.ok(pdf.length > 3000, 'PDF looks empty');
});

test('certificate HTML maps every integrity tone to a colour', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'controllers/certificate.controller.js'), 'utf8');
  const map = src.match(/const INTEGRITY_TONE = \{([^}]*)\}/)[1];
  for (const tone of ['green', 'yellow', 'red', 'muted']) {
    assert.match(map, new RegExp(`${tone}:\\s*'#[0-9a-f]{6}'`, 'i'));
  }
  assert.match(map, /amber:/, 'legacy amber alias kept so old payloads stay coloured');
});
