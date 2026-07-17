# ADR-0003: Add an opinionated Bitbucket pull request export

## Status

Accepted

## Context

ADR-0001 chose thin, composable provider primitives and stable normalized JSON. Reconstructing a complete pull-request review record from `pr get`, paginated `pr comments list`, `pr files`, `pr diff`, and approval-related activity requires many consumer-side calls and custom parsing.

Code-review analysis needs more than the current list/get summaries: full comments with reply edges (thread depth), file-level anchors, line stats when available, participant approval state, and historical first-approval timing.

Changing the existing normalized `pr get` / `pr comments list` / `pr files` schemas would risk breaking primitive consumers. A separate export command can aggregate multi-request data while leaving those primitives unchanged.

## Decision

Add `ire bitbucket pr export <id>` as an explicit, opinionated read aggregate. Keep existing Bitbucket PR primitives unchanged.

The export:

- emits the standard envelope with `schemaVersion: "1.0"`;
- fetches the pull request body, all comment pages, all diffstat pages, all activity pages, and the unified diff;
- normalizes timestamps to UTC ISO-8601;
- includes participants (role, approved, state, participatedOn) from the PR body;
- includes comments with `parentId` for thread structure, inline path/line anchors, and resolution when the provider sends it;
- includes files with `linesAdded` / `linesRemoved` when present on diffstat entries;
- includes a normalized activity timeline used for first-approval lag and changes-requested counts;
- always includes the full unified diff string (no truncation);
- computes a deterministic `metrics` object for analysis (comment counts, by-author/by-file tallies, max thread depth, density, first approval/comment lag);
- supports optional `--output <path>` to write the same success envelope JSON to disk (create parent directories, overwrite existing file), while still writing the full envelope to stdout and setting `meta.outputPath`.

Bulk or repository-wide export is out of scope. Consumers that need many PRs should paginate `pr list` and call `pr export` per id.

Density and author/file tallies count non-deleted comments only. Thread depth uses the full parent graph, including deleted comments. Line totals and line density are `null` when any file lacks line stats, to avoid under-counting.

Activity event shapes that cannot be classified become `type: "unknown"` rather than failing the export.

## Consequences

Consumers can obtain one deterministic PR review record suitable for offline code-review pattern analysis without orchestrating multiple primitive calls.

The export is intentionally deeper and more expensive than a single primitive: it may perform many sequential Bitbucket requests for a large PR. Diffs can make the JSON multi-megabyte; `--output` is the preferred path for offline corpora, but stdout still receives the full envelope.

Existing `pr get` / list / comments / files / diff consumers remain compatible.
