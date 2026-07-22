# ADR-0002: Add an opinionated Jira issue export

## Status

Accepted. Partially superseded by ADR-0004, which enriches `jira issue get`.

## Context

ADR-0001 chose thin, composable provider primitives and stable normalized JSON. In practice, reconstructing a complete Jira issue from the normalized issue, raw provider payload, comments endpoint, and related provider calls requires substantial consumer-side parsing. ADF conversion and instance-specific custom-field mapping currently require an LLM or bespoke script.

Changing `jira issue get` would break its established normalized schema. A separate export command can provide a curated aggregate while preserving the existing primitive.

Jira Cloud does not provide a supported public API for reading the pull-request details shown in an issue’s development panel. The private `dev-status` endpoint is unsuitable for a stable CLI contract.

## Decision

Add `ire jira issue export <KEY>` as an explicit, opinionated read aggregate. Keep `ire jira issue get` unchanged.

The export:

- emits the standard envelope with `schemaVersion: "1.0"`;
- renders all ADF rich-text fields as Markdown by default and supports `--adf-format=raw`;
- fetches complete comments and related Jira data needed for the export;
- emits stable semantic custom-field keys configured as ordered Jira field-ID candidates, with no built-in instance-specific IDs;
- emits configured semantic keys as `null` when none of their candidates are populated;
- emits collection fields as empty arrays when empty;
- uses one nullable `parent { key, summary }` field for issue hierarchy;
- normalizes timestamps to UTC;
- includes attachment metadata;
- supports `--download-attachments <dir>`, sanitizes filenames, and overwrites existing files with the same sanitized names.

Pull-request resolution is excluded until Jira offers a supported public API capable of reading development-panel details. The CLI will not depend on Jira’s private `dev-status` endpoint or use branch-name matching as if it were authoritative.

## Consequences

Consumers can save a compact, deterministic Jira issue record without an LLM while existing `jira issue get` consumers remain compatible.

The export is intentionally deeper and more opinionated than the primitives established by ADR-0001. It may perform multiple provider requests and attachment filesystem writes.

Instances must configure their semantic Jira field mappings. Jira development-panel pull requests remain unavailable in the export until the provider exposes a stable read API.
