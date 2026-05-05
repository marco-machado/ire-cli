#!/usr/bin/env node

import { Command } from "commander";
import {
  AuthConfigurationError,
  AuthConfigurationMissingError,
  type AuthDebugRequest,
  type AuthCheckResult,
  checkConfiguredProviderAuth,
  checkProviderAuth,
  type ProviderName,
} from "./auth.js";
import { ConfigValidationError, resolveConfig } from "./config.js";
import {
  getJiraIssue,
  listJiraIssueComments,
  searchJiraIssues,
  JiraAuthenticationError,
  JiraConfigurationError,
  type JiraDebugRequest,
  JiraIssueNotFoundError,
  JiraNetworkError,
  JiraNormalizedOutputError,
  JiraProviderError,
} from "./jira.js";

type SuccessEnvelope = {
  success: true;
  schemaVersion: "1.0";
  data: unknown;
  meta: Record<string, unknown>;
};

type ErrorEnvelope = {
  success: false;
  schemaVersion: "1.0";
  data?: unknown;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: Record<string, unknown>;
};

function writeEnvelope(envelope: SuccessEnvelope | ErrorEnvelope): void {
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

function authResults(data: AuthCheckResult | AuthCheckResult[]): AuthCheckResult[] {
  return Array.isArray(data) ? data : [data];
}

function hasAuthFailures(data: AuthCheckResult | AuthCheckResult[]): boolean {
  return authResults(data).some((result) => !result.authenticated);
}

function authFailureExitCode(data: AuthCheckResult | AuthCheckResult[]): number {
  const exitCodes = authResults(data).map((result) => {
    if (result.authenticated) {
      return 0;
    }

    if (result.error.code === "NETWORK_ERROR") {
      return 6;
    }

    if (result.error.code === "PROVIDER_ERROR") {
      return 5;
    }

    return 3;
  });

  return Math.max(...exitCodes);
}

function isProviderName(provider: string): provider is ProviderName {
  return provider === "jira" || provider === "bitbucket";
}

const program = new Command();

program
  .name("ire")
  .description("Agent-first CLI for Jira and Bitbucket")
  .version("0.1.0");

program
  .command("config")
  .description("Inspect resolved ire configuration")
  .command("inspect")
  .description("Emit resolved configuration as a JSON envelope")
  .option("--jira-base-url <url>")
  .option("--jira-email <email>")
  .option("--jira-api-token <token>")
  .option("--bitbucket-workspace <workspace>")
  .option("--bitbucket-username <username>")
  .option("--bitbucket-app-password <password>")
  .action((flags) => {
    try {
      const config = resolveConfig({ flags });

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data: { config },
        meta: {},
      });
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      writeEnvelope({
        success: false,
        schemaVersion: "1.0",
        error: {
          code: "INTERNAL_ERROR",
          message: "Unexpected internal error",
        },
        meta: {},
      });
      process.exitCode = 1;
    }
  });

program
  .command("auth")
  .description("Check provider authentication")
  .command("check")
  .description("Verify configured provider credentials")
  .argument("[provider]", "Provider to check: jira or bitbucket")
  .option("--debug", "Include redacted provider request metadata")
  .option("--jira-base-url <url>")
  .option("--jira-email <email>")
  .option("--jira-api-token <token>")
  .option("--bitbucket-workspace <workspace>")
  .option("--bitbucket-username <username>")
  .option("--bitbucket-app-password <password>")
  .action(async (provider: string | undefined, flags) => {
    try {
      if (provider !== undefined && !isProviderName(provider)) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "INVALID_PROVIDER",
            message: `Unknown auth provider: ${provider}`,
            details: {
              allowed: ["jira", "bitbucket"],
            },
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      const config = resolveConfig({ flags, redactSecrets: false });
      const debugRequests: AuthDebugRequest[] = [];
      const authOptions = flags.debug
        ? { debugRequests }
        : {};
      const data =
        provider === undefined
          ? await checkConfiguredProviderAuth(config, authOptions)
          : await checkProviderAuth(config, provider, authOptions);
      const meta = flags.debug ? { debug: { requests: debugRequests } } : {};

      if (hasAuthFailures(data)) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          data,
          error: {
            code: "AUTH_CHECK_FAILED",
            message: "One or more auth checks failed",
          },
          meta,
        });
        process.exitCode = authFailureExitCode(data);
        return;
      }

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data,
        meta,
      });
    } catch (error) {
      if (
        error instanceof AuthConfigurationError ||
        error instanceof AuthConfigurationMissingError
      ) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      if (error instanceof ConfigValidationError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      writeEnvelope({
        success: false,
        schemaVersion: "1.0",
        error: {
          code: "INTERNAL_ERROR",
          message: "Unexpected internal error",
        },
        meta: {},
      });
      process.exitCode = 1;
    }
  });

const jiraCommand = program.command("jira").description("Read Jira resources");
const jiraIssueCommand = jiraCommand
  .command("issue")
  .description("Read Jira issues");

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
            details: {
              argument: "KEY",
            },
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

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data,
        meta,
      });
    } catch (error) {
      if (error instanceof JiraConfigurationError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 2;
        return;
      }

      if (error instanceof ConfigValidationError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 2;
        return;
      }

      if (error instanceof JiraAuthenticationError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 3;
        return;
      }

      if (error instanceof JiraIssueNotFoundError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 4;
        return;
      }

      if (error instanceof JiraProviderError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 5;
        return;
      }

      if (error instanceof JiraNetworkError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
          },
          meta,
        });
        process.exitCode = 6;
        return;
      }

      if (error instanceof JiraNormalizedOutputError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 1;
        return;
      }

      writeEnvelope({
        success: false,
        schemaVersion: "1.0",
        error: {
          code: "INTERNAL_ERROR",
          message: "Unexpected internal error",
        },
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
            details: {
              argument: "KEY",
            },
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

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data,
        meta,
      });
    } catch (error) {
      if (error instanceof JiraConfigurationError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 2;
        return;
      }

      if (error instanceof ConfigValidationError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 2;
        return;
      }

      if (error instanceof JiraAuthenticationError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 3;
        return;
      }

      if (error instanceof JiraIssueNotFoundError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 4;
        return;
      }

      if (error instanceof JiraProviderError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 5;
        return;
      }

      if (error instanceof JiraNetworkError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
          },
          meta,
        });
        process.exitCode = 6;
        return;
      }

      if (error instanceof JiraNormalizedOutputError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 1;
        return;
      }

      writeEnvelope({
        success: false,
        schemaVersion: "1.0",
        error: {
          code: "INTERNAL_ERROR",
          message: "Unexpected internal error",
        },
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
      if (flags.jql === undefined) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "MISSING_OPTION",
            message: "Jira issue search JQL is required",
            details: {
              option: "--jql",
            },
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
        jql: flags.jql,
        limit,
        cursor: flags.cursor,
        debugRequests: flags.debug ? debugRequests : undefined,
      });

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data,
        meta,
      });
    } catch (error) {
      if (error instanceof JiraConfigurationError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 2;
        return;
      }

      if (error instanceof ConfigValidationError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 2;
        return;
      }

      if (error instanceof JiraAuthenticationError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 3;
        return;
      }

      if (error instanceof JiraProviderError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 5;
        return;
      }

      if (error instanceof JiraNetworkError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
          },
          meta,
        });
        process.exitCode = 6;
        return;
      }

      if (error instanceof JiraNormalizedOutputError) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          meta,
        });
        process.exitCode = 1;
        return;
      }

      writeEnvelope({
        success: false,
        schemaVersion: "1.0",
        error: {
          code: "INTERNAL_ERROR",
          message: "Unexpected internal error",
        },
        meta,
      });
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
