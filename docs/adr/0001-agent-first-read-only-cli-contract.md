# ADR-0001: Agent-first read-only CLI contract

## Status

Accepted

## Context

`ire-cli` wraps Jira Cloud and Bitbucket Cloud API calls for coding agents such as Claude Code, Codex, Gemini, and opencode.

The primary consumer is an agent process, not a human in an interactive shell. The CLI therefore needs stable command shapes, deterministic output, explicit errors, bounded pagination, and predictable configuration. Human-friendly terminal formatting can be added later as an opt-in layer.

## Decision

### Product shape

v1 will expose thin, composable provider primitives rather than opinionated workflows.

Command namespaces will use provider-native terminology:

```text
ire jira ...
ire bitbucket ...
```

v1 is read-only. Mutating commands are out of scope, but the command tree should not prevent future write namespaces or verbs.

### Providers

v1 targets Jira Cloud and Bitbucket Cloud only. Jira Data Center, Bitbucket Data Center, and Bitbucket Server are out of scope until the v1 contract stabilizes.

### Output

Every command emits a JSON envelope on stdout by default:

```json
{
  "success": true,
  "schemaVersion": "1.0",
  "data": {},
  "meta": {}
}
```

Errors use the same envelope with `success: false` and an `error` object.

`schemaVersion` tracks output compatibility, not package version. v1 starts at `"1.0"`.

Default `data` is normalized into an agent-oriented schema. Provider-native payloads are available through `--raw` on supported commands.

Normalized CLI output is schema-validated before emission. Provider clients should tolerate provider-side extra fields where possible, but malformed normalized output is a bug.

Absent optional fields are omitted. Known-empty provider values are emitted as `null`. `undefined` is never emitted.

Default `meta` is minimal. It includes provider and resolved identity fields where useful. Request/runtime details are included only under redacted `meta.debug` when `--debug` is set.

### Configuration

Configuration precedence is:

```text
CLI flags > process env > project .env > project config > user config > defaults
```

Project config is `.ire/config.json` at the Git root. Outside Git, project config is `.ire/config.json` in the current working directory.

Project `.env` follows the same discovery rule.

User config is `~/.config/ire-cli/config.json`.

Secrets may be read from config if present, but env vars are the documented supported path for secrets.

Supported env vars are:

```text
IRE_JIRA_BASE_URL
IRE_JIRA_EMAIL
IRE_JIRA_API_TOKEN
IRE_BITBUCKET_WORKSPACE
IRE_BITBUCKET_REPO
IRE_BITBUCKET_EMAIL
IRE_BITBUCKET_API_TOKEN
```

Bitbucket Cloud authentication uses Basic HTTP Authentication. `IRE_BITBUCKET_API_TOKEN` is used as the Basic auth password with `IRE_BITBUCKET_EMAIL` as the username.

Profiles are not part of v1. Internals should still pass a resolved config object instead of relying on scattered globals so profile support can be considered later.

### Identity resolution

Jira issue identity is always explicit in v1. The CLI does not infer Jira issue keys from Git branches.

Bitbucket repository identity can be resolved by:

```text
explicit flags > config defaults > Git remote inference > structured ambiguity/missing error
```

Supported explicit repo syntax should include `workspace/repo`. Git remote inference should parse common Bitbucket Cloud SSH and HTTPS remotes when unambiguous.

### Pagination

List/search commands use explicit pagination:

```text
--limit 50
--cursor <cursor>
```

Defaults are:

```text
default limit: 50
maximum limit: 100
```

Responses include a top-level `pagination` object when paginated. v1 does not include `--all`.

### Errors and exit codes

Commands should emit structured JSON failures where possible and use these exit codes:

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

Stdout contains the JSON envelope. Agent-mode stderr should stay quiet unless the process fails before an envelope can be emitted.

### Diagnostics

v1 includes:

```text
ire config inspect
ire auth check
ire auth check jira
ire auth check bitbucket
```

`config inspect` does not call providers and redacts secrets.

`auth check` performs lightweight authenticated requests. Without a provider argument, it checks all configured providers and fails overall if any requested/configured provider fails.

`--debug` adds redacted request metadata under `meta.debug`. Authorization headers and credential values are never emitted.

### v1 command surface

Jira:

```text
ire jira issue get KEY
ire jira issue search --jql "..."
ire jira issue comments list KEY
```

Bitbucket PRs:

```text
ire bitbucket pr get ID
ire bitbucket pr list --repo workspace/repo
ire bitbucket pr comments list ID --repo workspace/repo
ire bitbucket pr diff ID --repo workspace/repo
ire bitbucket pr files ID --repo workspace/repo
```

Bitbucket Pipelines:

```text
ire bitbucket pipelines list --repo workspace/repo --branch main
ire bitbucket pipelines latest --repo workspace/repo --branch current
ire bitbucket pipelines get UUID --repo workspace/repo
ire bitbucket pipelines steps list UUID --repo workspace/repo
ire bitbucket pipelines log UUID STEP_UUID --repo workspace/repo
```

Pipeline artifacts, reruns, and stops are out of scope for v1.

### Implementation baseline

The npm package is `ire-cli`; the executable is `ire`.

v1 targets:

```text
Node.js >=22
ESM
TypeScript
Commander
built-in fetch/Undici
Zod
```

## Consequences

Agents get a predictable, machine-readable interface that is easy to compose and test.

The project deliberately delays human-first conveniences such as prompts, spinners, tables, OAuth login, credential storage, and high-level workflows.

The read-only v1 scope limits risk while still supporting the primary agent loop: inspect Jira context, inspect Bitbucket PRs, and diagnose Bitbucket Pipelines failures.
