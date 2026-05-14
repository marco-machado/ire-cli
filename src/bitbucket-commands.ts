import type { Command } from "commander";
import { resolveConfig } from "./config.js";
import {
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
  type BitbucketDebugRequest,
} from "./bitbucket.js";
import { handleProviderError, writeEnvelope } from "./output.js";

export function registerBitbucketCommands(program: Command): void {
  const bitbucketCommand = program.command("bitbucket").description("Read Bitbucket resources");

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

  const bitbucketPrCommand = bitbucketCommand.command("pr").description("Read Bitbucket pull requests");

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
      const meta: Record<string, unknown> = flags.debug ? { debug: { requests: debugRequests } } : {};

      try {
        const limit = flags.limit === undefined ? 50 : Number(flags.limit);

        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          writeEnvelope({
            success: false,
            schemaVersion: "1.0",
            error: {
              code: "INVALID_LIMIT",
              message: "Bitbucket pull request list limit must be between 1 and 100",
              details: { limit: Number.isNaN(limit) ? flags.limit : limit, min: 1, max: 100 },
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

        writeEnvelope({
          success: true,
          schemaVersion: "1.0",
          data: result.data,
          meta: { ...meta, bitbucket: result.repo },
        });
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
      const meta: Record<string, unknown> = flags.debug ? { debug: { requests: debugRequests } } : {};

      try {
        if (id === undefined) {
          writeEnvelope({
            success: false,
            schemaVersion: "1.0",
            error: { code: "MISSING_ARGUMENT", message: "Bitbucket pull request ID is required", details: { argument: "ID" } },
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
            error: { code: "INVALID_ARGUMENT", message: "Bitbucket pull request ID must be a positive integer", details: { argument: "ID", value: id } },
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
              details: { limit: Number.isNaN(limit) ? flags.limit : limit, min: 1, max: 100 },
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

        writeEnvelope({
          success: true,
          schemaVersion: "1.0",
          data: result.data,
          meta: { ...meta, bitbucket: result.repo },
        });
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
      const meta: Record<string, unknown> = flags.debug ? { debug: { requests: debugRequests } } : {};

      try {
        if (id === undefined) {
          writeEnvelope({
            success: false,
            schemaVersion: "1.0",
            error: { code: "MISSING_ARGUMENT", message: "Bitbucket pull request ID is required", details: { argument: "ID" } },
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
            error: { code: "INVALID_ARGUMENT", message: "Bitbucket pull request ID must be a positive integer", details: { argument: "ID", value: id } },
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
              details: { limit: Number.isNaN(limit) ? flags.limit : limit, min: 1, max: 100 },
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

        writeEnvelope({
          success: true,
          schemaVersion: "1.0",
          data: result.data,
          meta: { ...meta, bitbucket: result.repo },
        });
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
      const meta: Record<string, unknown> = flags.debug ? { debug: { requests: debugRequests } } : {};

      try {
        if (id === undefined) {
          writeEnvelope({
            success: false,
            schemaVersion: "1.0",
            error: { code: "MISSING_ARGUMENT", message: "Bitbucket pull request ID is required", details: { argument: "ID" } },
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
            error: { code: "INVALID_ARGUMENT", message: "Bitbucket pull request ID must be a positive integer", details: { argument: "ID", value: id } },
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

        writeEnvelope({
          success: true,
          schemaVersion: "1.0",
          data: result.data,
          meta: { ...meta, bitbucket: result.repo },
        });
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
      const meta: Record<string, unknown> = flags.debug ? { debug: { requests: debugRequests } } : {};

      try {
        if (id === undefined) {
          writeEnvelope({
            success: false,
            schemaVersion: "1.0",
            error: { code: "MISSING_ARGUMENT", message: "Bitbucket pull request ID is required", details: { argument: "ID" } },
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
            error: { code: "INVALID_ARGUMENT", message: "Bitbucket pull request ID must be a positive integer", details: { argument: "ID", value: id } },
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

        writeEnvelope({
          success: true,
          schemaVersion: "1.0",
          data: result.data,
          meta: { ...meta, bitbucket: result.repo },
        });
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
