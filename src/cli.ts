#!/usr/bin/env node

import { Command } from "commander";
import { bitbucketProvider } from "./bitbucket.js";
import { jiraProvider } from "./jira.js";
import { registerAuthCommands } from "./auth-commands.js";
import { registerBitbucketCommands } from "./bitbucket-commands.js";
import { registerConfigCommands } from "./config-commands.js";
import { registerJiraCommands } from "./jira-commands.js";

const registeredProviders = [jiraProvider, bitbucketProvider];

const program = new Command();

program
  .name("ire")
  .description("Agent-first CLI for Jira and Bitbucket")
  .version("0.1.0");

registerConfigCommands(program);
registerAuthCommands(program, registeredProviders);
registerJiraCommands(program);
registerBitbucketCommands(program);

program.parseAsync(process.argv);
