#!/usr/bin/env bash
# Two-state smoke for the core: MUST be run with hhhweb dev server on :5173.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm build
# Pre-ruling D8-0: os.tmpdir() on macOS is /var/folders/.../T, not /tmp.
TMP_ROOT=$(node -p "require('os').tmpdir()")
TMP_BEFORE=$(mktemp -d); TMP_AFTER=$(mktemp -d)
cp -R "$TMP_ROOT"/dsh-browser-verify-* "$TMP_BEFORE/" 2>/dev/null || true
# Deviation D8-4: real hhhweb facts — page needs the uni-app hash route and the
# app's `{status, result}` envelope; mocks are pre-registered by the CLI before
# navigation (unmocked APIs answer "session invalid" and bounce to #/).
node lib/cli.js --url 'http://localhost:5173/hweb/#/pages/lyp/livingPayment' \
  --mock tests/fixtures/mock-empty.json --wait-selector '.header' --assert '.empty-wrap' --screenshot
node lib/cli.js --url 'http://localhost:5173/hweb/#/pages/lyp/livingPayment' \
  --mock tests/fixtures/mock-normal.json --wait-selector '.header' --assert '.grid-item' --screenshot
# 0.1.3 regression guard: without --wait-selector the open must still snapshot
# after the render settles (non-empty, no boot skeleton), not the early frame.
OPEN_OUT=$(node lib/cli.js --url 'http://localhost:5173/hweb/#/pages/lyp/livingPayment' \
  --mock tests/fixtures/mock-normal.json --assert '.grid-item' --screenshot)
echo "$OPEN_OUT" | head -1 | grep -q '水费' || { echo 'FAIL: no-wait-selector open did not snapshot settled content'; exit 1; }
echo '--- no-wait-selector open OK (settled, 水费 present) ---'
sleep 1
cp -R "$TMP_ROOT"/dsh-browser-verify-* "$TMP_AFTER/" 2>/dev/null || true
echo "--- garbage diff ---"
diff -r "$TMP_BEFORE" "$TMP_AFTER" || echo "残留差异见上（预期：无——CLI 默认截图在 pid 临时目录内，dispose 时删除）"
rm -rf "$TMP_BEFORE" "$TMP_AFTER"
echo "--- zombie chromium ---"
ps -Ao pid=,command= | grep -c "$TMP_ROOT/[d]sh-browser-verify-" || true
