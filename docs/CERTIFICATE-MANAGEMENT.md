# Certificate Management v2

Yeh document un 7 cheezon ko cover karta hai jo certificate system me add ki gayi hain
(certificate ka design freeze, revoke reason + restore, CSV + filters, issue notification,
QR code, server-side PDF, per-template logo).

---

## 1. Design binding — certificate apna design bhoolta nahi

Pehle: certificate render hamesha `certificate_templates` ki **current** row padhta tha.
Admin template ka colour ya headline badal deta, aur **purane saare certificates** ka
look badal jaata — jo pehle print ho chuka hai, wo ab dusra dikhta.

Ab: issue karte waqt us waqt ka design `certificates.design_snapshot` (JSON) me
freeze ho jaata hai, aur `certificates.template_id` bhi save hota hai.

| Cheez | Source | Kyun |
|---|---|---|
| colours, headline, subtitle, seal text, label | `design_snapshot` (frozen) | printed certificate ka look kabhi na badle |
| **logo** | `certificate_templates.logo_path` (live) | logo identity hai, styling nahi — admin apna logo badle to purane certificates par bhi naya logo aaye |

Purana certificate jiska snapshot nahi hai, wo `template_id`/`cert_type` se fallback
karta hai (crash nahi) — `themeForCertificate()` corrupt snapshot par bhi safe hai.

Proof: `backend/test/unit/certificateDesign.test.js` + `tools/cert-verify/verify-cert-management.sh`
(check: template ka headline badalne par bhi issued certificate ka purana headline render hua).

---

## 2. Revoke reason + restore

| Endpoint | Kaam |
|---|---|
| `DELETE /api/admin/certificates/:id` | revoke; body `{ reason }` optional par admin UI me prompt se aata hai (max 255 chars, `revoke_reason` me store) |
| `POST /api/admin/certificates/:id/restore` | un-revoke — `revoked_at/revoked_by/revoke_reason` NULL, wahi certificate number aur wahi public token |

Revoked certificate ka public print/PDF **410 Gone** deta hai (verify page par "revoked"
message + reason). Restore ke baad link waapas **200** — naya token generate nahi hota,
isliye jo student ne link save kiya tha wo phir se kaam karta hai.
Restore idempotent hai: dobara call karne par `{ restored: true, already: true }`.

Admin list me revoked row par reason dikhta hai aur ↩️ Restore button hota hai.

---

## 3. CSV export + filters

`GET /api/admin/certificates/export.csv` — bilkul wahi filters jo list endpoint leta hai:

| Param | Value |
|---|---|
| `search` | student name, email, certificate no, course/quiz/contest title |
| `type` | `course` / `quiz` / `contest` / `milestone` / `path` |
| `status` | `active` / `revoked` / `all` |
| `from`, `to` | `YYYY-MM-DD` (issue date, inclusive) |
| `course` | course id |

Export aur on-screen list **ek hi `buildFilters()` + `LIST_JOINS`** se chalte hain, isliye
CSV me kabhi wo rows nahi aati jo screen par nahi dikh rahi.

CSV details:
- UTF-8 **BOM** (Excel me Hindi/accents theek dikhein), CRLF line endings
- 13 columns, aakhri `Verify URL` (public verification link)
- **formula injection guard**: `= + - @` se shuru hone wale cell ke aage `'` lagta hai
  (Excel/Sheets me formula execute na ho)
- max 20,000 rows, `Cache-Control: no-store`
- filename `certificates-YYYY-MM-DD.csv`

---

## 4. Issue hone par student ko notification

`services/notification.service.js` ka `notifyCertificateIssued()` — `notifications` table me
`type='certificate'` row, deep link `/certificates`.
`notifications.type` ka ENUM fixed tha, isliye `ensureNotificationTypes()` (idempotent) boot par
ENUM me `certificate` add karta hai — purane DB par bhi kaam karega, data drop nahi hota.
Notification fail ho to issuance fail nahi hoti (try/catch, sirf log).

---

## 5. QR code — print se verify tak

- Print HTML me QR **inline SVG** (`.verify-qr`) — koi extra request nahi, offline print bhi kaam karega.
- PDF me QR **PNG 320px** (`GET /api/cert/:token/qr.png` bhi available).
- QR ka content: `<origin>/cert/<public_token>` — scan karte hi public verification page.
- Caption: "SCAN TO VERIFY" (Hinglish print sheet par English hi rakha, kyunki public page hai).

---

## 6. Server-side PDF

`GET /api/cert/:token/pdf` → `services/certificatePdf.service.js` (pdfkit).

- A4 **landscape**, single page, ~10–13 KB
- `Content-Disposition: attachment; filename="<student>-<certno>.pdf"`
- Mobile-safe: student ko `window.print()` ki zarurat nahi, direct download.
  Student page par ⬇️ Download PDF + 🖨️ Print dono hain; admin list me bhi PDF button.
- Dark certificate theme PDF me pre-blended colours se banti hai (pdfkit me `rgba()` nahi hota),
  isliye band/panel tints `mix()`/`onDark()` se nikalte hain — render me koi transparent-black
  patch nahi aata.
- PDF fonts WinAnsi hain, isliye non-ASCII characters strip hote hain; brand mark `</>` se.
- Integrity band bhi PDF me aata hai: tinted pill + score + ek line note
  ("review indicator, not a finding of misconduct").

---

## 7. Per-template logo

| Endpoint | Detail |
|---|---|
| `POST /api/admin/certificate-templates/:id/logo` | multipart field `logo`; PNG/JPG/WebP, magic-byte validation (`validateRasterImage`), `uploads/banners/<file>` |
| `DELETE /api/admin/certificate-templates/:id/logo` | `logo_path = NULL` |

Response `{ logo_path: "banners/…png", url: "/uploads/banners/…png" }`.
`clean()` logo_path ko validate karta hai — sirf `https://` URL ya safe relative path
(`..` nahi, koi `javascript:` nahi). Admin UI (`admin/CertificateTemplates.jsx`) me
preview + Replace + ✕ remove, aur "Save the template first" hint naye template par.

Logo live overlay hai (dekho point 1) — isliye template ka logo badalne par naye **aur**
purane certificate dono par naya logo aata hai, par colours frozen rehte hain.

---

## Endpoint summary

```
GET    /api/cert/:token                 public JSON verify
GET    /api/cert/:token/print           printable HTML (QR inline)
GET    /api/cert/:token/pdf             server-side PDF  ← naya
GET    /api/cert/:token/qr.svg|qr.png   QR only

GET    /api/admin/certificates          filters: search/type/status/from/to/course
GET    /api/admin/certificates/export.csv   ← naya (same filters)
GET    /api/admin/certificates/stats
DELETE /api/admin/certificates/:id      body { reason }
POST   /api/admin/certificates/:id/restore  ← naya
POST   /api/admin/certificates/:id/reissue

GET    /api/admin/certificate-templates
POST   /api/admin/certificates-templates/:id/logo    ← naya
DELETE /api/admin/certificate-templates/:id/logo     ← naya
```

## Verification

```bash
cd Smartodl/backend && npm test          # 133 pass
cd Smartodl/frontend && npx vite build    # ✓
bash tools/cert-verify/verify-cert-management.sh   # 29 checks, 7 features, live API + DB
```

`tools/cert-verify/integrity-pdf-check.py` teeno band ke PDF render karta hai
(`/tmp/integrity-{green,yellow,red}.png`) — yellow/red pill tinted aur readable dikhta hai.
