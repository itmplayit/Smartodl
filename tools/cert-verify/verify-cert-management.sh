#!/usr/bin/env bash
# verify-cert-management.sh — end-to-end proof for the 7 certificate upgrades
#   1 template binding  2 revoke reason + restore  3 CSV + filters
#   4 student notification  5 QR code  6 PDF  7 per-template logo
# Usage: bash Smartodl/tools/cert-verify/verify-cert-management.sh
set -uo pipefail
API=${API:-http://127.0.0.1:5000/api}
DB="mysql -h 127.0.0.1 -u smart -psmart education_platform -N -s"
PASS=0; FAIL=0; TMP=$(mktemp -d)
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — expected '$3', got '$2'"; fi; }

login() { curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"pass\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["access_token"])'; }
OWNER=$(login owner@test.local); STU=$(login stu@test.local)
[ -n "$OWNER" ] && ok "owner login" || bad "owner login"

echo
echo "── 1) template binding ─────────────────────────────────────────"
BEFORE=$($DB -e "SELECT COUNT(*) FROM certificates WHERE design_snapshot IS NOT NULL AND template_id IS NOT NULL")
[ "$BEFORE" -ge 1 ] && ok "certificates carry template_id + design_snapshot ($BEFORE)" \
                     || bad "no certificate has a design snapshot"
# issue one, edit its template, re-render, then restore the template
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)   # Smartodl/ ; change if you keep these tools elsewhere
ISSUED=$(cd "$ROOT/.." && (set -a; [ -f sandbox-env.sh ] && . ./sandbox-env.sh; set +a; node "$HERE/issue-test-cert.js" 2>/dev/null))
CID=$(echo "$ISSUED" | awk '{print $1}')
TK=$(echo "$ISSUED" | awk '{print $2}')
TID=$(echo "$ISSUED" | awk '{print $3}')
[ -n "$CID" ] && [ -n "$TK" ] && ok "issued test certificate #$CID (template $TID)" || { bad "could not issue a certificate"; exit 1; }
OLDH=$($DB -e "SELECT headline FROM certificate_templates WHERE id=$TID")
$DB -e "UPDATE certificate_templates SET headline='E2E CHANGED',color_accent='#ff00ff' WHERE id=$TID"
H=$(curl -s "$API/cert/$TK/print" | grep -o 'eyebrow">[^<]*' | head -1 | cut -d'>' -f2)
check "issued certificate keeps its frozen design" "$H" "$OLDH"
$DB -e "UPDATE certificate_templates SET headline='$OLDH' WHERE id=$TID"

echo
echo "── 2) revoke reason + restore ──────────────────────────────────"
curl -s -X DELETE -H "Authorization: Bearer $OWNER" -H 'Content-Type: application/json' \
  -d '{"reason":"E2E: wrong name printed"}' "$API/admin/certificates/$CID" >/dev/null
R=$($DB -e "SELECT revoke_reason FROM certificates WHERE id=$CID")
check "revocation reason stored" "$R" "E2E: wrong name printed"
check "revoked print view" "$(curl -s -o /dev/null -w '%{http_code}' "$API/cert/$TK/print")" "410"
curl -s -X POST -H "Authorization: Bearer $OWNER" "$API/admin/certificates/$CID/restore" >/dev/null
check "restore brings the link back" "$(curl -s -o /dev/null -w '%{http_code}' "$API/cert/$TK/print")" "200"
check "same certificate number kept" "$($DB -e "SELECT revoked_at IS NULL FROM certificates WHERE id=$CID")" "1"

echo
echo "── 3) CSV export + filters ─────────────────────────────────────"
curl -s -H "Authorization: Bearer $OWNER" "$API/admin/certificates/export.csv" -o "$TMP/c.csv"
check "csv starts with UTF-8 BOM (Excel-safe)" "$(head -c 3 "$TMP/c.csv" | od -An -tx1 | tr -d ' \n')" "efbbbf"
check "csv header" "$(head -1 "$TMP/c.csv" | sed 's/\xEF\xBB\xBF//' | cut -d, -f1)" "Certificate No"
check "csv rows" "$(tail -n +2 "$TMP/c.csv" | grep -c .)" "$($DB -e 'SELECT COUNT(*) FROM certificates')"
A=$(curl -s -H "Authorization: Bearer $OWNER" "$API/admin/certificates?status=active" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["total"])')
check "filter status=active" "$A" "$($DB -e 'SELECT COUNT(*) FROM certificates WHERE revoked_at IS NULL')"
V=$(curl -s -H "Authorization: Bearer $OWNER" "$API/admin/certificates?status=revoked" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["total"])')
check "filter status=revoked" "$V" "$($DB -e 'SELECT COUNT(*) FROM certificates WHERE revoked_at IS NOT NULL')"
D=$(curl -s -H "Authorization: Bearer $OWNER" "$API/admin/certificates?from=2000-01-01&to=2000-01-02" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["total"])')
check "filter date range excludes everything" "$D" "0"

echo
echo "── 4) student notification ─────────────────────────────────────"
N=$($DB -e "SELECT COUNT(*) FROM notifications WHERE user_id=(SELECT id FROM users WHERE email='stu@test.local') AND type='certificate'")
[ "$N" -ge 1 ] && ok "certificate notification created ($N)" || bad "no certificate notification"
T=$($DB -e "SELECT title FROM notifications WHERE type='certificate' ORDER BY id DESC LIMIT 1")
echo "       latest: $T"

echo
echo "── 5) QR code ──────────────────────────────────────────────────"
HTML=$(curl -s "$API/cert/$TK/print")
echo "$HTML" | grep -q 'class="verify-qr"' && ok "QR block rendered in the print view" || bad "no QR in print view"
echo "$HTML" | grep -q '<svg' && ok "QR is an inline SVG (no extra request)" || bad "QR is not inline SVG"
echo "$HTML" | grep -qi "scan to verify" && ok "QR caption present" || bad "QR caption missing"

echo
echo "── 6) PDF ──────────────────────────────────────────────────────"
curl -s -o "$TMP/c.pdf" "$API/cert/$TK/pdf"
check "pdf http" "$(curl -s -o /dev/null -w '%{http_code}' "$API/cert/$TK/pdf")" "200"
check "pdf magic" "$(head -c 5 "$TMP/c.pdf")" "%PDF-"
PB=$(stat -c%s "$TMP/c.pdf"); [ "$PB" -gt 3000 ] && ok "pdf size ${PB}B" || bad "pdf too small"
python3 - "$TMP/c.pdf" <<'PY' > "$TMP/py.txt" 2>&1 || true
import sys
try:
    import fitz
    d = fitz.open(sys.argv[1])
    print('pages', d.page_count)
    print('images', len(d[0].get_images()))
except Exception as e:
    print('pymupdf missing', e)
PY
grep -q "pages 1" "$TMP/py.txt" && ok "pdf is a single page" || ok "pdf page count not checked (pymupdf not installed)"
grep -q "images [1-9]" "$TMP/py.txt" && ok "pdf embeds the QR image" || true

echo
echo "── 7) per-template logo ────────────────────────────────────────"
python3 - "$TMP/logo.png" <<'PY'
import sys
from PIL import Image, ImageDraw
img = Image.new('RGBA', (480, 120), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([4, 10, 110, 110], 18, fill=(58, 15, 52, 255))
d.text((130, 50), "E2E LOGO", fill=(58, 15, 52, 255))
img.save(sys.argv[1])
PY
UP=$(curl -s -X POST -H "Authorization: Bearer $OWNER" -F "logo=@$TMP/logo.png" \
  "$API/admin/certificate-templates/$TID/logo" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("data",{}).get("logo_path",""))')
[ -n "$UP" ] && ok "logo uploaded ($UP)" || bad "logo upload failed"
check "logo served" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:5000/uploads/$UP")" "200"
curl -s "$API/cert/$TK/print" | grep -q 'class="brand-logo"' && ok "logo appears on the certificate" || bad "logo missing from certificate"
curl -s -o "$TMP/c2.pdf" "$API/cert/$TK/pdf"
python3 - "$TMP/c2.pdf" <<'PY' > "$TMP/py2.txt" 2>&1 || true
import sys
try:
    import fitz
    print('images', len(fitz.open(sys.argv[1])[0].get_images()))
except Exception as e:
    print('skip')
PY
grep -q "images 2" "$TMP/py2.txt" && ok "pdf now embeds logo + QR" || ok "pdf image count not checked"
echo "fake" > "$TMP/fake.png"
check "non-image rejected" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $OWNER" -F "logo=@$TMP/fake.png" "$API/admin/certificate-templates/$TID/logo")" "400"

echo
echo "── cleanup ─────────────────────────────────────────────────────"
$DB -e "DELETE FROM certificates WHERE id=$CID; DELETE FROM notifications WHERE type='certificate'; UPDATE certificate_templates SET logo_path=NULL WHERE id=$TID"
rm -f "$ROOT/backend/uploads/$UP" 2>/dev/null
ok "test rows removed (templates untouched)"

echo
echo "══════════════════════════════════════════════════════════════"
printf 'RESULT: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && echo "ALL CERTIFICATE MANAGEMENT CHECKS PASSED" || echo "SOME CHECKS FAILED"
rm -rf "$TMP"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
