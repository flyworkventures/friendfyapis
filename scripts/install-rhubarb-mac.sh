#!/usr/bin/env bash
# Installs Rhubarb Lip Sync into friendfyapis/tools/rhubarb/rhubarb (no sudo).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/tools/rhubarb"
VERSION="1.14.0"
ZIP="Rhubarb-Lip-Sync-${VERSION}-macOS.zip"
URL="https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v${VERSION}/${ZIP}"
TMP="$(mktemp -d)"

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

if [[ -x "$DEST/rhubarb" && -f "$DEST/res/sphinx/cmudict-en-us.dict" ]]; then
  echo "Rhubarb already installed: $DEST"
  "$DEST/rhubarb" --version
  exit 0
fi

echo "Downloading Rhubarb ${VERSION}..."
curl -fsSL -o "$TMP/$ZIP" "$URL"
unzip -q -o "$TMP/$ZIP" -d "$TMP/extract"
SRC="$(find "$TMP/extract" -maxdepth 1 -type d -name 'Rhubarb-Lip-Sync-*' | head -1)"
if [[ -z "$SRC" || ! -x "$SRC/rhubarb" ]]; then
  echo "Rhubarb bundle not found in archive" >&2
  exit 1
fi
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC"/. "$DEST/"
chmod +x "$DEST/rhubarb"
if [[ ! -f "$DEST/res/sphinx/cmudict-en-us.dict" ]]; then
  echo "Missing PocketSphinx resources under $DEST/res" >&2
  exit 1
fi
echo "Installed: $DEST (binary + res/)"
"$DEST/rhubarb" --version
echo ""
echo "Add to friendfyapis/.env:"
echo "RHUBARB_BIN=$DEST/rhubarb"
