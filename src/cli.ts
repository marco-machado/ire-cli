#!/usr/bin/env node

import { Command } from "commander";
import {
  AuthConfigurationError,
  AuthConfigurationMissingError,
  type AuthCheckResult,
  type AuthDebugRequest,
  checkConfiguredProviderAuth,
} from "./auth.js";
import { ConfigValidationError, resolveConfig } from "./config.js";
import { bitbucketProvider } from "./bitbucket.js";
import { jiraProvider } from "./jira.js";
import { writeEnvelope } from "./output.js";
import { registerBitbucketCommands } from "./bitbucket-commands.js";
import { registerJiraCommands } from "./jira-commands.js";

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

registerJiraCommands(program);
registerBitbucketCommands(program);

program.parseAsync(process.argv);
