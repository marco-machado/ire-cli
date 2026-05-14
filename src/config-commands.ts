import type { Command } from "commander";
import { resolveConfig } from "./config.js";
import { handleProviderError, writeEnvelope } from "./output.js";

export function registerConfigCommands(program: Command): void {
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
        if (handleProviderError(error, {})) return;

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
}
