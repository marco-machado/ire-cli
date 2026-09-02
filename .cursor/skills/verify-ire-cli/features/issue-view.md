# Issue view

`ire issue view KEY` fetches one Jira issue as the destination primary record: header fields, QA fields, parent, subtasks, and issue links. `--comments` and `--pull-requests` request those Expansions; unrequested keys are absent. Leftover `ire jira issue get|export|search|comments list` remain on the tree for the always-full aggregate, curated export, JQL search, and paginated comments.

## Sub-features

- `view-primary` — `issue view KEY` with no Expansion flags
- `view-comments` — `--comments` adds every comment page
- `view-pull-requests` — `--pull-requests` adds Bitbucket PRs from the Jira development panel
- `view-missing-key` — omitted KEY → `MISSING_ARGUMENT`, exit 2
- `leftover-get` — `jira issue get KEY` always includes comments + pull requests; success `schemaVersion` is `"1.1"`; supports `--raw`
- `leftover-export` — `jira issue export KEY`; `--adf-format markdown|raw`; `--download-attachments <dir>` writes files then still prints JSON
- `leftover-search` — `jira issue search --jql "..."` required; `--limit` 1–100; `--cursor`
- `leftover-comments-list` — `jira issue comments list KEY` paginated; supports `--raw`

## How to get to it (user POV)

```text
ire issue view ABC-123
ire issue view ABC-123 --comments --pull-requests
ire jira issue get ABC-123
ire jira issue export ABC-123
ire jira issue export ABC-123 --download-attachments ./attachments
ire jira issue search --jql "project = ABC ORDER BY updated DESC"
ire jira issue comments list ABC-123
```

Issue identity is always an explicit key. The CLI does not infer keys from the current branch.

## Driving it with run-ire.sh

Preconditions: Launch + Doctor have succeeded. Live Jira needs `IRE_JIRA_BASE_URL`, `IRE_JIRA_EMAIL`, `IRE_JIRA_API_TOKEN` via `--env` (or flags). Without credentials, drive `view-missing-key` and the incomplete-auth path; skip live fetches.

- **Missing key**: user runs view with no key.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step view-missing-key -- issue view`
  Observe: exit 2; `success: false`; `error.code` is `"MISSING_ARGUMENT"`; `error.message` is `Jira issue key is required`; `error.details.argument` is `"KEY"`.

- **Incomplete auth**: user passes a key but Jira is unconfigured.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step view-incomplete-auth -- issue view ABC-123`
  Observe: exit 2; `error.code` is `"AUTH_CONFIG_INCOMPLETE"`; `error.details.provider` is `"jira"`; `missing` lists `baseUrl`, `email`, `apiToken`.

- **Primary view (live)**: user views one issue.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step view-primary --env IRE_JIRA_BASE_URL=… --env IRE_JIRA_EMAIL=… --env IRE_JIRA_API_TOKEN=… -- issue view ABC-123`
  Observe: exit 0; `success: true`; `schemaVersion: "1.0"`; `data.key` is `ABC-123`; `data` has `summary`, `status`, `issueType`, `created`, `updated`, `project`, `labels`, `subtasks`, `issueLinks`; `comments` and `pullRequests` keys are **absent**; stdout has no API token.

- **Comments expansion (live)**: same plus `--comments`.
  Command: `… -- issue view ABC-123 --comments`
  Observe: exit 0; `data.comments` is an array of `{ id, author, body, created, updated }`.

- **Pull-request expansion (live)**: same plus `--pull-requests`.
  Command: `… -- issue view ABC-123 --pull-requests`
  Observe: exit 0; `data.pullRequests` is an array of `{ title, url, status, branch, repository, author, updated }` (Bitbucket-only from the development panel).

- **Leftover search missing JQL**: user omits `--jql`.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step search-missing-jql -- jira issue search`
  Observe: exit 2; `error.code` is `"MISSING_OPTION"`; `error.details.option` is `"--jql"`.

- **Export attachments (live)**: user exports and downloads.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step export-attachments --cwd <scratch> --env IRE_JIRA_*=… -- jira issue export ABC-123 --download-attachments ./attachments`
  Observe: exit 0; envelope `data.attachments` lists `{ filename, mimeType, size, contentUrl }`; bytes exist as safe basenames under `<scratch>/attachments`. JSON remains on stdout.

## Gotchas

- `issue view` has **no** `--raw`. Leftover `jira issue get --raw` returns `{ issue, comments, pullRequests }`.
- A requested Expansion is fail-closed: a failed comments or pull-request fetch fails the whole command.
- QA fields `testPlan`, `regressionTestingGuidance`, `regression` resolve from built-in field ids (`customfield_11747`, `customfield_12213`, `customfield_11734`); unset is `null` on any instance.
- Export field mappings live under `jira.issueExport.fieldMappings` in config. `sprints` and `storyPoints` are reserved top-level keys; other mapped keys land in `customFields`. `--adf-format` must be `markdown` or `raw` (`INVALID_OPTION` otherwise).
- Search/comments `--limit` default 50, max 100 (`INVALID_LIMIT`). Search cursor is an opaque Jira token; do not increment it.
- `--download-attachments` overwrites same-name files. Capture those files under scratch; they are side effects, not evidence-root artifacts unless copied there on purpose.
