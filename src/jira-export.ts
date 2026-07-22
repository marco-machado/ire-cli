import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { adfToMarkdown, isAdfDocument } from "./adf.js";
import type { ResolvedConfig } from "./config.js";
import { IreConfigurationError } from "./errors.js";
import {
  fetchAllJiraCommentPages,
  getJiraIssue,
  JiraAuthenticationError,
  JiraNetworkError,
  JiraNormalizedOutputError,
  JiraProviderError,
  type JiraDebugRequest,
} from "./jira.js";

type JsonRecord = Record<string, unknown>;

export type AdfFormat = "markdown" | "raw";

export type JiraIssueExportOptions = {
  adfFormat?: AdfFormat;
  downloadAttachments?: string;
  debugRequests?: JiraDebugRequest[];
};

const userSchema = z
  .object({
    accountId: z.string(),
    displayName: z.string(),
  })
  .strict();

const adfDocumentSchema = z
  .object({
    type: z.literal("doc"),
    version: z.number().int(),
    content: z.array(z.json()),
  })
  .passthrough();

const richTextSchema = z.union([z.string(), adfDocumentSchema]).nullable();

const jiraIssueExportSchema = z
  .object({
    key: z.string(),
    summary: z.string(),
    description: richTextSchema,
    status: z.string(),
    issueType: z.string(),
    priority: z.string().nullable(),
    project: z.object({ key: z.string(), name: z.string() }).strict(),
    assignee: userSchema.nullable(),
    reporter: userSchema.nullable(),
    labels: z.array(z.string()),
    sprints: z.array(z.object({ name: z.string(), state: z.string() }).strict()),
    storyPoints: z.number().nullable(),
    parent: z.object({ key: z.string(), summary: z.string() }).strict().nullable(),
    created: z.iso.datetime(),
    updated: z.iso.datetime(),
    customFields: z.record(z.string(), z.json()),
    comments: z.array(
      z
        .object({
          author: userSchema.nullable(),
          created: z.iso.datetime(),
          body: richTextSchema,
        })
        .strict(),
    ),
    attachments: z.array(
      z
        .object({
          filename: z.string(),
          mimeType: z.string(),
          size: z.number().nonnegative(),
          contentUrl: z.url(),
        })
        .strict(),
    ),
    subtasks: z.array(
      z.object({ key: z.string(), summary: z.string(), status: z.string() }).strict(),
    ),
    issueLinks: z.array(
      z
        .object({
          relationship: z.string(),
          key: z.string(),
          summary: z.string(),
          type: z.string(),
          status: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type JiraIssueExport = z.infer<typeof jiraIssueExportSchema>;

export class JiraAttachmentWriteError extends IreConfigurationError {
  readonly code = "JIRA_ATTACHMENT_WRITE_FAILED";

  constructor(readonly details: { directory: string; filename?: string }) {
    super("Jira attachment could not be written");
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function namedField(value: unknown): string | undefined {
  const record = asRecord(value);
  return typeof record?.name === "string" ? record.name : undefined;
}

function normalizeTimestamp(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function normalizeUser(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const user = asRecord(value);
  if (user === undefined) return value;
  return {
    accountId: user.accountId,
    displayName: user.displayName,
  };
}

function renderRichText(value: unknown, format: AdfFormat): unknown {
  if (value === null || value === undefined) return null;
  if (!isAdfDocument(value)) return typeof value === "string" ? value : normalizeCustomValue(value, format);
  return format === "raw" ? value : adfToMarkdown(value);
}

function normalizeCustomValue(value: unknown, format: AdfFormat): unknown {
  if (value === null || value === undefined) return null;
  if (isAdfDocument(value)) return renderRichText(value, format);
  if (Array.isArray(value)) return value.map((entry) => normalizeCustomValue(entry, format));
  if (typeof value !== "object") return value;

  const record = asRecord(value);
  if (record === undefined) return value;
  if ("value" in record) return normalizeCustomValue(record.value, format);
  if (typeof record.name === "string") return record.name;
  return value;
}

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (isAdfDocument(value)) return adfToMarkdown(value) !== "";
  if (Array.isArray(value)) return value.some((entry) => isPopulated(entry));
  const record = asRecord(value);
  if (record === undefined) return true;
  if ("value" in record) return isPopulated(record.value);
  if (typeof record.name === "string") return record.name.trim() !== "";
  return Object.keys(record).length > 0;
}

function mappedValue(
  fields: JsonRecord,
  candidates: string[] | undefined,
): unknown {
  if (candidates === undefined) return null;
  for (const fieldId of candidates) {
    const value = fields[fieldId];
    if (isPopulated(value)) return value;
  }
  return null;
}

function normalizeSprints(value: unknown): unknown {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    const sprint = asRecord(entry);
    return sprint !== undefined && typeof sprint.name === "string" && typeof sprint.state === "string"
      ? { name: sprint.name, state: sprint.state }
      : entry;
  });
}

function normalizeParent(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const parent = asRecord(value);
  const fields = asRecord(parent?.fields);
  if (parent === undefined) return value;
  return { key: parent.key, summary: fields?.summary };
}

function normalizeAttachments(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const attachment = asRecord(entry);
    return {
      filename: attachment?.filename,
      mimeType: attachment?.mimeType,
      size: attachment?.size,
      contentUrl: attachment?.content,
    };
  });
}

function normalizeSubtasks(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const subtask = asRecord(entry);
    const fields = asRecord(subtask?.fields);
    return {
      key: subtask?.key,
      summary: fields?.summary,
      status: namedField(fields?.status),
    };
  });
}

function normalizeIssueLinks(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const link = asRecord(entry);
    const type = asRecord(link?.type);
    const outward = asRecord(link?.outwardIssue);
    const inward = asRecord(link?.inwardIssue);
    const issue = outward ?? inward;
    const fields = asRecord(issue?.fields);
    return {
      relationship: outward !== undefined ? type?.outward : type?.inward,
      key: issue?.key,
      summary: fields?.summary,
      type: namedField(fields?.issuetype),
      status: namedField(fields?.status),
    };
  });
}

async function getAllComments(
  config: ResolvedConfig,
  key: string,
  format: AdfFormat,
  debugRequests: JiraDebugRequest[] | undefined,
): Promise<unknown[]> {
  const pages = await fetchAllJiraCommentPages(config, key, { debugRequests });

  return pages.flatMap((pageValue) => {
    const pageComments = asRecord(pageValue)?.comments;

    return (Array.isArray(pageComments) ? pageComments : []).map(
      (commentValue) => {
        const comment = asRecord(commentValue);
        return {
          author: normalizeUser(comment?.author),
          created: normalizeTimestamp(comment?.created),
          body: renderRichText(comment?.body, format),
        };
      },
    );
  });
}

function attachmentFilename(filename: string): string {
  const sanitized = basename(filename.replaceAll("\\", "/")).replaceAll("\0", "");
  return sanitized === "" || sanitized === "." || sanitized === ".."
    ? "attachment"
    : sanitized;
}

async function downloadJiraAttachments(
  config: ResolvedConfig,
  attachments: JiraIssueExport["attachments"],
  directory: string,
  debugRequests: JiraDebugRequest[] | undefined,
): Promise<void> {
  try {
    await mkdir(directory, { recursive: true });
  } catch {
    throw new JiraAttachmentWriteError({ directory });
  }

  const jiraOrigin = new URL(config.jira.baseUrl.value ?? "").origin;
  const authorization = `Basic ${Buffer.from(
    `${config.jira.email.value}:${config.jira.apiToken.value}`,
  ).toString("base64")}`;

  for (const attachment of attachments) {
    const contentUrl = new URL(attachment.contentUrl);
    if (contentUrl.origin !== jiraOrigin) {
      throw new JiraProviderError("Jira attachment URL was outside the Jira origin");
    }

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(String(contentUrl), {
        headers: {
          accept: "*/*",
          authorization,
        },
      });
    } catch {
      debugRequests?.push({
        provider: "jira",
        method: "GET",
        url: String(contentUrl),
        latencyMs: Date.now() - startedAt,
      });
      throw new JiraNetworkError();
    }

    debugRequests?.push({
      provider: "jira",
      method: "GET",
      url: String(contentUrl),
      status: response.status,
      latencyMs: Date.now() - startedAt,
    });

    if (response.status === 401 || response.status === 403) {
      throw new JiraAuthenticationError(response.status);
    }
    if (!response.ok) {
      throw new JiraProviderError("Jira attachment download failed", response.status);
    }

    const filename = attachmentFilename(attachment.filename);
    if (response.body === null) {
      throw new JiraProviderError("Jira attachment response was invalid", response.status);
    }

    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(
        join(directory, filename),
        constants.O_WRONLY
          | constants.O_CREAT
          | constants.O_TRUNC
          | constants.O_NOFOLLOW,
        0o666,
      );
      await pipeline(
        Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        file.createWriteStream({ autoClose: false }),
      );
    } catch {
      throw new JiraAttachmentWriteError({ directory, filename });
    } finally {
      await file?.close().catch(() => undefined);
    }
  }
}

export async function exportJiraIssue(
  config: ResolvedConfig,
  key: string,
  options: JiraIssueExportOptions = {},
): Promise<JiraIssueExport> {
  const format = options.adfFormat ?? "markdown";
  const providerIssue = await getJiraIssue(config, key, {
    raw: true,
    debugRequests: options.debugRequests,
  });
  const issue = asRecord(providerIssue);
  const fields = asRecord(issue?.fields) ?? {};
  const mappings = config.jira.issueExport.fieldMappings.value;
  const customFields: Record<string, unknown> = {};

  for (const [semanticKey, candidates] of Object.entries(mappings)) {
    if (semanticKey === "sprints" || semanticKey === "storyPoints") continue;
    customFields[semanticKey] = normalizeCustomValue(
      mappedValue(fields, candidates),
      format,
    );
  }

  const storyPointsValue = mappedValue(fields, mappings.storyPoints);
  const normalized = {
    key: issue?.key,
    summary: fields.summary,
    description: renderRichText(fields.description, format),
    status: namedField(fields.status),
    issueType: namedField(fields.issuetype),
    priority: fields.priority === null ? null : (namedField(fields.priority) ?? null),
    project: {
      key: asRecord(fields.project)?.key,
      name: asRecord(fields.project)?.name,
    },
    assignee: normalizeUser(fields.assignee),
    reporter: normalizeUser(fields.reporter),
    labels: Array.isArray(fields.labels) ? fields.labels : [],
    sprints: normalizeSprints(mappedValue(fields, mappings.sprints)),
    storyPoints: storyPointsValue,
    parent: normalizeParent(fields.parent),
    created: normalizeTimestamp(fields.created),
    updated: normalizeTimestamp(fields.updated),
    customFields,
    comments: await getAllComments(config, key, format, options.debugRequests),
    attachments: normalizeAttachments(fields.attachment),
    subtasks: normalizeSubtasks(fields.subtasks),
    issueLinks: normalizeIssueLinks(fields.issuelinks),
  };

  const parsed = jiraIssueExportSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new JiraNormalizedOutputError(
      parsed.error.issues.map((issueError) => ({
        code: issueError.code,
        message: issueError.message,
        path: issueError.path.join("."),
      })),
      "Normalized Jira issue export output failed validation",
    );
  }

  if (options.downloadAttachments !== undefined) {
    await downloadJiraAttachments(
      config,
      parsed.data.attachments,
      options.downloadAttachments,
      options.debugRequests,
    );
  }

  return parsed.data;
}
