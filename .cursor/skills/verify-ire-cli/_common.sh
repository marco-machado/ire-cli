#!/usr/bin/env bash
# Shared paths for verify-ire-cli helpers. Sourced, not executed.

_skill_dir() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

SKILL_DIR="$(_skill_dir)"
ACTIVE_RUN_FILE="$SKILL_DIR/.active-run"

find_repo_root() {
  if [[ -n "${IRE_VERIFY_REPO:-}" ]]; then
    printf '%s\n' "$IRE_VERIFY_REPO"
    return
  fi

  local dir="$SKILL_DIR"
  while true; do
    if [[ -f "$dir/package.json" ]] && grep -q '"name": "@marco.machado/ire-cli"' "$dir/package.json"; then
      printf '%s\n' "$dir"
      return
    fi
    local parent
    parent="$(dirname "$dir")"
    if [[ "$parent" == "$dir" ]]; then
      echo "verify-ire-cli: could not find ire-cli repo root from $SKILL_DIR" >&2
      return 1
    fi
    dir="$parent"
  done
}

load_active_run() {
  if [[ ! -f "$ACTIVE_RUN_FILE" ]]; then
    echo "verify-ire-cli: no active run. Launch first: $SKILL_DIR/helpers/launch.sh" >&2
    return 1
  fi
  # shellcheck disable=SC1090
  source "$ACTIVE_RUN_FILE"
  if [[ -z "${IRE_VERIFY_RUN_DIR:-}" || -z "${IRE_VERIFY_EVIDENCE:-}" || -z "${IRE_VERIFY_REPO:-}" ]]; then
    echo "verify-ire-cli: $ACTIVE_RUN_FILE is incomplete" >&2
    return 1
  fi
}

cli_js() {
  printf '%s\n' "$IRE_VERIFY_REPO/dist/cli.js"
}

package_version() {
  local repo="${IRE_VERIFY_REPO:-$(find_repo_root)}"
  node -e "const p=require(process.argv[1]); process.stdout.write(p.version)" "$repo/package.json"
}
