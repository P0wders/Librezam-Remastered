#!/usr/bin/env bash
# Librezam Remastered — full build script (see BUILD.md)
# Produces dist/firefox.zip, identical in content to the package submitted to AMO.
set -euo pipefail
cd "$(dirname "$0")"

SHAZAM_REPO="https://github.com/FoxRefire/node-shazam-api.git"
SHAZAM_COMMIT="d776140"
SHAZAM_DIR="third_party/node-shazam-api"

# 1. Get the node-shazam-api source (already included in the AMO source package)
if [ ! -d "$SHAZAM_DIR" ]; then
    git clone -b webpack "$SHAZAM_REPO" "$SHAZAM_DIR"
    git -C "$SHAZAM_DIR" checkout "$SHAZAM_COMMIT"
fi

# 2. Build libs/shazam-api.min.js with webpack
(
    cd "$SHAZAM_DIR"
    npm ci --no-audit --no-fund
    npx webpack
)
cp "$SHAZAM_DIR/webpack-dist/shazam-api.min.js" libs/shazam-api.min.js

# 3. Package the extension (build.py needs the "watchdog" Python package)
python3 -m venv .venv
.venv/bin/pip install --quiet watchdog
.venv/bin/python build.py -b firefox --zip-only

echo "Done: dist/firefox.zip"
