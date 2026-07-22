# ADR-0004: Enrich jira issue get into a strict read aggregate

## Status

Accepted. Partially supersedes ADR-0002.

## Context

ADR-0002 kept `jira issue get` unchanged, excluded the private `dev-status` endpoint, and required configured custom-field mappings with no built-in instance-specific ids. In practice, QA and review work needs one command that returns everything required to understand an issue: the QA custom fields, its place in the hierarchy, linked work items, the complete comment list, and development-panel pull requests. `jira issue export` stays a curated offline document and does not fill that role.

## Decision

`ire jira issue get <KEY>` returns one work item in full normalized detail and stays strict about failures.

The get:

- adds `testPlan`, `regressionTestingGuidance`, and `regression`, resolved from hardcoded instance-specific field ids (`customfield_11747`, `customfield_12213`, `customfield_11734`), always present and `null` when unset;
- adds a nullable `parent` and a `subtasks` array as `{ key, summary, type, status }`;
- adds linked work items as `issueLinks` entries of `{ relationship, key, summary, type, status }`;
- fetches the complete comment list across all pages;
- reads development-panel pull requests from the private `dev-status` endpoint with `applicationType=bitbucket`;
- fails the whole command when any underlying request fails;
- returns every fetched provider payload under `--raw` as `{ issue, comments, pullRequests }`;
- emits the success envelope with `schemaVersion: "1.1"`.

This supersedes three ADR-0002 statements as they apply to `jira issue get`: the command does not stay unchanged, the CLI now depends on the private `dev-status` endpoint for this command, and the three QA fields use built-in instance-specific ids. The export contract in ADR-0002 is unchanged, and export still excludes pull requests.

## Consequences

Consumers read one command to understand an issue without falling back to the Jira UI or raw payloads. Scripts detect the contract change through the schema version.

The `dev-status` endpoint is internal and undocumented; Atlassian may change it without notice, and the `applicationType=bitbucket` filter hides pull requests linked through other tools. Strict failure makes an endpoint change loud rather than silent. The hardcoded field ids belong to the target Jira instance; other instances see `null` values.
