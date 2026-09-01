import type { Command } from "commander";
import { resolveConfig } from "./config.js";
import { getJiraIssueView, type JiraDebugRequest } from "./jira.js";
import { handleProviderError, writeEnvelope } from "./output.js";

export function registerIssueCommands(program: Command): void {
  const issueCommand = program.command("issue").description("Read issues");

  issueCommand
    .command("view")
    .description("Fetch one issue as a normalized primary record")
    .argument("[key]", "Jira issue key")
    .option("--comments", "Include every normalized comment")
    .option("--pull-requests", "Include Bitbucket pull requests from the Jira development panel")
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
        const data = await getJiraIssueView(config, key, {
          comments: flags.comments === true,
          pullRequests: flags.pullRequests === true,
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
