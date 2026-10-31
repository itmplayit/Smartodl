// helper for verify-cert-management.sh — issues one throw-away certificate
// and prints "<id> <public_token> <template_id>"
// env (DB_*, JUDGE_MODE…) is exported by the caller — see verify-cert-management.sh
const path = require('path').join(__dirname, '..', '..', 'backend');
const certs = require(`${path}/controllers/certificate.controller`);
const { q1 } = require(`${path}/config/db`);
(async () => {
  const s = await q1("SELECT id FROM users WHERE email='stu@test.local'");
  if (!s) { console.error('no student'); process.exit(1); }
  const id = await certs.issueMilestone(s.id, 'verify_e2e', 'E2E Certificate', 94);
  const row = await q1('SELECT public_token, template_id FROM certificates WHERE id=?', [id]);
  console.log(`${id} ${row.public_token} ${row.template_id}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
