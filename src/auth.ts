import type { ResolvedConfig } from "./config.js";

export type ProviderName = "jira" | "bitbucket";

type Fetch = typeof fetch;

type AuthFailureCode = "AUTH_FAILED" | "PROVIDER_ERROR" | "NETWORK_ERROR";

export type AuthDebugRequest = {
  provider: ProviderName;
  method: "GET";
  url: string;
  status?: number;
  latencyMs: number;
};

type AuthCheckOptions = {
  fetchImpl?: Fetch;
  debugRequests?: AuthDebugRequest[];
};

type AuthSuccessResult = {
  provider: ProviderName;
  authenticated: true;
  identity: Record<string, string>;
};

type AuthFailureResult = {
  provider: ProviderName;
  authenticated: false;
  error: {
    code: AuthFailureCode;
    message: string;
    status?: number;
  };
};

export type AuthCheckResult = AuthSuccessResult | AuthFailureResult;

type ProviderField = {
  name: string;
  value: string | null;
};

export class AuthConfigurationError extends Error {
  readonly code = "AUTH_CONFIG_INCOMPLETE";
  readonly details: {
    provider: ProviderName;
    missing: string[];
  };

  constructor(provider: ProviderName, missing: string[]) {
    super(`${providerDisplayName(provider)} auth configuration is incomplete`);
    this.details = { provider, missing };
  }
}

export class AuthConfigurationMissingError extends Error {
  readonly code = "AUTH_CONFIG_MISSING";
  readonly details: {
    providers: ProviderName[];
  };

  constructor() {
    super("No provider auth configuration found");
    this.details = { providers: ["jira", "bitbucket"] };
  }
}

function providerDisplayName(provider: ProviderName): string {
  return provider === "jira" ? "Jira" : "Bitbucket";
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function basicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function providerFailure(
  provider: ProviderName,
  status: number,
): AuthFailureResult {
  if (status === 401 || status === 403) {
    return {
      provider,
      authenticated: false,
      error: {
        code: "AUTH_FAILED",
        message: `${providerDisplayName(provider)} authentication failed`,
        status,
      },
    };
  }

  return {
    provider,
    authenticated: false,
    error: {
      code: "PROVIDER_ERROR",
      message: `${providerDisplayName(provider)} provider request failed`,
      status,
    },
  };
}

async function fetchJson(
  provider: ProviderName,
  url: string,
  init: RequestInit,
  options: AuthCheckOptions,
): Promise<
  { ok: true; body: unknown } | { ok: false; failure: AuthFailureResult }
> {
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(url, init);
  } catch {
    options.debugRequests?.push({
      provider,
      method: "GET",
      url,
      latencyMs: Date.now() - startedAt,
    });

    return {
      ok: false,
      failure: {
        provider,
        authenticated: false,
        error: {
          code: "NETWORK_ERROR",
          message: `${providerDisplayName(provider)} provider request failed`,
        },
      },
    };
  }

  options.debugRequests?.push({
    provider,
    method: "GET",
    url,
    status: response.status,
    latencyMs: Date.now() - startedAt,
  });

  if (!response.ok) {
    return { ok: false, failure: providerFailure(provider, response.status) };
  }

  try {
    return { ok: true, body: await response.json() };
  } catch {
    return {
      ok: false,
      failure: {
        provider,
        authenticated: false,
        error: {
          code: "PROVIDER_ERROR",
          message: `${providerDisplayName(provider)} provider response was invalid`,
          status: response.status,
        },
      },
    };
  }
}

export async function checkConfiguredProviderAuth(
  config: ResolvedConfig,
  options: AuthCheckOptions = {},
): Promise<AuthCheckResult[]> {
  const results: AuthCheckResult[] = [];
  const jiraConfig = providerFields(config, "jira");
  const bitbucketConfig = providerFields(config, "bitbucket");

  assertCompleteIfAnyConfigured("jira", jiraConfig);
  assertCompleteIfAnyConfigured("bitbucket", bitbucketConfig);

  if (isUnconfigured(jiraConfig) && isUnconfigured(bitbucketConfig)) {
    throw new AuthConfigurationMissingError();
  }

  if (isComplete(jiraConfig)) {
    results.push(await checkProviderAuth(config, "jira", options));
  }

  if (isComplete(bitbucketConfig)) {
    results.push(await checkProviderAuth(config, "bitbucket", options));
  }

  return results;
}

export async function checkProviderAuth(
  config: ResolvedConfig,
  provider: ProviderName,
  options: AuthCheckOptions = {},
): Promise<AuthCheckResult> {
  if (provider === "jira") {
    return checkJiraAuth(config, options);
  }

  return checkBitbucketAuth(config, options);
}

async function checkJiraAuth(
  config: ResolvedConfig,
  options: AuthCheckOptions,
): Promise<AuthCheckResult> {
  assertComplete("jira", providerFields(config, "jira"));

  const jiraBaseUrl = config.jira.baseUrl.value;
  const jiraEmail = config.jira.email.value;
  const jiraApiToken = config.jira.apiToken.value;

  if (jiraBaseUrl !== null && jiraEmail !== null && jiraApiToken !== null) {
    const response = await fetchJson(
      "jira",
      `${normalizeBaseUrl(jiraBaseUrl)}/rest/api/3/myself`,
      {
        headers: {
          accept: "application/json",
          authorization: basicAuthorization(jiraEmail, jiraApiToken),
        },
      },
      options,
    );

    if (!response.ok) {
      return response.failure;
    }

    const body = response.body as {
      accountId?: unknown;
      displayName?: unknown;
      emailAddress?: unknown;
    };

    return {
      provider: "jira",
      authenticated: true,
      identity: {
        accountId: typeof body.accountId === "string" ? body.accountId : "",
        displayName:
          typeof body.displayName === "string" ? body.displayName : "",
        email: typeof body.emailAddress === "string" ? body.emailAddress : "",
      },
    };
  }

  throw new Error("Unreachable Jira configuration state");
}

async function checkBitbucketAuth(
  config: ResolvedConfig,
  options: AuthCheckOptions,
): Promise<AuthCheckResult> {
  assertComplete("bitbucket", providerFields(config, "bitbucket"));

  const bitbucketWorkspace = config.bitbucket.workspace.value;
  const bitbucketUsername = config.bitbucket.username.value;
  const bitbucketAppPassword = config.bitbucket.appPassword.value;

  if (
    bitbucketWorkspace !== null &&
    bitbucketUsername !== null &&
    bitbucketAppPassword !== null
  ) {
    const response = await fetchJson(
      "bitbucket",
      "https://api.bitbucket.org/2.0/user",
      {
        headers: {
          accept: "application/json",
          authorization: basicAuthorization(
            bitbucketUsername,
            bitbucketAppPassword,
          ),
        },
      },
      options,
    );

    if (!response.ok) {
      return response.failure;
    }

    const body = response.body as {
      account_id?: unknown;
      display_name?: unknown;
      username?: unknown;
    };

    return {
      provider: "bitbucket",
      authenticated: true,
      identity: {
        accountId: typeof body.account_id === "string" ? body.account_id : "",
        displayName:
          typeof body.display_name === "string" ? body.display_name : "",
        username: typeof body.username === "string" ? body.username : "",
        workspace: bitbucketWorkspace,
      },
    };
  }

  throw new Error("Unreachable Bitbucket configuration state");
}

function providerFields(
  config: ResolvedConfig,
  provider: ProviderName,
): ProviderField[] {
  if (provider === "jira") {
    return [
      { name: "baseUrl", value: config.jira.baseUrl.value },
      { name: "email", value: config.jira.email.value },
      { name: "apiToken", value: config.jira.apiToken.value },
    ];
  }

  return [
    { name: "workspace", value: config.bitbucket.workspace.value },
    { name: "username", value: config.bitbucket.username.value },
    { name: "appPassword", value: config.bitbucket.appPassword.value },
  ];
}

function isComplete(fields: ProviderField[]): boolean {
  return fields.every((field) => field.value !== null);
}

function isUnconfigured(fields: ProviderField[]): boolean {
  return fields.every((field) => field.value === null);
}

function missingFields(fields: ProviderField[]): string[] {
  return fields
    .filter((field) => field.value === null)
    .map((field) => field.name);
}

function assertComplete(provider: ProviderName, fields: ProviderField[]): void {
  const missing = missingFields(fields);

  if (missing.length > 0) {
    throw new AuthConfigurationError(provider, missing);
  }
}

function assertCompleteIfAnyConfigured(
  provider: ProviderName,
  fields: ProviderField[],
): void {
  if (isUnconfigured(fields)) {
    return;
  }

  assertComplete(provider, fields);
}
