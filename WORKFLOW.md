# Developer Workflow

This repo is configured for agent-assisted development through local skills in
`.agents/skills`. The commands below are prompts you give to the coding agent,
not shell commands.

## One-Time Setup

Run this only when the repo's agent configuration is missing or needs to change:

```text
/setup-matt-pocock-skills
```

Use it when switching issue trackers, changing triage label names, or changing
the domain documentation layout. This repo is already configured for:

- GitHub Issues: `marco-machado/ire-cli`
- Default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`,
  `ready-for-human`, `wontfix`
- Single-context domain docs: root `CONTEXT.md` plus root `docs/adr/`

## Before Starting Work

For any non-trivial change, expect the agent to read:

- `CONTEXT.md` for project vocabulary
- Relevant ADRs in `docs/adr/`
- `docs/agents/issue-tracker.md`
- `docs/agents/triage-labels.md`
- `docs/agents/domain.md`

The goal is to keep plans, issue titles, tests, and implementation language
aligned with the repo's domain model.

## Command Guide

### Clarify a Plan

```text
/grill-with-docs <rough plan or idea>
```

Use when an idea is fuzzy, terminology matters, or you want the agent to
challenge the design against the codebase, `CONTEXT.md`, and ADRs.

The agent should ask one question at a time, answer anything it can by reading
the code, update `CONTEXT.md` when domain terms are resolved, and suggest ADRs
only for durable architectural decisions.

### Create a PRD

```text
/to-prd
```

Use after the plan is clear enough to become a product requirement. The agent
should synthesize from current context, confirm the main modules and testing
focus, then publish a GitHub issue labeled `needs-triage`.

### Break a Plan Into Issues

```text
/to-issues <PRD issue number or URL>
```

Use after a PRD or larger plan exists. The agent should split the work into
thin vertical slices, mark each slice as `AFK` or `HITL`, confirm dependencies
with you, then create GitHub issues in dependency order with `needs-triage`.

### Triage Issues

```text
/triage <issue number>
```

Use when deciding whether an issue is ready to be picked up. Each triaged issue
should have one category label and one state label.

Category labels:

- `bug`
- `enhancement`

State labels:

- `needs-triage`
- `needs-info`
- `ready-for-agent`
- `ready-for-human`
- `wontfix`

For bugs, the agent should attempt reproduction before asking design questions.
For `ready-for-agent`, the agent should post an agent brief with current
behavior, desired behavior, key interfaces, acceptance criteria, and explicit
out-of-scope notes.

### Build a Feature With TDD

```text
/tdd <issue number or feature description>
```

Use for a ready feature slice when you want red-green-refactor discipline. The
agent should work one behavior at a time:

1. Write one behavior test.
2. Watch it fail.
3. Write the minimum implementation.
4. Watch it pass.
5. Repeat for the next behavior.
6. Refactor only while tests are green.

Tests should verify behavior through public interfaces, not implementation
details.

### Debug a Bug

```text
/diagnose <bug issue number or bug description>
```

Use before fixing a hard bug or performance regression. The agent should:

1. Build a fast feedback loop.
2. Reproduce the reported failure.
3. Rank falsifiable hypotheses.
4. Add narrow instrumentation if needed.
5. Write a regression test at the correct seam.
6. Fix the bug.
7. Re-run the original repro and clean up debug artifacts.

Do not skip straight to a fix unless the feedback loop and reproduction are
already clear.

### Improve Architecture

```text
/improve-codebase-architecture
```

Use when looking for refactor opportunities, better test seams, or deeper
modules. The agent should present candidates first, then explore a selected
candidate with you before designing interfaces or making changes.

### Regain Context

```text
/zoom-out
```

Use when you or the agent are lost in a code area. The agent should move up one
level and describe the relevant modules, callers, and domain concepts.

### Create or Edit Skills

```text
/write-a-skill
```

Use when adding or changing a local skill under `.agents/skills`.

## Common Flows

### New Feature

```text
/grill-with-docs add Bitbucket pipeline artifact inspection
/to-prd
/to-issues <PRD issue>
/triage <slice issue>
/tdd <ready slice issue>
```

### Bug Fix

```text
/triage <bug issue>
/diagnose <bug issue>
```

### Small Obvious Change

```text
/tdd <change description>
```

Skip PRD and issue breakdown when the change is small, local, and already clear.

### Architecture Cleanup

```text
/improve-codebase-architecture
/grill-with-docs <selected refactor candidate>
/to-issues <approved refactor plan>
```

Use this flow when the cleanup affects multiple modules or needs explicit
design agreement before implementation.

## Commit Convention

Use Conventional Commits for any commits made from this workflow.
