# ire-cli

`ire-cli` is an agent-first CLI for read-only access to Jira Cloud and Bitbucket Cloud. It is designed for coding agents such as Claude Code, Codex, Gemini, and opencode that need deterministic API primitives with structured output.

The npm package is `ire-cli`; the executable is `ire`.

## Design goals

- Provide thin, composable Jira and Bitbucket primitives.
- Emit stable JSON envelopes by default.
- Normalize provider responses into agent-oriented schemas.
- Keep v1 read-only, while leaving room for future write commands.
- Avoid interactive prompts, spinners, fuzzy selection, and human-first terminal formatting in the default path.

## Output contract

Every command emits a JSON envelope on stdout:

```json
{
  "success": true,
  "schemaVersion": "1.0",
  "data": {},
  "meta": {}
}
```

Failures use the same envelope:

```json
{
  "success": false,
  "schemaVersion": "1.0",
  "error": {
    "code": "jira.issue_not_found",
    "message": "Issue ABC-123 was not found",
    "statusCode": 404
  },
  "meta": {
    "provider": "jira"
  }
}
```

Default output is normalized for agents. Use `--raw` on supported commands to return provider-native payloads inside `data`.

Optional fields are omitted when absent. Known-empty provider values are represented as `null`. `undefined` is never emitted.

## Configuration

Configuration precedence:

```text
CLI flags > process env > project .env > project config > user config > defaults
```

Project files are discovered from the Git root:

```text
<git-root>/.env
<git-root>/.ire/config.json
```

Outside a Git repository, discovery falls back to the current working directory:

```text
<cwd>/.env
<cwd>/.ire/config.json
```

User config is read from:

```text
~/.config/ire-cli/config.json
```

Secrets are supported in config if present, but env vars are the documented secret path.

Supported env vars:

```text
IRE_JIRA_BASE_URL
IRE_JIRA_EMAIL
IRE_JIRA_API_TOKEN
IRE_BITBUCKET_WORKSPACE
IRE_BITBUCKET_USERNAME
IRE_BITBUCKET_APP_PASSWORD
```

Example project config:

```json
{
  "jira": {
    "baseUrl": "https://example.atlassian.net",
    "defaultProject": "ABC"
  },
  "bitbucket": {
    "workspace": "example-workspace",
    "defaultRepo": "api-service"
  }
}
```

Profiles are not part of v1.

## v1 command surface

Planned Jira commands:

```text
ire jira issue get KEY
ire jira issue search --jql "project = ABC ORDER BY updated DESC"
ire jira issue comments list KEY
```

Jira issue keys are always explicit. The CLI does not infer Jira issue identity from branch names.

Planned Bitbucket commands:

```text
ire bitbucket pr get ID
ire bitbucket pr list --repo workspace/repo
ire bitbucket pr comments list ID --repo workspace/repo
ire bitbucket pr diff ID --repo workspace/repo
ire bitbucket pr files ID --repo workspace/repo
```

Planned Bitbucket Pipelines commands:

```text
ire bitbucket pipelines list --repo workspace/repo --branch main
ire bitbucket pipelines latest --repo workspace/repo --branch current
ire bitbucket pipelines get UUID --repo workspace/repo
ire bitbucket pipelines steps list UUID --repo workspace/repo
ire bitbucket pipelines log UUID STEP_UUID --repo workspace/repo
```

Pipeline artifacts, reruns, and stops are out of scope for v1.

Bitbucket repository identity can be provided explicitly, read from config, or inferred from local Git remotes when unambiguous. Responses include the resolved workspace/repo in `meta`.

## Pagination

Paginated commands use explicit controls:

```text
--limit 50
--cursor <cursor>
```

Defaults:

```text
default limit: 50
maximum limit: 100
```

Responses include pagination metadata:

```json
{
  "success": true,
  "schemaVersion": "1.0",
  "data": [],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasNextPage": false
  },
  "meta": {
    "provider": "jira"
  }
}
```

`--all` is not part of v1.

## Diagnostics

Inspect resolved configuration without provider calls:

```text
ire config inspect
```

Check authentication with lightweight provider requests:

```text
ire auth check
ire auth check jira
ire auth check bitbucket
```

Use `--debug` to include redacted request metadata under `meta.debug`. Debug output never includes authorization headers or credential values.

## Exit codes

```text
0 success
1 unexpected/internal error
2 usage/configuration error
3 authentication/authorization error
4 not found
5 provider/API error
6 network/timeout error
7 ambiguity/conflict
```

## Runtime

v1 targets Node.js `>=22`, ESM, TypeScript, Commander, built-in `fetch`/Undici, and Zod for boundary validation.
