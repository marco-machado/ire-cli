---
name: verify-ire-cli
description: Verify ire-cli (Immutable Read Engine) on its CLI surface by spawning isolated `node dist/cli.js` processes and checking JSON envelopes. Use when proving ire commands, checking config inspect, auth check, issue view, Bitbucket PR/pipeline reads, or verifying CLI behavior after a change.
---

# Verify ire-cli

`ire-cli` is a short-lived CLI. The user-facing binary is `ire`; in this checkout drive `node dist/cli.js`. Every command prints one JSON envelope on stdout and exits. There is no server, TUI, prompt, spinner, or listen port.

Secondary surfaces, not this skill's drive target: the published consumer skill `skills/use-ire-cli`, and the npm package `@marco.machado/ire-cli`. No web UI.

Feature details live in [features/](features/README.md). Drive from that map. A proof that hits one convenient entry point is incomplete when the map lists others.

Tests under `tests/*.test.mjs` spawn the same binary with isolated `HOME`/`cwd`. They are the automated contract. Their `--import` fetch hooks are test-only; do not use them as the user path.

## Launch

No process stays up. Launch means install/build once, then open an isolated scratch home + cwd.

```sh
.cursor/skills/verify-ire-cli/helpers/launch.sh <run-id>
```

Ready when the helper prints `ready: dist/cli.js <version>` and `.cursor/skills/verify-ire-cli/.active-run` exists. `dist/cli.js --version` equals `package.json` `version` (currently the file on disk; do not hard-code it).

Teardown is [Cleanup](#cleanup). Failed attempts must run cleanup too so `/tmp/ire-verify-*` dirs do not accumulate.

## Doctor

Run this first whenever anything looks off. It is read-only against providers (default `config inspect` makes no network calls).

```sh
.cursor/skills/verify-ire-cli/helpers/doctor.sh
```

Worth driving when stdout is `ok node=... cli=<package version> inspect=defaulted` and exit is 0. That means: Node >= 22, `dist/cli.js` exists, `--version` matches `package.json`, and isolated `config inspect` is the all-default envelope (`success: true`, every field `source: "default"`, secret-capable fields `value: null`).

If doctor fails, do not drive. Rebuild with `launch.sh` or inspect `evidence/<run-id>/doctor/` and `doctor-config-inspect/`.

## Drive

Harness: `helpers/run-ire.sh`. It matches the test spawn recipe (`node dist/cli.js`, empty env except `PATH`/`HOME`/`LANG`, isolated `HOME` + cwd).

```sh
.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step <id> [--cwd DIR] [--home DIR] [--env KEY=VAL] -- <ire args>
```

Examples grounded in this repo:

```sh
.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step default-inspect -- config inspect
.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step env-redaction \
  --env IRE_JIRA_BASE_URL=https://jira.example.test \
  --env IRE_JIRA_EMAIL=agent@example.test \
  --env IRE_JIRA_API_TOKEN=jira-secret \
  -- config inspect
.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step missing-issue-key -- issue view
.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step auth-missing -- auth check
```

Stable handles (not coordinates, not tab order):

| Handle | What it is |
| --- | --- |
| `config inspect` | resolved config; no provider calls |
| `auth check` / `auth check jira` / `auth check bitbucket` | lightweight provider probe |
| `issue view KEY` | destination issue View; `--comments`, `--pull-requests` |
| `jira issue get KEY` | leftover always-full aggregate (`schemaVersion` `"1.1"` on success) |
| `jira issue export KEY` | curated export; `--adf-format markdown\|raw`, `--download-attachments <dir>` |
| `jira issue search --jql "..."` | required `--jql`; `--limit`, `--cursor` |
| `jira issue comments list KEY` | paginated comments |
| `bitbucket pr get\|list\|export\|comments list\|files\|diff` | `--repo workspace/repo` |
| `bitbucket pipelines list\|latest\|get\|steps list\|log` | `--repo`, `--branch` on list/latest |
| `--debug` | redacted `meta.debug.requests` |
| `--raw` | provider payload on leftover get, comments list, pr get only — **not** on `issue view` |

Parse **stdout JSON**, then the process exit code. stderr is empty on the contract path. Commander `-h` / `-V` are human text, not envelopes.

Exit codes: `0` success, `1` internal/normalized-output, `2` usage/config, `3` auth, `4` not found, `5` provider/API, `6` network/timeout, `7` ambiguity (`BITBUCKET_REPO_AMBIGUOUS`).

Do not inherit the agent shell's `IRE_*` variables, `HOME`, or repo cwd. `run-ire.sh` starts from `env -i`. Passing `--env IRE_JIRA_API_TOKEN=...` is explicit. Driving from the checkout cwd would walk to this git root and pick up any `.env` / `.ire/config.json`.

Provider success paths need real Jira/Bitbucket credentials. When they are absent, prove the skip by observing `AUTH_CONFIG_MISSING` or `AUTH_CONFIG_INCOMPLETE` (exit 2), not by mocking `fetch`.

## Evidence

Root: `.cursor/skills/verify-ire-cli/evidence/<run-id>/`. Cleanup never deletes this tree.

Each `run-ire.sh --step <id>` writes:

- `command.txt` — `node <dist/cli.js> <argv>` with `--jira-api-token` / `--bitbucket-api-token` values replaced by `<redacted>`
- `env.txt` — `HOME`, cwd, extra env (`IRE_*_API_TOKEN` values redacted)
- `stdout.txt` — raw stdout (the envelope)
- `stdout.json` — parsed envelope when stdout is JSON
- `stderr.txt`
- `exit-code.txt`
- `meta.json` — `exitCode`, `success`, `errorCode` when present

Proof standard:

- Drive the real CLI path (`node dist/cli.js …`), not library internals or test fetch hooks.
- Capture the command **and** the resulting envelope/exit code. For writes to disk (`jira issue export --download-attachments`, `bitbucket pr export --output`), also capture the files ire created under the scratch cwd and `meta.outputPath`.
- `config inspect` is local and is enough to prove envelope + redaction + precedence without providers. Auth/issue/PR/pipeline success needs live credentials; without them, record the configuration-error envelope as a skip, not a pass.
- Confirm secrets never appear in `stdout.txt` (`apiToken.value` is `"<redacted>"`; `--debug` has no `authorization` header).

## Cleanup

```sh
.cursor/skills/verify-ire-cli/helpers/cleanup.sh
```

Deletes only `/tmp/ire-verify-<run-id>` named in `.active-run`, then removes `.active-run`. It does not kill by process name (each drive already exited). It does not touch `evidence/`. After cleanup, `test -d .cursor/skills/verify-ire-cli/evidence/<run-id>` must still succeed.

## Helpers

All under `.cursor/skills/verify-ire-cli/helpers/`, executable:

| Script | Invocation |
| --- | --- |
| `launch.sh` | `.cursor/skills/verify-ire-cli/helpers/launch.sh <run-id>` |
| `doctor.sh` | `.cursor/skills/verify-ire-cli/helpers/doctor.sh` |
| `run-ire.sh` | `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step <id> -- config inspect` |
| `cleanup.sh` | `.cursor/skills/verify-ire-cli/helpers/cleanup.sh` |

## Isolate

Two runs can execute side by side: no ports, no shared daemon. Each run needs its own `HOME` (`~/.config/ire-cli/config.json`) and cwd (project `.env` / `.ire/config.json`, plus Bitbucket git-remote inference). `launch.sh` refuses to reuse an existing `/tmp/ire-verify-<run-id>`. Do not double-drive one scratch dir from two agents.

This checkout is a git repo. Bitbucket commands without `--repo` may infer `workspace/repo` from `git remote -v`. Isolated default cwd is **not** a git repo, so inference does not leak this GitHub remote.

## Maintain

`/maintain-verification-skill` is the loop that updates this skill and the feature map when the CLI surface changes.
