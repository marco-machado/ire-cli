# Proof: config inspect

Feature map: [features/config-inspect.md](../../features/config-inspect.md).

Ran this skill cold against `node dist/cli.js` 0.2.0 (Node v22.14.0).

| Step | Result |
| --- | --- |
| Launch | `helpers/launch.sh config-inspect-baseline` → `ready: dist/cli.js 0.2.0` |
| Doctor | `ok node=v22.14.0 cli=0.2.0 inspect=defaulted` |
| Drive `default-inspect` | exit 0, all-default envelope |
| Drive `env-redaction` | exit 0, env sources, tokens `<redacted>` in stdout and `env.txt` |
| Drive `flag-override` | exit 0, `jira.email.source` is `flag` |
| Drive `project-files` | exit 0, `project-config` + `project-env` from a non-git cwd |
| Drive `validation-error` | exit 2, `CONFIG_VALIDATION_ERROR`, no `data` |
| Cleanup | `/tmp/ire-verify-config-inspect-baseline` removed; this directory remained |

No live Jira/Bitbucket credentials were present. Provider features were not driven.
