#!/usr/bin/env bash
# Tear down scratch created by this run. Evidence stays.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../_common.sh"

if [[ ! -f "$ACTIVE_RUN_FILE" ]]; then
  echo "verify-ire-cli: nothing to clean (no active run)"
  exit 0
fi

# shellcheck disable=SC1090
source "$ACTIVE_RUN_FILE"

if [[ -z "${IRE_VERIFY_RUN_DIR:-}" ]]; then
  echo "verify-ire-cli: active run has no IRE_VERIFY_RUN_DIR" >&2
  exit 1
fi

case "$IRE_VERIFY_RUN_DIR" in
  /tmp/ire-verify-*)
    ;;
  *)
    echo "verify-ire-cli: refusing to delete unexpected run dir: $IRE_VERIFY_RUN_DIR" >&2
    exit 1
    ;;
esac

rm -rf "$IRE_VERIFY_RUN_DIR"
rm -f "$ACTIVE_RUN_FILE"

if [[ -n "${IRE_VERIFY_EVIDENCE:-}" && -d "$IRE_VERIFY_EVIDENCE" ]]; then
  echo "removed scratch $IRE_VERIFY_RUN_DIR"
  echo "evidence remains $IRE_VERIFY_EVIDENCE"
else
  echo "removed scratch $IRE_VERIFY_RUN_DIR"
  echo "verify-ire-cli: evidence dir missing after cleanup (proof failed)" >&2
  exit 1
fi
