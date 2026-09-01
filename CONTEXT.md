# ire-cli

A CLI that reads Jira and Bitbucket data and emits normalized JSON envelopes for humans, scripts, and agents.

## Language

**Resource**:
The noun the command tree is keyed by: issue, pr, repo, or pipeline.
_Avoid_: provider namespace

**Provider**:
Jira Cloud or Bitbucket Cloud, the backing system bound to a Resource. issue binds to Jira Cloud; pr, repo, and pipeline bind to Bitbucket Cloud.
_Avoid_: host, backend, integration

**View**:
A single-command fetch of one Resource. The default Envelope is the primary record; flags request Expansions. Failures of the primary record or of a requested Expansion fail the whole command.
_Avoid_: Get, Fetch, show

**Expansion**:
A collection a View flag requests in addition to the primary record.
_Avoid_: include, extra, sidecar

**Export**:
A curated document of a work item intended for offline review, including attachments.
_Avoid_: Dump, download

**Linked Work Item**:
An issue connected through a Jira issue link (blocks, relates to, duplicates); distinct from the parent/subtask hierarchy.
_Avoid_: Related issue, linked issue

**Envelope**:
The versioned JSON wrapper every command prints: success flag, schema version, data or error, and meta.
_Avoid_: Response, payload
