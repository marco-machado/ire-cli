The command trees do not line up 1:1. ire is 18 leaf commands, all reads. Destination leaves are `ire <resource> <verb>`; leftover leaves stay `ire <provider> <resource> <verb>`. gh is a full GitHub product CLI: the overlapping slice is already larger than ire’s entire tree, and most of gh has no analog at all.

The two trees

ire (complete):

ire
├── config inspect
├── auth check [jira|bitbucket]
├── issue view KEY
├── jira issue
│   ├── get KEY
│   ├── export KEY
│   ├── search --jql
│   └── comments list KEY
└── bitbucket
    ├── pr
    │   ├── get ID
    │   ├── list
    │   ├── export ID
    │   ├── comments list ID
    │   ├── files ID
    │   └── diff ID
    └── pipelines
        ├── list
        ├── latest
        ├── get UUID
        ├── steps list UUID
        └── log UUID STEP_UUID

gh (top-level groups):

gh
├── Core:        auth, browse, codespace, discussion, gist,
│                issue, org, pr, project, release, repo, skill
├── Actions:     cache, run, workflow
└── Additional:  agent-task, alias, api, attestation, completion,
                 config, copilot, extension, gpg-key, label,
                 licenses, preview, ruleset, search, secret,
                 ssh-key, status, variable

issue + pr + run + workflow + auth + config is already ~50 leaf commands. The rest of gh (repos, gists, codespaces, projects, secrets, extensions, gh api, …) has no ire counterpart.

Grammar

┌──────────────────┬───────────────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────────────────────────────────┐
│                  │ ire                                                   │ gh                                                                                            │
├──────────────────┼───────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
│ Shape            │ Destination: ire <resource> <verb>. Leftover: ire     │ gh <resource> <verb>                                                                          │
│                  │ <provider> <resource> <verb>                          │                                                                                                │
├──────────────────┼───────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
│ Identity         │ Required. Jira key or Bitbucket PR id / pipeline UUID │ Often optional. PR/run inferred from current branch; interactive picker if omitted            │
├──────────────────┼───────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
│ Default output   │ JSON envelope always                                  │ Human table / pretty text; JSON is --json <fields>                                            │
├──────────────────┼───────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
│ Raw provider     │ --raw on some commands                                │ --json field pick, or gh api                                                                  │
│ JSON             │                                                       │                                                                                               │
├──────────────────┼───────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
│ Pagination       │ --limit (default 50, max 100) + --cursor. No --all    │ --limit (issue/PR default 30, runs 20). Fetches N items; no cursor. gh api --paginate for     │
│                  │                                                       │ full dump                                                                                     │
├──────────────────┼───────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
│ Repo targeting   │ --repo workspace/repo (Bitbucket only). Jira has no   │ -R [HOST/]OWNER/REPO on almost everything                                                     │
│                  │ repo                                                  │                                                                                               │
├──────────────────┼───────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
│ Web              │ none                                                  │ -w / --web on most view/list commands                                                         │
├──────────────────┼───────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
│ Writes           │ none                                                  │ create, edit, close, comment, merge, rerun, delete, …                                         │
└──────────────────┴───────────────────────────────────────────────────────┴───────────────────────────────────────────────────────────────────────────────────────────────┘

Destination issue fetch is `ire issue view` (primary record; Expansions opt-in). Leftover `ire jira issue get` is the always-full aggregate. gh `view` is a display command, optionally in a browser.

A naming trap: gh issue comment / gh pr comment write. ire … comments list reads.

───

Issues: ire issue view vs gh issue; leftover `ire jira issue get`

ire issue view KEY
ire jira issue get KEY
ire jira issue export KEY
ire jira issue search --jql "..."
ire jira issue comments list KEY

gh issue list | create | status
gh issue view | close | comment | delete | develop | edit
gh issue lock | unlock | pin | unpin | reopen | transfer
gh search issues

View one issue

┌─────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────┐
│             │ ire issue view KEY                                                                                      │ gh issue view {number|url}                       │
├─────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────┤
│ Identity    │ Key required (ABC-123). Never inferred from the branch                                                  │ Number or URL required. No branch inference (    │
│             │                                                                                                         │ unlike PRs)                                      │
├─────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────┤
│ What you    │ Primary record: header, QA fields, parent, subtasks, issue links. `--comments` and `--pull-requests`    │ Title/body/metadata. Comments only with -c / --  │
│ get         │ request those Expansions                                                                                │ comments                                         │
├─────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────┤
│ Failure     │ Fails the whole command if the issue fetch or a requested Expansion fails                               │ Single GitHub resource fetch                     │
├─────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────┤
│ JSON        │ Always. schemaVersion: "1.0"                                                                            │ Only with --json fields                          │
├─────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────┤
│ Extra       │ No `--raw`. Leftover `ire jira issue get` is the always-full aggregate, including `--raw`               │ --web opens the browser                          │
└─────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────┘

`ire jira issue get KEY` remains as a leftover: one fail-closed aggregate (comments + development-panel PRs always on), `schemaVersion: "1.1"`.

Export (ire only)

ire jira issue export KEY has no gh equivalent. It is a curated offline document: Markdown (or raw ADF), sprints/story points, configured custom fields, all comments, attachment metadata, optional --download-attachments <dir>.

gh has no “issue export” and no attachment download command. Closest is gh issue view --json … plus gh api.

List / search

┌──────────────┬────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────┬────────────────────────────────────┐
│              │ ire jira issue search --jql                    │ gh issue list                                                       │ gh search issues                   │
├──────────────┼────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
│ Query        │ Provider JQL, required                         │ Flag filters (--label, --assignee, --state, --milestone, --type)    │ GitHub search syntax + many        │
│ language     │                                                │ plus optional --search                                              │ qualifier flags                    │
├──────────────┼────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
│ Default      │ You must pass --jql                            │ Open issues in the current repo, limit 30                           │ Cross-repo search                  │
├──────────────┼────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
│ Pagination   │ --limit + --cursor (Jira continuation token,   │ --limit only                                                        │ --limit only                       │
│              │ 7-day expiry)                                  │                                                                     │                                    │
├──────────────┼────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
│ Scope        │ The configured Jira site                       │ Current repo (-R to change)                                         │ GitHub-wide (--owner, --repo, --   │
│              │                                                │                                                                     │ archived, …)                       │
├──────────────┼────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┼────────────────────────────────────┤
│ Web          │ no                                             │ --web                                                               │ --web                              │
└──────────────┴────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────┴────────────────────────────────────┘

ire has no issue list. Every listing is an explicit JQL search. gh splits “list this repo” from “search GitHub.”

gh issue list flag surface that ire does not have: --assignee, --author, --label, --mention, --milestone, --state, --type, --app, --search, --web. ire pushes all of that into JQL (assignee = …, labels = …, status = …).

Comments

┌────────────┬──────────────────────────────────┬──────────────────────────────┬──────────────────────────┐
│            │ ire jira issue comments list KEY │ gh issue comment             │ gh issue view --comments │
├────────────┼──────────────────────────────────┼──────────────────────────────┼──────────────────────────┤
│ Verb       │ Read, paginated                  │ Write (add/edit/delete last) │ Read, bundled into view  │
├────────────┼──────────────────────────────────┼──────────────────────────────┼──────────────────────────┤
│ Pagination │ --limit / --cursor               │ n/a                          │ not a list command       │
├────────────┼──────────────────────────────────┼──────────────────────────────┼──────────────────────────┤
│ Raw        │ --raw                            │ n/a                          │ --json comments          │
└────────────┴──────────────────────────────────┴──────────────────────────────┴──────────────────────────┘

gh cannot list comments as a first-class paginated primitive. ire cannot create, edit, or delete comments.

Issue verbs that exist only on gh

create, close, delete, edit, reopen, lock, unlock, pin, unpin, transfer, develop, status. All writes or human-status UX. Permanently out of ire.

───

Pull requests: ire bitbucket pr vs gh pr

ire bitbucket pr get ID
ire bitbucket pr list
ire bitbucket pr export ID
ire bitbucket pr comments list ID
ire bitbucket pr files ID
ire bitbucket pr diff ID

gh pr list | create | status
gh pr view | checkout | checks | close | comment | diff | edit
gh pr lock | unlock | merge | ready | reopen | revert | review
gh pr update-branch
gh search prs

Get / view one PR

┌──────────────────┬────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────┐
│                  │ ire bitbucket pr get ID                    │ gh pr view [<number>|<url>|<branch>]                             │
├──────────────────┼────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ Identity         │ Positive integer, required                 │ Number, URL, or branch. Omitted = PR for current branch          │
├──────────────────┼────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ Output           │ Normalized JSON (or --raw)                 │ Pretty text; --json fields; --web                                │
├──────────────────┼────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ Comments         │ Not included (use comments list or export) │ -c / --comments                                                  │
├──────────────────┼────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ Files            │ Not included (use files or export)         │ --json files                                                     │
├──────────────────┼────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ Reviews / checks │ Not on get                                 │ --json reviews,latestReviews,statusCheckRollup plus gh pr checks │
└──────────────────┴────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────┘

ire bitbucket pr get is a thin primitive. gh pr view --json can pull a large GraphQL field set in one shot. The aggregate in ire is pr export, not pr get.

List

┌────────────┬───────────────────────────────────────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────┐
│            │ ire bitbucket pr list                                                                 │ gh pr list                                                          │
├────────────┼───────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
│ Default    │ Open PRs; drafts hidden                                                               │ Open PRs (including drafts); limit 30                               │
├────────────┼───────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
│ State      │ --state OPEN,MERGED,DECLINED,SUPERSEDED (Bitbucket names; comma-separated, multi-     │ --state open|closed|merged|all                                      │
│            │ state)                                                                                │                                                                     │
├────────────┼───────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
│ Drafts     │ --include-drafts opt-in                                                               │ --draft filters to drafts                                           │
├────────────┼───────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
│ Filters    │ repo, state, drafts, limit, cursor                                                    │ --author, --assignee, --label, --base, --head, --search, --app, --  │
│            │                                                                                       │ web                                                                 │
├────────────┼───────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
│ Search     │ none                                                                                  │ --search uses GitHub issue/PR search                                │
├────────────┼───────────────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
│ Pagination │ --limit 1–100 + --cursor                                                              │ --limit only                                                        │
└────────────┴───────────────────────────────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────┘

No ire equivalent of gh pr list --author @me --label bug --search "review:required".

Diff and files

┌───────────────────┬────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────┐
│ Job               │ ire                                                            │ gh                                                           │
├───────────────────┼────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ Unified diff      │ ire bitbucket pr diff ID → JSON envelope wrapping the diff     │ gh pr diff [id] → raw diff on stdout (color, --patch, --web) │
├───────────────────┼────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ Changed-file list │ ire bitbucket pr files ID (paginated, line stats when present) │ gh pr diff --name-only, or gh pr view --json files           │
├───────────────────┼────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ Exclude paths     │ no                                                             │ gh pr diff --exclude '*.yml'                                 │
└───────────────────┴────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────┘

ire never prints a raw patch as the process output; the diff is a field inside the envelope. gh pr diff is a human/pager command that can also emit a patch.

Comments

Same split as issues: ire bitbucket pr comments list ID is a paginated read (includes thread parentId on export, not necessarily on the list primitive). gh pr comment writes. Reading GitHub review comments is gh pr view --comments / --json comments,reviews.

Export (ire only)

ire bitbucket pr export ID has no gh equivalent. It fans out to body + all comment pages + diffstat + activity + unified diff, then emits participants, threaded comments, files with line stats, activity timeline, full diff, and derived metrics (comment density, first-approval lag, max thread depth). --output <path> also writes the envelope to disk.

Closest gh reconstruction: several gh pr view --json …, gh pr diff, and gh api calls, assembled by the caller.

PR verbs that exist only on gh

┌─────────────────────────┬───────────────────────────────────────────────────────────────┐
│ Command                 │ Role                                                          │
├─────────────────────────┼───────────────────────────────────────────────────────────────┤
│ create                  │ Open a PR                                                     │
├─────────────────────────┼───────────────────────────────────────────────────────────────┤
│ checkout                │ Fetch and switch to the PR branch                             │
├─────────────────────────┼───────────────────────────────────────────────────────────────┤
│ checks                  │ CI status for that PR (--watch, extra exit code 8 if pending) │
├─────────────────────────┼───────────────────────────────────────────────────────────────┤
│ close / reopen / ready  │ State changes                                                 │
├─────────────────────────┼───────────────────────────────────────────────────────────────┤
│ edit                    │ Title/body/base/reviewers                                     │
├─────────────────────────┼───────────────────────────────────────────────────────────────┤
│ merge / rebase / squash │ Merge                                                         │
├─────────────────────────┼───────────────────────────────────────────────────────────────┤
│ review                  │ Approve / request changes / comment                           │
├─────────────────────────┼───────────────────────────────────────────────────────────────┤
│ revert / update-branch  │ GitHub-specific workflows                                     │
├─────────────────────────┼───────────────────────────────────────────────────────────────┤
│ lock / unlock           │ Conversation lock                                             │
├─────────────────────────┼───────────────────────────────────────────────────────────────┤
│ status                  │ Human dashboard of PRs involving you                          │
├─────────────────────────┼───────────────────────────────────────────────────────────────┤
│ search prs              │ Cross-repo search                                             │
└─────────────────────────┴───────────────────────────────────────────────────────────────┘

ire has no checkout, no merge, no review, no “checks on this PR” command. Pipeline diagnosis is a separate namespace (bitbucket pipelines), not attached to the PR.

───

CI: ire bitbucket pipelines vs gh run / gh workflow

ire bitbucket pipelines list
ire bitbucket pipelines latest
ire bitbucket pipelines get UUID
ire bitbucket pipelines steps list UUID
ire bitbucket pipelines log UUID STEP_UUID

gh run list | view | watch | cancel | delete | download | rerun
gh workflow list | view | run | enable | disable
gh pr checks
gh cache …

┌──────────────┬──────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────┐
│ Job          │ ire                                              │ gh                                                                                     │
├──────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
│ List runs    │ pipelines list --branch (cursor, limit ≤100)     │ run list (--branch, --commit, --event, --status, --workflow, --user, --created, --all) │
├──────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
│ Latest run   │ pipelines latest (explicit)                      │ run list --limit 1 (convention, not a command)                                         │
├──────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
│ Get one run  │ pipelines get UUID (UUID required)               │ run view [id] (optional id → interactive picker)                                       │
├──────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
│ Steps / jobs │ pipelines steps list UUID                        │ run view -v / --json jobs                                                              │
├──────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
│ Logs         │ pipelines log UUID STEP_UUID (both ids required) │ run view --log / --log-failed / --job <id>                                             │
├──────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
│ Watch        │ no                                               │ run watch, pr checks --watch                                                           │
├──────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
│ Artifacts    │ out of scope (ADR-0001)                          │ run download                                                                           │
├──────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
│ Mutate       │ no                                               │ rerun, cancel, delete, workflow run/enable/disable                                     │
└──────────────┴──────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────┘

ire models CI as five explicit reads with required identifiers. gh models it as a human workflow: pick a run, follow it, rerun it, download artifacts, jump to the browser.

gh pr checks has no ire twin. Bitbucket PR build status is not a command; you go to pipelines with a branch.

───

Auth and config

┌─────────────┬────────────────────────────────────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────────────────┐
│             │ ire                                                                        │ gh                                                                            │
├─────────────┼────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Auth        │ auth check [jira|bitbucket] only. Lightweight probe. No login, no token    │ login, logout, refresh, setup-git, status, switch, token                      │
│             │ storage, no account switch                                                 │                                                                               │
├─────────────┼────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Config      │ config inspect only. Emits the resolved Jira/Bitbucket config (secrets     │ config get|set|list|clear-cache of client settings: editor, pager, git_       │
│             │ redacted). Does not call providers                                         │ protocol, prompt, browser, spinner, …                                         │
├─────────────┼────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Credentials │ Env vars / files; documented path is env                                   │ OAuth device flow, PAT, keychain, multi-host, --show-token                    │
└─────────────┴────────────────────────────────────────────────────────────────────────────┴───────────────────────────────────────────────────────────────────────────────┘

ire auth check is closer to gh auth status than to gh auth login. ire config inspect is closer to “print the resolved connection object” than to gh config, which does not inspect GitHub resources at all.

───

The unbounded escape hatch

gh api <endpoint> is a first-class command: REST or GraphQL, -X POST, --paginate, --jq. It makes the rest of GitHub’s API part of the CLI surface.

ire has no ire api. If a Jira or Bitbucket endpoint is not in the tree, it is not reachable. --raw only unwraps payloads for commands that already exist.

That is the largest surface difference: gh is a closed set of verbs plus an open API client. ire is a closed set of verbs.

───

What each side has that the other does not

Only on ire (as first-class commands):

• issue view as a fail-closed primary-record fetch with `--comments` / `--pull-requests` Expansions
• leftover jira issue get as a fail-closed multi-request aggregate (comments + links + hierarchy + dev-panel PRs always on)
• jira issue export / bitbucket pr export (curated offline documents + metrics + attachment download)
• jira issue comments list / bitbucket pr comments list as paginated read primitives
• bitbucket pr files as its own command
• bitbucket pipelines latest
• bitbucket pipelines log with both run and step UUID required
• Versioned JSON envelope on every command, including errors

Only on gh (overlapping domains, still missing from ire):

• Every write verb
• issue list (repo-scoped, flag filters)
• pr checkout, pr checks, pr review, pr merge, pr status
• run watch / rerun / download, workflow run
• search issues|prs|code|commits|repos
• auth login and credential management
• --web, interactive pickers, --json field selection, --jq, --template
• gh api

gh groups with no ire analog at all: repo, gist, release, org, project, label, codespace, discussion, secret, variable, cache, attestation, ruleset, ssh-key, gpg-key, extension, alias, browse, status, copilot, agent-task, skill, preview, licenses, completion.

───

Practical mapping

If you already know gh and want the ire command:

┌────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────┐
│ You would type in gh                       │ Closest ire                                                      │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh issue view 12                           │ ire issue view ABC-12 (key, not number)                          │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh issue view 12 --comments --json …       │ ire issue view ABC-12 --comments                                 │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh issue list --label bug                  │ ire jira issue search --jql 'labels = bug'                       │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh search issues 'repo:x is:open'          │ ire jira issue search --jql '…' (Jira site, not GitHub search)   │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ (no gh equivalent)                         │ ire jira issue export ABC-12                                     │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh issue comment 12 --body '…'             │ none                                                             │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh pr view (current branch)                │ none — id required: ire bitbucket pr get 42                      │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh pr view 42 --json files,comments        │ ire bitbucket pr get 42 + files + comments list, or pr export 42 │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh pr list --author @me                    │ none (no author filter; list then filter client-side)            │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh pr diff 42                              │ ire bitbucket pr diff 42 (JSON-wrapped, not a patch stream)      │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh pr diff --name-only                     │ ire bitbucket pr files 42                                        │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh pr checks / gh run view --log           │ ire bitbucket pipelines latest then steps list then log          │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh run list --limit 1 --branch main        │ ire bitbucket pipelines latest --branch main                     │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh auth status                             │ ire auth check                                                   │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh auth login                              │ none                                                             │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh api repos/{owner}/{repo}/pulls/42       │ ire bitbucket pr get 42 --raw (only for commands that exist)     │
├────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
│ gh repo clone / gh pr create / gh pr merge │ none                                                             │
└────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────┘

The surface ire chose to implement is the agent read-loop: get this ticket, get this PR, get this pipeline log. gh’s surface is the human GitHub workflow, with JSON and gh api as a second layer.
