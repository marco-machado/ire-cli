# ADR-0005: Make `jira issue export` a complete ticket record

## Status

Accepted.

## Context

ADR-0002 added `jira issue export` as a curated read aggregate while keeping `jira issue get` unchanged, and explicitly excluded development-panel pull requests and built-in instance-specific field ids. ADR-0004 later enriched `get` with QA fields, hierarchy, comments, and pull requests.

The two commands still do not form a union that covers `jira issue get --raw`. `get` omits attachments, sprints/story points, and most QA fields; `export` omits pull requests and, with empty `fieldMappings`, every QA field and sprint/story-point value. A fetch-to-disk pipeline that must render header fields, QA fields, markdown (including images), attachments, comments, and PRs still has to parse the provider-native payload. The failure is a confident incomplete record, not an error.

Jira Cloud still has no supported public API for the development panel. ADR-0002 rejected the private `dev-status` endpoint; ADR-0004 already adopted it for `get`, filtered to Bitbucket. Reusing it in `export` trades an undocumented endpoint for a complete record on both commands.

## Decision

Make `jira issue export` the complete ticket record, keeping `jira issue get`'s `1.1` plain-text contract unchanged:

- add `pullRequests` with the shape `get` already normalizes (`title`, `url`, `status`, `branch`, `repository`, `author`, `updated`), fetched from the private `dev-status` endpoint and strict on failure;
- emit first-class, always-present-nullable QA keys (`acceptanceCriteria`, `designs`, `testPlan`, `regressionTestingGuidance`, `architecturalNotes`, `regression`, `changeImpact`, `deploymentStatus`, `releasePlan`) instead of hiding them in `customFields`;
- resolve QA ids from `jira.issueExport.fieldMappings` when set, falling back to the built-in ids `get` already uses for `testPlan`, `regressionTestingGuidance`, and `regression`; unset keys with no built-in id remain present and `null`;
- render every rich-text field (description, comments, QA fields) as Markdown by default, and emit a `media` node without an inline URL as `![alt](contentUrl)` by matching its `alt` to an attachment filename, so image-only fields are non-empty and images survive a single export;
- keep `--download-attachments <dir>` and keep `--adf-format markdown|raw`;
- bump `export`'s `schemaVersion` to `1.1` for the new keys.

`get` keeps its plain-text `1.1` contract. Its secondary defects are fixed in place: image-only QA fields now render their media labels instead of a false `null`, and pull-request URLs built from Bitbucket workspace/repository UUIDs are rewritten to the human `workspace/repo` slug when that slug is present.

## Consequences

A ticket-fetch skill needs only `ire jira issue export KEY --download-attachments ./tickets/KEY/assets` and no `--raw`. Consumers must accept the new `1.1` export schema and the first-class QA keys.

`export` now depends on the undocumented `dev-status` endpoint, matching `get`; its strict failure mode keeps provider changes loud. Consumers relying on `customFields` must move the QA keys to the new top-level fields; other configured keys remain under `customFields`.
