#!/usr/bin/env bash
# Spawn one isolated ire invocation and write stdout/stderr/exit-code evidence.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../_common.sh"

load_active_run

STEP=""
CWD_OVERRIDE=""
HOME_OVERRIDE=""
declare -a EXTRA_ENV=()
declare -a IRE_ARGS=()

usage() {
  echo "Usage: run-ire.sh --step NAME [--cwd DIR] [--home DIR] [--env KEY=VAL] [--] <ire args>" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --step)
      [[ $# -ge 2 ]] || usage
      STEP="$2"
      shift 2
      ;;
    --cwd)
      [[ $# -ge 2 ]] || usage
      CWD_OVERRIDE="$2"
      shift 2
      ;;
    --home)
      [[ $# -ge 2 ]] || usage
      HOME_OVERRIDE="$2"
      shift 2
      ;;
    --env)
      [[ $# -ge 2 ]] || usage
      EXTRA_ENV+=("$2")
      shift 2
      ;;
    --)
      shift
      IRE_ARGS+=("$@")
      break
      ;;
    -*)
      echo "verify-ire-cli: unknown flag $1" >&2
      usage
      ;;
    *)
      IRE_ARGS+=("$@")
      break
      ;;
  esac
done

if [[ -z "$STEP" ]]; then
  echo "verify-ire-cli: --step NAME is required" >&2
  usage
fi

if [[ ${#IRE_ARGS[@]} -eq 0 ]]; then
  echo "verify-ire-cli: missing ire arguments" >&2
  usage
fi

CLI="$(cli_js)"
if [[ ! -f "$CLI" ]]; then
  echo "verify-ire-cli: $CLI missing; run helpers/launch.sh" >&2
  exit 1
fi

HOME_DIR="${HOME_OVERRIDE:-$IRE_VERIFY_RUN_DIR/home}"
CWD="${CWD_OVERRIDE:-$IRE_VERIFY_RUN_DIR/steps/$STEP/cwd}"
mkdir -p "$HOME_DIR" "$CWD"

STEP_DIR="$IRE_VERIFY_EVIDENCE/$STEP"
mkdir -p "$STEP_DIR"

redact_token_args() {
  local -a out=()
  local skip_value=0
  local arg
  for arg in "$@"; do
    if [[ $skip_value -eq 1 ]]; then
      out+=("<redacted>")
      skip_value=0
      continue
    fi
    case "$arg" in
      --jira-api-token|--bitbucket-api-token)
        out+=("$arg")
        skip_value=1
        ;;
      --jira-api-token=*|--bitbucket-api-token=*)
        out+=("${arg%%=*}=<redacted>")
        ;;
      *)
        out+=("$arg")
        ;;
    esac
  done
  printf '%s\n' "${out[*]}"
}

redact_env_record() {
  local pair
  for pair in "$@"; do
    case "$pair" in
      IRE_JIRA_API_TOKEN=*|IRE_BITBUCKET_API_TOKEN=*)
        printf '%s=<redacted>\n' "${pair%%=*}"
        ;;
      *)
        printf '%s\n' "$pair"
        ;;
    esac
  done
}

{
  echo "node $CLI ${IRE_ARGS[*]}"
} > "$STEP_DIR/command.raw.txt"
redact_token_args "${IRE_ARGS[@]}" > "$STEP_DIR/command.txt"
{
  echo "HOME=$HOME_DIR"
  echo "cwd=$CWD"
  redact_env_record "${EXTRA_ENV[@]}"
} > "$STEP_DIR/env.txt"

declare -a ENV_ASSIGN=()
for pair in "${EXTRA_ENV[@]}"; do
  ENV_ASSIGN+=("$pair")
done

run_cli() {
  if [[ ${#ENV_ASSIGN[@]} -gt 0 ]]; then
    env -i -C "$CWD" \
      PATH="$PATH" \
      HOME="$HOME_DIR" \
      PWD="$CWD" \
      LANG="${LANG:-C.UTF-8}" \
      LC_ALL="${LC_ALL:-C.UTF-8}" \
      TZ="${TZ:-UTC}" \
      "${ENV_ASSIGN[@]}" \
      node "$CLI" "${IRE_ARGS[@]}" \
      >"$STEP_DIR/stdout.txt" \
      2>"$STEP_DIR/stderr.txt"
  else
    env -i -C "$CWD" \
      PATH="$PATH" \
      HOME="$HOME_DIR" \
      PWD="$CWD" \
      LANG="${LANG:-C.UTF-8}" \
      LC_ALL="${LC_ALL:-C.UTF-8}" \
      TZ="${TZ:-UTC}" \
      node "$CLI" "${IRE_ARGS[@]}" \
      >"$STEP_DIR/stdout.txt" \
      2>"$STEP_DIR/stderr.txt"
  fi
}

set +e
run_cli
EXIT_CODE=$?
set -e

printf '%s\n' "$EXIT_CODE" > "$STEP_DIR/exit-code.txt"

node -e '
const fs = require("node:fs");
const stepDir = process.argv[1];
const stdout = fs.readFileSync(stepDir + "/stdout.txt", "utf8");
const meta = {
  node: process.version,
  exitCode: Number(fs.readFileSync(stepDir + "/exit-code.txt", "utf8")),
  stdoutBytes: Buffer.byteLength(stdout),
  stderrBytes: Buffer.byteLength(fs.readFileSync(stepDir + "/stderr.txt")),
  json: false,
};
try {
  const parsed = JSON.parse(stdout);
  meta.json = true;
  meta.success = parsed.success;
  meta.schemaVersion = parsed.schemaVersion;
  if (parsed.error && typeof parsed.error === "object") {
    meta.errorCode = parsed.error.code;
  }
  fs.writeFileSync(stepDir + "/stdout.json", JSON.stringify(parsed, null, 2) + "\n");
} catch {
  // commander --help / --version are text, not envelopes
}
fs.writeFileSync(stepDir + "/meta.json", JSON.stringify(meta, null, 2) + "\n");
' "$STEP_DIR"

echo "step=$STEP exit=$EXIT_CODE stdout=$STEP_DIR/stdout.txt"
exit "$EXIT_CODE"
