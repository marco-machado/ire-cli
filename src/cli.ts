#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { bitbucketProvider } from "./bitbucket.js";
import { jiraProvider } from "./jira.js";
import { registerAuthCommands } from "./auth-commands.js";
import { registerBitbucketCommands } from "./bitbucket-commands.js";
import { registerConfigCommands } from "./config-commands.js";
import { registerJiraCommands } from "./jira-commands.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8"),
) as { version: string };

const registeredProviders = [jiraProvider, bitbucketProvider];

const program = new Command();

program
  .name("ire")
  .description("Agent-first CLI for Jira and Bitbucket")
  .version(version);

registerConfigCommands(program);
registerAuthCommands(program, registeredProviders);
registerJiraCommands(program);
registerBitbucketCommands(program);

program.parseAsync(process.argv);
