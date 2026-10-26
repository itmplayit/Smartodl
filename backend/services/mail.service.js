'use strict';
/** Password-reset / notification email. Sensitive links are never logged in production. */
const nodemailer = require('nodemailer');

let transport = null;
function getTransport() {
  if (transport) return transport;
  const mailMode = process.env.MAIL_MODE || (process.env.SMTP_HOST ? 'smtp' : 'disabled');
  if (mailMode !== 'smtp' || !process.env.SMTP_HOST) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: process.env.SMTP_REQUIRE_TLS !== 'false' && port !== 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    tls: { rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' },
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20000),
  });
  return transport;
}

function mailConfigured() {
  const mailMode = process.env.MAIL_MODE || (process.env.SMTP_HOST ? 'smtp' : 'disabled');
  return mailMode === 'smtp' && Boolean(process.env.SMTP_HOST);
}

/** Convert raw nodemailer/SMTP failures into a clear, client-visible message. */
function friendlyMailError(e) {
  const code = String((e && e.code) || '');
  const resp = String((e && (e.response || e.message)) || '').slice(0, 200);
  let hint;
  if (!process.env.MAIL_FROM) {
    hint = 'MAIL_FROM is not set in backend/.env (for example, MAIL_FROM=SmartODL <you@gmail.com>).';
  } else if (code === 'EAUTH' || /535|534|username and password|credentials|not accepted/i.test(resp)) {
    hint = 'Gmail rejected the login. A normal Gmail password will not work — turn on two-step verification in the Google Account, create an App Password at myaccount.google.com/apppasswords, and put that 16-character code in SMTP_PASS.';
  } else if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET' || /ECONNREFUSED|timed? ?out|getaddrinfo/i.test(resp)) {
    hint = `A connection to the SMTP server (${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}) could not be established. Check the internet connection, firewall, and antivirus software.`;
  } else {
    hint = 'Sending email failed. Check the SMTP settings in backend/.env again.';
  }
  const err = new Error(`${hint}${resp ? ` (the server said: ${resp})` : ''}`);
  err.statusCode = 503;
  err.expose = true;
  return err;
}

async function sendMail({ to, subject, text, html }) {
  const t = getTransport();
  if (!t) return { delivered: false };
  try {
    await t.sendMail({ from: process.env.MAIL_FROM, to, subject, text, html });
  } catch (e) {
    throw friendlyMailError(e);
  }
  return { delivered: true };
}

/** Handshake-without-sending check used by scripts/test-mail.js. */
async function verifyMail() {
  const t = getTransport();
  if (!t) return { ok: false, reason: 'MAIL_MODE is not smtp or SMTP_HOST is empty (check backend/.env)' };
  try {
    await t.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: friendlyMailError(e).message };
  }
}

module.exports = { sendMail, verifyMail, mailConfigured };
