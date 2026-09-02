# Config inspect

`ire config inspect` prints the resolved Jira and Bitbucket configuration as a success envelope without calling providers. Each field is `{ value, source }` with `source` one of `flag`, `env`, `project-env`, `project-config`, `user-config`, `default`. Secret fields (`jira.apiToken`, `bitbucket.apiToken`) render as `"<redacted>"` when set.

## Sub-features

- `default-inspect` — no config anywhere; every field `value: null`, `source: "default"`
- `env-redaction` — process env (`IRE_*`) wins over files; tokens redacted
- `flag-override` — `--jira-email` / `--bitbucket-*` flags win over env
- `project-files` — non-git cwd `.env` + `.ire/config.json` (`project-env`, `project-config`)
- `validation-error` — invalid project config JSON schema → `CONFIG_VALIDATION_ERROR`, exit 2

## How to get to it (user POV)

```text
ire config inspect
ire config inspect --jira-email agent@example.test
```

No login. Help text: `Usage: ire config inspect [options]` with `--jira-base-url`, `--jira-email`, `--jira-api-token`, `--bitbucket-workspace`, `--bitbucket-repo`, `--bitbucket-email`, `--bitbucket-api-token`.

## Driving it with run-ire.sh

Preconditions: Launch + Doctor have succeeded. Isolated `HOME` and cwd are empty (Doctor already proved all-default). Do not pass leftover `IRE_*` from the agent shell.

- **Default inspect**: user runs inspect with nothing configured.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step default-inspect -- config inspect`
  Observe: exit 0; stderr empty; `success: true`; `schemaVersion: "1.0"`; `meta: {}`; every `jira.*` and `bitbucket.*` field `value: null` and `source: "default"`; `jira.issueExport.fieldMappings.value` is `{}`.

- **Env redaction**: user exports credentials then inspects.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step env-redaction --env IRE_JIRA_BASE_URL=https://jira.example.test --env IRE_JIRA_EMAIL=agent@example.test --env IRE_JIRA_API_TOKEN=jira-secret --env IRE_BITBUCKET_WORKSPACE=example-workspace --env IRE_BITBUCKET_REPO=example-repo --env IRE_BITBUCKET_EMAIL=bb-user --env IRE_BITBUCKET_API_TOKEN=bb-secret -- config inspect`
  Observe: exit 0; `jira.baseUrl.source` is `"env"` with the example URL; `jira.apiToken` and `bitbucket.apiToken` are `{ "value": "<redacted>", "source": "env" }`; stdout does not contain `jira-secret` or `bb-secret`.

- **Flag override**: user passes `--jira-email` on top of env.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step flag-override --env IRE_JIRA_EMAIL=env-agent@example.test -- config inspect --jira-email flag-agent@example.test`
  Observe: exit 0; `jira.email` is `{ "value": "flag-agent@example.test", "source": "flag" }`.

- **Project files**: user has project `.env` and `.ire/config.json` outside git.
  Setup under a scratch dir that is **not** a git repo: write `.env` with `IRE_JIRA_EMAIL=cwd-env@example.test` and `.ire/config.json` with `{ "jira": { "baseUrl": "https://cwd-config-jira.example.test" } }`.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step project-files --cwd <that-dir> -- config inspect`
  Observe: exit 0; `jira.baseUrl` is `{ "value": "https://cwd-config-jira.example.test", "source": "project-config" }`; `jira.email` is `{ "value": "cwd-env@example.test", "source": "project-env" }`.

- **Validation error**: user has a broken project config.
  Setup: non-git scratch dir, `.ire/config.json` containing `{ "jira": { "baseUrl": 123 } }`.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step validation-error --cwd <that-dir> -- config inspect`
  Observe: exit 2; stderr empty; `success: false`; `error.code` is `"CONFIG_VALIDATION_ERROR"`; `error.message` matches `/Invalid project config/`; no `data` key.

## Gotchas

- Precedence is `flag > env > project-env > project-config > user-config > default`. User config is `$HOME/.config/ire-cli/config.json`. Inside a git work tree, project files are at the git root, not cwd.
- `config inspect` never calls `fetch`. A hang or DNS error here is not a provider outage; the process is wrong.
- `--jira-api-token` on the command line is still redacted in the envelope; `run-ire.sh` also redacts it in `command.txt`.
- Commander `--help` for this command is not JSON.
