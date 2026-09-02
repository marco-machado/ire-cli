#!/usr/bin/env bash
# Read-only: is this built CLI + isolated run worth driving?
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../_common.sh"

load_active_run

CLI="$(cli_js)"
DOCTOR_DIR="$IRE_VERIFY_EVIDENCE/doctor"
mkdir -p "$DOCTOR_DIR"

fail() {
  printf '%s\n' "$1" | tee "$DOCTOR_DIR/fail.txt" >&2
  exit 1
}

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  fail "doctor: Node $NODE_MAJOR < 22 (engines.node is >=22)"
fi

if [[ ! -f "$CLI" ]]; then
  fail "doctor: missing $CLI"
fi

EXPECTED="$(package_version)"
ACTUAL="$(
  env -i PATH="$PATH" HOME="$IRE_VERIFY_RUN_DIR/home" LANG=C.UTF-8 \
    node "$CLI" --version
)"
ACTUAL="${ACTUAL//$'\n'/}"
printf '%s\n' "$ACTUAL" > "$DOCTOR_DIR/cli-version.txt"
printf '%s\n' "$EXPECTED" > "$DOCTOR_DIR/package-version.txt"

if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  fail "doctor: cli --version $ACTUAL != package.json $EXPECTED"
fi

# Isolated default inspect: no inherited IRE_*, no user/project config.
set +e
"$SCRIPT_DIR/run-ire.sh" --step doctor-config-inspect --cwd "$IRE_VERIFY_RUN_DIR/cwd" --home "$IRE_VERIFY_RUN_DIR/home" \
  config inspect
INSPECT_EXIT=$?
set -e

if [[ "$INSPECT_EXIT" -ne 0 ]]; then
  fail "doctor: config inspect exited $INSPECT_EXIT (expected 0)"
fi

node -e '
const assert = require("node:assert/strict");
const fs = require("node:fs");
const envelope = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
assert.deepEqual(envelope, {
  success: true,
  schemaVersion: "1.0",
  data: {
    config: {
      jira: {
        baseUrl: { value: null, source: "default" },
        email: { value: null, source: "default" },
        apiToken: { value: null, source: "default" },
        issueExport: { fieldMappings: { value: {}, source: "default" } },
      },
      bitbucket: {
        workspace: { value: null, source: "default" },
        repo: { value: null, source: "default" },
        email: { value: null, source: "default" },
        apiToken: { value: null, source: "default" },
      },
    },
  },
  meta: {},
});
' "$IRE_VERIFY_EVIDENCE/doctor-config-inspect/stdout.txt"

printf 'ok node=%s cli=%s inspect=defaulted\n' "$(node --version)" "$ACTUAL" | tee "$DOCTOR_DIR/ok.txt"
