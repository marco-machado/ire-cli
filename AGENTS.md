## Repository Guidelines

- One commit per logical change
- Use Conventional Commits format, with the same `feat`, `fix`, `docs`, `test`, `refactor`, `ci`, `chore` types preferred for branch names too
- Use branch names in the format `<type>/<issue-number>-<kebab-summary>` when tied to an issue (e.g. `feat/42-jira-comments-create`, `fix/58-config-env-precedence`), or `<type>/<kebab-summary>` for work without an issue (e.g. `chore/update-readme`, `ci/required-checks`)
- `main` is branch-protected: all changes must land via a merged pull request — direct pushes to `main` are rejected
- Only merge commits are enabled for PRs (squash and rebase are disabled); `gh pr merge --merge` is the way to merge, even for single-commit branches

## Release

- Bump `package.json` with `npm version patch|minor|major` on a `chore/release-vX.Y.Z` branch, open a PR, and merge it into `main`
- Tag only after the release PR is merged: pull `main`, then tag the merged commit as `vX.Y.Z` (matching the package version exactly, e.g. package `0.2.0` uses tag `v0.2.0`) and push the tag — tagging before merge produces a tag pointing to a commit not reachable from `main`
- Publish a GitHub Release from that `vX.Y.Z` tag to trigger `.github/workflows/publish.yml`, which validates the tag matches the package version and runs tests before publishing
- Do not publish to npm manually from CI
