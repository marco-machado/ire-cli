# Bitbucket Pipelines

`ire bitbucket pipelines …` reads pipeline runs for a repository. `list` and `latest` take optional `--branch`. `get` and `steps list` require the run UUID. `log` requires both the run UUID and the step UUID. There is no watch, rerun, or artifact download.

## Sub-features

- `pipelines-list` — paginated runs; `--branch`, `--limit`, `--cursor`, `--repo`
- `pipelines-latest` — latest run; `--branch`, `--repo`
- `pipelines-get` — one run by UUID
- `pipelines-steps-list` — steps for a run UUID; `--limit`, `--cursor`
- `pipelines-log` — log for `UUID STEP_UUID`
- `pipelines-missing-uuid` — omitted UUID on get/steps/log → `MISSING_ARGUMENT`, exit 2

## How to get to it (user POV)

```text
ire bitbucket pipelines list --repo workspace/repo --branch main
ire bitbucket pipelines latest --repo workspace/repo --branch main
ire bitbucket pipelines get {uuid} --repo workspace/repo
ire bitbucket pipelines steps list {uuid} --repo workspace/repo
ire bitbucket pipelines log {uuid} {stepUuid} --repo workspace/repo
```

Repo identity follows the same `--repo` / config / git-remote rule as pull requests. Success envelopes include `meta.bitbucket`.

## Driving it with run-ire.sh

Preconditions: Launch + Doctor have succeeded. Live reads need Bitbucket email+token and `workspace/repo`. Without them, drive missing-UUID and repo-missing; skip live list/latest/get/log.

- **Get missing UUID**: user runs get with no UUID.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step pipelines-missing-uuid -- bitbucket pipelines get`
  Observe: exit 2; `error.code` is `"MISSING_ARGUMENT"`; `error.message` is `Bitbucket pipelines get requires a UUID`; `error.details.argument` is `"UUID"`.

- **Steps missing UUID**: user lists steps with no UUID.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step pipelines-steps-missing -- bitbucket pipelines steps list`
  Observe: exit 2; `error.code` is `"MISSING_ARGUMENT"`; `error.message` is `Bitbucket pipelines steps list requires a UUID`.

- **Log missing step UUID**: user passes only the run UUID.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step pipelines-log-missing-step -- bitbucket pipelines log '{uuid}'`
  Observe: exit 2; `error.code` is `"MISSING_ARGUMENT"`; `error.message` is `Bitbucket pipelines log requires a step UUID`; `error.details.argument` is `"STEP_UUID"`.

- **Invalid list limit**: user passes a non-positive `--limit`.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step pipelines-invalid-limit -- bitbucket pipelines list --repo workspace/repo --limit 0`
  Observe: exit 2; `error.code` is `"INVALID_LIMIT"`; `error.message` is `Bitbucket pipelines list limit must be a positive integer`.

- **Latest (live)**: user asks for the newest run on a branch.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step pipelines-latest --env IRE_BITBUCKET_EMAIL=… --env IRE_BITBUCKET_API_TOKEN=… -- bitbucket pipelines latest --repo workspace/repo --branch main`
  Observe: exit 0; `success: true`; `data` is one normalized pipeline; `meta.bitbucket` matches the `--repo`. Skip without live credentials.

- **Steps then log (live)**: user diagnoses a failure.
  Command: `… -- bitbucket pipelines steps list {uuid} --repo workspace/repo` then `… -- bitbucket pipelines log {uuid} {stepUuid} --repo workspace/repo`
  Observe: steps list exit 0 with step UUIDs; log exit 0 with log text inside `data`. Use ids from the previous envelope, not guessed UUIDs.

## Gotchas

- Pipeline UUIDs are Bitbucket's, including braces if the provider returns them. Copy from `pipelines list` / `latest` / `get`; do not invent.
- `log` needs **both** ids. There is no `--log-failed` convenience flag.
- List `--limit` must be a positive integer; unlike Jira search, the local check here is `>= 1` (provider still caps at 100).
- No command attaches pipelines to a pull request. Branch is the join key (`--branch`).
- Same repo-isolation rules as PR commands: isolated cwd will not infer this GitHub remote as Bitbucket.
