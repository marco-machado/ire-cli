# ire-cli

`ire-cli` is an agent-first CLI for read-only access to Jira Cloud and Bitbucket Cloud. It is designed for coding agents such as Claude Code, Codex, Gemini, and opencode that need deterministic API primitives with structured output.

The npm package is `@marco.machado/ire-cli`; the executable is `ire`.

## Installation

Run without installing globally:

```sh
npx @marco.machado/ire-cli --help
```

Install globally:

```sh
npm install -g @marco.machado/ire-cli
ire --help
```

`ire-cli` requires Node.js `>=22`.

## Agent skill

Install the `use-ire-cli` skill for agents that support [Vercel Skills](https://github.com/vercel-labs/skills):

```sh
npx skills add https://github.com/marco-machado/ire-cli --skill use-ire-cli
```

Or install directly from the skill path:

```sh
npx skills add https://github.com/marco-machado/ire-cli/tree/main/skills/use-ire-cli
```

## Design goals

- Provide thin, composable Jira and Bitbucket primitives.
- Emit stable JSON envelopes by default.
- Normalize provider responses into agent-oriented schemas.
- Provide read-only inspection commands for Jira, Bitbucket pull requests, and Bitbucket Pipelines.
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

For Bitbucket Cloud, `IRE_BITBUCKET_API_TOKEN` is sent as the Basic auth password with `IRE_BITBUCKET_EMAIL` as the Basic auth username.

Supported env vars:

```text
IRE_JIRA_BASE_URL
IRE_JIRA_EMAIL
IRE_JIRA_API_TOKEN
IRE_BITBUCKET_WORKSPACE
IRE_BITBUCKET_REPO
IRE_BITBUCKET_EMAIL
IRE_BITBUCKET_API_TOKEN
```

Example project config:

```json
{
  "jira": {
    "baseUrl": "https://example.atlassian.net",
    "email": "agent@example.com",
    "apiToken": "use-env-for-secrets-when-possible"
  },
  "bitbucket": {
    "workspace": "example-workspace",
    "repo": "example-repo",
    "email": "agent@example.com",
    "apiToken": "use-env-for-secrets-when-possible"
  }
}
```

Inspect resolved configuration without provider calls:

```sh
ire config inspect
```

## Commands

### Jira

```text
ire jira issue get KEY
ire jira issue search --jql "project = ABC ORDER BY updated DESC"
ire jira issue comments list KEY
```

Jira issue keys are always explicit. The CLI does not infer Jira issue identity from branch names.

Supported options:

- `ire jira issue get`: `--raw`, `--debug`, Jira config flags.
- `ire jira issue search`: `--jql`, `--limit`, `--cursor`, `--debug`, Jira config flags.
- `ire jira issue comments list`: `--limit`, `--cursor`, `--raw`, `--debug`, Jira config flags.

Jira config flags are:

```text
--jira-base-url <url>
--jira-email <email>
--jira-api-token <token>
```

### Bitbucket pull requests

```text
ire bitbucket pr get ID [--repo workspace/repo]
ire bitbucket pr list [--repo workspace/repo]
ire bitbucket pr comments list ID [--repo workspace/repo]
ire bitbucket pr files ID [--repo workspace/repo]
ire bitbucket pr diff ID [--repo workspace/repo]
```

Bitbucket repository identity can be provided explicitly via `--repo workspace/repo`, read from config (`bitbucket.workspace` + `bitbucket.repo`), or inferred from local Git remotes when unambiguous. Responses include the resolved workspace/repo in `meta.bitbucket`.

Supported options:

- `ire bitbucket pr get`: `--repo`, `--raw`, `--debug`, Bitbucket config flags.
- `ire bitbucket pr list`: `--repo`, `--limit`, `--cursor`, `--debug`, Bitbucket config flags.
- `ire bitbucket pr comments list`: `--repo`, `--limit`, `--cursor`, `--debug`, Bitbucket config flags.
- `ire bitbucket pr files`: `--repo`, `--limit`, `--cursor`, `--debug`, Bitbucket config flags.
- `ire bitbucket pr diff`: `--repo`, `--debug`, Bitbucket config flags.

### Bitbucket Pipelines

```text
ire bitbucket pipelines list [--repo workspace/repo] [--branch main]
ire bitbucket pipelines latest [--repo workspace/repo] [--branch main]
ire bitbucket pipelines get UUID [--repo workspace/repo]
ire bitbucket pipelines steps list UUID [--repo workspace/repo]
ire bitbucket pipelines log UUID STEP_UUID [--repo workspace/repo]
```

Supported options:

- `ire bitbucket pipelines list`: `--repo`, `--branch`, `--limit`, `--cursor`, `--debug`, Bitbucket config flags.
- `ire bitbucket pipelines latest`: `--repo`, `--branch`, `--debug`, Bitbucket config flags.
- `ire bitbucket pipelines get`: `--repo`, `--debug`, Bitbucket config flags.
- `ire bitbucket pipelines steps list`: `--repo`, `--limit`, `--cursor`, `--debug`, Bitbucket config flags.
- `ire bitbucket pipelines log`: `--repo`, `--debug`, Bitbucket config flags.

Bitbucket config flags are:

```text
--bitbucket-workspace <workspace>
--bitbucket-repo <repo>
--bitbucket-email <email>
--bitbucket-api-token <token>
```

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

## Diagnostics

Check authentication with lightweight provider requests:

```sh
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

## Development

```sh
npm install
npm test
npm run build
```

