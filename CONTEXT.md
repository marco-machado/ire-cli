# ire-cli

A CLI that reads Jira and Bitbucket data and emits normalized JSON envelopes for humans, scripts, and agents.

## Language

**Get**:
A single-command fetch of one work item in full normalized detail, strict about failures.
_Avoid_: Fetch, show, view

**Export**:
A curated document of a work item intended for offline review, including attachments.
_Avoid_: Dump, download

**Linked Work Item**:
An issue connected through a Jira issue link (blocks, relates to, duplicates); distinct from the parent/subtask hierarchy.
_Avoid_: Related issue, linked issue

**Envelope**:
The versioned JSON wrapper every command prints: success flag, schema version, data or error, and meta.
_Avoid_: Response, payload
