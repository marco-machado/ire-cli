# ire-cli feature map

Verification source for the `ire` CLI. Drive from these files, not from memory of `README.md`.

Primary surface: short-lived `node dist/cli.js` (installed name `ire`). Harness: [helpers/run-ire.sh](../helpers/run-ire.sh).

## Baseline preconditions

- Launch has printed `ready: dist/cli.js …` and `.active-run` exists.
- Doctor has printed `ok … inspect=defaulted` (isolated all-default `config inspect`).
- Node >= 22. No long-lived process to keep alive.
- Provider success paths require `IRE_JIRA_*` and/or `IRE_BITBUCKET_*` (or equivalent flags/project/user config) **passed explicitly into `run-ire.sh --env`**. The agent shell is not the config source.

## Driving conventions

- One `run-ire.sh --step <id>` per user action. Never reuse a step id in the same run.
- Default cwd is a fresh non-git directory under the run scratch. Pass `--cwd` when the step needs project files or a fake `.git`.
- Default `HOME` is the run's scratch home. User config is `$HOME/.config/ire-cli/config.json`.
- Parse stdout as a JSON envelope unless the command is Commander `-h`/`-V`.
- Record exit code beside the envelope. `success: false` still writes JSON on stdout.

## Proof / skip reporting

- **Pass**: mapped action ran on `node dist/cli.js`; envelope + exit code match the Observe line; side-effect files (if any) exist under scratch; secrets absent from stdout.
- **Skip**: provider credentials or a live issue/PR/pipeline id are missing. Capture the actual local failure (`AUTH_CONFIG_MISSING`, `AUTH_CONFIG_INCOMPLETE`, `BITBUCKET_REPO_MISSING`, `MISSING_ARGUMENT`) and stop. Do not mock `fetch`. Do not call that skip a pass.
- **Fail**: envelope, exit code, redaction, or side effect disagrees with the Observe line.

## Feature entry contract

Each file is one user-facing feature:

1. H1 + one paragraph of user-visible behavior
2. H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with run-ire.sh`, `Gotchas`
3. Sub-features: short IDs, one line each
4. Driving starts with `Preconditions:` and labeled bullets pairing the user action with an exact command and observable result

Index:

| File | User-facing feature |
| --- | --- |
| [config-inspect.md](config-inspect.md) | Resolve and print configuration (local) |
| [auth-check.md](auth-check.md) | Probe Jira/Bitbucket credentials |
| [issue-view.md](issue-view.md) | View one Jira issue (destination + leftover reads/export) |
| [bitbucket-pr.md](bitbucket-pr.md) | Read Bitbucket pull requests |
| [bitbucket-pipelines.md](bitbucket-pipelines.md) | Read Bitbucket Pipelines runs, steps, logs |
