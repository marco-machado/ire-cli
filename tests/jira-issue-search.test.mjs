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

test("jira issue search runs JQL with the default limit and emits normalized paginated results", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const headers = new Headers(init.headers);

      if (url.origin + url.pathname === "https://jira.example.test/rest/api/3/search") {
        return Response.json({ message: "deprecated endpoint used" }, { status: 410 });
      }

      if (url.origin + url.pathname !== "https://jira.example.test/rest/api/3/search/jql") {
        return Response.json({ message: "unexpected url", url: String(input) }, { status: 500 });
      }

      if (init.method !== "POST") {
        return Response.json({ message: "unexpected method", method: init.method }, { status: 500 });
      }

      if (url.search !== "") {
        return Response.json({ message: "unexpected query string", search: url.search }, { status: 500 });
      }

      if (headers.get("content-type") !== "application/json") {
        return Response.json({ message: "unexpected content type" }, { status: 500 });
      }

      if (headers.get("accept") !== "application/json") {
        return Response.json({ message: "unexpected accept header" }, { status: 500 });
      }

      const body = JSON.parse(init.body);
      const expectedBody = {
        jql: "project = ABC ORDER BY updated DESC",
        maxResults: 50,
        fields: ["key", "summary", "status", "issuetype", "priority", "assignee", "created", "updated"]
      };
      if (JSON.stringify(body) !== JSON.stringify(expectedBody)) {
        return Response.json({ message: "unexpected body", body }, { status: 500 });
      }

      const expectedAuthorization = "Basic " + Buffer.from("agent@example.test:jira-secret").toString("base64");
      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }

      return Response.json({
        isLast: false,
        nextPageToken: "opaque-next-page-token",
        issues: [
          {
            key: "ABC-123",
            fields: {
              summary: "Searchable issue",
              status: { name: "In Progress" },
              issuetype: { name: "Bug" },
              priority: { name: "High" },
              assignee: { accountId: "assignee-1", displayName: "Assignee One" },
              created: "2026-05-04T12:34:56.000+0000",
              updated: "2026-05-04T13:45:01.000+0000"
            }
          }
        ]
      });
    };
  `);

  const result = await runIre(
    ["jira", "issue", "search", "--jql", "project = ABC ORDER BY updated DESC"],
    {
      nodeArgs: ["--import", hookPath],
      env: {
        IRE_JIRA_BASE_URL: "https://jira.example.test/",
        IRE_JIRA_EMAIL: "agent@example.test",
        IRE_JIRA_API_TOKEN: "jira-secret",
      },
    },
  );
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("jira-secret"), false);
  assert.equal(envelope.success, true);
  assert.equal(envelope.schemaVersion, "1.0");
  assert.deepEqual(envelope.data, {
    issues: [
      {
        key: "ABC-123",
        summary: "Searchable issue",
        status: "In Progress",
        issueType: "Bug",
        priority: "High",
        assignee: { accountId: "assignee-1", displayName: "Assignee One" },
        created: "2026-05-04T12:34:56.000Z",
        updated: "2026-05-04T13:45:01.000Z",
      },
    ],
    pagination: {
      limit: 50,
      nextCursor: "opaque-next-page-token",
      hasNextPage: true,
    },
  });
  assert.deepEqual(envelope.meta, {});
});

test("jira issue search rejects limits above 100 before network calls", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => {
      throw new Error("network call attempted");
    };
  `);

  const result = await runIre(
    ["jira", "issue", "search", "--jql", "project = ABC", "--limit", "101"],
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

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "INVALID_LIMIT");
  assert.equal(envelope.error.message, "Jira issue search limit must be between 1 and 100");
  assert.deepEqual(envelope.error.details, {
    limit: 101,
    min: 1,
    max: 100,
  });
  assert.deepEqual(envelope.meta, {});
  assert.equal("data" in envelope, false);
});

test("jira issue search propagates limit and cursor and emits last-page pagination metadata", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const body = JSON.parse(init.body);

      if (url.origin + url.pathname !== "https://jira.example.test/rest/api/3/search/jql") {
        return Response.json({ message: "unexpected url", url: String(input) }, { status: 500 });
      }

      if (init.method !== "POST") {
        return Response.json({ message: "unexpected method", method: init.method }, { status: 500 });
      }

      if (body.maxResults !== 25) {
        return Response.json({ message: "unexpected maxResults", maxResults: body.maxResults }, { status: 500 });
      }

      if (body.nextPageToken !== "opaque-current-page-token") {
        return Response.json({ message: "unexpected nextPageToken", nextPageToken: body.nextPageToken }, { status: 500 });
      }

      if ("startAt" in body) {
        return Response.json({ message: "unexpected startAt", startAt: body.startAt }, { status: 500 });
      }

      return Response.json({
        isLast: true,
        issues: []
      });
    };
  `);

  const result = await runIre(
    ["jira", "issue", "search", "--jql", "project = ABC", "--limit", "25", "--cursor", "opaque-current-page-token"],
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

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(envelope.data, {
    issues: [],
    pagination: {
      limit: 25,
      nextCursor: null,
      hasNextPage: false,
    },
  });
});

test("jira issue search debug metadata reports the enhanced POST request without credentials", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json({ isLast: true, issues: [] });
  `);

  const result = await runIre(
    ["jira", "issue", "search", "--jql", "project = ABC", "--debug"],
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

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("jira-secret"), false);
  assert.equal(result.stdout.includes("agent@example.test"), false);
  assert.deepEqual(envelope.meta.debug.requests[0], {
    provider: "jira",
    method: "POST",
    url: "https://jira.example.test/rest/api/3/search/jql",
    status: 200,
    latencyMs: envelope.meta.debug.requests[0].latencyMs,
  });
  assert.equal(typeof envelope.meta.debug.requests[0].latencyMs, "number");
});

test("jira issue search requires JQL before network calls", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => {
      throw new Error("network call attempted");
    };
  `);

  const result = await runIre(["jira", "issue", "search"], {
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
  assert.equal(envelope.error.code, "MISSING_OPTION");
  assert.equal(envelope.error.message, "Jira issue search JQL is required");
  assert.deepEqual(envelope.error.details, {
    option: "--jql",
  });
  assert.deepEqual(envelope.meta, {});
  assert.equal("data" in envelope, false);
});

test("jira issue search maps provider auth failures to exit code 3", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json(
      { errorMessages: ["Unauthorized"] },
      { status: 401 }
    );
  `);

  const result = await runIre(["jira", "issue", "search", "--jql", "project = ABC"], {
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
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "JIRA_AUTH_FAILED");
  assert.deepEqual(envelope.error.details, { status: 401 });
});

test("jira issue search maps provider failures including malformed JQL to exit code 5", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json(
      { errorMessages: ["The JQL query is malformed"] },
      { status: 400 }
    );
  `);

  const result = await runIre(["jira", "issue", "search", "--jql", "not valid jql"], {
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
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "JIRA_PROVIDER_ERROR");
  assert.deepEqual(envelope.error.details, { status: 400 });
});

test("jira issue search maps network failures to exit code 6", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
  `);

  const result = await runIre(["jira", "issue", "search", "--jql", "project = ABC"], {
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
  assert.equal(envelope.error.code, "JIRA_NETWORK_ERROR");
});

test("jira issue search treats malformed normalized output as an internal error", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json({
      startAt: 0,
      maxResults: 50,
      total: 1,
      issues: [
        {
          key: "ABC-BAD",
          fields: {
            status: { name: "Done" },
            issuetype: { name: "Task" },
            created: "2026-05-04T12:34:56.000+0000",
            updated: "2026-05-04T13:45:01.000+0000"
          }
        }
      ]
    });
  `);

  const result = await runIre(["jira", "issue", "search", "--jql", "project = ABC"], {
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
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "INTERNAL_ERROR");
  assert.equal(envelope.error.message, "Normalized Jira issue search output failed validation");
  assert.equal(envelope.error.details.some((detail) => detail.path === "issues.0.summary"), true);
});

test("jira issue search rejects non-numeric limits before network calls", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => {
      throw new Error("network call attempted");
    };
  `);

  const result = await runIre(
    ["jira", "issue", "search", "--jql", "project = ABC", "--limit", "many"],
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

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "INVALID_LIMIT");
  assert.deepEqual(envelope.error.details, {
    limit: "many",
    min: 1,
    max: 100,
  });
});
