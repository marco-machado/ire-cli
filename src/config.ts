import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

export type ConfigSource =
  | "flag"
  | "env"
  | "project-env"
  | "project-config"
  | "user-config"
  | "default";

type ResolvedField = {
  value: string | null;
  source: ConfigSource;
};

type FieldDefinition = {
  envVar: string;
  secret: boolean;
};

type RawConfigValues = Record<string, string | null | undefined>;

export type ConfigFlags = {
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  bitbucketWorkspace?: string;
  bitbucketUsername?: string;
  bitbucketAppPassword?: string;
};

type ResolveConfigOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  flags?: ConfigFlags;
  homeDir?: string;
};

export class ConfigValidationError extends Error {
  readonly code = "CONFIG_VALIDATION_ERROR";
  readonly details: Array<{ code: string; message: string; path: string }>;

  constructor(
    readonly configSource: "project config" | "user config",
    readonly configPath: string,
    details: Array<{ code: string; message: string; path: string }>,
  ) {
    super(`Invalid ${configSource} at ${configPath}`);
    this.details = details;
  }
}

export type ResolvedConfig = {
  jira: {
    baseUrl: ResolvedField;
    email: ResolvedField;
    apiToken: ResolvedField;
  };
  bitbucket: {
    workspace: ResolvedField;
    username: ResolvedField;
    appPassword: ResolvedField;
  };
};

const defaultField = (): ResolvedField => ({
  value: null,
  source: "default",
});

const redactedSecret = "<redacted>";

const fields = {
  jira: {
    baseUrl: { envVar: "IRE_JIRA_BASE_URL", secret: false },
    email: { envVar: "IRE_JIRA_EMAIL", secret: false },
    apiToken: { envVar: "IRE_JIRA_API_TOKEN", secret: true },
  },
  bitbucket: {
    workspace: { envVar: "IRE_BITBUCKET_WORKSPACE", secret: false },
    username: { envVar: "IRE_BITBUCKET_USERNAME", secret: false },
    appPassword: { envVar: "IRE_BITBUCKET_APP_PASSWORD", secret: true },
  },
} satisfies Record<string, Record<string, FieldDefinition>>;

const nullableString = z.string().nullable().optional();

const configFileSchema = z
  .object({
    jira: z
      .object({
        baseUrl: nullableString,
        email: nullableString,
        apiToken: nullableString,
      })
      .strict()
      .optional(),
    bitbucket: z
      .object({
        workspace: nullableString,
        username: nullableString,
        appPassword: nullableString,
      })
      .strict()
      .optional(),
  })
  .strict();

type ConfigFile = z.infer<typeof configFileSchema>;

function visibleValue(
  definition: FieldDefinition,
  value: string | null,
): string | null {
  if (value === null) {
    return null;
  }

  return definition.secret ? redactedSecret : value;
}

function applySource(
  config: ResolvedConfig,
  values: RawConfigValues,
  source: ConfigSource,
): void {
  config.jira.baseUrl = resolveSourceField(
    fields.jira.baseUrl,
    values[fields.jira.baseUrl.envVar],
    source,
    config.jira.baseUrl,
  );
  config.jira.email = resolveSourceField(
    fields.jira.email,
    values[fields.jira.email.envVar],
    source,
    config.jira.email,
  );
  config.jira.apiToken = resolveSourceField(
    fields.jira.apiToken,
    values[fields.jira.apiToken.envVar],
    source,
    config.jira.apiToken,
  );
  config.bitbucket.workspace = resolveSourceField(
    fields.bitbucket.workspace,
    values[fields.bitbucket.workspace.envVar],
    source,
    config.bitbucket.workspace,
  );
  config.bitbucket.username = resolveSourceField(
    fields.bitbucket.username,
    values[fields.bitbucket.username.envVar],
    source,
    config.bitbucket.username,
  );
  config.bitbucket.appPassword = resolveSourceField(
    fields.bitbucket.appPassword,
    values[fields.bitbucket.appPassword.envVar],
    source,
    config.bitbucket.appPassword,
  );
}

function resolveSourceField(
  definition: FieldDefinition,
  value: string | null | undefined,
  source: ConfigSource,
  current: ResolvedField,
): ResolvedField {
  if (value === undefined) {
    return current;
  }

  return {
    value: visibleValue(definition, value),
    source,
  };
}

function findProjectRoot(cwd: string): string {
  let current = resolve(cwd);

  while (true) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return resolve(cwd);
    }

    current = parent;
  }
}

function parseEnvFile(contents: string): RawConfigValues {
  const values: RawConfigValues = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      trimmed,
    );

    if (!match) {
      continue;
    }

    values[match[1]] = unquoteEnvValue(match[2].trim());
  }

  return values;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function readProjectEnv(cwd: string): RawConfigValues {
  const envPath = join(findProjectRoot(cwd), ".env");

  if (!existsSync(envPath)) {
    return {};
  }

  return parseEnvFile(readFileSync(envPath, "utf8"));
}

function readConfigFile(
  configPath: string,
  configSource: "project config" | "user config",
): RawConfigValues {
  if (!existsSync(configPath)) {
    return {};
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new ConfigValidationError(configSource, configPath, [
      {
        code: "invalid_json",
        message: error instanceof Error ? error.message : "Invalid JSON",
        path: "",
      },
    ]);
  }

  const parsedResult = configFileSchema.safeParse(parsedJson);

  if (!parsedResult.success) {
    throw new ConfigValidationError(
      configSource,
      configPath,
      parsedResult.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join("."),
      })),
    );
  }

  return configFileToValues(parsedResult.data);
}

function configFileToValues(config: ConfigFile): RawConfigValues {
  return {
    [fields.jira.baseUrl.envVar]: config.jira?.baseUrl,
    [fields.jira.email.envVar]: config.jira?.email,
    [fields.jira.apiToken.envVar]: config.jira?.apiToken,
    [fields.bitbucket.workspace.envVar]: config.bitbucket?.workspace,
    [fields.bitbucket.username.envVar]: config.bitbucket?.username,
    [fields.bitbucket.appPassword.envVar]: config.bitbucket?.appPassword,
  };
}

function flagsToValues(flags: ConfigFlags): RawConfigValues {
  return {
    [fields.jira.baseUrl.envVar]: flags.jiraBaseUrl,
    [fields.jira.email.envVar]: flags.jiraEmail,
    [fields.jira.apiToken.envVar]: flags.jiraApiToken,
    [fields.bitbucket.workspace.envVar]: flags.bitbucketWorkspace,
    [fields.bitbucket.username.envVar]: flags.bitbucketUsername,
    [fields.bitbucket.appPassword.envVar]: flags.bitbucketAppPassword,
  };
}

export function resolveConfig(options: ResolveConfigOptions = {}): ResolvedConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const flags = options.flags ?? {};
  const projectRoot = findProjectRoot(cwd);
  const config = {
    jira: {
      baseUrl: defaultField(),
      email: defaultField(),
      apiToken: defaultField(),
    },
    bitbucket: {
      workspace: defaultField(),
      username: defaultField(),
      appPassword: defaultField(),
    },
  };

  applySource(
    config,
    readConfigFile(
      join(options.homeDir ?? homedir(), ".config", "ire-cli", "config.json"),
      "user config",
    ),
    "user-config",
  );
  applySource(
    config,
    readConfigFile(join(projectRoot, ".ire", "config.json"), "project config"),
    "project-config",
  );
  applySource(config, readProjectEnv(cwd), "project-env");
  applySource(config, env, "env");
  applySource(config, flagsToValues(flags), "flag");

  return config;
}
