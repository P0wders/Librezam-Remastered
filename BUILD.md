# Building Librezam Remastered

## Requirements
- **OS:** Linux or macOS (any distribution/version with the tools below). On Windows, use WSL.
- **Node.js 18.12 or newer** with **npm 8 or newer** (Node.js 22 LTS + npm 10 recommended) —
  install from https://nodejs.org or with your package manager / nvm.
- **Python 3.8 or newer** with the `venv` module — https://www.python.org
- **git** (only needed if `third_party/node-shazam-api` is not already present)
- Internet access for `npm ci` (downloads the pinned dependencies from `package-lock.json`)

## One-step build

    ./build.sh

Output: `dist/firefox.zip` — the extension package submitted to addons.mozilla.org.

## What the script does
1. Uses the node-shazam-api source in `third_party/node-shazam-api` (or clones
   https://github.com/FoxRefire/node-shazam-api, branch `webpack`, commit `d776140`).
2. Runs `npm ci` and `npx webpack` there, producing `webpack-dist/shazam-api.min.js`,
   and copies it to `libs/shazam-api.min.js`.
3. Creates a Python virtual environment, installs `watchdog` (imported by build.py),
   and runs `python build.py -b firefox --zip-only`, which zips the repository
   (excluding build-only files) and renames `manifest_firefox.json` to `manifest.json`.

## Source files
- The extension's own code (`popup/`, `background/`, `content/`, `common/`,
  `backendModules/`, `_locales/`, `images/`) is hand-written, unminified
  JavaScript/HTML/CSS. It is not transpiled or bundled.
- `libs/materialize/materialize.min.js` and `.min.css`: Materialize v2.2.2, unmodified
  open-source library — https://materializeweb.com (MIT).
- `libs/shazam-api.min.js`: webpack build of node-shazam-api (GPL-2.0), see above. The
  committed file is byte-identical to `webpack-dist/shazam-api.min.js` in that repository
  at commit `d776140` (SHA-256 `9eb3df5b61776ef88bf46bc323c6c17a14dba493874abf20859b6e1592bb1315`).
