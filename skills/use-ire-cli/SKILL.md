---
name: use-ire-cli
description: Use the ire agent-first CLI to inspect Jira Cloud issues, Bitbucket Cloud pull requests, and Bitbucket Pipelines with stable JSON output. Use when the user asks to use ire, inspect Jira/Bitbucket context through ire, check ire configuration/auth, retrieve PR diffs/comments/files, or diagnose Bitbucket Pipelines failures with the CLI.
---

# Use ire CLI

## Quick start

Use `ire` as a read-only, agent-first wrapper around Jira Cloud and Bitbucket Cloud. Prefer explicit identifiers and parse stdout as JSON envelopes.

```sh
ire config inspect
ire auth check
ire jira issue get ABC-123
ire bitbucket pr get 42 --repo workspace/repo
ire bitbucket pipelines latest --repo workspace/repo --branch main
```

Every command writes a JSON envelope to stdout:

```json
{ "success": true, "schemaVersion": "1.0", "data": {}, "meta": {} }
```

On failure, still read stdout JSON: `success: false`, `error.code`, `error.message`, optional `error.details`, and `meta`.

## Core rules

- Treat v1 as read-only: inspect only; do not expect mutation commands.
- Do not scrape human output. Use envelope fields and exit codes.
- Keep Jira issue identity explicit; never infer issue keys from branches.
- Prefer `--repo workspace/repo` for Bitbucket unless config or Git remote inference is clearly enough.
- Use env vars for secrets; never print tokens.
- Add `--debug` only when needed; it emits redacted request metadata under `meta.debug`.
- Use `--raw` only on supported commands when provider-native payloads are specifically needed.

## Configuration workflow

1. Check resolved config without provider calls:
   ```sh
   ire config inspect
   ```
2. If values are missing, use precedence:
   ```text
   CLI flags > process env > project .env > project config > user config > defaults
   ```
3. Supported env vars:
   ```text
   IRE_JIRA_BASE_URL IRE_JIRA_EMAIL IRE_JIRA_API_TOKEN
   IRE_BITBUCKET_WORKSPACE IRE_BITBUCKET_REPO
   IRE_BITBUCKET_EMAIL IRE_BITBUCKET_API_TOKEN
   ```
4. Check auth with lightweight provider requests:
   ```sh
   ire auth check
   ire auth check jira
   ire auth check bitbucket
   ```

## Jira workflows

```sh
ire jira issue get KEY
ire jira issue search --jql "project = ABC ORDER BY updated DESC" --limit 50
ire jira issue comments list KEY --limit 50
```

Supported Jira flags: `--jira-base-url`, `--jira-email`, `--jira-api-token`, plus `--debug`; `get` and `comments list` support `--raw`.

## Bitbucket PR workflows

```sh
ire bitbucket pr list --repo workspace/repo --limit 50
ire bitbucket pr get ID --repo workspace/repo
ire bitbucket pr comments list ID --repo workspace/repo --limit 50
ire bitbucket pr files ID --repo workspace/repo --limit 50
ire bitbucket pr diff ID --repo workspace/repo
```

PR IDs must be positive integers. Responses include resolved repo identity in `meta.bitbucket`.

## Bitbucket Pipelines workflows

```sh
ire bitbucket pipelines list --repo workspace/repo --branch main --limit 50
ire bitbucket pipelines latest --repo workspace/repo --branch main
ire bitbucket pipelines get UUID --repo workspace/repo
ire bitbucket pipelines steps list UUID --repo workspace/repo
ire bitbucket pipelines log UUID STEP_UUID --repo workspace/repo
```

For pipeline failure diagnosis: get latest run, list steps, identify failed step UUID, fetch its log, then summarize only relevant failing lines.

## Pagination and errors

Paginated commands use `--limit` and `--cursor`; default limit is 50, max is 100. If `pagination.hasNextPage` is true, repeat with `--cursor pagination.nextCursor`.

Exit codes: `0` success, `1` internal/normalized-output bug, `2` usage/config, `3` auth, `4` not found, `5` provider/API, `6` network/timeout, `7` ambiguity/conflict.
