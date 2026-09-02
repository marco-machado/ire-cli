#!/usr/bin/env bash
# Build ire-cli once and open an isolated verification run (no long-lived process).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../_common.sh"

REPO_ROOT="$(find_repo_root)"
IRE_VERIFY_REPO="$REPO_ROOT"
RUN_ID="${1:-run-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
RUN_DIR="${IRE_VERIFY_RUN_DIR_OVERRIDE:-/tmp/ire-verify-$RUN_ID}"
EVIDENCE_DIR="$REPO_ROOT/.cursor/skills/verify-ire-cli/evidence/$RUN_ID"

if [[ -e "$RUN_DIR" ]]; then
  echo "verify-ire-cli: run dir already exists: $RUN_DIR" >&2
  echo "Pass a fresh run id or run helpers/cleanup.sh first." >&2
  exit 1
fi

cd "$REPO_ROOT"

if [[ ! -d node_modules ]]; then
  npm ci
fi
npm run build

if [[ ! -f dist/cli.js ]]; then
  echo "verify-ire-cli: dist/cli.js missing after build" >&2
  exit 1
fi

mkdir -p "$RUN_DIR/home" "$RUN_DIR/cwd" "$EVIDENCE_DIR"
umask 077

cat > "$ACTIVE_RUN_FILE" <<EOF
IRE_VERIFY_RUN_ID=$(printf '%q' "$RUN_ID")
IRE_VERIFY_RUN_DIR=$(printf '%q' "$RUN_DIR")
IRE_VERIFY_EVIDENCE=$(printf '%q' "$EVIDENCE_DIR")
IRE_VERIFY_REPO=$(printf '%q' "$REPO_ROOT")
EOF

cat > "$EVIDENCE_DIR/RUN.md" <<EOF
# ire-cli verification run \`$RUN_ID\`

- repo: \`$REPO_ROOT\`
- scratch: \`$RUN_DIR\` (removed by cleanup)
- evidence: \`$EVIDENCE_DIR\` (survives cleanup)
- launched: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- package version: $(package_version)
- node: $(node --version)
EOF

echo "ready: dist/cli.js $(package_version)  run=$RUN_ID  scratch=$RUN_DIR  evidence=$EVIDENCE_DIR"
