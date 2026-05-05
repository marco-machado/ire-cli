import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function runIre(args, options = {}) {
  const cwd = options.cwd ?? (await mkdtemp(join(tmpdir(), "ire-cli-test-")));
  const home = options.home ?? (await mkdtemp(join(tmpdir(), "ire-cli-home-")));

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [...(options.nodeArgs ?? []), cliPath, ...args],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          ...options.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function parseJson(stdout) {
  return JSON.parse(stdout);
}

async function writeFetchHook(source) {
  const hookDir = await mkdtemp(join(tmpdir(), "ire-cli-fetch-hook-"));
  const hookPath = join(hookDir, "mock-fetch.mjs");
  await writeFile(hookPath, source);
  return hookPath;
}

test("auth check verifies all configured providers and emits successful results", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const authorization = new Headers(init.headers).get("authorization");

      if (!authorization) {
        return Response.json({ message: "missing authorization" }, { status: 401 });
      }

      if (url === "https://jira.example.test/rest/api/3/myself") {
        return Response.json({
          accountId: "jira-account-123",
          displayName: "Jira Agent",
          emailAddress: "agent@example.test"
        });
      }

      if (url === "https://api.bitbucket.org/2.0/user") {
        return Response.json({
          account_id: "bitbucket-account-456",
          display_name: "Bitbucket Agent",
          username: "bb-user"
        });
      }

      return Response.json({ message: "unexpected url", url }, { status: 404 });
    };
  `);

  const result = await runIre(["auth", "check"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
      IRE_BITBUCKET_WORKSPACE: "example-workspace",
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bitbucket-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, true);
  assert.equal(envelope.schemaVersion, "1.0");
  assert.deepEqual(envelope.data, [
    {
      provider: "jira",
      authenticated: true,
      identity: {
        accountId: "jira-account-123",
        displayName: "Jira Agent",
        email: "agent@example.test",
      },
    },
    {
      provider: "bitbucket",
      authenticated: true,
      identity: {
        accountId: "bitbucket-account-456",
        displayName: "Bitbucket Agent",
        username: "bb-user",
        workspace: "example-workspace",
      },
    },
  ]);
  assert.deepEqual(envelope.meta, {});
});

test("auth check jira verifies only Jira", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const authorization = new Headers(init.headers).get("authorization");

      if (url !== "https://jira.example.test/rest/api/3/myself") {
        throw new Error("unexpected provider request: " + url);
      }

      if (!authorization) {
        return Response.json({ message: "missing authorization" }, { status: 401 });
      }

      return Response.json({
        accountId: "jira-account-123",
        displayName: "Jira Agent",
        emailAddress: "agent@example.test"
      });
    };
  `);

  const result = await runIre(["auth", "check", "jira"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
      IRE_BITBUCKET_WORKSPACE: "example-workspace",
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bitbucket-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, true);
  assert.deepEqual(envelope.data, {
    provider: "jira",
    authenticated: true,
    identity: {
      accountId: "jira-account-123",
      displayName: "Jira Agent",
      email: "agent@example.test",
    },
  });
  assert.deepEqual(envelope.meta, {});
});

test("auth check rejects unknown providers", async () => {
  const result = await runIre(["auth", "check", "github"]);
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "INVALID_PROVIDER");
  assert.equal(envelope.error.message, "Unknown auth provider: github");
  assert.deepEqual(envelope.error.details, {
    allowed: ["jira", "bitbucket"],
  });
  assert.deepEqual(envelope.meta, {});
  assert.equal("data" in envelope, false);
});

test("auth check reports partial provider configuration before network calls", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => {
      throw new Error("network call attempted");
    };
  `);

  const result = await runIre(["auth", "check", "jira"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, false);
  assert.equal(envelope.schemaVersion, "1.0");
  assert.equal(envelope.error.code, "AUTH_CONFIG_INCOMPLETE");
  assert.equal(envelope.error.message, "Jira auth configuration is incomplete");
  assert.deepEqual(envelope.error.details, {
    provider: "jira",
    missing: ["apiToken"],
  });
  assert.deepEqual(envelope.meta, {});
  assert.equal("data" in envelope, false);
});

test("auth check reports missing provider configuration when none are configured", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => {
      throw new Error("network call attempted");
    };
  `);

  const result = await runIre(["auth", "check"], {
    nodeArgs: ["--import", hookPath],
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "AUTH_CONFIG_MISSING");
  assert.equal(envelope.error.message, "No provider auth configuration found");
  assert.deepEqual(envelope.error.details, {
    providers: ["jira", "bitbucket"],
  });
  assert.deepEqual(envelope.meta, {});
  assert.equal("data" in envelope, false);
});

test("auth check represents mixed provider success and auth failure", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const authorization = new Headers(init.headers).get("authorization");

      if (!authorization) {
        return Response.json({ message: "missing authorization" }, { status: 401 });
      }

      if (url === "https://jira.example.test/rest/api/3/myself") {
        return Response.json({
          accountId: "jira-account-123",
          displayName: "Jira Agent",
          emailAddress: "agent@example.test"
        });
      }

      if (url === "https://api.bitbucket.org/2.0/user") {
        return Response.json({ message: "invalid credentials" }, { status: 401 });
      }

      return Response.json({ message: "unexpected url", url }, { status: 404 });
    };
  `);

  const result = await runIre(["auth", "check"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
      IRE_BITBUCKET_WORKSPACE: "example-workspace",
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bitbucket-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 3);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, false);
  assert.equal(envelope.schemaVersion, "1.0");
  assert.deepEqual(envelope.data, [
    {
      provider: "jira",
      authenticated: true,
      identity: {
        accountId: "jira-account-123",
        displayName: "Jira Agent",
        email: "agent@example.test",
      },
    },
    {
      provider: "bitbucket",
      authenticated: false,
      error: {
        code: "AUTH_FAILED",
        message: "Bitbucket authentication failed",
        status: 401,
      },
    },
  ]);
  assert.deepEqual(envelope.error, {
    code: "AUTH_CHECK_FAILED",
    message: "One or more auth checks failed",
  });
  assert.deepEqual(envelope.meta, {});
});

test("auth check reports provider API errors with exit code 5", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);

      if (url === "https://api.bitbucket.org/2.0/user") {
        return Response.json({ message: "temporarily unavailable" }, { status: 503 });
      }

      return Response.json({ message: "unexpected url", url }, { status: 404 });
    };
  `);

  const result = await runIre(["auth", "check", "bitbucket"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_BITBUCKET_WORKSPACE: "example-workspace",
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bitbucket-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 5);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, false);
  assert.deepEqual(envelope.data, {
    provider: "bitbucket",
    authenticated: false,
    error: {
      code: "PROVIDER_ERROR",
      message: "Bitbucket provider request failed",
      status: 503,
    },
  });
  assert.deepEqual(envelope.error, {
    code: "AUTH_CHECK_FAILED",
    message: "One or more auth checks failed",
  });
  assert.deepEqual(envelope.meta, {});
});

test("auth check reports network errors with exit code 6", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
  `);

  const result = await runIre(["auth", "check", "jira"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 6);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, false);
  assert.deepEqual(envelope.data, {
    provider: "jira",
    authenticated: false,
    error: {
      code: "NETWORK_ERROR",
      message: "Jira provider request failed",
    },
  });
  assert.deepEqual(envelope.error, {
    code: "AUTH_CHECK_FAILED",
    message: "One or more auth checks failed",
  });
  assert.deepEqual(envelope.meta, {});
});

test("auth check debug metadata redacts authorization and credential values", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const authorization = new Headers(init.headers).get("authorization");

      if (!authorization) {
        return Response.json({ message: "missing authorization" }, { status: 401 });
      }

      return Response.json({
        accountId: "jira-account-123",
        displayName: "Jira Agent",
        emailAddress: "agent@example.test"
      });
    };
  `);

  const result = await runIre(["auth", "check", "jira", "--debug"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-debug-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, true);
  assert.equal(result.stdout.includes("jira-debug-secret"), false);
  assert.equal(result.stdout.toLowerCase().includes("authorization"), false);
  assert.equal(typeof envelope.meta.debug.requests[0].latencyMs, "number");
  assert.deepEqual(
    {
      ...envelope.meta.debug.requests[0],
      latencyMs: 0,
    },
    {
      provider: "jira",
      method: "GET",
      url: "https://jira.example.test/rest/api/3/myself",
      status: 200,
      latencyMs: 0,
    },
  );
});
