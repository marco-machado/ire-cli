import { z } from "zod";
import type { ResolvedConfig } from "./config.js";
import {
  BitbucketNormalizedOutputError,
  getBitbucketPullRequest,
  getBitbucketPullRequestDiff,
  listBitbucketPullRequestActivity,
  listBitbucketPullRequestComments,
  listBitbucketPullRequestFiles,
  type BitbucketDebugRequest,
  type BitbucketRepoIdentity,
} from "./bitbucket.js";

type JsonRecord = Record<string, unknown>;

export type BitbucketPullRequestExportOptions = {
  repo?: string;
  cwd?: string;
  fetchImpl?: typeof fetch;
  debugRequests?: BitbucketDebugRequest[];
};

const userSchema = z
  .object({
    accountId: z.string().nullable(),
    displayName: z.string(),
  })
  .strict();

const branchCommitSchema = z
  .object({
    branch: z.string(),
    commit: z.string(),
  })
  .strict();

const participantSchema = z
  .object({
    user: userSchema.nullable(),
    role: z.string().nullable(),
    approved: z.boolean(),
    state: z.string().nullable(),
    participatedOn: z.iso.datetime().nullable(),
  })
  .strict();

const commentInlineSchema = z
  .object({
    path: z.string(),
    from: z.number().int().nullable(),
    to: z.number().int().nullable(),
  })
  .strict();

const commentResolutionSchema = z
  .object({
    user: userSchema.nullable(),
    created: z.iso.datetime().nullable(),
  })
  .strict();

const exportCommentSchema = z
  .object({
    id: z.number().int(),
    parentId: z.number().int().nullable(),
    author: userSchema.nullable(),
    body: z.string(),
    deleted: z.boolean(),
    pending: z.boolean(),
    inline: commentInlineSchema.nullable(),
    resolution: commentResolutionSchema.nullable(),
    created: z.iso.datetime(),
    updated: z.iso.datetime(),
  })
  .strict();

const exportFileSchema = z
  .object({
    path: z.string(),
    previousPath: z.string().nullable(),
    status: z.enum(["added", "removed", "modified", "renamed"]),
    linesAdded: z.number().int().nullable(),
    linesRemoved: z.number().int().nullable(),
  })
  .strict();

const exportActivitySchema = z
  .object({
    type: z.enum(["approval", "changes_requested", "update", "comment", "unknown"]),
    at: z.iso.datetime().nullable(),
    user: userSchema.nullable(),
    state: z.string().nullable(),
    commentId: z.number().int().nullable(),
  })
  .strict();

const authorCountSchema = z
  .object({
    author: userSchema.nullable(),
    count: z.number().int().nonnegative(),
  })
  .strict();

const fileCountSchema = z
  .object({
    path: z.string(),
    count: z.number().int().nonnegative(),
  })
  .strict();

const metricsSchema = z
  .object({
    commentsTotal: z.number().int().nonnegative(),
    commentsDeleted: z.number().int().nonnegative(),
    commentsInline: z.number().int().nonnegative(),
    commentsGeneral: z.number().int().nonnegative(),
    commentsByAuthor: z.array(authorCountSchema),
    commentsByFile: z.array(fileCountSchema),
    maxThreadDepth: z.number().int().nonnegative(),
    threadCount: z.number().int().nonnegative(),
    filesChanged: z.number().int().nonnegative(),
    linesAdded: z.number().int().nullable(),
    linesRemoved: z.number().int().nullable(),
    commentDensityPerFile: z.number().nullable(),
    commentDensityPerLine: z.number().nullable(),
    firstApprovalAt: z.iso.datetime().nullable(),
    firstApprovalLagSeconds: z.number().int().nullable(),
    approvalCount: z.number().int().nonnegative(),
    changesRequestedCount: z.number().int().nonnegative(),
    firstCommentAt: z.iso.datetime().nullable(),
    firstCommentLagSeconds: z.number().int().nullable(),
  })
  .strict();

const bitbucketPullRequestExportSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    description: z.string().nullable(),
    state: z.enum(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]),
    draft: z.boolean(),
    author: userSchema.nullable(),
    source: branchCommitSchema,
    destination: branchCommitSchema,
    reviewers: z.array(userSchema),
    participants: z.array(participantSchema),
    mergeCommit: z.string().nullable(),
    closedBy: userSchema.nullable(),
    commentCount: z.number().int().nullable(),
    taskCount: z.number().int().nullable(),
    created: z.iso.datetime(),
    updated: z.iso.datetime(),
    comments: z.array(exportCommentSchema),
    files: z.array(exportFileSchema),
    activity: z.array(exportActivitySchema),
    diff: z.string(),
    metrics: metricsSchema,
  })
  .strict();

export type BitbucketPullRequestExport = z.infer<typeof bitbucketPullRequestExportSchema>;
export type ExportComment = z.infer<typeof exportCommentSchema>;
export type ExportActivity = z.infer<typeof exportActivitySchema>;
export type ExportFile = z.infer<typeof exportFileSchema>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function requireTimestamp(value: unknown): string {
  const normalized = normalizeTimestamp(value);
  if (normalized === null) {
    return value as string;
  }
  return normalized;
}

function userField(value: unknown): z.infer<typeof userSchema> | null {
  const user = asRecord(value);
  if (user === undefined) {
    return null;
  }

  const displayName = user.display_name;
  if (typeof displayName !== "string") {
    return null;
  }

  return {
    accountId: typeof user.account_id === "string" ? user.account_id : null,
    displayName,
  };
}

function branchCommitField(value: unknown): z.infer<typeof branchCommitSchema> {
  const endpoint = asRecord(value);
  const branch = asRecord(endpoint?.branch);
  const commit = asRecord(endpoint?.commit);

  return {
    branch: typeof branch?.name === "string" ? branch.name : "",
    commit: typeof commit?.hash === "string" ? commit.hash : "",
  };
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function filePath(value: unknown): string | undefined {
  const file = asRecord(value);
  return typeof file?.path === "string" ? file.path : undefined;
}

function pageValues(page: unknown): unknown[] {
  const record = asRecord(page);
  return Array.isArray(record?.values) ? record.values : [];
}

function pageNextCursor(page: unknown): string | null {
  const record = asRecord(page);
  return typeof record?.next === "string" ? record.next : null;
}

async function collectAllPages(
  fetchPage: (cursor: string | undefined) => Promise<unknown>,
): Promise<unknown[]> {
  const values: unknown[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await fetchPage(cursor);
    values.push(...pageValues(page));
    const next = pageNextCursor(page);
    if (next === null) {
      break;
    }
    cursor = next;
  }

  return values;
}

function normalizeParticipant(value: unknown): z.infer<typeof participantSchema> {
  const participant = asRecord(value);
  const participatedOn = normalizeTimestamp(participant?.participated_on);

  return {
    user: userField(participant?.user),
    role: typeof participant?.role === "string" ? participant.role : null,
    approved: participant?.approved === true,
    state: typeof participant?.state === "string" ? participant.state : null,
    participatedOn,
  };
}

function normalizeCommentInline(value: unknown): z.infer<typeof commentInlineSchema> | null {
  const inline = asRecord(value);
  if (inline === undefined || typeof inline.path !== "string") {
    return null;
  }

  return {
    path: inline.path,
    from: inline.from === null || inline.from === undefined
      ? null
      : typeof inline.from === "number"
        ? inline.from
        : null,
    to: inline.to === null || inline.to === undefined
      ? null
      : typeof inline.to === "number"
        ? inline.to
        : null,
  };
}

function normalizeCommentResolution(value: unknown): z.infer<typeof commentResolutionSchema> | null {
  const resolution = asRecord(value);
  if (resolution === undefined) {
    return null;
  }

  return {
    user: userField(resolution.user ?? resolution.resolved_by),
    created: normalizeTimestamp(resolution.created_on ?? resolution.created ?? resolution.resolved_on),
  };
}

function normalizeCommentBody(value: unknown): string {
  const content = asRecord(value);
  return typeof content?.raw === "string" ? content.raw : "";
}

function normalizeExportComment(value: unknown): ExportComment {
  const comment = asRecord(value);
  const parent = asRecord(comment?.parent);
  const parentId = typeof parent?.id === "number"
    ? parent.id
    : typeof comment?.parent_id === "number"
      ? comment.parent_id
      : null;

  return {
    id: comment?.id as number,
    parentId,
    author: userField(comment?.user),
    body: normalizeCommentBody(comment?.content),
    deleted: comment?.deleted === true,
    pending: comment?.pending === true,
    inline: normalizeCommentInline(comment?.inline),
    resolution: normalizeCommentResolution(comment?.resolution),
    created: requireTimestamp(comment?.created_on),
    updated: requireTimestamp(comment?.updated_on),
  };
}

function normalizeExportFile(value: unknown): ExportFile {
  const diffstat = asRecord(value);
  const oldPath = filePath(diffstat?.old);
  const newPath = filePath(diffstat?.new);

  return {
    path: (newPath ?? oldPath) as string,
    previousPath: newPath !== undefined && oldPath !== undefined && oldPath !== newPath ? oldPath : null,
    status: diffstat?.status as ExportFile["status"],
    linesAdded: nullableNumber(diffstat?.lines_added),
    linesRemoved: nullableNumber(diffstat?.lines_removed),
  };
}

function normalizeActivityEvent(value: unknown): ExportActivity {
  const entry = asRecord(value) ?? {};

  if (asRecord(entry.approval) !== undefined) {
    const approval = asRecord(entry.approval)!;
    return {
      type: "approval",
      at: normalizeTimestamp(approval.date),
      user: userField(approval.user),
      state: null,
      commentId: null,
    };
  }

  const changesRequest =
    asRecord(entry.changes_request)
    ?? asRecord(entry.changes_requested)
    ?? asRecord(entry.request_changes);
  if (changesRequest !== undefined) {
    return {
      type: "changes_requested",
      at: normalizeTimestamp(changesRequest.date),
      user: userField(changesRequest.user),
      state: null,
      commentId: null,
    };
  }

  if (asRecord(entry.update) !== undefined) {
    const update = asRecord(entry.update)!;
    return {
      type: "update",
      at: normalizeTimestamp(update.date),
      user: userField(update.author ?? update.user),
      state: typeof update.state === "string" ? update.state : null,
      commentId: null,
    };
  }

  if (asRecord(entry.comment) !== undefined) {
    const comment = asRecord(entry.comment)!;
    return {
      type: "comment",
      at: normalizeTimestamp(comment.created_on ?? comment.updated_on),
      user: userField(comment.user),
      state: null,
      commentId: typeof comment.id === "number" ? comment.id : null,
    };
  }

  return {
    type: "unknown",
    at: normalizeTimestamp(entry.date ?? entry.created_on),
    user: userField(entry.user ?? entry.author),
    state: typeof entry.state === "string" ? entry.state : null,
    commentId: null,
  };
}

function authorKey(author: z.infer<typeof userSchema> | null): string {
  if (author === null) {
    return "null";
  }
  if (author.accountId !== null) {
    return `id:${author.accountId}`;
  }
  return `name:${author.displayName}`;
}

function lagSeconds(startIso: string, endIso: string | null): number | null {
  if (endIso === null) {
    return null;
  }
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }
  return Math.floor((end - start) / 1000);
}

function computeMaxThreadDepth(comments: ExportComment[]): number {
  if (comments.length === 0) {
    return 0;
  }

  const byId = new Map<number, ExportComment>();
  for (const comment of comments) {
    byId.set(comment.id, comment);
  }

  const depthCache = new Map<number, number>();

  function depthOf(id: number, visiting: Set<number>): number {
    const cached = depthCache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(id)) {
      return 1;
    }

    const comment = byId.get(id);
    if (comment === undefined) {
      return 1;
    }

    if (comment.parentId === null || !byId.has(comment.parentId)) {
      depthCache.set(id, 1);
      return 1;
    }

    visiting.add(id);
    const depth = 1 + depthOf(comment.parentId, visiting);
    visiting.delete(id);
    depthCache.set(id, depth);
    return depth;
  }

  let max = 0;
  for (const comment of comments) {
    max = Math.max(max, depthOf(comment.id, new Set()));
  }
  return max;
}

function computeMetrics(
  created: string,
  comments: ExportComment[],
  files: ExportFile[],
  activity: ExportActivity[],
): z.infer<typeof metricsSchema> {
  const activeComments = comments.filter((comment) => !comment.deleted);
  const commentsDeleted = comments.length - activeComments.length;
  const commentsInline = activeComments.filter((comment) => comment.inline !== null).length;
  const commentsGeneral = activeComments.length - commentsInline;

  const authorCounts = new Map<string, { author: z.infer<typeof userSchema> | null; count: number }>();
  for (const comment of activeComments) {
    const key = authorKey(comment.author);
    const existing = authorCounts.get(key);
    if (existing === undefined) {
      authorCounts.set(key, { author: comment.author, count: 1 });
    } else {
      existing.count += 1;
    }
  }

  const fileCounts = new Map<string, number>();
  for (const comment of activeComments) {
    const path = comment.inline?.path;
    if (path === undefined) {
      continue;
    }
    fileCounts.set(path, (fileCounts.get(path) ?? 0) + 1);
  }

  const commentsByAuthor = [...authorCounts.values()].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    const leftName = left.author?.displayName ?? "";
    const rightName = right.author?.displayName ?? "";
    return leftName.localeCompare(rightName);
  });

  const commentsByFile = [...fileCounts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.path.localeCompare(right.path);
    });

  let linesAdded: number | null = 0;
  let linesRemoved: number | null = 0;
  for (const file of files) {
    if (file.linesAdded === null || file.linesRemoved === null) {
      linesAdded = null;
      linesRemoved = null;
      break;
    }
    linesAdded += file.linesAdded;
    linesRemoved += file.linesRemoved;
  }

  const filesChanged = files.length;
  const commentsTotal = activeComments.length;
  const commentDensityPerFile = filesChanged > 0 ? commentsTotal / filesChanged : null;
  const totalLines = linesAdded !== null && linesRemoved !== null ? linesAdded + linesRemoved : null;
  const commentDensityPerLine =
    totalLines !== null && totalLines > 0 ? commentsTotal / totalLines : null;

  const approvalTimes = activity
    .filter((event) => event.type === "approval" && event.at !== null)
    .map((event) => event.at as string)
    .sort();
  const firstApprovalAt = approvalTimes[0] ?? null;

  const commentTimes = activeComments
    .map((comment) => comment.created)
    .sort();
  const firstCommentAt = commentTimes[0] ?? null;

  return {
    commentsTotal,
    commentsDeleted,
    commentsInline,
    commentsGeneral,
    commentsByAuthor,
    commentsByFile,
    maxThreadDepth: computeMaxThreadDepth(comments),
    threadCount: comments.filter((comment) => comment.parentId === null).length,
    filesChanged,
    linesAdded,
    linesRemoved,
    commentDensityPerFile,
    commentDensityPerLine,
    firstApprovalAt,
    firstApprovalLagSeconds: lagSeconds(created, firstApprovalAt),
    approvalCount: activity.filter((event) => event.type === "approval").length,
    changesRequestedCount: activity.filter((event) => event.type === "changes_requested").length,
    firstCommentAt,
    firstCommentLagSeconds: lagSeconds(created, firstCommentAt),
  };
}

export async function exportBitbucketPullRequest(
  config: ResolvedConfig,
  id: number,
  options: BitbucketPullRequestExportOptions = {},
): Promise<{ data: BitbucketPullRequestExport; repo: BitbucketRepoIdentity }> {
  const shared = {
    repo: options.repo,
    cwd: options.cwd,
    fetchImpl: options.fetchImpl,
    debugRequests: options.debugRequests,
  };

  const prResult = await getBitbucketPullRequest(config, id, {
    ...shared,
    raw: true,
  });
  const pullRequest = asRecord(prResult.data) ?? {};
  const repo = prResult.repo;

  const [rawComments, rawFiles, rawActivity, diffResult] = await Promise.all([
    collectAllPages((cursor) =>
      listBitbucketPullRequestComments(config, id, {
        ...shared,
        limit: 100,
        cursor,
        raw: true,
      }).then((result) => result.data),
    ),
    collectAllPages((cursor) =>
      listBitbucketPullRequestFiles(config, id, {
        ...shared,
        limit: 100,
        cursor,
        raw: true,
      }).then((result) => result.data),
    ),
    collectAllPages((cursor) =>
      listBitbucketPullRequestActivity(config, id, {
        ...shared,
        limit: 100,
        cursor,
        raw: true,
      }).then((result) => result.data),
    ),
    getBitbucketPullRequestDiff(config, id, shared),
  ]);

  const comments = rawComments.map(normalizeExportComment);
  const files = rawFiles.map(normalizeExportFile);
  const activity = rawActivity.map(normalizeActivityEvent);
  const diffRecord = asRecord(diffResult.data);
  const diff = typeof diffRecord?.diff === "string" ? diffRecord.diff : "";

  const reviewers = Array.isArray(pullRequest.reviewers)
    ? pullRequest.reviewers.map(userField).filter((user): user is z.infer<typeof userSchema> => user !== null)
    : [];
  const participants = Array.isArray(pullRequest.participants)
    ? pullRequest.participants.map(normalizeParticipant)
    : [];
  const mergeCommit = asRecord(pullRequest.merge_commit);
  const created = requireTimestamp(pullRequest.created_on);

  const normalized = {
    id: pullRequest.id,
    title: pullRequest.title,
    description: typeof pullRequest.description === "string" ? pullRequest.description : null,
    state: pullRequest.state,
    draft: pullRequest.draft === true,
    author: userField(pullRequest.author),
    source: branchCommitField(pullRequest.source),
    destination: branchCommitField(pullRequest.destination),
    reviewers,
    participants,
    mergeCommit: typeof mergeCommit?.hash === "string" ? mergeCommit.hash : null,
    closedBy: userField(pullRequest.closed_by),
    commentCount: nullableNumber(pullRequest.comment_count),
    taskCount: nullableNumber(pullRequest.task_count),
    created,
    updated: requireTimestamp(pullRequest.updated_on),
    comments,
    files,
    activity,
    diff,
    metrics: computeMetrics(created, comments, files, activity),
  };

  const parsed = bitbucketPullRequestExportSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new BitbucketNormalizedOutputError(
      parsed.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
      "Normalized Bitbucket pull request export output failed validation",
    );
  }

  return { data: parsed.data, repo };
}
