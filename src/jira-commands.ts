import type { Command } from "commander";
import { resolveConfig } from "./config.js";
import {
  getJiraIssue,
  listJiraIssueComments,
  searchJiraIssues,
  type JiraDebugRequest,
} from "./jira.js";
import { exportJiraIssue, type AdfFormat } from "./jira-export.js";
import { handleProviderError, writeEnvelope } from "./output.js";

export function registerJiraCommands(program: Command): void {
  const jiraCommand = program.command("jira").description("Read Jira resources");
  const jiraIssueCommand = jiraCommand.command("issue").description("Read Jira issues");

  jiraIssueCommand
    .command("get")
    .description("Fetch a Jira issue by explicit key")
    .argument("[key]", "Jira issue key")
    .option("--raw", "Return the provider-native Jira payload")
    .option("--debug", "Include redacted provider request metadata")
    .option("--jira-base-url <url>")
    .option("--jira-email <email>")
    .option("--jira-api-token <token>")
    .action(async (key: string | undefined, flags) => {
      const debugRequests: JiraDebugRequest[] = [];
      const meta: Record<string, unknown> = flags.debug
        ? { debug: { requests: debugRequests } }
        : {};

      try {
        if (key === undefined) {
          writeEnvelope({
            success: false,
            schemaVersion: "1.0",
            error: {
              code: "MISSING_ARGUMENT",
              message: "Jira issue key is required",
              details: { argument: "KEY" },
            },
            meta: {},
          });
          process.exitCode = 2;
          return;
        }

        const config = resolveConfig({ flags, redactSecrets: false });
        const data = await getJiraIssue(config, key, {
          raw: flags.raw,
          debugRequests: flags.debug ? debugRequests : undefined,
        });

        writeEnvelope({ success: true, schemaVersion: "1.0", data, meta });
      } catch (error) {
        if (handleProviderError(error, meta)) return;
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: { code: "INTERNAL_ERROR", message: "Unexpected internal error" },
          meta,
        });
        process.exitCode = 1;
      }
    });

  jiraIssueCommand
    .command("export")
    .description("Export a complete curated Jira issue")
    .argument("[key]", "Jira issue key")
    .option("--adf-format <format>", "Render rich text as markdown or raw ADF", "markdown")
    .option("--download-attachments <dir>", "Download attachments to a directory")
    .option("--debug", "Include redacted provider request metadata")
    .option("--jira-base-url <url>")
    .option("--jira-email <email>")
    .option("--jira-api-token <token>")
    .action(async (key: string | undefined, flags) => {
      const debugRequests: JiraDebugRequest[] = [];
      const meta: Record<string, unknown> = flags.debug
        ? { debug: { requests: debugRequests } }
        : {};

      try {
        if (key === undefined) {
          writeEnvelope({
            success: false,
            schemaVersion: "1.0",
            error: {
              code: "MISSING_ARGUMENT",
              message: "Jira issue key is required",
              details: { argument: "KEY" },
            },
            meta: {},
          });
          process.exitCode = 2;
          return;
        }

        if (flags.adfFormat !== "markdown" && flags.adfFormat !== "raw") {
          writeEnvelope({
            success: false,
            schemaVersion: "1.0",
            error: {
              code: "INVALID_OPTION",
              message: "Jira issue export ADF format must be markdown or raw",
              details: { option: "--adf-format", value: flags.adfFormat },
            },
            meta: {},
          });
          process.exitCode = 2;
          return;
        }

        const config = resolveConfig({ flags, redactSecrets: false });
        const data = await exportJiraIssue(config, key, {
          adfFormat: flags.adfFormat as AdfFormat,
          downloadAttachments: flags.downloadAttachments,
          debugRequests: flags.debug ? debugRequests : undefined,
        });

        writeEnvelope({ success: true, schemaVersion: "1.0", data, meta });
      } catch (error) {
        if (handleProviderError(error, meta)) return;
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: { code: "INTERNAL_ERROR", message: "Unexpected internal error" },
          meta,
        });
        process.exitCode = 1;
      }
    });

  const jiraIssueCommentsCommand = jiraIssueCommand
    .command("comments")
    .description("Read Jira issue comments");

  jiraIssueCommentsCommand
    .command("list")
    .description("List comments for a Jira issue by explicit key")
    .argument("[key]", "Jira issue key")
    .option("--limit <limit>")
    .option("--cursor <cursor>")
    .option("--raw", "Return the provider-native Jira payload")
    .option("--debug", "Include redacted provider request metadata")
    .option("--jira-base-url <url>")
    .option("--jira-email <email>")
    .option("--jira-api-token <token>")
    .action(async (key: string | undefined, flags) => {
      const debugRequests: JiraDebugRequest[] = [];
      const meta: Record<string, unknown> = flags.debug
        ? { debug: { requests: debugRequests } }
        : {};

      try {
        if (key === undefined) {
          writeEnvelope({
            success: false,
            schemaVersion: "1.0",
            error: {
              code: "MISSING_ARGUMENT",
              message: "Jira issue key is required",
              details: { argument: "KEY" },
            },
            meta: {},
          });
          process.exitCode = 2;
          return;
        }

        const limit = flags.limit === undefined ? 50 : Number(flags.limit);

        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          writeEnvelope({
            success: false,
            schemaVersion: "1.0",
            error: {
              code: "INVALID_LIMIT",
              message: "Jira issue comments limit must be between 1 and 100",
              details: {
                limit: Number.isNaN(limit) ? flags.limit : limit,
                min: 1,
                max: 100,
              },
            },
            meta: {},
          });
          process.exitCode = 2;
          return;
        }

        const config = resolveConfig({ flags, redactSecrets: false });
        const data = await listJiraIssueComments(config, key, {
          limit,
          cursor: flags.cursor,
          raw: flags.raw,
          debugRequests: flags.debug ? debugRequests : undefined,
        });

        writeEnvelope({ success: true, schemaVersion: "1.0", data, meta });
      } catch (error) {
        if (handleProviderError(error, meta)) return;
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: { code: "INTERNAL_ERROR", message: "Unexpected internal error" },
          meta,
        });
        process.exitCode = 1;
      }
    });

  jiraIssueCommand
    .command("search")
    .description("Search Jira issues using provider-native JQL")
    .option("--jql <query>")
    .option("--limit <limit>")
    .option("--cursor <cursor>")
    .option("--debug", "Include redacted provider request metadata")
    .option("--jira-base-url <url>")
    .option("--jira-email <email>")
    .option("--jira-api-token <token>")
    .action(async (flags) => {
      const debugRequests: JiraDebugRequest[] = [];
      const meta: Record<string, unknown> = flags.debug
        ? { debug: { requests: debugRequests } }
        : {};

      try {
        const jql = typeof flags.jql === "string" ? flags.jql.trim() : undefined;
        if (jql === undefined || jql.length === 0) {
          writeEnvelope({
            success: false,
            schemaVersion: "1.0",
            error: {
              code: "MISSING_OPTION",
              message: "Jira issue search JQL is required",
              details: { option: "--jql" },
            },
            meta: {},
          });
          process.exitCode = 2;
          return;
        }

        const limit = flags.limit === undefined ? 50 : Number(flags.limit);

        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          writeEnvelope({
            success: false,
            schemaVersion: "1.0",
            error: {
              code: "INVALID_LIMIT",
              message: "Jira issue search limit must be between 1 and 100",
              details: {
                limit: Number.isNaN(limit) ? flags.limit : limit,
                min: 1,
                max: 100,
              },
            },
            meta: {},
          });
          process.exitCode = 2;
          return;
        }

        const config = resolveConfig({ flags, redactSecrets: false });
        const data = await searchJiraIssues(config, {
          jql,
          limit,
          cursor: flags.cursor,
          debugRequests: flags.debug ? debugRequests : undefined,
        });

        writeEnvelope({ success: true, schemaVersion: "1.0", data, meta });
      } catch (error) {
        if (handleProviderError(error, meta)) return;
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: { code: "INTERNAL_ERROR", message: "Unexpected internal error" },
          meta,
        });
        process.exitCode = 1;
      }
    });
}
