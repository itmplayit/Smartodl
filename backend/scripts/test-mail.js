'use strict';
/**
 * Quick SMTP self-test — verify the mail setup without the UI:
 *   node scripts/test-mail.js                 (configuration and connection check only)
 *   node scripts/test-mail.js you@gmail.com   (also send a real test email)
 */
require('dotenv').config();
const { verifyMail, sendMail, mailConfigured } = require('../services/mail.service');

(async () => {
  const to = process.argv[2];
  const mask = (v) => (v ? `${v.slice(0, 3)}****` : '(empty)');
  console.log('--- SmartODL mail self-test ---');
  console.log('MAIL_MODE :', process.env.MAIL_MODE || '(unset -> disabled)');
  console.log('SMTP_HOST :', process.env.SMTP_HOST || '(empty)');
  console.log('SMTP_PORT :', process.env.SMTP_PORT || 587);
  console.log('SMTP_USER :', mask(process.env.SMTP_USER));
  console.log('SMTP_PASS :', process.env.SMTP_PASS ? '(set, hidden)' : '(empty)');
  console.log('MAIL_FROM :', process.env.MAIL_FROM || '(empty)');

  if (!mailConfigured()) {
    console.error('\nMail is currently DISABLED. backend/.env contains a Gmail SMTP template —');
    console.error('uncomment those lines, enter your details, and restart the backend.');
    process.exitCode = 1;
    return;
  }

  const v = await verifyMail();
  console.log('\nConnection verify:', v.ok ? 'OK' : `FAIL -> ${v.reason}`);
  if (!v.ok) { process.exitCode = 1; return; }

  if (to) {
    await sendMail({ to, subject: 'SmartODL mail test', text: 'This is a test email — the SmartODL mail setup is working correctly.' });
    console.log(`\nTest email sent to: ${to}`);
    console.log('Check both the inbox and the SPAM/JUNK folder.');
  } else {
    console.log('\nTip: run node scripts/test-mail.js your@gmail.com to send a test email.');
  }
})().catch((e) => { console.error('\nFAIL:', e.message); process.exitCode = 1; });
