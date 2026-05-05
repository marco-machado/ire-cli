#!/usr/bin/env node

import { Command } from "commander";
import { ConfigValidationError, resolveConfig } from "./config.js";

type SuccessEnvelope = {
  success: true;
  schemaVersion: "1.0";
  data: unknown;
  meta: Record<string, never>;
};

type ErrorEnvelope = {
  success: false;
  schemaVersion: "1.0";
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: Record<string, never>;
};

function writeEnvelope(envelope: SuccessEnvelope | ErrorEnvelope): void {
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
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

program.parseAsync(process.argv);
