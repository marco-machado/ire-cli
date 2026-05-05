# ire-cli Context

This document defines the domain language for `ire-cli`.

## Glossary

### Agent-first CLI

A command-line interface optimized for coding agents rather than interactive human use. Agent-first commands are deterministic, non-interactive by default, and emit structured machine-readable output.

### Provider

An external service wrapped by `ire-cli`. v1 providers are Jira Cloud and Bitbucket Cloud.

### Provider-native payload

The unnormalized JSON shape returned by a provider API. Provider-native payloads are available through `--raw` on supported commands.

### Normalized schema

The stable `ire-cli` output shape produced from provider-native payloads. Normalized schemas are designed for agent consumption and are validated before emission.

### Envelope

The top-level JSON object emitted by every command. It includes `success`, `schemaVersion`, `data` or `error`, and `meta`.

### Schema version

The output contract version in each envelope. v1 starts with `schemaVersion: "1.0"`. This version tracks response compatibility, not the npm package version.

### Project config

Repository-local configuration stored at `.ire/config.json` at the Git root. Outside a Git repository, project config is read from `.ire/config.json` in the current working directory.

### User config

Per-user configuration stored at `~/.config/ire-cli/config.json`.

### Project `.env`

Environment file discovered at the Git root, or at the current working directory outside a Git repository. It may provide credentials and local defaults.

### Configuration precedence

The order used to resolve settings:

```text
CLI flags > process env > project .env > project config > user config > defaults
```

### Explicit issue key

A Jira issue key passed directly by the caller. v1 requires explicit Jira issue keys and does not infer them from Git branches.

### Repository inference

Bitbucket workspace/repo resolution from the local Git remote when no explicit repo or config default is available and the result is unambiguous.

### Read-only v1

The first version of `ire-cli` only performs read operations. Mutating commands are intentionally excluded, while the command namespace leaves room for future write commands.

### Debug metadata

Optional redacted request information included under `meta.debug` when `--debug` is passed. Debug metadata never includes authorization headers or credential values.
