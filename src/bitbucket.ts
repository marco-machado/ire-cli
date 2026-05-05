import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { ResolvedConfig } from "./config.js";

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
  cwd?: string;
  fetchImpl?: Fetch;
  debugRequests?: BitbucketDebugRequest[];
};

export class BitbucketConfigurationError extends Error {
  readonly code = "AUTH_CONFIG_INCOMPLETE";
  readonly details: { provider: "bitbucket"; missing: string[] };

  constructor(missing: string[]) {
    super("Bitbucket auth configuration is incomplete");
    this.details = { provider: "bitbucket", missing };
  }
}

export class BitbucketRepoMissingError extends Error {
  readonly code = "BITBUCKET_REPO_MISSING";
  readonly details = {
    precedence: ["--repo", "config", "git-remote"],
    expected: "workspace/repo",
  };

  constructor() {
    super("Bitbucket repository identity could not be resolved");
  }
}

export class BitbucketRepoAmbiguousError extends Error {
  readonly code = "BITBUCKET_REPO_AMBIGUOUS";
  readonly details: { remotes: BitbucketRepoIdentity[] };

  constructor(remotes: BitbucketRepoIdentity[]) {
    super("Multiple Bitbucket repository identities were found");
    this.details = { remotes };
  }
}

export class BitbucketRepoInvalidError extends Error {
  readonly code = "BITBUCKET_REPO_INVALID";
  readonly details: { repo: string; expected: "workspace/repo" };

  constructor(repo: string) {
    super("Bitbucket repository identity must use workspace/repo syntax");
    this.details = { repo, expected: "workspace/repo" };
  }
}

export class BitbucketPullRequestNotFoundError extends Error {
  readonly code = "BITBUCKET_PR_NOT_FOUND";
  readonly details: { id: number; repo: BitbucketRepoIdentity; status: 404 };

  constructor(id: number, repo: BitbucketRepoIdentity) {
    super(`Bitbucket pull request ${id} was not found`);
    this.details = { id, repo, status: 404 };
  }
}

export class BitbucketAuthenticationError extends Error {
  readonly code = "BITBUCKET_AUTH_FAILED";
  readonly details: { status: 401 | 403 };

  constructor(status: 401 | 403) {
    super("Bitbucket authentication failed");
    this.details = { status };
  }
}

export class BitbucketProviderError extends Error {
  readonly code = "BITBUCKET_PROVIDER_ERROR";
  readonly details: { status?: number };

  constructor(message: string, status?: number) {
    super(message);
    this.details = status === undefined ? {} : { status };
  }
}

export class BitbucketNetworkError extends Error {
  readonly code = "BITBUCKET_NETWORK_ERROR";

  constructor() {
    super("Bitbucket provider request failed");
  }
}

export class BitbucketNormalizedOutputError extends Error {
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
    accountId: z.string(),
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

function basicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function assertBitbucketConfigComplete(config: ResolvedConfig): asserts config is
  ResolvedConfig & {
    bitbucket: { username: { value: string }; appPassword: { value: string } };
  } {
  const missing = [
    { name: "username", value: config.bitbucket.username.value },
    { name: "appPassword", value: config.bitbucket.appPassword.value },
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
    accountId: user.account_id,
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
    author: userField(pullRequest?.author),
    source: branchField(pullRequest?.source),
    destination: branchField(pullRequest?.destination),
    created: normalizeTimestamp(pullRequest?.created_on),
    updated: normalizeTimestamp(pullRequest?.updated_on),
  } as z.infer<typeof normalizedPullRequestSummarySchema>;
}

function normalizePullRequestList(providerPage: unknown, limit: number): z.infer<typeof normalizedPullRequestListSchema> {
  const page = asRecord(providerPage);
  const values = Array.isArray(page?.values) ? page.values : [];
  const nextCursor = typeof page?.next === "string" ? page.next : null;
  const normalized = {
    prs: values.map(normalizePullRequestSummary),
    pagination: {
      limit,
      nextCursor,
      hasNextPage: nextCursor !== null,
    },
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

function pullRequestsUrl(repo: BitbucketRepoIdentity, limit: number, cursor?: string): string {
  if (cursor !== undefined) {
    return cursor;
  }

  const url = new URL(
    `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repo)}/pullrequests`,
  );
  url.searchParams.set("pagelen", String(limit));
  return String(url);
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
  const url = pullRequestsUrl(repo, limit, options.cursor);
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: basicAuthorization(
          config.bitbucket.username.value,
          config.bitbucket.appPassword.value,
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
          config.bitbucket.username.value,
          config.bitbucket.appPassword.value,
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
