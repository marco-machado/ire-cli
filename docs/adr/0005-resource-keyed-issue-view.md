# ADR-0005: Resource-keyed command tree, starting with issue view

## Status

Accepted. Partially supersedes ADR-0001.

## Context

ADR-0001 keyed the tree by provider (`ire jira …`, `ire bitbucket …`) and named the one-issue fetch `get`. The destination grammar is `ire <resource> <verb>`, with View replacing Get. Shipping the whole tree at once is a larger contract than this slice.

## Decision

The command tree is keyed by Resource, not by provider. This supersedes ADR-0001’s provider-namespace rule. Binding is unchanged: issue → Jira Cloud; pr, repo, and pipeline → Bitbucket Cloud.

This slice adds one leaf, `ire issue view KEY`, and does not change or remove any existing command. Provider-namespaced leaves remain until a later replacement. `ire jira issue get` stays the ADR-0004 aggregate: a leftover, not a second destination fetch.

`issue view` is a View. Default `data` is the primary issue record: today’s get payload without `comments` and `pullRequests`, with the same omit/null rules. `--comments` and `--pull-requests` request those Expansions. Unrequested Expansion keys are absent. The default fetch is `GET /issue/{key}` only. A requested Expansion is fail-closed and uses the same collection normalizers as get. Success `schemaVersion` is `"1.0"`. There is no `--raw`.

## Considered Options

- Make `view` a rename of get (always comments and pull requests). Rejected: View’s default is the primary record; Expansions are opt-in.
- Hard-remove `ire jira issue get` in this slice. Rejected: this slice is add-only.
- Keep `--raw` on View. Rejected: destination View is normalized Envelope only; leftover get still has `--raw`.

## Consequences

The binary exposes two trees until later replacements land. Consumers that want the destination fetch use `ire issue view`; consumers that want the ADR-0004 aggregate keep `ire jira issue get`. Default View is one provider request. `jira issue comments list` remains a leftover primitive beside `view --comments`.
