import { execFileSync } from "node:child_process";
import { z } from "zod";
import { checkProviderAuth } from "./auth.js";
import type { ResolvedConfig } from "./config.js";
import {
  IreAmbiguousError,
  IreAuthenticationError,
  IreConfigurationError,
  IreNetworkError,
  IreNormalizedOutputError,
  IreNotFoundError,
  IreProviderError,
} from "./errors.js";
import type { Provider } from "./provider.js";

type Fetch = typeof fetch;
type JsonRecord = Record<string, unknown>;

export type BitbucketDebugRequest = {
  provider: "bitbucket";
  method: "GET";
  url: string;
  status?: number;
  latencyMs: number;
};

export type BitbucketRepoIdentity = {
  workspace: string;
  repo: string;
};

type BitbucketPullRequestGetOptions = {
  repo?: string;
  raw?: boolean;
  cwd?: string;
  fetchImpl?: Fetch;
  debugRequests?: BitbucketDebugRequest[];
};

type BitbucketPullRequestListOptions = {
  repo?: string;
  limit?: number;
  cursor?: string;
  state?: string[];
  includeDrafts?: boolean;
  cwd?: string;
  fetchImpl?: Fetch;
  debugRequests?: BitbucketDebugRequest[];
};

type BitbucketPullRequestCommentsListOptions = {
  repo?: string;
  limit?: number;
  cursor?: string;
  cwd?: string;
  fetchImpl?: Fetch;
  debugRequests?: BitbucketDebugRequest[];
};

type BitbucketPullRequestFilesOptions = {
  repo?: string;
  limit?: number;
  cursor?: string;
  cwd?: string;
  fetchImpl?: Fetch;
  debugRequests?: BitbucketDebugRequest[];
};

type BitbucketPullRequestDiffOptions = {
  repo?: string;
  cwd?: string;
  fetchImpl?: Fetch;
  debugRequests?: BitbucketDebugRequest[];
};

type BitbucketPipelineListOptions = {
  repo?: string;
  branch?: string;
  limit?: number;
  cursor?: string;
  cwd?: string;
  fetchImpl?: Fetch;
  debugRequests?: BitbucketDebugRequest[];
};

type BitbucketPipelineLatestOptions = {
  repo?: string;
  branch?: string;
  cwd?: string;
  fetchImpl?: Fetch;
  debugRequests?: BitbucketDebugRequest[];
};

type BitbucketPipelineGetOptions = {
  repo?: string;
  cwd?: string;
  fetchImpl?: Fetch;
  debugRequests?: BitbucketDebugRequest[];
};

type BitbucketPipelineStepsListOptions = {
  repo?: string;
  limit?: number;
  cursor?: string;
  cwd?: string;
  fetchImpl?: Fetch;
  debugRequests?: BitbucketDebugRequest[];
};

type BitbucketPipelineLogOptions = {
  repo?: string;
  cwd?: string;
  fetchImpl?: Fetch;
  debugRequests?: BitbucketDebugRequest[];
};

export class BitbucketConfigurationError extends IreConfigurationError {
  readonly code = "AUTH_CONFIG_INCOMPLETE";
  readonly details: { provider: "bitbucket"; missing: string[] };

  constructor(missing: string[]) {
    super("Bitbucket auth configuration is incomplete");
    this.details = { provider: "bitbucket", missing };
  }
}

export class BitbucketRepoMissingError extends IreConfigurationError {
  readonly code = "BITBUCKET_REPO_MISSING";
  readonly details = {
    precedence: ["--repo", "config", "git-remote"],
    expected: "workspace/repo",
  };

  constructor() {
    super("Bitbucket repository identity could not be resolved");
  }
}

export class BitbucketRepoAmbiguousError extends IreAmbiguousError {
  readonly code = "BITBUCKET_REPO_AMBIGUOUS";
  readonly details: { remotes: BitbucketRepoIdentity[] };

  constructor(remotes: BitbucketRepoIdentity[]) {
    super("Multiple Bitbucket repository identities were found");
    this.details = { remotes };
  }
}

export class BitbucketRepoInvalidError extends IreConfigurationError {
  readonly code = "BITBUCKET_REPO_INVALID";
  readonly details: { repo: string; expected: "workspace/repo" };

  constructor(repo: string) {
    super("Bitbucket repository identity must use workspace/repo syntax");
    this.details = { repo, expected: "workspace/repo" };
  }
}

export class BitbucketPullRequestNotFoundError extends IreNotFoundError {
  readonly code = "BITBUCKET_PR_NOT_FOUND";
  readonly details: { id: number; repo: BitbucketRepoIdentity; status: 404 };

  constructor(id: number, repo: BitbucketRepoIdentity) {
    super(`Bitbucket pull request ${id} was not found`);
    this.details = { id, repo, status: 404 };
  }
}

export class BitbucketPipelineNotFoundError extends IreNotFoundError {
  readonly code = "BITBUCKET_PIPELINE_NOT_FOUND";
  readonly details: { repo: BitbucketRepoIdentity; branch?: string | null; uuid?: string; stepUuid?: string; status?: 404 };

  constructor(repo: BitbucketRepoIdentity, identity?: { branch?: string | null; uuid?: string; stepUuid?: string; status?: 404 }) {
    super("No Bitbucket pipeline resource was found");
    this.details = { repo, ...identity };
    if (identity?.branch === undefined && identity?.uuid === undefined) {
      this.details.branch = null;
    }
  }
}

export class BitbucketAuthenticationError extends IreAuthenticationError {
  readonly code = "BITBUCKET_AUTH_FAILED";
  readonly details: { status: 401 | 403 };

  constructor(status: 401 | 403) {
    super("Bitbucket authentication failed");
    this.details = { status };
  }
}

export class BitbucketProviderError extends IreProviderError {
  readonly code = "BITBUCKET_PROVIDER_ERROR";
  readonly details: { status?: number };

  constructor(message: string, status?: number) {
    super(message);
    this.details = status === undefined ? {} : { status };
  }
}

export class BitbucketNetworkError extends IreNetworkError {
  readonly code = "BITBUCKET_NETWORK_ERROR";

  constructor() {
    super("Bitbucket provider request failed");
  }
}

export class BitbucketNormalizedOutputError extends IreNormalizedOutputError {
  readonly code = "INTERNAL_ERROR";
  readonly details: Array<{ code: string; message: string; path: string }>;

  constructor(
    details: Array<{ code: string; message: string; path: string }>,
    message = "Normalized Bitbucket pull request output failed validation",
  ) {
    super(message);
    this.details = details;
  }
}

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

const normalizedPullRequestSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    description: z.string().nullable(),
    state: z.enum(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]),
    author: userSchema.nullable(),
    source: branchCommitSchema,
    destination: branchCommitSchema,
    reviewers: z.array(userSchema),
    created: z.iso.datetime(),
    updated: z.iso.datetime(),
  })
  .strict();

const branchSchema = z
  .object({
    branch: z.string(),
  })
  .strict();

const normalizedPullRequestSummarySchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    state: z.string(),
    draft: z.boolean(),
    author: userSchema.nullable(),
    source: branchSchema,
    destination: branchSchema,
    created: z.iso.datetime(),
    updated: z.iso.datetime(),
  })
  .strict();

const paginationSchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    nextCursor: z.string().nullable(),
    hasNextPage: z.boolean(),
  })
  .strict();

const normalizedPullRequestListSchema = z
  .object({
    prs: z.array(normalizedPullRequestSummarySchema),
    pagination: paginationSchema,
  })
  .strict();

const normalizedPipelineSchema = z
  .object({
    uuid: z.string(),
    buildNumber: z.number().int(),
    state: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "PAUSED"]),
    result: z.enum(["SUCCESSFUL", "FAILED", "ERROR", "STOPPED"]).nullable(),
    branch: z.string().nullable(),
    trigger: z.string().nullable(),
    created: z.iso.datetime(),
    completed: z.iso.datetime().nullable(),
    durationInSeconds: z.number().nullable(),
  })
  .strict();

const normalizedPipelineListSchema = z
  .object({
    pipelines: z.array(normalizedPipelineSchema),
    pagination: paginationSchema,
  })
  .strict();

const normalizedPipelineStepSchema = z
  .object({
    uuid: z.string(),
    name: z.string().nullable(),
    state: z.string(),
    result: z.string().nullable(),
    startedOn: z.iso.datetime().nullable(),
    completedOn: z.iso.datetime().nullable(),
    durationInSeconds: z.number().nullable(),
  })
  .strict();

const normalizedPipelineStepsListSchema = z
  .object({
    steps: z.array(normalizedPipelineStepSchema),
    pagination: paginationSchema,
  })
  .strict();

const normalizedPipelineLogSchema = z
  .object({
    log: z.string(),
  })
  .strict();

const normalizedPullRequestCommentInlineSchema = z
  .object({
    path: z.string(),
    from: z.number().int().nullable(),
    to: z.number().int().nullable(),
  })
  .strict();

const normalizedPullRequestCommentSchema = z
  .object({
    id: z.number().int(),
    author: userSchema.nullable(),
    body: z.string(),
    deleted: z.boolean(),
    inline: normalizedPullRequestCommentInlineSchema.nullable(),
    created: z.iso.datetime(),
    updated: z.iso.datetime(),
  })
  .strict();

const normalizedPullRequestCommentsListSchema = z
  .object({
    comments: z.array(normalizedPullRequestCommentSchema),
    pagination: paginationSchema,
  })
  .strict();

const normalizedPullRequestFileSchema = z
  .object({
    path: z.string(),
    previousPath: z.string().nullable(),
    status: z.enum(["added", "removed", "modified", "renamed"]),
  })
  .strict();

const normalizedPullRequestFilesSchema = z
  .object({
    files: z.array(normalizedPullRequestFileSchema),
    pagination: paginationSchema,
  })
  .strict();

const normalizedPullRequestDiffSchema = z
  .object({
    diff: z.string(),
  })
  .strict();

function basicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

type BitbucketAuthenticatedConfig = ResolvedConfig & {
  bitbucket: {
    email: { value: string };
    apiToken: { value: string };
  };
};

function assertBitbucketConfigComplete(config: ResolvedConfig): asserts config is BitbucketAuthenticatedConfig {
  const missing = [
    { name: "email", value: config.bitbucket.email.value },
    { name: "apiToken", value: config.bitbucket.apiToken.value },
  ]
    .filter((field) => field.value === null)
    .map((field) => field.name);

  if (missing.length > 0) {
    throw new BitbucketConfigurationError(missing);
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as JsonRecord;
}

function parseRepoIdentity(value: string): BitbucketRepoIdentity | undefined {
  const match = /^([^\s/]+)\/([^\s/]+)$/.exec(value.trim());

  if (!match) {
    return undefined;
  }

  return {
    workspace: match[1],
    repo: match[2].replace(/\.git$/i, ""),
  };
}

export function parseBitbucketRemoteUrl(url: string): BitbucketRepoIdentity | undefined {
  const trimmed = url.trim();
  const sshMatch = /^(?:ssh:\/\/)?git@bitbucket\.org[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (sshMatch) {
    return { workspace: sshMatch[1], repo: sshMatch[2] };
  }

  const httpsMatch = /^https:\/\/(?:[^@/]+@)?bitbucket\.org\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (httpsMatch) {
    return { workspace: httpsMatch[1], repo: httpsMatch[2] };
  }

  return undefined;
}

function uniqueIdentities(identities: BitbucketRepoIdentity[]): BitbucketRepoIdentity[] {
  const seen = new Set<string>();
  const unique: BitbucketRepoIdentity[] = [];

  for (const identity of identities) {
    const key = `${identity.workspace}/${identity.repo}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(identity);
    }
  }

  return unique;
}

function inferRepoFromGitRemotes(cwd: string): BitbucketRepoIdentity | undefined {
  let output: string;

  try {
    output = execFileSync("git", ["remote", "-v"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }

  const identities = uniqueIdentities(
    output
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[1])
      .filter((url): url is string => url !== undefined)
      .map(parseBitbucketRemoteUrl)
      .filter((identity): identity is BitbucketRepoIdentity => identity !== undefined),
  );

  if (identities.length > 1) {
    throw new BitbucketRepoAmbiguousError(identities);
  }

  return identities[0];
}

export function resolveBitbucketRepo(
  config: ResolvedConfig,
  options: { repo?: string; cwd?: string } = {},
): BitbucketRepoIdentity {
  if (options.repo !== undefined) {
    const explicit = parseRepoIdentity(options.repo);
    if (explicit === undefined) {
      throw new BitbucketRepoInvalidError(options.repo);
    }
    return explicit;
  }

  const workspace = config.bitbucket.workspace.value;
  const repo = config.bitbucket.repo.value;
  if (workspace !== null && repo !== null) {
    return { workspace, repo };
  }

  const inferred = inferRepoFromGitRemotes(options.cwd ?? process.cwd());
  if (inferred !== undefined) {
    return inferred;
  }

  throw new BitbucketRepoMissingError();
}

function userField(value: unknown): z.infer<typeof userSchema> | null {
  const user = asRecord(value);
  if (user === undefined) {
    return null;
  }

  return {
    accountId: typeof user.account_id === "string" ? user.account_id : null,
    displayName: user.display_name,
  } as z.infer<typeof userSchema>;
}

function branchField(value: unknown): z.infer<typeof branchSchema> {
  const endpoint = asRecord(value);
  const branch = asRecord(endpoint?.branch);

  return {
    branch: branch?.name,
  } as z.infer<typeof branchSchema>;
}

function branchCommitField(value: unknown): z.infer<typeof branchCommitSchema> {
  const endpoint = asRecord(value);
  const commit = asRecord(endpoint?.commit);

  return {
    ...branchField(value),
    commit: commit?.hash,
  } as z.infer<typeof branchCommitSchema>;
}

function normalizeTimestamp(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function normalizePullRequest(providerPullRequest: unknown): z.infer<typeof normalizedPullRequestSchema> {
  const pullRequest = asRecord(providerPullRequest);
  const reviewers = Array.isArray(pullRequest?.reviewers)
    ? pullRequest.reviewers.map(userField).filter((user) => user !== null)
    : [];
  const normalized = {
    id: pullRequest?.id,
    title: pullRequest?.title,
    description:
      typeof pullRequest?.description === "string"
        ? pullRequest.description
        : pullRequest?.description === null
          ? null
          : null,
    state: pullRequest?.state,
    author: userField(pullRequest?.author),
    source: branchCommitField(pullRequest?.source),
    destination: branchCommitField(pullRequest?.destination),
    reviewers,
    created: normalizeTimestamp(pullRequest?.created_on),
    updated: normalizeTimestamp(pullRequest?.updated_on),
  };

  const parsedResult = normalizedPullRequestSchema.safeParse(normalized);
  if (!parsedResult.success) {
    throw new BitbucketNormalizedOutputError(
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
    );
  }

  return parsedResult.data;
}

function normalizePullRequestSummary(providerPullRequest: unknown): z.infer<typeof normalizedPullRequestSummarySchema> {
  const pullRequest = asRecord(providerPullRequest);

  return {
    id: pullRequest?.id,
    title: pullRequest?.title,
    state: pullRequest?.state,
    draft: pullRequest?.draft === true,
    author: userField(pullRequest?.author),
    source: branchField(pullRequest?.source),
    destination: branchField(pullRequest?.destination),
    created: normalizeTimestamp(pullRequest?.created_on),
    updated: normalizeTimestamp(pullRequest?.updated_on),
  } as z.infer<typeof normalizedPullRequestSummarySchema>;
}

function paginationFromProvider(page: JsonRecord | undefined, limit: number): z.infer<typeof paginationSchema> {
  const nextCursor = typeof page?.next === "string" ? page.next : null;

  return {
    limit,
    nextCursor,
    hasNextPage: nextCursor !== null,
  };
}

function normalizePullRequestList(providerPage: unknown, limit: number): z.infer<typeof normalizedPullRequestListSchema> {
  const page = asRecord(providerPage);
  const values = Array.isArray(page?.values) ? page.values : [];
  const normalized = {
    prs: values.map(normalizePullRequestSummary),
    pagination: paginationFromProvider(page, limit),
  };

  const parsedResult = normalizedPullRequestListSchema.safeParse(normalized);
  if (!parsedResult.success) {
    throw new BitbucketNormalizedOutputError(
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
      "Normalized Bitbucket pull request list output failed validation",
    );
  }

  return parsedResult.data;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizePipeline(providerPipeline: unknown): z.infer<typeof normalizedPipelineSchema> {
  const pipeline = asRecord(providerPipeline);
  const state = asRecord(pipeline?.state);
  const result = asRecord(state?.result);
  const target = asRecord(pipeline?.target);
  const trigger = asRecord(pipeline?.trigger);
  const normalized = {
    uuid: pipeline?.uuid,
    buildNumber: pipeline?.build_number,
    state: state?.name,
    result: result?.name ?? null,
    branch: stringField(target?.ref_name),
    trigger: stringField(trigger?.name),
    created: normalizeTimestamp(pipeline?.created_on),
    completed: pipeline?.completed_on === undefined || pipeline.completed_on === null ? null : normalizeTimestamp(pipeline.completed_on),
    durationInSeconds: pipeline?.duration_in_seconds === undefined || pipeline.duration_in_seconds === null ? null : pipeline.duration_in_seconds,
  };

  const parsedResult = normalizedPipelineSchema.safeParse(normalized);
  if (!parsedResult.success) {
    throw new BitbucketNormalizedOutputError(
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
      "Normalized Bitbucket pipeline output failed validation",
    );
  }

  return parsedResult.data;
}

function normalizePipelineList(providerPage: unknown, limit: number): z.infer<typeof normalizedPipelineListSchema> {
  const page = asRecord(providerPage);
  const values = Array.isArray(page?.values) ? page.values : [];
  const normalized = {
    pipelines: values.map(normalizePipeline),
    pagination: paginationFromProvider(page, limit),
  };

  const parsedResult = normalizedPipelineListSchema.safeParse(normalized);
  if (!parsedResult.success) {
    throw new BitbucketNormalizedOutputError(
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
      "Normalized Bitbucket pipeline list output failed validation",
    );
  }

  return parsedResult.data;
}

function normalizeNullableTimestamp(value: unknown): unknown {
  return value === undefined || value === null ? null : normalizeTimestamp(value);
}

function normalizePipelineStep(providerStep: unknown): z.infer<typeof normalizedPipelineStepSchema> {
  const step = asRecord(providerStep);
  const state = asRecord(step?.state);
  const result = asRecord(state?.result);
  const normalized = {
    uuid: step?.uuid,
    name: stringField(step?.name),
    state: state?.name,
    result: result?.name ?? null,
    startedOn: normalizeNullableTimestamp(step?.started_on),
    completedOn: normalizeNullableTimestamp(step?.completed_on),
    durationInSeconds: step?.duration_in_seconds === undefined || step.duration_in_seconds === null ? null : step.duration_in_seconds,
  };

  const parsedResult = normalizedPipelineStepSchema.safeParse(normalized);
  if (!parsedResult.success) {
    throw new BitbucketNormalizedOutputError(
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
      "Normalized Bitbucket pipeline step output failed validation",
    );
  }

  return parsedResult.data;
}

function normalizePipelineStepsList(providerPage: unknown, limit: number): z.infer<typeof normalizedPipelineStepsListSchema> {
  const page = asRecord(providerPage);
  const values = Array.isArray(page?.values) ? page.values : [];
  const normalized = {
    steps: values.map(normalizePipelineStep),
    pagination: paginationFromProvider(page, limit),
  };

  const parsedResult = normalizedPipelineStepsListSchema.safeParse(normalized);
  if (!parsedResult.success) {
    throw new BitbucketNormalizedOutputError(
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
      "Normalized Bitbucket pipeline steps list output failed validation",
    );
  }

  return parsedResult.data;
}

function normalizePipelineLog(log: string): z.infer<typeof normalizedPipelineLogSchema> {
  const parsedResult = normalizedPipelineLogSchema.safeParse({ log });
  if (!parsedResult.success) {
    throw new BitbucketNormalizedOutputError(
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
      "Normalized Bitbucket pipeline log output failed validation",
    );
  }

  return parsedResult.data;
}

function normalizeCommentInline(value: unknown): z.infer<typeof normalizedPullRequestCommentInlineSchema> | null {
  const inline = asRecord(value);
  if (inline === undefined) {
    return null;
  }

  return {
    path: inline.path,
    from: inline.from === null ? null : inline.from,
    to: inline.to === null ? null : inline.to,
  } as z.infer<typeof normalizedPullRequestCommentInlineSchema>;
}

function normalizeCommentBody(value: unknown): string {
  const content = asRecord(value);
  return typeof content?.raw === "string" ? content.raw : "";
}

function normalizePullRequestComment(providerComment: unknown): z.infer<typeof normalizedPullRequestCommentSchema> {
  const comment = asRecord(providerComment);

  return {
    id: comment?.id,
    author: userField(comment?.user),
    body: normalizeCommentBody(comment?.content),
    deleted: comment?.deleted ?? false,
    inline: normalizeCommentInline(comment?.inline),
    created: normalizeTimestamp(comment?.created_on),
    updated: normalizeTimestamp(comment?.updated_on),
  } as z.infer<typeof normalizedPullRequestCommentSchema>;
}

function normalizePullRequestCommentsList(providerPage: unknown, limit: number): z.infer<typeof normalizedPullRequestCommentsListSchema> {
  const page = asRecord(providerPage);
  const values = Array.isArray(page?.values) ? page.values : [];
  const normalized = {
    comments: values.map(normalizePullRequestComment),
    pagination: paginationFromProvider(page, limit),
  };

  const parsedResult = normalizedPullRequestCommentsListSchema.safeParse(normalized);
  if (!parsedResult.success) {
    throw new BitbucketNormalizedOutputError(
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
      "Normalized Bitbucket pull request comments output failed validation",
    );
  }

  return parsedResult.data;
}

function filePath(value: unknown): string | undefined {
  const file = asRecord(value);
  return typeof file?.path === "string" ? file.path : undefined;
}

function normalizePullRequestFile(providerFile: unknown): z.infer<typeof normalizedPullRequestFileSchema> {
  const diffstat = asRecord(providerFile);
  const oldPath = filePath(diffstat?.old);
  const newPath = filePath(diffstat?.new);

  return {
    path: newPath ?? oldPath,
    previousPath: newPath !== undefined && oldPath !== undefined && oldPath !== newPath ? oldPath : null,
    status: diffstat?.status,
  } as z.infer<typeof normalizedPullRequestFileSchema>;
}

function normalizePullRequestFiles(providerPage: unknown, limit: number): z.infer<typeof normalizedPullRequestFilesSchema> {
  const page = asRecord(providerPage);
  const values = Array.isArray(page?.values) ? page.values : [];
  const normalized = {
    files: values.map(normalizePullRequestFile),
    pagination: paginationFromProvider(page, limit),
  };

  const parsedResult = normalizedPullRequestFilesSchema.safeParse(normalized);
  if (!parsedResult.success) {
    throw new BitbucketNormalizedOutputError(
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
      "Normalized Bitbucket pull request files output failed validation",
    );
  }

  return parsedResult.data;
}

function normalizePullRequestDiff(diff: string): z.infer<typeof normalizedPullRequestDiffSchema> {
  const parsedResult = normalizedPullRequestDiffSchema.safeParse({ diff });
  if (!parsedResult.success) {
    throw new BitbucketNormalizedOutputError(
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
      "Normalized Bitbucket pull request diff output failed validation",
    );
  }

  return parsedResult.data;
}

async function readProviderJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new BitbucketProviderError(
      "Bitbucket provider response was invalid",
      response.status,
    );
  }
}

function pullRequestsUrl(
  repo: BitbucketRepoIdentity,
  limit: number,
  cursor?: string,
  states?: string[],
  includeDrafts?: boolean,
): string {
  if (cursor !== undefined) {
    return cursor;
  }

  const url = new URL(
    `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repo)}/pullrequests`,
  );
  url.searchParams.set("pagelen", String(limit));
  if (includeDrafts) {
    // A `q` filter disables Bitbucket's implicit `state=OPEN` default and its
    // implicit draft hiding, so the state constraint and both draft values must
    // be spelled out here or the result broadens to every state.
    const effectiveStates = states && states.length > 0 ? states : ["OPEN"];
    const statePredicate = effectiveStates.map((state) => `state="${state}"`).join(" OR ");
    url.searchParams.set("q", `(${statePredicate}) AND (draft=true OR draft=false)`);
  } else {
    for (const state of states ?? []) {
      url.searchParams.append("state", state);
    }
  }
  return String(url);
}

function pullRequestCommentsUrl(repo: BitbucketRepoIdentity, id: number, limit: number, cursor?: string): string {
  if (cursor !== undefined) {
    return cursor;
  }

  const url = new URL(
    `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repo)}/pullrequests/${id}/comments`,
  );
  url.searchParams.set("pagelen", String(limit));
  return String(url);
}

function pullRequestFilesUrl(repo: BitbucketRepoIdentity, id: number, limit: number, cursor?: string): string {
  if (cursor !== undefined) {
    return cursor;
  }

  const url = new URL(
    `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repo)}/pullrequests/${id}/diffstat`,
  );
  url.searchParams.set("pagelen", String(limit));
  return String(url);
}

function pullRequestDiffUrl(repo: BitbucketRepoIdentity, id: number): string {
  return `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repo)}/pullrequests/${id}/diff`;
}

function pipelineUrl(repo: BitbucketRepoIdentity, uuid: string): string {
  return `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repo)}/pipelines/${encodeURIComponent(uuid)}`;
}

function pipelineStepsUrl(repo: BitbucketRepoIdentity, uuid: string, limit: number, cursor?: string): string {
  if (cursor !== undefined) {
    return cursor;
  }

  const url = new URL(
    `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repo)}/pipelines/${encodeURIComponent(uuid)}/steps/`,
  );
  url.searchParams.set("pagelen", String(limit));
  return String(url);
}

function pipelineLogUrl(repo: BitbucketRepoIdentity, pipelineUuid: string, stepUuid: string): string {
  return `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repo)}/pipelines/${encodeURIComponent(pipelineUuid)}/steps/${encodeURIComponent(stepUuid)}/log`;
}

function pipelinesUrl(repo: BitbucketRepoIdentity, limit: number, branch?: string, cursor?: string): string {
  if (cursor !== undefined) {
    return cursor;
  }

  const url = new URL(
    `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repo)}/pipelines/`,
  );
  url.searchParams.set("pagelen", String(limit));
  if (branch !== undefined) {
    url.searchParams.set("target.ref_name", branch);
  }
  return String(url);
}

async function fetchBitbucketText(
  config: BitbucketAuthenticatedConfig,
  url: string,
  options: { fetchImpl?: Fetch; debugRequests?: BitbucketDebugRequest[] } = {},
): Promise<string> {
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "text/plain",
        authorization: basicAuthorization(
          config.bitbucket.email.value,
          config.bitbucket.apiToken.value,
        ),
      },
    });
  } catch {
    options.debugRequests?.push({ provider: "bitbucket", method: "GET", url, latencyMs: Date.now() - startedAt });
    throw new BitbucketNetworkError();
  }

  options.debugRequests?.push({ provider: "bitbucket", method: "GET", url, status: response.status, latencyMs: Date.now() - startedAt });

  if (response.status === 401 || response.status === 403) {
    throw new BitbucketAuthenticationError(response.status);
  }

  if (!response.ok) {
    throw new BitbucketProviderError("Bitbucket provider request failed", response.status);
  }

  return response.text();
}

async function fetchBitbucketJson(
  config: BitbucketAuthenticatedConfig,
  url: string,
  options: { fetchImpl?: Fetch; debugRequests?: BitbucketDebugRequest[] } = {},
): Promise<unknown> {
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: basicAuthorization(
          config.bitbucket.email.value,
          config.bitbucket.apiToken.value,
        ),
      },
    });
  } catch {
    options.debugRequests?.push({
      provider: "bitbucket",
      method: "GET",
      url,
      latencyMs: Date.now() - startedAt,
    });
    throw new BitbucketNetworkError();
  }

  options.debugRequests?.push({
    provider: "bitbucket",
    method: "GET",
    url,
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });

  if (response.status === 401 || response.status === 403) {
    throw new BitbucketAuthenticationError(response.status);
  }

  if (!response.ok) {
    throw new BitbucketProviderError("Bitbucket provider request failed", response.status);
  }

  return readProviderJson(response);
}

export async function listBitbucketPipelines(
  config: ResolvedConfig,
  options: BitbucketPipelineListOptions = {},
): Promise<{ data: unknown; repo: BitbucketRepoIdentity }> {
  assertBitbucketConfigComplete(config);

  const repo = resolveBitbucketRepo(config, {
    repo: options.repo,
    cwd: options.cwd,
  });
  const limit = Math.min(options.limit ?? 50, 100);
  const url = pipelinesUrl(repo, limit, options.branch, options.cursor);
  const body = await fetchBitbucketJson(config, url, {
    fetchImpl: options.fetchImpl,
    debugRequests: options.debugRequests,
  });

  return { data: normalizePipelineList(body, limit), repo };
}

export async function getBitbucketPipeline(
  config: ResolvedConfig,
  uuid: string,
  options: BitbucketPipelineGetOptions = {},
): Promise<{ data: unknown; repo: BitbucketRepoIdentity }> {
  assertBitbucketConfigComplete(config);

  const repo = resolveBitbucketRepo(config, {
    repo: options.repo,
    cwd: options.cwd,
  });
  const url = pipelineUrl(repo, uuid);

  try {
    const body = await fetchBitbucketJson(config, url, {
      fetchImpl: options.fetchImpl,
      debugRequests: options.debugRequests,
    });
    return { data: normalizePipeline(body), repo };
  } catch (error) {
    if (error instanceof BitbucketProviderError && error.details.status === 404) {
      throw new BitbucketPipelineNotFoundError(repo, { uuid, status: 404 });
    }
    throw error;
  }
}

export async function getBitbucketPipelineLog(
  config: ResolvedConfig,
  pipelineUuid: string,
  stepUuid: string,
  options: BitbucketPipelineLogOptions = {},
): Promise<{ data: unknown; repo: BitbucketRepoIdentity }> {
  assertBitbucketConfigComplete(config);

  const repo = resolveBitbucketRepo(config, {
    repo: options.repo,
    cwd: options.cwd,
  });
  const url = pipelineLogUrl(repo, pipelineUuid, stepUuid);

  try {
    const log = await fetchBitbucketText(config, url, {
      fetchImpl: options.fetchImpl,
      debugRequests: options.debugRequests,
    });
    return { data: normalizePipelineLog(log), repo };
  } catch (error) {
    if (error instanceof BitbucketProviderError && error.details.status === 404) {
      throw new BitbucketPipelineNotFoundError(repo, { uuid: pipelineUuid, stepUuid, status: 404 });
    }
    throw error;
  }
}

export async function listBitbucketPipelineSteps(
  config: ResolvedConfig,
  uuid: string,
  options: BitbucketPipelineStepsListOptions = {},
): Promise<{ data: unknown; repo: BitbucketRepoIdentity }> {
  assertBitbucketConfigComplete(config);

  const repo = resolveBitbucketRepo(config, {
    repo: options.repo,
    cwd: options.cwd,
  });
  const limit = Math.min(options.limit ?? 50, 100);
  const url = pipelineStepsUrl(repo, uuid, limit, options.cursor);

  try {
    const body = await fetchBitbucketJson(config, url, {
      fetchImpl: options.fetchImpl,
      debugRequests: options.debugRequests,
    });
    return { data: normalizePipelineStepsList(body, limit), repo };
  } catch (error) {
    if (error instanceof BitbucketProviderError && error.details.status === 404) {
      throw new BitbucketPipelineNotFoundError(repo, { uuid, status: 404 });
    }
    throw error;
  }
}

export async function getLatestBitbucketPipeline(
  config: ResolvedConfig,
  options: BitbucketPipelineLatestOptions = {},
): Promise<{ data: unknown; repo: BitbucketRepoIdentity }> {
  assertBitbucketConfigComplete(config);

  const repo = resolveBitbucketRepo(config, {
    repo: options.repo,
    cwd: options.cwd,
  });
  const url = pipelinesUrl(repo, 1, options.branch);
  const body = await fetchBitbucketJson(config, url, {
    fetchImpl: options.fetchImpl,
    debugRequests: options.debugRequests,
  });
  const page = asRecord(body);
  const values = Array.isArray(page?.values) ? page.values : [];

  if (values.length === 0) {
    throw new BitbucketPipelineNotFoundError(repo, { branch: options.branch ?? null });
  }

  return { data: normalizePipeline(values[0]), repo };
}

export async function listBitbucketPullRequests(
  config: ResolvedConfig,
  options: BitbucketPullRequestListOptions = {},
): Promise<{ data: unknown; repo: BitbucketRepoIdentity }> {
  assertBitbucketConfigComplete(config);

  const repo = resolveBitbucketRepo(config, {
    repo: options.repo,
    cwd: options.cwd,
  });
  const limit = options.limit ?? 50;
  const url = pullRequestsUrl(repo, limit, options.cursor, options.state, options.includeDrafts);
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: basicAuthorization(
          config.bitbucket.email.value,
          config.bitbucket.apiToken.value,
        ),
      },
    });
  } catch {
    options.debugRequests?.push({
      provider: "bitbucket",
      method: "GET",
      url,
      latencyMs: Date.now() - startedAt,
    });
    throw new BitbucketNetworkError();
  }

  options.debugRequests?.push({
    provider: "bitbucket",
    method: "GET",
    url,
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });

  if (response.status === 401 || response.status === 403) {
    throw new BitbucketAuthenticationError(response.status);
  }

  if (!response.ok) {
    throw new BitbucketProviderError(
      "Bitbucket provider request failed",
      response.status,
    );
  }

  const body = await readProviderJson(response);
  return { data: normalizePullRequestList(body, limit), repo };
}

export async function listBitbucketPullRequestComments(
  config: ResolvedConfig,
  id: number,
  options: BitbucketPullRequestCommentsListOptions = {},
): Promise<{ data: unknown; repo: BitbucketRepoIdentity }> {
  assertBitbucketConfigComplete(config);

  const repo = resolveBitbucketRepo(config, {
    repo: options.repo,
    cwd: options.cwd,
  });
  const limit = options.limit ?? 50;
  const url = pullRequestCommentsUrl(repo, id, limit, options.cursor);
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: basicAuthorization(
          config.bitbucket.email.value,
          config.bitbucket.apiToken.value,
        ),
      },
    });
  } catch {
    options.debugRequests?.push({
      provider: "bitbucket",
      method: "GET",
      url,
      latencyMs: Date.now() - startedAt,
    });
    throw new BitbucketNetworkError();
  }

  options.debugRequests?.push({
    provider: "bitbucket",
    method: "GET",
    url,
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });

  if (response.status === 404) {
    throw new BitbucketPullRequestNotFoundError(id, repo);
  }

  if (response.status === 401 || response.status === 403) {
    throw new BitbucketAuthenticationError(response.status);
  }

  if (!response.ok) {
    throw new BitbucketProviderError(
      "Bitbucket provider request failed",
      response.status,
    );
  }

  const body = await readProviderJson(response);
  return { data: normalizePullRequestCommentsList(body, limit), repo };
}

export async function listBitbucketPullRequestFiles(
  config: ResolvedConfig,
  id: number,
  options: BitbucketPullRequestFilesOptions = {},
): Promise<{ data: unknown; repo: BitbucketRepoIdentity }> {
  assertBitbucketConfigComplete(config);

  const repo = resolveBitbucketRepo(config, {
    repo: options.repo,
    cwd: options.cwd,
  });
  const limit = options.limit ?? 50;
  const url = pullRequestFilesUrl(repo, id, limit, options.cursor);
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: basicAuthorization(
          config.bitbucket.email.value,
          config.bitbucket.apiToken.value,
        ),
      },
    });
  } catch {
    options.debugRequests?.push({
      provider: "bitbucket",
      method: "GET",
      url,
      latencyMs: Date.now() - startedAt,
    });
    throw new BitbucketNetworkError();
  }

  options.debugRequests?.push({
    provider: "bitbucket",
    method: "GET",
    url,
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });

  if (response.status === 404) {
    throw new BitbucketPullRequestNotFoundError(id, repo);
  }

  if (response.status === 401 || response.status === 403) {
    throw new BitbucketAuthenticationError(response.status);
  }

  if (!response.ok) {
    throw new BitbucketProviderError(
      "Bitbucket provider request failed",
      response.status,
    );
  }

  const body = await readProviderJson(response);
  return { data: normalizePullRequestFiles(body, limit), repo };
}

export async function getBitbucketPullRequestDiff(
  config: ResolvedConfig,
  id: number,
  options: BitbucketPullRequestDiffOptions = {},
): Promise<{ data: unknown; repo: BitbucketRepoIdentity }> {
  assertBitbucketConfigComplete(config);

  const repo = resolveBitbucketRepo(config, {
    repo: options.repo,
    cwd: options.cwd,
  });
  const url = pullRequestDiffUrl(repo, id);
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "text/plain",
        authorization: basicAuthorization(
          config.bitbucket.email.value,
          config.bitbucket.apiToken.value,
        ),
      },
    });
  } catch {
    options.debugRequests?.push({
      provider: "bitbucket",
      method: "GET",
      url,
      latencyMs: Date.now() - startedAt,
    });
    throw new BitbucketNetworkError();
  }

  options.debugRequests?.push({
    provider: "bitbucket",
    method: "GET",
    url,
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });

  if (response.status === 404) {
    throw new BitbucketPullRequestNotFoundError(id, repo);
  }

  if (response.status === 401 || response.status === 403) {
    throw new BitbucketAuthenticationError(response.status);
  }

  if (!response.ok) {
    throw new BitbucketProviderError(
      "Bitbucket provider request failed",
      response.status,
    );
  }

  const body = await response.text();
  return { data: normalizePullRequestDiff(body), repo };
}

export async function getBitbucketPullRequest(
  config: ResolvedConfig,
  id: number,
  options: BitbucketPullRequestGetOptions = {},
): Promise<{ data: unknown; repo: BitbucketRepoIdentity }> {
  assertBitbucketConfigComplete(config);

  const repo = resolveBitbucketRepo(config, {
    repo: options.repo,
    cwd: options.cwd,
  });
  const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repo)}/pullrequests/${id}`;
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: basicAuthorization(
          config.bitbucket.email.value,
          config.bitbucket.apiToken.value,
        ),
      },
    });
  } catch {
    options.debugRequests?.push({
      provider: "bitbucket",
      method: "GET",
      url,
      latencyMs: Date.now() - startedAt,
    });
    throw new BitbucketNetworkError();
  }

  options.debugRequests?.push({
    provider: "bitbucket",
    method: "GET",
    url,
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });

  if (response.status === 404) {
    throw new BitbucketPullRequestNotFoundError(id, repo);
  }

  if (response.status === 401 || response.status === 403) {
    throw new BitbucketAuthenticationError(response.status);
  }

  if (!response.ok) {
    throw new BitbucketProviderError(
      "Bitbucket provider request failed",
      response.status,
    );
  }

  const body = await readProviderJson(response);
  return { data: options.raw ? body : normalizePullRequest(body), repo };
}

export const bitbucketProvider: Provider = {
  name: "bitbucket",
  authCheck: (config, options) => checkProviderAuth(config, "bitbucket", options),
  configSlice: (config) => [
    { name: "workspace", value: config.bitbucket.workspace.value },
    { name: "email", value: config.bitbucket.email.value },
    { name: "apiToken", value: config.bitbucket.apiToken.value },
  ],
};
