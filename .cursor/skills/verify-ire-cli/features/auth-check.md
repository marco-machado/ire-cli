# Auth check

`ire auth check` makes a lightweight request to each fully configured provider (`GET {jiraBaseUrl}/rest/api/3/myself`, `GET https://api.bitbucket.org/2.0/user`) and prints identity fields on success. `ire auth check jira` and `ire auth check bitbucket` restrict the probe. Mixed provider outcomes still emit per-provider `data` plus `error.code: "AUTH_CHECK_FAILED"`.

## Sub-features

- `check-all` — probe every complete provider; success envelope is an array of results
- `check-jira` / `check-bitbucket` — single-provider object in `data`
- `invalid-provider` — unknown name → `INVALID_PROVIDER`, exit 2, no network
- `config-missing` — no provider configured → `AUTH_CONFIG_MISSING`, exit 2
- `config-incomplete` — partial Jira or Bitbucket fields → `AUTH_CONFIG_INCOMPLETE`, exit 2
- `debug-redaction` — `--debug` adds `meta.debug.requests` without authorization or token values

## How to get to it (user POV)

```text
ire auth check
ire auth check jira
ire auth check bitbucket
ire auth check jira --debug
```

Help text: `Usage: ire auth check [options] [provider]` with argument `provider` (`jira` or `bitbucket`). Flags: `--debug` and the Jira/Bitbucket config flags (`auth check` has no `--bitbucket-repo`).

## Driving it with run-ire.sh

Preconditions: Launch + Doctor have succeeded. Provider **success** needs live tokens passed via `--env` or flags. Without them, drive `config-missing` / `invalid-provider` and report provider success as skip.

- **Config missing**: user checks auth with a blank isolated home.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step auth-missing -- auth check`
  Observe: exit 2; `success: false`; `error.code` is `"AUTH_CONFIG_MISSING"`; `error.details.providers` is `["jira","bitbucket"]`; stderr empty.

- **Invalid provider**: user passes a name that is not jira/bitbucket.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step auth-invalid -- auth check github`
  Observe: exit 2; `error.code` is `"INVALID_PROVIDER"`; `error.message` is `Unknown auth provider: github`; `error.details.allowed` is `["jira","bitbucket"]`.

- **Config incomplete**: user set Jira URL and email but no token.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step auth-incomplete --env IRE_JIRA_BASE_URL=https://jira.example.test --env IRE_JIRA_EMAIL=agent@example.test -- auth check jira`
  Observe: exit 2; `error.code` is `"AUTH_CONFIG_INCOMPLETE"`; `error.details` is `{ "provider": "jira", "missing": ["apiToken"] }`.

- **Check all (live)**: user has complete Jira and/or Bitbucket env.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step auth-live --env IRE_JIRA_BASE_URL=… --env IRE_JIRA_EMAIL=… --env IRE_JIRA_API_TOKEN=… -- auth check`
  Observe: exit 0; `success: true`; `data` is an array; each element has `authenticated: true` and `identity` (`accountId`, `displayName`, `email` for Jira; `accountId`, `displayName`, `username`, `workspace` for Bitbucket). Skip if tokens are absent.

- **Debug redaction (live Jira)**: same as live jira plus `--debug`.
  Command: `.cursor/skills/verify-ire-cli/helpers/run-ire.sh --step auth-debug --env IRE_JIRA_BASE_URL=… --env IRE_JIRA_EMAIL=… --env IRE_JIRA_API_TOKEN=… -- auth check jira --debug`
  Observe: exit 0; `meta.debug.requests[0]` has `provider: "jira"`, `method: "GET"`, `url` ending in `/rest/api/3/myself`, numeric `latencyMs`; stdout contains neither the token nor the string `authorization` (any case).

## Gotchas

- Incomplete config is rejected **before** network. Do not treat `AUTH_CONFIG_INCOMPLETE` as a provider outage.
- Auth failure vs provider error vs network: exit `3` (`AUTH_FAILED`), `5` (`PROVIDER_ERROR`), `6` (`NETWORK_ERROR`). Mixed results use the max of those codes plus `AUTH_CHECK_FAILED`.
- `auth check` does not persist tokens and has no login/logout.
- Bitbucket identity request is always `https://api.bitbucket.org/2.0/user`, not the workspace URL.
