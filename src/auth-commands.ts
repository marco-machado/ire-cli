import type { Command } from "commander";
import {
  type AuthCheckResult,
  type AuthDebugRequest,
  checkConfiguredProviderAuth,
} from "./auth.js";
import { resolveConfig } from "./config.js";
import { handleProviderError, writeEnvelope } from "./output.js";
import type { Provider } from "./provider.js";

function authResults(data: AuthCheckResult | AuthCheckResult[]): AuthCheckResult[] {
  return Array.isArray(data) ? data : [data];
}

function hasAuthFailures(data: AuthCheckResult | AuthCheckResult[]): boolean {
  return authResults(data).some((result) => !result.authenticated);
}

function authFailureExitCode(data: AuthCheckResult | AuthCheckResult[]): number {
  const exitCodes = authResults(data).map((result) => {
    if (result.authenticated) return 0;
    if (result.error.code === "NETWORK_ERROR") return 6;
    if (result.error.code === "PROVIDER_ERROR") return 5;
    return 3;
  });

  return Math.max(...exitCodes);
}

export function registerAuthCommands(program: Command, providers: Provider[]): void {
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
      const debugRequests: AuthDebugRequest[] = [];
      const meta: Record<string, unknown> = flags.debug
        ? { debug: { requests: debugRequests } }
        : {};

      try {
        const knownProvider =
          provider !== undefined
            ? providers.find((p) => p.name === provider)
            : undefined;

        if (provider !== undefined && knownProvider === undefined) {
          writeEnvelope({
            success: false,
            schemaVersion: "1.0",
            error: {
              code: "INVALID_PROVIDER",
              message: `Unknown auth provider: ${provider}`,
              details: {
                allowed: providers.map((p) => p.name),
              },
            },
            meta: {},
          });
          process.exitCode = 2;
          return;
        }

        const config = resolveConfig({ flags, redactSecrets: false });
        const authOptions = flags.debug ? { debugRequests } : {};
        const data =
          knownProvider === undefined
            ? await checkConfiguredProviderAuth(config, authOptions)
            : await knownProvider.authCheck(config, authOptions);

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
        if (handleProviderError(error, meta)) return;

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
}
