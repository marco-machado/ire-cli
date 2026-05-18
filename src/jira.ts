import { z } from "zod";
import { checkProviderAuth } from "./auth.js";
import type { ResolvedConfig } from "./config.js";
import {
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

export type JiraDebugRequest = {
  provider: "jira";
  method: "GET";
  url: string;
  status?: number;
  latencyMs: number;
};

type JiraIssueGetOptions = {
  raw?: boolean;
  fetchImpl?: Fetch;
  debugRequests?: JiraDebugRequest[];
};

type JiraIssueSearchOptions = {
  jql: string;
  limit?: number;
  cursor?: string;
  fetchImpl?: Fetch;
  debugRequests?: JiraDebugRequest[];
};

type JiraIssueCommentsListOptions = {
  limit?: number;
  cursor?: string;
  raw?: boolean;
  fetchImpl?: Fetch;
  debugRequests?: JiraDebugRequest[];
};

export class JiraConfigurationError extends IreConfigurationError {
  readonly code = "AUTH_CONFIG_INCOMPLETE";
  readonly details: {
    provider: "jira";
    missing: string[];
  };

  constructor(missing: string[]) {
    super("Jira auth configuration is incomplete");
    this.details = { provider: "jira", missing };
  }
}

export class JiraIssueNotFoundError extends IreNotFoundError {
  readonly code = "JIRA_ISSUE_NOT_FOUND";
  readonly details: {
    key: string;
    status: 404;
  };

  constructor(key: string) {
    super(`Jira issue ${key} was not found`);
    this.details = { key, status: 404 };
  }
}

export class JiraAuthenticationError extends IreAuthenticationError {
  readonly code = "JIRA_AUTH_FAILED";
  readonly details: {
    status: 401 | 403;
  };

  constructor(status: 401 | 403) {
    super("Jira authentication failed");
    this.details = { status };
  }
}

export class JiraProviderError extends IreProviderError {
  readonly code = "JIRA_PROVIDER_ERROR";
  readonly details: {
    status?: number;
  };

  constructor(message: string, status?: number) {
    super(message);
    this.details = status === undefined ? {} : { status };
  }
}

export class JiraNetworkError extends IreNetworkError {
  readonly code = "JIRA_NETWORK_ERROR";

  constructor() {
    super("Jira provider request failed");
  }
}

export class JiraNormalizedOutputError extends IreNormalizedOutputError {
  readonly code = "INTERNAL_ERROR";
  readonly details: Array<{ code: string; message: string; path: string }>;

  constructor(
    details: Array<{ code: string; message: string; path: string }>,
    message = "Normalized Jira issue output failed validation",
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

const normalizedJiraIssueSchema = z
  .object({
    key: z.string(),
    summary: z.string(),
    description: z.string().nullable().optional(),
    status: z.string(),
    issueType: z.string(),
    priority: z.string().nullable().optional(),
    project: z
      .object({
        key: z.string(),
        name: z.string(),
      })
      .strict(),
    assignee: userSchema.nullable().optional(),
    reporter: userSchema.nullable().optional(),
    labels: z.array(z.string()),
    created: z.iso.datetime(),
    updated: z.iso.datetime(),
  })
  .strict();

const normalizedJiraIssueSummarySchema = z
  .object({
    key: z.string(),
    summary: z.string(),
    status: z.string(),
    issueType: z.string(),
    priority: z.string().nullable().optional(),
    assignee: userSchema.nullable().optional(),
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

const normalizedJiraIssueSearchSchema = z
  .object({
    issues: z.array(normalizedJiraIssueSummarySchema),
    pagination: paginationSchema,
  })
  .strict();

const normalizedJiraCommentSchema = z
  .object({
    id: z.string(),
    author: userSchema.nullable(),
    body: z.string(),
    created: z.iso.datetime(),
    updated: z.iso.datetime(),
  })
  .strict();

const normalizedJiraIssueCommentsListSchema = z
  .object({
    comments: z.array(normalizedJiraCommentSchema),
    pagination: paginationSchema,
  })
  .strict();

export type NormalizedJiraIssue = z.infer<typeof normalizedJiraIssueSchema>;
export type NormalizedJiraIssueSummary = z.infer<
  typeof normalizedJiraIssueSummarySchema
>;
export type NormalizedJiraComment = z.infer<typeof normalizedJiraCommentSchema>;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function basicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function jiraConfigFields(config: ResolvedConfig): Array<{
  name: string;
  value: string | null;
}> {
  return [
    { name: "baseUrl", value: config.jira.baseUrl.value },
    { name: "email", value: config.jira.email.value },
    { name: "apiToken", value: config.jira.apiToken.value },
  ];
}

function assertJiraConfigComplete(config: ResolvedConfig): asserts config is
  ResolvedConfig & {
    jira: {
      baseUrl: { value: string };
      email: { value: string };
      apiToken: { value: string };
    };
  } {
  const missing = jiraConfigFields(config)
    .filter((field) => field.value === null)
    .map((field) => field.name);

  if (missing.length > 0) {
    throw new JiraConfigurationError(missing);
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as JsonRecord;
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function namedField(value: unknown): string | undefined {
  const record = asRecord(value);

  return typeof record?.name === "string" ? record.name : undefined;
}

function userField(value: unknown): NormalizedJiraIssue["assignee"] | undefined {
  if (value === null) {
    return null;
  }

  const record = asRecord(value);

  if (record === undefined) {
    return undefined;
  }

  return {
    accountId: record.accountId,
    displayName: record.displayName,
  } as NormalizedJiraIssue["assignee"];
}

function projectField(value: unknown): NormalizedJiraIssue["project"] {
  const record = asRecord(value);

  return {
    key: record?.key,
    name: record?.name,
  } as NormalizedJiraIssue["project"];
}

function normalizeTimestamp(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString();
}

function adfToPlainText(value: unknown): string | undefined {
  const chunks: string[] = [];

  function visit(node: unknown): void {
    if (typeof node === "string") {
      chunks.push(node);
      return;
    }

    const record = asRecord(node);

    if (record === undefined) {
      return;
    }

    if (typeof record.text === "string") {
      chunks.push(record.text);
    }

    if (Array.isArray(record.content)) {
      for (const child of record.content) {
        visit(child);
      }
    }

    if (record.type === "paragraph") {
      chunks.push("\n");
    }
  }

  visit(value);

  const text = chunks.join("").trim();
  return text === "" ? undefined : text;
}

function descriptionField(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return adfToPlainText(value);
}

function normalizeJiraIssueSummary(providerIssue: unknown): Record<string, unknown> {
  const issue = asRecord(providerIssue);
  const fields = asRecord(issue?.fields);
  const normalized: Record<string, unknown> = {
    key: issue?.key,
    summary: fields?.summary,
    status: namedField(fields?.status),
    issueType: namedField(fields?.issuetype),
    created: normalizeTimestamp(fields?.created),
    updated: normalizeTimestamp(fields?.updated),
  };

  if (fields !== undefined && hasOwn(fields, "priority")) {
    normalized.priority =
      fields.priority === null ? null : namedField(fields.priority);
  }

  if (fields !== undefined && hasOwn(fields, "assignee")) {
    normalized.assignee = userField(fields.assignee);
  }

  return normalized;
}

function normalizeJiraIssue(providerIssue: unknown): NormalizedJiraIssue {
  const issue = asRecord(providerIssue);
  const fields = asRecord(issue?.fields);
  const normalized: Record<string, unknown> = {
    key: issue?.key,
    summary: fields?.summary,
    status: namedField(fields?.status),
    issueType: namedField(fields?.issuetype),
    project: projectField(fields?.project),
    labels: fields?.labels,
    created: normalizeTimestamp(fields?.created),
    updated: normalizeTimestamp(fields?.updated),
  };

  if (fields !== undefined && hasOwn(fields, "description")) {
    normalized.description = descriptionField(fields.description);
  }

  if (fields !== undefined && hasOwn(fields, "priority")) {
    normalized.priority =
      fields.priority === null ? null : namedField(fields.priority);
  }

  if (fields !== undefined && hasOwn(fields, "assignee")) {
    normalized.assignee = userField(fields.assignee);
  }

  if (fields !== undefined && hasOwn(fields, "reporter")) {
    normalized.reporter = userField(fields.reporter);
  }

  const parsedResult = normalizedJiraIssueSchema.safeParse(normalized);

  if (!parsedResult.success) {
    throw new JiraNormalizedOutputError(
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
    );
  }

  return parsedResult.data;
}

function paginationFromProvider(
  providerPage: JsonRecord | undefined,
  limit: number,
): z.infer<typeof paginationSchema> {
  const startAt = typeof providerPage?.startAt === "number" ? providerPage.startAt : 0;
  const total = typeof providerPage?.total === "number" ? providerPage.total : 0;
  const nextStartAt = startAt + limit;
  const hasNextPage = nextStartAt < total;

  return {
    limit,
    nextCursor: hasNextPage ? String(nextStartAt) : null,
    hasNextPage,
  };
}

function normalizeJiraIssueSearch(
  providerSearch: unknown,
  limit: number,
): z.infer<typeof normalizedJiraIssueSearchSchema> {
  const search = asRecord(providerSearch);
  const issues = Array.isArray(search?.issues) ? search.issues : [];
  const normalized = {
    issues: issues.map(normalizeJiraIssueSummary),
    pagination: paginationFromProvider(search, limit),
  };
  const parsedResult = normalizedJiraIssueSearchSchema.safeParse(normalized);

  if (!parsedResult.success) {
    throw new JiraNormalizedOutputError(
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
      "Normalized Jira issue search output failed validation",
    );
  }

  return parsedResult.data;
}

function normalizeJiraComment(providerComment: unknown): Record<string, unknown> {
  const comment = asRecord(providerComment);
  const normalized: Record<string, unknown> = {
    id: comment?.id,
    author: userField(comment?.author) ?? null,
    body:
      typeof comment?.body === "string"
        ? comment.body
        : (adfToPlainText(comment?.body) ?? ""),
    created: normalizeTimestamp(comment?.created),
    updated: normalizeTimestamp(comment?.updated),
  };

  return normalized;
}

function normalizeJiraIssueCommentsList(
  providerComments: unknown,
  limit: number,
): z.infer<typeof normalizedJiraIssueCommentsListSchema> {
  const page = asRecord(providerComments);
  const comments = Array.isArray(page?.comments) ? page.comments : [];
  const normalized = {
    comments: comments.map(normalizeJiraComment),
    pagination: paginationFromProvider(page, limit),
  };
  const parsedResult = normalizedJiraIssueCommentsListSchema.safeParse(normalized);

  if (!parsedResult.success) {
    throw new JiraNormalizedOutputError(
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
      "Normalized Jira issue comments output failed validation",
    );
  }

  return parsedResult.data;
}

async function readProviderJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new JiraProviderError(
      "Jira provider response was invalid",
      response.status,
    );
  }
}

export async function searchJiraIssues(
  config: ResolvedConfig,
  options: JiraIssueSearchOptions,
): Promise<unknown> {
  assertJiraConfigComplete(config);

  const limit = options.limit ?? 50;
  const startAt = options.cursor ?? "0";
  const url = new URL(
    `${normalizeBaseUrl(config.jira.baseUrl.value)}/rest/api/3/search`,
  );
  url.searchParams.set("jql", options.jql);
  url.searchParams.set("maxResults", String(limit));
  url.searchParams.set("startAt", startAt);

  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(String(url), {
      headers: {
        accept: "application/json",
        authorization: basicAuthorization(
          config.jira.email.value,
          config.jira.apiToken.value,
        ),
      },
    });
  } catch {
    options.debugRequests?.push({
      provider: "jira",
      method: "GET",
      url: String(url),
      latencyMs: Date.now() - startedAt,
    });
    throw new JiraNetworkError();
  }

  options.debugRequests?.push({
    provider: "jira",
    method: "GET",
    url: String(url),
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });

  if (response.status === 401 || response.status === 403) {
    throw new JiraAuthenticationError(response.status);
  }

  if (!response.ok) {
    throw new JiraProviderError("Jira provider request failed", response.status);
  }

  const body = await readProviderJson(response);
  return normalizeJiraIssueSearch(body, limit);
}

export async function listJiraIssueComments(
  config: ResolvedConfig,
  key: string,
  options: JiraIssueCommentsListOptions = {},
): Promise<unknown> {
  assertJiraConfigComplete(config);

  const limit = options.limit ?? 50;
  const startAt = options.cursor ?? "0";
  const url = new URL(
    `${normalizeBaseUrl(config.jira.baseUrl.value)}/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
  );
  url.searchParams.set("maxResults", String(limit));
  url.searchParams.set("startAt", startAt);

  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(String(url), {
      headers: {
        accept: "application/json",
        authorization: basicAuthorization(
          config.jira.email.value,
          config.jira.apiToken.value,
        ),
      },
    });
  } catch {
    options.debugRequests?.push({
      provider: "jira",
      method: "GET",
      url: String(url),
      latencyMs: Date.now() - startedAt,
    });
    throw new JiraNetworkError();
  }

  options.debugRequests?.push({
    provider: "jira",
    method: "GET",
    url: String(url),
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });

  if (response.status === 404) {
    throw new JiraIssueNotFoundError(key);
  }

  if (response.status === 401 || response.status === 403) {
    throw new JiraAuthenticationError(response.status);
  }

  if (!response.ok) {
    throw new JiraProviderError(
      "Jira provider request failed",
      response.status,
    );
  }

  const body = await readProviderJson(response);

  if (options.raw) {
    return body;
  }

  return normalizeJiraIssueCommentsList(body, limit);
}

export async function getJiraIssue(
  config: ResolvedConfig,
  key: string,
  options: JiraIssueGetOptions = {},
): Promise<unknown> {
  assertJiraConfigComplete(config);

  const url = `${normalizeBaseUrl(config.jira.baseUrl.value)}/rest/api/3/issue/${encodeURIComponent(key)}`;
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: basicAuthorization(
          config.jira.email.value,
          config.jira.apiToken.value,
        ),
      },
    });
  } catch {
    options.debugRequests?.push({
      provider: "jira",
      method: "GET",
      url,
      latencyMs: Date.now() - startedAt,
    });
    throw new JiraNetworkError();
  }

  options.debugRequests?.push({
    provider: "jira",
    method: "GET",
    url,
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });

  if (response.status === 404) {
    throw new JiraIssueNotFoundError(key);
  }

  if (response.status === 401 || response.status === 403) {
    throw new JiraAuthenticationError(response.status);
  }

  if (!response.ok) {
    throw new JiraProviderError(
      "Jira provider request failed",
      response.status,
    );
  }

  const body = await readProviderJson(response);

  if (options.raw) {
    return body;
  }

  return normalizeJiraIssue(body);
}

export const jiraProvider: Provider = {
  name: "jira",
  authCheck: (config, options) => checkProviderAuth(config, "jira", options),
  configSlice: (config) => [
    { name: "baseUrl", value: config.jira.baseUrl.value },
    { name: "email", value: config.jira.email.value },
    { name: "apiToken", value: config.jira.apiToken.value },
  ],
};
