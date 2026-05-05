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

test("jira issue get fetches an explicit key and emits a normalized issue envelope", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);

      if (url !== "https://jira.example.test/rest/api/3/issue/ABC-123") {
        return Response.json({ message: "unexpected url", url }, { status: 500 });
      }

      if (headers.get("accept") !== "application/json") {
        return Response.json({ message: "missing accept header" }, { status: 500 });
      }

      const expectedAuthorization = "Basic " + Buffer.from("agent@example.test:jira-secret").toString("base64");
      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }

      return Response.json({
        id: "10001",
        key: "ABC-123",
        fields: {
          summary: "Fix issue retrieval",
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Loaded from Jira" }]
              }
            ]
          },
          status: { name: "In Progress" },
          issuetype: { name: "Bug" },
          priority: { name: "High" },
          project: { key: "ABC", name: "Agent Bridge" },
          assignee: { accountId: "assignee-1", displayName: "Assignee One" },
          reporter: { accountId: "reporter-1", displayName: "Reporter One" },
          labels: ["agent", "cli"],
          created: "2026-05-04T12:34:56.000+0000",
          updated: "2026-05-04T13:45:01.000+0000"
        }
      });
    };
  `);

  const result = await runIre(["jira", "issue", "get", "ABC-123"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test/",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("jira-secret"), false);
  assert.equal(envelope.success, true);
  assert.equal(envelope.schemaVersion, "1.0");
  assert.deepEqual(envelope.data, {
    key: "ABC-123",
    summary: "Fix issue retrieval",
    description: "Loaded from Jira",
    status: "In Progress",
    issueType: "Bug",
    priority: "High",
    project: { key: "ABC", name: "Agent Bridge" },
    assignee: { accountId: "assignee-1", displayName: "Assignee One" },
    reporter: { accountId: "reporter-1", displayName: "Reporter One" },
    labels: ["agent", "cli"],
    created: "2026-05-04T12:34:56.000Z",
    updated: "2026-05-04T13:45:01.000Z",
  });
  assert.deepEqual(envelope.meta, {});
});

test("jira issue get --raw returns the provider-native payload in a success envelope", async () => {
  const providerPayload = {
    id: "10002",
    key: "ABC-456",
    self: "https://jira.example.test/rest/api/3/issue/10002",
    fields: {
      summary: "Keep native payload intact",
      labels: ["raw"],
      customfield_10010: { value: "provider-specific" },
    },
  };
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);

      if (url !== "https://jira.example.test/rest/api/3/issue/ABC-456") {
        return Response.json({ message: "unexpected url", url }, { status: 500 });
      }

      return Response.json(${JSON.stringify(providerPayload)});
    };
  `);

  const result = await runIre(["jira", "issue", "get", "ABC-456", "--raw"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("jira-secret"), false);
  assert.equal(envelope.success, true);
  assert.deepEqual(envelope.data, providerPayload);
  assert.deepEqual(envelope.meta, {});
});

test("jira issue get requires an explicit issue key", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => {
      throw new Error("network call attempted");
    };
  `);

  const result = await runIre(["jira", "issue", "get"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, false);
  assert.equal(envelope.schemaVersion, "1.0");
  assert.equal(envelope.error.code, "MISSING_ARGUMENT");
  assert.equal(envelope.error.message, "Jira issue key is required");
  assert.deepEqual(envelope.error.details, {
    argument: "KEY",
  });
  assert.deepEqual(envelope.meta, {});
  assert.equal("data" in envelope, false);
});

test("jira issue get reports incomplete Jira configuration before network calls", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => {
      throw new Error("network call attempted");
    };
  `);

  const result = await runIre(["jira", "issue", "get", "ABC-123"], {
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
  assert.equal(envelope.error.code, "AUTH_CONFIG_INCOMPLETE");
  assert.equal(envelope.error.message, "Jira auth configuration is incomplete");
  assert.deepEqual(envelope.error.details, {
    provider: "jira",
    missing: ["apiToken"],
  });
  assert.deepEqual(envelope.meta, {});
  assert.equal("data" in envelope, false);
});

test("jira issue get omits absent optional fields and preserves known-empty values", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json({
      id: "10003",
      key: "ABC-789",
      fields: {
        summary: "Optional fields",
        description: null,
        status: { name: "To Do" },
        issuetype: { name: "Task" },
        project: { key: "ABC", name: "Agent Bridge" },
        assignee: null,
        labels: [],
        created: "2026-05-04T09:00:00.000+0000",
        updated: "2026-05-04T09:15:00.000+0000"
      }
    });
  `);

  const result = await runIre(["jira", "issue", "get", "ABC-789"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("undefined"), false);
  assert.deepEqual(envelope.data, {
    key: "ABC-789",
    summary: "Optional fields",
    description: null,
    status: "To Do",
    issueType: "Task",
    project: { key: "ABC", name: "Agent Bridge" },
    assignee: null,
    labels: [],
    created: "2026-05-04T09:00:00.000Z",
    updated: "2026-05-04T09:15:00.000Z",
  });
  assert.equal("priority" in envelope.data, false);
  assert.equal("reporter" in envelope.data, false);
});

test("jira issue get maps provider 404 responses to a structured not-found error", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json(
      { errorMessages: ["Issue does not exist"] },
      { status: 404 }
    );
  `);

  const result = await runIre(["jira", "issue", "get", "ABC-404"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 4);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("jira-secret"), false);
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "JIRA_ISSUE_NOT_FOUND");
  assert.equal(envelope.error.message, "Jira issue ABC-404 was not found");
  assert.deepEqual(envelope.error.details, {
    key: "ABC-404",
    status: 404,
  });
  assert.deepEqual(envelope.meta, {});
  assert.equal("data" in envelope, false);
});

test("jira issue get maps provider auth failures to exit code 3", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json(
      { errorMessages: ["Unauthorized"] },
      { status: 401 }
    );
  `);

  const result = await runIre(["jira", "issue", "get", "ABC-401"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 3);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("jira-secret"), false);
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "JIRA_AUTH_FAILED");
  assert.equal(envelope.error.message, "Jira authentication failed");
  assert.deepEqual(envelope.error.details, {
    status: 401,
  });
  assert.deepEqual(envelope.meta, {});
  assert.equal("data" in envelope, false);
});

test("jira issue get maps provider API failures to exit code 5", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json(
      { errorMessages: ["Jira is unavailable"] },
      { status: 503 }
    );
  `);

  const result = await runIre(["jira", "issue", "get", "ABC-503"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 5);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("jira-secret"), false);
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "JIRA_PROVIDER_ERROR");
  assert.equal(envelope.error.message, "Jira provider request failed");
  assert.deepEqual(envelope.error.details, {
    status: 503,
  });
  assert.deepEqual(envelope.meta, {});
  assert.equal("data" in envelope, false);
});

test("jira issue get maps network failures to exit code 6", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
  `);

  const result = await runIre(["jira", "issue", "get", "ABC-NET"], {
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
  assert.equal(result.stdout.includes("jira-secret"), false);
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "JIRA_NETWORK_ERROR");
  assert.equal(envelope.error.message, "Jira provider request failed");
  assert.deepEqual(envelope.meta, {});
  assert.equal("data" in envelope, false);
});

test("jira issue get treats malformed normalized output as an internal error", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json({
      id: "10004",
      key: "ABC-BAD",
      fields: {
        status: { name: "Done" },
        issuetype: { name: "Bug" },
        project: { key: "ABC", name: "Agent Bridge" },
        labels: [],
        created: "2026-05-04T10:00:00.000+0000",
        updated: "2026-05-04T10:05:00.000+0000"
      }
    });
  `);

  const result = await runIre(["jira", "issue", "get", "ABC-BAD"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("jira-secret"), false);
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "INTERNAL_ERROR");
  assert.equal(
    envelope.error.message,
    "Normalized Jira issue output failed validation",
  );
  assert.equal(
    envelope.error.details.some((detail) => detail.path === "summary"),
    true,
  );
  assert.deepEqual(envelope.meta, {});
  assert.equal("data" in envelope, false);
});

test("jira issue get debug metadata redacts authorization and credential values", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json({
      id: "10005",
      key: "ABC-DEBUG",
      fields: {
        summary: "Debug metadata",
        status: { name: "Done" },
        issuetype: { name: "Task" },
        project: { key: "ABC", name: "Agent Bridge" },
        labels: [],
        created: "2026-05-04T11:00:00.000+0000",
        updated: "2026-05-04T11:01:00.000+0000"
      }
    });
  `);

  const result = await runIre(
    ["jira", "issue", "get", "ABC-DEBUG", "--debug"],
    {
      nodeArgs: ["--import", hookPath],
      env: {
        IRE_JIRA_BASE_URL: "https://jira.example.test",
        IRE_JIRA_EMAIL: "agent@example.test",
        IRE_JIRA_API_TOKEN: "jira-secret",
      },
    },
  );
  const envelope = parseJson(result.stdout);
  const serializedMeta = JSON.stringify(envelope.meta);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("jira-secret"), false);
  assert.equal(serializedMeta.includes("authorization"), false);
  assert.equal(serializedMeta.includes("agent@example.test"), false);
  assert.deepEqual(envelope.meta.debug.requests[0], {
    provider: "jira",
    method: "GET",
    url: "https://jira.example.test/rest/api/3/issue/ABC-DEBUG",
    status: 200,
    latencyMs: envelope.meta.debug.requests[0].latencyMs,
  });
  assert.equal(typeof envelope.meta.debug.requests[0].latencyMs, "number");
});

test("jira issue get includes redacted debug metadata on provider failures", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json(
      { errorMessages: ["Issue does not exist"] },
      { status: 404 }
    );
  `);

  const result = await runIre(
    ["jira", "issue", "get", "ABC-404", "--debug"],
    {
      nodeArgs: ["--import", hookPath],
      env: {
        IRE_JIRA_BASE_URL: "https://jira.example.test",
        IRE_JIRA_EMAIL: "agent@example.test",
        IRE_JIRA_API_TOKEN: "jira-secret",
      },
    },
  );
  const envelope = parseJson(result.stdout);
  const serializedMeta = JSON.stringify(envelope.meta);

  assert.equal(result.exitCode, 4);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("jira-secret"), false);
  assert.equal(serializedMeta.includes("authorization"), false);
  assert.equal(serializedMeta.includes("agent@example.test"), false);
  assert.equal(envelope.error.code, "JIRA_ISSUE_NOT_FOUND");
  assert.deepEqual(envelope.meta.debug.requests[0], {
    provider: "jira",
    method: "GET",
    url: "https://jira.example.test/rest/api/3/issue/ABC-404",
    status: 404,
    latencyMs: envelope.meta.debug.requests[0].latencyMs,
  });
  assert.equal(typeof envelope.meta.debug.requests[0].latencyMs, "number");
});
