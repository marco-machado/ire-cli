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

program.parseAsync(process.argv);
