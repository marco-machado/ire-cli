## Repository Guidelines

- Use logical groups when commiting
- Use Conventional Commits format
- Use branch names in the format `<type>/<issue-number>-<kebab-summary>` when tied to an issue, e.g. `feat/42-jira-comments-create` or `fix/58-config-env-precedence`
- For work without an issue, use `<type>/<kebab-summary>`, e.g. `chore/update-readme` or `ci/required-checks`
- Prefer Conventional Commit-style branch types: `feat`, `fix`, `docs`, `test`, `refactor`, `ci`, `chore`
- Release by bumping `package.json` with `npm version patch|minor|major`, pushing `main` with tags, then publishing a GitHub Release from the matching `vX.Y.Z` tag
- npm publishing is release-triggered through `.github/workflows/publish.yml`; do not publish manually from CI
- Ensure release tags match the package version exactly, e.g. package `0.2.0` uses tag `v0.2.0`
- Use `AskUserQuestion` tool if available

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `marco-machado/ire-cli`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the project triage vocabulary, including `ready-for-review` for completed work awaiting human review. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` plus root `docs/adr/`. See `docs/agents/domain.md`.
