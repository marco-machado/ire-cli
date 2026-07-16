<div align="center">

# ire-cli

**The Immutable Read Engine for Jira Cloud and Bitbucket Cloud**

[![npm version](https://img.shields.io/npm/v/%40marco.machado%2Fire-cli)](https://www.npmjs.com/package/@marco.machado/ire-cli)
[![CI](https://github.com/marco-machado/ire-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/marco-machado/ire-cli/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

Give coding agents deterministic, structured access to issue, pull request, and pipeline context—without giving them write access.

</div>

`ire-cli` exposes thin, composable Jira Cloud and Bitbucket Cloud API primitives for coding agents such as Claude Code, Codex, Gemini, and opencode. Every command produces a stable JSON envelope that is straightforward to parse, validate, and compose.

> [!IMPORTANT]
> `ire-cli` is permanently read-only. It does not create, update, approve, merge, rerun, or delete provider resources.

The npm package is `@marco.machado/ire-cli`; the executable is `ire`.

## Features

- Stable JSON success and error envelopes with documented exit codes.
- Normalized, agent-oriented schemas with raw provider payloads where supported.
- Jira issue retrieval, search, comments, and complete issue exports.
- Bitbucket pull request details, lists, comments, changed files, and diffs.
- Bitbucket Pipelines runs, steps, and logs.
- Layered configuration with secret redaction and lightweight auth checks.
- Explicit pagination and optional redacted request diagnostics.
- No prompts, spinners, fuzzy selection, or human-only terminal formatting.

## Getting started

### Prerequisites

- Node.js 22 or later
- A Jira Cloud API token, a Bitbucket Cloud API token, or both

### Install

Run without installing globally:

```sh
npx @marco.machado/ire-cli --help
```

Install globally:

```sh
npm install -g @marco.machado/ire-cli
ire --help
```

### Configure

Set credentials through environment variables, then verify the resolved configuration and authentication:

```sh
export IRE_JIRA_BASE_URL="https://example.atlassian.net"
export IRE_JIRA_EMAIL="agent@example.com"
export IRE_JIRA_API_TOKEN="..."

ire config inspect
ire auth check jira
```

For Bitbucket, use `IRE_BITBUCKET_WORKSPACE`, `IRE_BITBUCKET_REPO`, `IRE_BITBUCKET_EMAIL`, and `IRE_BITBUCKET_API_TOKEN`.

> [!NOTE]
> Prefer environment variables for credentials. `ire config inspect` redacts secrets in its output.

### Run

```sh
ire jira issue export ABC-123
ire bitbucket pr get 42 --repo workspace/repository
ire bitbucket pipelines latest --repo workspace/repository --branch main
```

## Agent skill

Install the `use-ire-cli` skill for agents that support [Vercel Skills](https://github.com/vercel-labs/skills):

```sh
npx skills add https://github.com/marco-machado/ire-cli --skill use-ire-cli
```

Or install directly from the skill path:

```sh
npx skills add https://github.com/marco-machado/ire-cli/tree/main/skills/use-ire-cli
```

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
    "code": "JIRA_ISSUE_NOT_FOUND",
    "message": "Jira issue ABC-123 was not found",
    "details": {
      "key": "ABC-123",
      "status": 404
    }
  },
  "meta": {}
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
    "apiToken": "use-env-for-secrets-when-possible",
    "issueExport": {
      "fieldMappings": {
        "sprints": ["customfield_10020"],
        "storyPoints": ["customfield_10016"],
        "acceptanceCriteria": ["customfield_11745", "customfield_11735"],
        "testPlan": ["customfield_11747"]
      }
    }
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
ire jira issue export KEY
ire jira issue search --jql "project = ABC ORDER BY updated DESC"
ire jira issue comments list KEY
```

Jira issue keys are always explicit. The CLI does not infer Jira issue identity from branch names.

Supported options:

- `ire jira issue get`: `--raw`, `--debug`, Jira config flags.
- `ire jira issue export`: `--adf-format markdown|raw`, `--download-attachments <dir>`, `--debug`, Jira config flags.
- `ire jira issue search`: `--jql`, `--limit`, `--cursor`, `--debug`, Jira config flags.
- `ire jira issue comments list`: `--limit`, `--cursor`, `--raw`, `--debug`, Jira config flags.

Jira config flags are:

```text
--jira-base-url <url>
--jira-email <email>
--jira-api-token <token>
```

#### Complete Jira issue export

`ire jira issue export KEY` emits one curated issue record containing normalized header fields, sprint/story-point data, a nullable parent, configured semantic fields, all comments, attachment metadata, subtasks, and issue links. It keeps `jira issue get` backward-compatible.

The standard success envelope has `schemaVersion: "1.0"`; its `data` contract is:

| Field | Type |
| --- | --- |
| `key`, `summary`, `status`, `issueType`, `created`, `updated` | `string` (`created`/`updated` are UTC ISO-8601) |
| `description` | Markdown `string`, raw ADF object, or `null` |
| `priority` | `string \| null` |
| `project` | `{ key: string, name: string }` |
| `assignee`, `reporter` | `{ accountId: string, displayName: string } \| null` |
| `labels` | `string[]` |
| `sprints` | `{ name: string, state: string }[]` |
| `storyPoints` | `number \| null` |
| `parent` | `{ key: string, summary: string } \| null` |
| `customFields` | configured semantic keys with JSON values or `null` |
| `comments` | `{ author, created, body }[]`, with UTC timestamps and Markdown/raw ADF bodies |
| `attachments` | `{ filename, mimeType, size, contentUrl }[]` |
| `subtasks` | `{ key, summary, status }[]` |
| `issueLinks` | `{ relationship, key, summary, type, status }[]` |

ADF descriptions, comments, and configured rich-text fields are rendered as Markdown by default. Use `--adf-format raw` to retain ADF objects consistently across every rich-text field.

Configure instance-specific Jira fields under `jira.issueExport.fieldMappings`. Each semantic key maps to an ordered list of provider field IDs; the first populated candidate wins. `sprints` and `storyPoints` are reserved output keys. Other configured keys are emitted under `customFields`. Configured-but-empty keys are `null`, unconfigured keys are omitted, and no instance-specific IDs are built in.

`--download-attachments <dir>` downloads attachment bytes with Jira authentication after validating the export. Provider filenames are reduced to safe basenames, and existing same-name files are overwritten. The JSON export still goes to stdout.

Development-panel pull requests are not included because Jira Cloud has no supported public API for reading them. The export does not use private `dev-status` endpoints or heuristic branch matching.

### Bitbucket pull requests

```text
ire bitbucket pr get ID [--repo workspace/repo]
ire bitbucket pr list [--repo workspace/repo] [--state OPEN,MERGED] [--include-drafts]
ire bitbucket pr comments list ID [--repo workspace/repo]
ire bitbucket pr files ID [--repo workspace/repo]
ire bitbucket pr diff ID [--repo workspace/repo]
```

Bitbucket repository identity can be provided explicitly via `--repo workspace/repo`, read from config (`bitbucket.workspace` + `bitbucket.repo`), or inferred from local Git remotes when unambiguous. Responses include the resolved workspace/repo in `meta.bitbucket`.

Supported options:

- `ire bitbucket pr get`: `--repo`, `--raw`, `--debug`, Bitbucket config flags.
- `ire bitbucket pr list`: `--repo`, `--limit`, `--cursor`, `--state`, `--include-drafts`, `--debug`, Bitbucket config flags. `--state` takes a comma-separated subset of `OPEN`, `MERGED`, `DECLINED`, `SUPERSEDED`; `--include-drafts` opts draft PRs (hidden by default) into the results. Each PR summary includes a `draft` boolean.
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

Responses include pagination metadata inside `data`. For example, Jira search returns:

```json
{
  "success": true,
  "schemaVersion": "1.0",
  "data": {
    "issues": [],
    "pagination": {
      "limit": 50,
      "nextCursor": null,
      "hasNextPage": false
    }
  },
  "meta": {}
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
npm ci
npm test
npm run build
```

