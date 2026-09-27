#!/bin/bash
# Installs dependencies at the start of Claude Code cloud sessions.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}"
if [ ! -d node_modules ]; then
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund >/dev/null 2>&1 || echo "npm ci failed; run it manually" >&2
fi
