#!/usr/bin/env bash
# =============================================================================
#  Make the proctoring object-detection model local (optional)
#
#  By default, the model is loaded from the jsDelivr CDN so that 18 MB for
#  30 students is not served through your own home upload connection. If your lab is completely offline,
#  this script places the same files in frontend/public/vendor/objdet/
#  and the app automatically prefers the local copy. The archive grows by about 18 MB.
#
#
#  Security/integrity:
#    * downloads first go into a temporary directory;
#    * every file's pinned SHA-256 checksum is verified;
#    * model.json shard paths must exactly match the allow-list;
#    * files are installed only after every check passes, so that an
#      interrupted or partial download can never become the live vendor bundle.
#
#  Usage:  bash vendor-objdet.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="$ROOT/frontend/public/vendor/objdet"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

TF_URL="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js"
COCO_URL="https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js"
MODEL_BASE="https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2"

download() {
  # --proto keeps redirects on HTTPS instead of silently downgrading.
  curl --proto '=https' --tlsv1.2 -fsSL -o "$2" "$1"
}

verify_sha256() {
  python3 - "$1" "$2" <<'PY'
import hashlib
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
expected = sys.argv[2]
actual = hashlib.sha256(path.read_bytes()).hexdigest()
if actual != expected:
    raise SystemExit(f"SHA-256 mismatch for {path.name}: expected {expected}, got {actual}")
PY
}

echo "==> tfjs + coco-ssd"
download "$TF_URL" "$TMP/tf.min.js"
verify_sha256 "$TMP/tf.min.js" "300dfae273d20b4046f46a06d735688f03675a807561e9bcb5f664eb2f3d2831"
download "$COCO_URL" "$TMP/coco-ssd.min.js"
verify_sha256 "$TMP/coco-ssd.min.js" "8875b8c1bb57723990c9d6506226e0e51cd21b8b6943eb53201086096de52df5"

echo "==> model"
download "$MODEL_BASE/model.json" "$TMP/model.json"
verify_sha256 "$TMP/model.json" "3770b2528339b1e3340cb74360e1e40401816b009779aeb8d0cce3a4353ea3a9"

python3 - "$TMP/model.json" "$TMP/.shards" <<'PY'
import json
import pathlib
import sys

expected = [
    "group1-shard1of5",
    "group1-shard2of5",
    "group1-shard3of5",
    "group1-shard4of5",
    "group1-shard5of5",
]
model = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
paths = [p for group in model.get("weightsManifest", []) for p in group.get("paths", [])]
if paths != expected:
    raise SystemExit(f"Unexpected model shard list: {paths!r}")
pathlib.Path(sys.argv[2]).write_text("\n".join(paths) + "\n", encoding="utf-8")
PY

while IFS= read -r file; do
  [ -n "$file" ] || continue
  download "$MODEL_BASE/$file" "$TMP/$file"
done < "$TMP/.shards"

verify_sha256 "$TMP/group1-shard1of5" "0e7af0f713e98521252321f7f84892c31cefccccec3ac64c84e5065b75ed5646"
verify_sha256 "$TMP/group1-shard2of5" "74cc6cfc2c4510c9cd81b8ad4cebf6f6a8f305119bb365ce0eb96276da38519a"
verify_sha256 "$TMP/group1-shard3of5" "50383033f893eae136392a403e8f70ade5efd90867df5695c4ca5ac640e14f38"
verify_sha256 "$TMP/group1-shard4of5" "d856dc534c780068bbf6c666ce1516df2c8433d87578aa31fcdf197de7058cc2"
verify_sha256 "$TMP/group1-shard5of5" "3d356f1fb6dfca6af78c56db34d9326706d0196e303f9de6b04f236ca79ed309"

cat > "$TMP/SHA256SUMS" <<'SUMS'
300dfae273d20b4046f46a06d735688f03675a807561e9bcb5f664eb2f3d2831  tf.min.js
8875b8c1bb57723990c9d6506226e0e51cd21b8b6943eb53201086096de52df5  coco-ssd.min.js
3770b2528339b1e3340cb74360e1e40401816b009779aeb8d0cce3a4353ea3a9  model.json
0e7af0f713e98521252321f7f84892c31cefccccec3ac64c84e5065b75ed5646  group1-shard1of5
74cc6cfc2c4510c9cd81b8ad4cebf6f6a8f305119bb365ce0eb96276da38519a  group1-shard2of5
50383033f893eae136392a403e8f70ade5efd90867df5695c4ca5ac640e14f38  group1-shard3of5
d856dc534c780068bbf6c666ce1516df2c8433d87578aa31fcdf197de7058cc2  group1-shard4of5
3d356f1fb6dfca6af78c56db34d9326706d0196e303f9de6b04f236ca79ed309  group1-shard5of5
SUMS

mkdir -p "$DEST"
for file in tf.min.js coco-ssd.min.js model.json group1-shard1of5 group1-shard2of5 \
            group1-shard3of5 group1-shard4of5 group1-shard5of5 SHA256SUMS; do
  mv -f "$TMP/$file" "$DEST/$file"
done

echo "==> done: $(du -sh "$DEST" | cut -f1) in $DEST"
echo "    all pinned SHA-256 checks passed; the app will now use the local files."
