# Bitbucket pull requests

`ire bitbucket pr …` reads one repository's pull requests as JSON envelopes. `get` is a thin primitive. `export` fans out to comments, files, activity, diff, and derived metrics, and may write the envelope with `--output <path>`. `list` defaults to open PRs with drafts hidden. Identity is a positive integer id plus `workspace/repo` from `--repo`, config, or an unambiguous git remote.

## Sub-features

- `pr-get` — `bitbucket pr get ID`; optional `--raw`
- `pr-list` — `bitbucket pr list`; `--state OPEN,MERGED,DECLINED,SUPERSEDED`; `--include-drafts`; `--limit`/`--cursor`
- `pr-export` — curated document; `--output` writes JSON and sets `meta.outputPath`
- `pr-comments-list` — paginated comments
- `pr-files` — changed files with line stats when present
- `pr-diff` — unified diff **inside** the envelope (`data`), never a raw patch as process output
- `pr-missing-id` / `pr-invalid-id` — omitted or non-positive id → `MISSING_ARGUMENT` / `INVALID_ARGUMENT`, exit 2

## How to get to it (user POV)

```text
ire bitbucket pr list --repo workspace/repo
ire bitbucket pr get 42 --repo workspace/repo
ire bitbucket pr export 42 --repo workspace/repo --output ./pr-42.json
ire bitbucket pr comments list 42 --repo workspace/repo
ire bitbucket pr files 42 --repo workspace/repo
ire bitbucket pr diff 42 --repo workspace/repo
```

Success envelopes include resolved identity in `meta.bitbucket`.

## Driving it with run-ire.sh

Preconditions: Launch + Doctor have succeeded. Live reads need Bitbucket email+token and a `workspace/repo` (`--repo` or `IRE_BITBUCKET_WORKSPACE` + `IRE_BITBUCKET_REPO`). Isolated default cwd is not a git repo, so git-remote inference does not apply unless you pass `--cwd` at a repo with Bitbucket remotes. Without credentials, drive missing/invalid id and repo-missing.

- **Missing id**: user runs get with no id.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step pr-missing-id -- bitbucket pr get`
  Observe: exit 2; `error.code` is `"MISSING_ARGUMENT"`; `error.message` is `Bitbucket pull request ID is required`; `error.details.argument` is `"ID"`.

- **Invalid id**: user passes a non-positive id.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step pr-invalid-id -- bitbucket pr get 0`
  Observe: exit 2; `error.code` is `"INVALID_ARGUMENT"`; `error.message` is `Bitbucket pull request ID must be a positive integer`; `error.details.value` is `"0"`.

- **Repo missing**: user passes a valid id but no repo, config, or git remote.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step pr-repo-missing --env IRE_BITBUCKET_EMAIL=bb-user --env IRE_BITBUCKET_API_TOKEN=bb-secret -- bitbucket pr get 42`
  Observe: exit 2; `error.code` is `"BITBUCKET_REPO_MISSING"`; `error.details.expected` is `"workspace/repo"`; `error.details.precedence` is `["--repo","config","git-remote"]`.

- **Invalid --state**: user lists with a bad state token.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step pr-invalid-state -- bitbucket pr list --repo workspace/repo --state OPEN,NOPE`
  Observe: exit 2; `error.code` is `"INVALID_STATE"`; `details.allowed` is `["OPEN","MERGED","DECLINED","SUPERSEDED"]`. (This check runs before the provider call.)

- **Get (live)**: user fetches one PR.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step pr-get --env IRE_BITBUCKET_EMAIL=… --env IRE_BITBUCKET_API_TOKEN=… -- bitbucket pr get 42 --repo workspace/repo`
  Observe: exit 0; `success: true`; `schemaVersion: "1.0"`; `meta.bitbucket` is `{ "workspace": "…", "repo": "…" }`; `data` is the normalized PR (not comments/files/diff). Skip without live credentials and a real id.

- **Export to disk (live)**: user asks for an offline document.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step pr-export --cwd <scratch> --env IRE_BITBUCKET_*=… -- bitbucket pr export 42 --repo workspace/repo --output ./pr-42.json`
  Observe: exit 0; stdout envelope matches the file at `meta.outputPath`; that path is the resolved `./pr-42.json` under `<scratch>`; parent dirs are created; existing files overwritten.

- **Diff (live)**: user asks for the patch.
  Command: `… -- bitbucket pr diff 42 --repo workspace/repo`
  Observe: exit 0; the unified diff is a field inside `data`, not a raw patch as the entire stdout.

## Gotchas

- `--repo` syntax is `workspace/repo`. Anything else is `BITBUCKET_REPO_INVALID`. Two distinct Bitbucket remotes in cwd is `BITBUCKET_REPO_AMBIGUOUS`, exit 7.
- `pr list` hides drafts unless `--include-drafts`. Default state is open PRs.
- `--raw` exists on `pr get` only among these PR commands.
- Export can issue many paginated provider requests. `--output` still prints the envelope on stdout.
- This GitHub checkout's remotes are not Bitbucket; do not drive PR commands from the repo cwd expecting inference to work.
