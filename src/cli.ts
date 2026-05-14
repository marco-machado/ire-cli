#!/usr/bin/env node

import { Command } from "commander";
import {
  AuthConfigurationError,
  AuthConfigurationMissingError,
  type AuthDebugRequest,
  type AuthCheckResult,
  checkConfiguredProviderAuth,
} from "./auth.js";
import {
  bitbucketProvider,
  getBitbucketPipeline,
  getBitbucketPipelineLog,
  getBitbucketPullRequest,
  getBitbucketPullRequestDiff,
  getLatestBitbucketPipeline,
  listBitbucketPipelineSteps,
  listBitbucketPipelines,
  listBitbucketPullRequestComments,
  listBitbucketPullRequestFiles,
  listBitbucketPullRequests,
  BitbucketAuthenticationError,
  BitbucketConfigurationError,
  type BitbucketDebugRequest,
  BitbucketNetworkError,
  BitbucketNormalizedOutputError,
  BitbucketProviderError,
  BitbucketPipelineNotFoundError,
  BitbucketPullRequestNotFoundError,
  BitbucketRepoAmbiguousError,
  BitbucketRepoInvalidError,
  BitbucketRepoMissingError,
} from "./bitbucket.js";
import { ConfigValidationError, resolveConfig } from "./config.js";
import {
  getJiraIssue,
  jiraProvider,
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

const registeredProviders = [jiraProvider, bitbucketProvider];

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
  .option("--bitbucket-repo <repo>")
  .option("--bitbucket-email <email>")
  .option("--bitbucket-api-token <token>")
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
  .option("--bitbucket-email <email>")
  .option("--bitbucket-api-token <token>")
  .action(async (provider: string | undefined, flags) => {
    try {
      const knownProvider =
        provider !== undefined
          ? registeredProviders.find((p) => p.name === provider)
          : undefined;

      if (provider !== undefined && knownProvider === undefined) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "INVALID_PROVIDER",
            message: `Unknown auth provider: ${provider}`,
            details: {
              allowed: registeredProviders.map((p) => p.name),
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
        knownProvider === undefined
          ? await checkConfiguredProviderAuth(config, authOptions)
          : await knownProvider.authCheck(config, authOptions);
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

function writeBitbucketCommandError(error: unknown, meta: Record<string, unknown>): boolean {
  if (
    error instanceof BitbucketConfigurationError ||
    error instanceof BitbucketRepoMissingError ||
    error instanceof BitbucketRepoInvalidError ||
    error instanceof ConfigValidationError
  ) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: { code: error.code, message: error.message, details: error.details },
      meta,
    });
    process.exitCode = 2;
    return true;
  }

  if (error instanceof BitbucketRepoAmbiguousError) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: { code: error.code, message: error.message, details: error.details },
      meta,
    });
    process.exitCode = 7;
    return true;
  }

  if (error instanceof BitbucketAuthenticationError) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: { code: error.code, message: error.message, details: error.details },
      meta,
    });
    process.exitCode = 3;
    return true;
  }

  if (error instanceof BitbucketPipelineNotFoundError || error instanceof BitbucketPullRequestNotFoundError) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: { code: error.code, message: error.message, details: error.details },
      meta,
    });
    process.exitCode = 4;
    return true;
  }

  if (error instanceof BitbucketProviderError) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: { code: error.code, message: error.message, details: error.details },
      meta,
    });
    process.exitCode = 5;
    return true;
  }

  if (error instanceof BitbucketNetworkError) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: { code: error.code, message: error.message },
      meta,
    });
    process.exitCode = 6;
    return true;
  }

  if (error instanceof BitbucketNormalizedOutputError) {
    writeEnvelope({
      success: false,
      schemaVersion: "1.0",
      error: { code: error.code, message: error.message, details: error.details },
      meta,
    });
    process.exitCode = 1;
    return true;
  }

  return false;
}

const bitbucketCommand = program
  .command("bitbucket")
  .description("Read Bitbucket resources");

const bitbucketPipelinesCommand = bitbucketCommand
  .command("pipelines")
  .description("Read Bitbucket Pipelines runs");

bitbucketPipelinesCommand
  .command("get")
  .description("Fetch a specific Bitbucket Pipelines run for a repository")
  .argument("[uuid]", "Bitbucket Pipelines run UUID")
  .option("--repo <repo>", "Bitbucket repository identity as workspace/repo")
  .option("--debug", "Include redacted provider request metadata")
  .option("--bitbucket-workspace <workspace>")
  .option("--bitbucket-repo <repo>")
  .option("--bitbucket-email <email>")
  .option("--bitbucket-api-token <token>")
  .action(async (uuid: string, flags) => {
    const debugRequests: BitbucketDebugRequest[] = [];
    const meta: Record<string, unknown> = flags.debug ? { debug: { requests: debugRequests } } : {};

    try {
      if (uuid === undefined) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "MISSING_ARGUMENT",
            message: "Bitbucket pipelines get requires a UUID",
            details: { argument: "UUID" },
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      const config = resolveConfig({ flags, redactSecrets: false });
      const result = await getBitbucketPipeline(config, uuid, {
        repo: flags.repo,
        debugRequests: flags.debug ? debugRequests : undefined,
      });

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data: result.data,
        meta: { ...meta, bitbucket: result.repo },
      });
    } catch (error) {
      if (writeBitbucketCommandError(error, meta)) return;
      writeEnvelope({
        success: false,
        schemaVersion: "1.0",
        error: { code: "INTERNAL_ERROR", message: "Unexpected internal error" },
        meta,
      });
      process.exitCode = 1;
    }
  });

bitbucketPipelinesCommand
  .command("list")
  .description("List Bitbucket Pipelines runs for a repository")
  .option("--repo <repo>", "Bitbucket repository identity as workspace/repo")
  .option("--branch <branch>")
  .option("--limit <limit>")
  .option("--cursor <cursor>")
  .option("--debug", "Include redacted provider request metadata")
  .option("--bitbucket-workspace <workspace>")
  .option("--bitbucket-repo <repo>")
  .option("--bitbucket-email <email>")
  .option("--bitbucket-api-token <token>")
  .action(async (flags) => {
    const debugRequests: BitbucketDebugRequest[] = [];
    const meta: Record<string, unknown> = flags.debug ? { debug: { requests: debugRequests } } : {};

    try {
      const requestedLimit = flags.limit === undefined ? 50 : Number(flags.limit);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "INVALID_LIMIT",
            message: "Bitbucket pipelines list limit must be a positive integer",
            details: { limit: Number.isNaN(requestedLimit) ? flags.limit : requestedLimit, min: 1, max: 100 },
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      const config = resolveConfig({ flags, redactSecrets: false });
      const result = await listBitbucketPipelines(config, {
        repo: flags.repo,
        branch: flags.branch,
        limit: requestedLimit,
        cursor: flags.cursor,
        debugRequests: flags.debug ? debugRequests : undefined,
      });

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data: result.data,
        meta: { ...meta, bitbucket: result.repo },
      });
    } catch (error) {
      if (writeBitbucketCommandError(error, meta)) return;
      writeEnvelope({
        success: false,
        schemaVersion: "1.0",
        error: { code: "INTERNAL_ERROR", message: "Unexpected internal error" },
        meta,
      });
      process.exitCode = 1;
    }
  });

bitbucketPipelinesCommand
  .command("log")
  .description("Fetch a Bitbucket Pipelines step log")
  .argument("[uuid]", "Bitbucket Pipelines run UUID")
  .argument("[stepUuid]", "Bitbucket Pipelines step UUID")
  .option("--repo <repo>", "Bitbucket repository identity as workspace/repo")
  .option("--debug", "Include redacted provider request metadata")
  .option("--bitbucket-workspace <workspace>")
  .option("--bitbucket-repo <repo>")
  .option("--bitbucket-email <email>")
  .option("--bitbucket-api-token <token>")
  .action(async (uuid: string | undefined, stepUuid: string | undefined, flags) => {
    const debugRequests: BitbucketDebugRequest[] = [];
    const meta: Record<string, unknown> = flags.debug ? { debug: { requests: debugRequests } } : {};

    try {
      if (uuid === undefined) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: { code: "MISSING_ARGUMENT", message: "Bitbucket pipelines log requires a UUID", details: { argument: "UUID" } },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      if (stepUuid === undefined) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: { code: "MISSING_ARGUMENT", message: "Bitbucket pipelines log requires a step UUID", details: { argument: "STEP_UUID" } },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      const config = resolveConfig({ flags, redactSecrets: false });
      const result = await getBitbucketPipelineLog(config, uuid, stepUuid, {
        repo: flags.repo,
        debugRequests: flags.debug ? debugRequests : undefined,
      });

      writeEnvelope({ success: true, schemaVersion: "1.0", data: result.data, meta: { ...meta, bitbucket: result.repo } });
    } catch (error) {
      if (writeBitbucketCommandError(error, meta)) return;
      writeEnvelope({
        success: false,
        schemaVersion: "1.0",
        error: { code: "INTERNAL_ERROR", message: "Unexpected internal error" },
        meta,
      });
      process.exitCode = 1;
    }
  });

const bitbucketPipelineStepsCommand = bitbucketPipelinesCommand
  .command("steps")
  .description("Read Bitbucket Pipelines steps");

bitbucketPipelineStepsCommand
  .command("list")
  .description("List steps for a specific Bitbucket Pipelines run")
  .argument("[uuid]", "Bitbucket Pipelines run UUID")
  .option("--repo <repo>", "Bitbucket repository identity as workspace/repo")
  .option("--limit <limit>")
  .option("--cursor <cursor>")
  .option("--debug", "Include redacted provider request metadata")
  .option("--bitbucket-workspace <workspace>")
  .option("--bitbucket-repo <repo>")
  .option("--bitbucket-email <email>")
  .option("--bitbucket-api-token <token>")
  .action(async (uuid: string | undefined, flags) => {
    const debugRequests: BitbucketDebugRequest[] = [];
    const meta: Record<string, unknown> = flags.debug ? { debug: { requests: debugRequests } } : {};

    try {
      if (uuid === undefined) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "MISSING_ARGUMENT",
            message: "Bitbucket pipelines steps list requires a UUID",
            details: { argument: "UUID" },
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      const requestedLimit = flags.limit === undefined ? 50 : Number(flags.limit);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "INVALID_LIMIT",
            message: "Bitbucket pipeline steps list limit must be a positive integer",
            details: { limit: Number.isNaN(requestedLimit) ? flags.limit : requestedLimit, min: 1, max: 100 },
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      const config = resolveConfig({ flags, redactSecrets: false });
      const result = await listBitbucketPipelineSteps(config, uuid, {
        repo: flags.repo,
        limit: requestedLimit,
        cursor: flags.cursor,
        debugRequests: flags.debug ? debugRequests : undefined,
      });

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data: result.data,
        meta: { ...meta, bitbucket: result.repo },
      });
    } catch (error) {
      if (writeBitbucketCommandError(error, meta)) return;
      writeEnvelope({
        success: false,
        schemaVersion: "1.0",
        error: { code: "INTERNAL_ERROR", message: "Unexpected internal error" },
        meta,
      });
      process.exitCode = 1;
    }
  });

bitbucketPipelinesCommand
  .command("latest")
  .description("Fetch the latest Bitbucket Pipelines run for a repository")
  .option("--repo <repo>", "Bitbucket repository identity as workspace/repo")
  .option("--branch <branch>")
  .option("--debug", "Include redacted provider request metadata")
  .option("--bitbucket-workspace <workspace>")
  .option("--bitbucket-repo <repo>")
  .option("--bitbucket-email <email>")
  .option("--bitbucket-api-token <token>")
  .action(async (flags) => {
    const debugRequests: BitbucketDebugRequest[] = [];
    const meta: Record<string, unknown> = flags.debug ? { debug: { requests: debugRequests } } : {};

    try {
      const config = resolveConfig({ flags, redactSecrets: false });
      const result = await getLatestBitbucketPipeline(config, {
        repo: flags.repo,
        branch: flags.branch,
        debugRequests: flags.debug ? debugRequests : undefined,
      });

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data: result.data,
        meta: { ...meta, bitbucket: result.repo },
      });
    } catch (error) {
      if (writeBitbucketCommandError(error, meta)) return;
      writeEnvelope({
        success: false,
        schemaVersion: "1.0",
        error: { code: "INTERNAL_ERROR", message: "Unexpected internal error" },
        meta,
      });
      process.exitCode = 1;
    }
  });

const bitbucketPrCommand = bitbucketCommand
  .command("pr")
  .description("Read Bitbucket pull requests");

bitbucketPrCommand
  .command("list")
  .description("List Bitbucket pull requests for a repository")
  .option("--repo <repo>", "Bitbucket repository identity as workspace/repo")
  .option("--limit <limit>")
  .option("--cursor <cursor>")
  .option("--debug", "Include redacted provider request metadata")
  .option("--bitbucket-workspace <workspace>")
  .option("--bitbucket-repo <repo>")
  .option("--bitbucket-email <email>")
  .option("--bitbucket-api-token <token>")
  .action(async (flags) => {
    const debugRequests: BitbucketDebugRequest[] = [];
    const meta: Record<string, unknown> = flags.debug
      ? { debug: { requests: debugRequests } }
      : {};

    try {
      const limit = flags.limit === undefined ? 50 : Number(flags.limit);

      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "INVALID_LIMIT",
            message: "Bitbucket pull request list limit must be between 1 and 100",
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
      const result = await listBitbucketPullRequests(config, {
        repo: flags.repo,
        limit,
        cursor: flags.cursor,
        debugRequests: flags.debug ? debugRequests : undefined,
      });
      const successMeta = {
        ...meta,
        bitbucket: result.repo,
      };

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data: result.data,
        meta: successMeta,
      });
    } catch (error) {
      if (
        error instanceof BitbucketConfigurationError ||
        error instanceof BitbucketRepoMissingError ||
        error instanceof BitbucketRepoInvalidError ||
        error instanceof ConfigValidationError
      ) {
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

      if (error instanceof BitbucketRepoAmbiguousError) {
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
        process.exitCode = 7;
        return;
      }

      if (error instanceof BitbucketAuthenticationError) {
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

      if (error instanceof BitbucketProviderError) {
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

      if (error instanceof BitbucketNetworkError) {
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

      if (error instanceof BitbucketNormalizedOutputError) {
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

const bitbucketPrCommentsCommand = bitbucketPrCommand
  .command("comments")
  .description("Read Bitbucket pull request comments");

bitbucketPrCommentsCommand
  .command("list")
  .description("List comments for a Bitbucket pull request")
  .argument("[id]", "Bitbucket pull request ID")
  .option("--repo <repo>", "Bitbucket repository identity as workspace/repo")
  .option("--limit <limit>")
  .option("--cursor <cursor>")
  .option("--debug", "Include redacted provider request metadata")
  .option("--bitbucket-workspace <workspace>")
  .option("--bitbucket-repo <repo>")
  .option("--bitbucket-email <email>")
  .option("--bitbucket-api-token <token>")
  .action(async (id: string | undefined, flags) => {
    const debugRequests: BitbucketDebugRequest[] = [];
    const meta: Record<string, unknown> = flags.debug
      ? { debug: { requests: debugRequests } }
      : {};

    try {
      if (id === undefined) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "MISSING_ARGUMENT",
            message: "Bitbucket pull request ID is required",
            details: { argument: "ID" },
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      const pullRequestId = Number(id);
      if (!Number.isInteger(pullRequestId) || pullRequestId < 1) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "INVALID_ARGUMENT",
            message: "Bitbucket pull request ID must be a positive integer",
            details: { argument: "ID", value: id },
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
            message: "Bitbucket pull request comments limit must be between 1 and 100",
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
      const result = await listBitbucketPullRequestComments(config, pullRequestId, {
        repo: flags.repo,
        limit,
        cursor: flags.cursor,
        debugRequests: flags.debug ? debugRequests : undefined,
      });
      const successMeta = {
        ...meta,
        bitbucket: result.repo,
      };

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data: result.data,
        meta: successMeta,
      });
    } catch (error) {
      if (
        error instanceof BitbucketConfigurationError ||
        error instanceof BitbucketRepoMissingError ||
        error instanceof BitbucketRepoInvalidError ||
        error instanceof ConfigValidationError
      ) {
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

      if (error instanceof BitbucketRepoAmbiguousError) {
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
        process.exitCode = 7;
        return;
      }

      if (error instanceof BitbucketAuthenticationError) {
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

      if (error instanceof BitbucketPullRequestNotFoundError) {
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

      if (error instanceof BitbucketProviderError) {
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

      if (error instanceof BitbucketNetworkError) {
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

      if (error instanceof BitbucketNormalizedOutputError) {
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

bitbucketPrCommand
  .command("files")
  .description("List files changed in a Bitbucket pull request")
  .argument("[id]", "Bitbucket pull request ID")
  .option("--repo <repo>", "Bitbucket repository identity as workspace/repo")
  .option("--limit <limit>")
  .option("--cursor <cursor>")
  .option("--debug", "Include redacted provider request metadata")
  .option("--bitbucket-workspace <workspace>")
  .option("--bitbucket-repo <repo>")
  .option("--bitbucket-email <email>")
  .option("--bitbucket-api-token <token>")
  .action(async (id: string | undefined, flags) => {
    const debugRequests: BitbucketDebugRequest[] = [];
    const meta: Record<string, unknown> = flags.debug
      ? { debug: { requests: debugRequests } }
      : {};

    try {
      if (id === undefined) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "MISSING_ARGUMENT",
            message: "Bitbucket pull request ID is required",
            details: { argument: "ID" },
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      const pullRequestId = Number(id);
      if (!Number.isInteger(pullRequestId) || pullRequestId < 1) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "INVALID_ARGUMENT",
            message: "Bitbucket pull request ID must be a positive integer",
            details: { argument: "ID", value: id },
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
            message: "Bitbucket pull request files limit must be between 1 and 100",
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
      const result = await listBitbucketPullRequestFiles(config, pullRequestId, {
        repo: flags.repo,
        limit,
        cursor: flags.cursor,
        debugRequests: flags.debug ? debugRequests : undefined,
      });
      const successMeta = {
        ...meta,
        bitbucket: result.repo,
      };

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data: result.data,
        meta: successMeta,
      });
    } catch (error) {
      if (
        error instanceof BitbucketConfigurationError ||
        error instanceof BitbucketRepoMissingError ||
        error instanceof BitbucketRepoInvalidError ||
        error instanceof ConfigValidationError
      ) {
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

      if (error instanceof BitbucketRepoAmbiguousError) {
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
        process.exitCode = 7;
        return;
      }

      if (error instanceof BitbucketAuthenticationError) {
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

      if (error instanceof BitbucketPullRequestNotFoundError) {
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

      if (error instanceof BitbucketProviderError) {
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

      if (error instanceof BitbucketNetworkError) {
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

      if (error instanceof BitbucketNormalizedOutputError) {
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

bitbucketPrCommand
  .command("diff")
  .description("Fetch a Bitbucket pull request diff by ID")
  .argument("[id]", "Bitbucket pull request ID")
  .option("--repo <repo>", "Bitbucket repository identity as workspace/repo")
  .option("--debug", "Include redacted provider request metadata")
  .option("--bitbucket-workspace <workspace>")
  .option("--bitbucket-repo <repo>")
  .option("--bitbucket-email <email>")
  .option("--bitbucket-api-token <token>")
  .action(async (id: string | undefined, flags) => {
    const debugRequests: BitbucketDebugRequest[] = [];
    const meta: Record<string, unknown> = flags.debug
      ? { debug: { requests: debugRequests } }
      : {};

    try {
      if (id === undefined) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "MISSING_ARGUMENT",
            message: "Bitbucket pull request ID is required",
            details: { argument: "ID" },
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      const pullRequestId = Number(id);
      if (!Number.isInteger(pullRequestId) || pullRequestId < 1) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "INVALID_ARGUMENT",
            message: "Bitbucket pull request ID must be a positive integer",
            details: { argument: "ID", value: id },
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      const config = resolveConfig({ flags, redactSecrets: false });
      const result = await getBitbucketPullRequestDiff(config, pullRequestId, {
        repo: flags.repo,
        debugRequests: flags.debug ? debugRequests : undefined,
      });
      const successMeta = {
        ...meta,
        bitbucket: result.repo,
      };

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data: result.data,
        meta: successMeta,
      });
    } catch (error) {
      if (
        error instanceof BitbucketConfigurationError ||
        error instanceof BitbucketRepoMissingError ||
        error instanceof BitbucketRepoInvalidError ||
        error instanceof ConfigValidationError
      ) {
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

      if (error instanceof BitbucketRepoAmbiguousError) {
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
        process.exitCode = 7;
        return;
      }

      if (error instanceof BitbucketAuthenticationError) {
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

      if (error instanceof BitbucketPullRequestNotFoundError) {
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

      if (error instanceof BitbucketProviderError) {
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

      if (error instanceof BitbucketNetworkError) {
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

      if (error instanceof BitbucketNormalizedOutputError) {
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

bitbucketPrCommand
  .command("get")
  .description("Fetch a Bitbucket pull request by ID")
  .argument("[id]", "Bitbucket pull request ID")
  .option("--repo <repo>", "Bitbucket repository identity as workspace/repo")
  .option("--raw", "Return the provider-native Bitbucket payload")
  .option("--debug", "Include redacted provider request metadata")
  .option("--bitbucket-workspace <workspace>")
  .option("--bitbucket-repo <repo>")
  .option("--bitbucket-email <email>")
  .option("--bitbucket-api-token <token>")
  .action(async (id: string | undefined, flags) => {
    const debugRequests: BitbucketDebugRequest[] = [];
    const meta: Record<string, unknown> = flags.debug
      ? { debug: { requests: debugRequests } }
      : {};

    try {
      if (id === undefined) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "MISSING_ARGUMENT",
            message: "Bitbucket pull request ID is required",
            details: { argument: "ID" },
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      const pullRequestId = Number(id);
      if (!Number.isInteger(pullRequestId) || pullRequestId < 1) {
        writeEnvelope({
          success: false,
          schemaVersion: "1.0",
          error: {
            code: "INVALID_ARGUMENT",
            message: "Bitbucket pull request ID must be a positive integer",
            details: { argument: "ID", value: id },
          },
          meta: {},
        });
        process.exitCode = 2;
        return;
      }

      const config = resolveConfig({ flags, redactSecrets: false });
      const result = await getBitbucketPullRequest(config, pullRequestId, {
        repo: flags.repo,
        raw: flags.raw,
        debugRequests: flags.debug ? debugRequests : undefined,
      });
      const successMeta = {
        ...meta,
        bitbucket: result.repo,
      };

      writeEnvelope({
        success: true,
        schemaVersion: "1.0",
        data: result.data,
        meta: successMeta,
      });
    } catch (error) {
      if (
        error instanceof BitbucketConfigurationError ||
        error instanceof BitbucketRepoMissingError ||
        error instanceof BitbucketRepoInvalidError ||
        error instanceof ConfigValidationError
      ) {
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

      if (error instanceof BitbucketRepoAmbiguousError) {
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
        process.exitCode = 7;
        return;
      }

      if (error instanceof BitbucketAuthenticationError) {
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

      if (error instanceof BitbucketPullRequestNotFoundError) {
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

      if (error instanceof BitbucketProviderError) {
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

      if (error instanceof BitbucketNetworkError) {
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

      if (error instanceof BitbucketNormalizedOutputError) {
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
