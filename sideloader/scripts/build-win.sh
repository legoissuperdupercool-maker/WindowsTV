#!/usr/bin/env bash
# Builds the ello Sideloader Windows installer without a Windows machine
# (Linux + wine), for when GitHub Actions minutes run out.
#
#   ELLO_IPA=/path/to/ello-smartTV.ipa sideloader/scripts/build-win.sh [version]
#
# The helper runs on Windows' own embeddable Python with the Windows wheels of
# its dependencies; rcodesign (apple-codesign, MPL-2.0) signs apps and Apple's
# anisette libraries let the PC sign in like Xcode. All are fetched here, at
# build time, so the installed app never downloads anything but from Apple.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(node -p "require('./package.json').version")}"
PY_VERSION=3.13.9
RCODESIGN_VERSION=0.29.0
CACHE="${ELLO_BUILD_CACHE:-$PWD/.build-cache}"
OUT=resources/helper
mkdir -p "$CACHE"

fetch() { [ -s "$CACHE/$2" ] || curl -fsSL -o "$CACHE/$2" "$1"; }

echo "== Windows Python $PY_VERSION"
fetch "https://www.python.org/ftp/python/$PY_VERSION/python-$PY_VERSION-embed-amd64.zip" python-embed.zip
rm -rf "$OUT" && mkdir -p "$OUT/python" "$OUT/app"
unzip -q "$CACHE/python-embed.zip" -d "$OUT/python"
PTH=$(ls "$OUT"/python/python3*._pth)
printf 'python313.zip\n.\nLib\\site-packages\n..\\app\nimport site\n' > "$PTH"

echo "== Windows packages"
python3 -m pip install --quiet --disable-pip-version-check --target "$OUT/python/Lib/site-packages" \
  --platform win_amd64 --python-version 3.13 --implementation cp --only-binary=:all: \
  pymobiledevice3==11.43.1 anisette==1.2.4 srp==1.0.22 \
  pywin32==311 colorama  # Windows-only dependencies: pip skips them when run on Linux
find "$OUT/python/Lib/site-packages" -name '__pycache__' -prune -exec rm -rf {} +

echo "== rcodesign $RCODESIGN_VERSION"
fetch "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F$RCODESIGN_VERSION/apple-codesign-$RCODESIGN_VERSION-x86_64-pc-windows-msvc.zip" rcodesign-win.zip
unzip -qjo "$CACHE/rcodesign-win.zip" '*/rcodesign.exe' -d "$OUT/app"

echo "== Apple's anisette libraries"
if [ ! -s "$CACHE/anisette-libs.bin" ]; then
  fetch "https://anisette.dl.mikealmel.ooo/libs?arch=arm64-v8a" anisette-bundle.bin
  python3 - "$CACHE/anisette-bundle.bin" "$CACHE/anisette-libs.bin" <<'PY'
import sys
from anisette import Anisette
Anisette.init(sys.argv[1]).save_libs(sys.argv[2])
PY
fi
cp "$CACHE/anisette-libs.bin" "$OUT/app/"

echo "== helper scripts"
cp helper/ello_apple_helper.py helper/apple_account.py helper/apple_dev.py helper/app_signer.py "$OUT/app/"
if [ -n "${ELLO_IPA:-}" ]; then cp "$ELLO_IPA" "$OUT/app/ello-smartTV.ipa"; fi

if command -v wine >/dev/null; then
  echo "== selftest (wine)"
  WINEDEBUG=-all ELLO_SELFTEST_WINE=1 APPDATA='C:\ello-selftest' wine "$OUT/python/python.exe" -X utf8 "$OUT/app/ello_apple_helper.py" --selftest
fi

echo "== installer $VERSION"
npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
npm run build
# electron-builder edits the .exe (icon, version) with rcedit under wine; only 64-bit
# wine is installed here, so let the 32-bit name run the 64-bit tool.
fix_rcedit() {
  for d in "$HOME"/.cache/electron-builder/winCodeSign/*/; do
    [ -f "$d/rcedit-x64.exe" ] && cp "$d/rcedit-x64.exe" "$d/rcedit-ia32.exe"
  done
  return 0
}
fix_rcedit
build() { CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win nsis --x64 --publish never; }
build || { fix_rcedit; build; }
ls -la release/*.exe
