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
  bitbucketRepo?: string;
  bitbucketEmail?: string;
  bitbucketApiToken?: string;
};

type ResolveConfigOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  flags?: ConfigFlags;
  homeDir?: string;
  redactSecrets?: boolean;
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
    repo: ResolvedField;
    email: ResolvedField;
    apiToken: ResolvedField;
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
    repo: { envVar: "IRE_BITBUCKET_REPO", secret: false },
    email: { envVar: "IRE_BITBUCKET_EMAIL", secret: false },
    apiToken: { envVar: "IRE_BITBUCKET_API_TOKEN", secret: true },
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
        repo: nullableString,
        email: nullableString,
        apiToken: nullableString,
      })
      .strict()
      .optional(),
  })
  .strict();

type ConfigFile = z.infer<typeof configFileSchema>;

function visibleValue(
  definition: FieldDefinition,
  value: string | null,
  redactSecrets: boolean,
): string | null {
  if (value === null) {
    return null;
  }

  return definition.secret && redactSecrets ? redactedSecret : value;
}

function applySource(
  config: ResolvedConfig,
  values: RawConfigValues,
  source: ConfigSource,
  redactSecrets: boolean,
): void {
  config.jira.baseUrl = resolveSourceField(
    fields.jira.baseUrl,
    values[fields.jira.baseUrl.envVar],
    source,
    config.jira.baseUrl,
    redactSecrets,
  );
  config.jira.email = resolveSourceField(
    fields.jira.email,
    values[fields.jira.email.envVar],
    source,
    config.jira.email,
    redactSecrets,
  );
  config.jira.apiToken = resolveSourceField(
    fields.jira.apiToken,
    values[fields.jira.apiToken.envVar],
    source,
    config.jira.apiToken,
    redactSecrets,
  );
  config.bitbucket.workspace = resolveSourceField(
    fields.bitbucket.workspace,
    values[fields.bitbucket.workspace.envVar],
    source,
    config.bitbucket.workspace,
    redactSecrets,
  );
  config.bitbucket.repo = resolveSourceField(
    fields.bitbucket.repo,
    values[fields.bitbucket.repo.envVar],
    source,
    config.bitbucket.repo,
    redactSecrets,
  );
  config.bitbucket.email = resolveSourceField(
    fields.bitbucket.email,
    values[fields.bitbucket.email.envVar],
    source,
    config.bitbucket.email,
    redactSecrets,
  );
  config.bitbucket.apiToken = resolveSourceField(
    fields.bitbucket.apiToken,
    values[fields.bitbucket.apiToken.envVar],
    source,
    config.bitbucket.apiToken,
    redactSecrets,
  );
}

function resolveSourceField(
  definition: FieldDefinition,
  value: string | null | undefined,
  source: ConfigSource,
  current: ResolvedField,
  redactSecrets: boolean,
): ResolvedField {
  if (value === undefined) {
    return current;
  }

  return {
    value: visibleValue(definition, value, redactSecrets),
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
    [fields.bitbucket.repo.envVar]: config.bitbucket?.repo,
    [fields.bitbucket.email.envVar]: config.bitbucket?.email,
    [fields.bitbucket.apiToken.envVar]: config.bitbucket?.apiToken,
  };
}

function flagsToValues(flags: ConfigFlags): RawConfigValues {
  return {
    [fields.jira.baseUrl.envVar]: flags.jiraBaseUrl,
    [fields.jira.email.envVar]: flags.jiraEmail,
    [fields.jira.apiToken.envVar]: flags.jiraApiToken,
    [fields.bitbucket.workspace.envVar]: flags.bitbucketWorkspace,
    [fields.bitbucket.repo.envVar]: flags.bitbucketRepo,
    [fields.bitbucket.email.envVar]: flags.bitbucketEmail,
    [fields.bitbucket.apiToken.envVar]: flags.bitbucketApiToken,
  };
}

export function resolveConfig(options: ResolveConfigOptions = {}): ResolvedConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const flags = options.flags ?? {};
  const projectRoot = findProjectRoot(cwd);
  const redactSecrets = options.redactSecrets ?? true;
  const config = {
    jira: {
      baseUrl: defaultField(),
      email: defaultField(),
      apiToken: defaultField(),
    },
    bitbucket: {
      workspace: defaultField(),
      repo: defaultField(),
      email: defaultField(),
      apiToken: defaultField(),
    },
  };

  applySource(
    config,
    readConfigFile(
      join(options.homeDir ?? homedir(), ".config", "ire-cli", "config.json"),
      "user config",
    ),
    "user-config",
    redactSecrets,
  );
  applySource(
    config,
    readConfigFile(join(projectRoot, ".ire", "config.json"), "project config"),
    "project-config",
    redactSecrets,
  );
  applySource(config, readProjectEnv(cwd), "project-env", redactSecrets);
  applySource(config, env, "env", redactSecrets);
  applySource(config, flagsToValues(flags), "flag", redactSecrets);

  return config;
}
