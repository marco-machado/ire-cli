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

const jiraEnv = {
  IRE_JIRA_BASE_URL: "https://jira.example.test/",
  IRE_JIRA_EMAIL: "agent@example.test",
  IRE_JIRA_API_TOKEN: "jira-secret",
};

test("jira issue comments list fetches an explicit key with default limit and emits normalized paginated comments", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const headers = new Headers(init.headers);

      if (url.origin + url.pathname !== "https://jira.example.test/rest/api/3/issue/ABC-123/comment") {
        return Response.json({ message: "unexpected url", url: String(input) }, { status: 500 });
      }

      if (url.searchParams.get("maxResults") !== "50") {
        return Response.json({ message: "unexpected maxResults", maxResults: url.searchParams.get("maxResults") }, { status: 500 });
      }

      if (url.searchParams.get("startAt") !== "0") {
        return Response.json({ message: "unexpected startAt", startAt: url.searchParams.get("startAt") }, { status: 500 });
      }

      if (headers.get("accept") !== "application/json") {
        return Response.json({ message: "missing accept header" }, { status: 500 });
      }

      const expectedAuthorization = "Basic " + Buffer.from("agent@example.test:jira-secret").toString("base64");
      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }

      return Response.json({
        startAt: 0,
        maxResults: 50,
        total: 51,
        comments: [
          {
            id: "10000",
            author: { accountId: "author-1", displayName: "Author One" },
            body: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: "Looks good" }] }]
            },
            created: "2026-05-04T12:34:56.000+0000",
            updated: "2026-05-04T13:45:01.000+0000"
          }
        ]
      });
    };
  `);

  const result = await runIre(["jira", "issue", "comments", "list", "ABC-123"], {
    nodeArgs: ["--import", hookPath],
    env: jiraEnv,
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("jira-secret"), false);
  assert.deepEqual(envelope, {
    success: true,
    schemaVersion: "1.0",
    data: {
      comments: [
        {
          id: "10000",
          author: { accountId: "author-1", displayName: "Author One" },
          body: "Looks good",
          created: "2026-05-04T12:34:56.000Z",
          updated: "2026-05-04T13:45:01.000Z",
        },
      ],
      pagination: {
        limit: 50,
        nextCursor: "50",
        hasNextPage: true,
      },
    },
    meta: {},
  });
});

test("jira issue comments list propagates limit and cursor and emits last-page pagination", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("maxResults") !== "25") {
        return Response.json({ message: "unexpected maxResults" }, { status: 500 });
      }
      if (url.searchParams.get("startAt") !== "50") {
        return Response.json({ message: "unexpected startAt" }, { status: 500 });
      }
      return Response.json({ startAt: 50, maxResults: 25, total: 60, comments: [] });
    };
  `);

  const result = await runIre(
    ["jira", "issue", "comments", "list", "ABC-123", "--limit", "25", "--cursor", "50"],
    { nodeArgs: ["--import", hookPath], env: jiraEnv },
  );
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(envelope.data, {
    comments: [],
    pagination: { limit: 25, nextCursor: null, hasNextPage: false },
  });
});

test("jira issue comments list --raw returns provider-native payload in a success envelope", async () => {
  const providerPayload = {
    startAt: 0,
    maxResults: 1,
    total: 1,
    comments: [{ id: "raw-1", body: { provider: "native" }, customField: true }],
  };
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json(${JSON.stringify(providerPayload)});
  `);

  const result = await runIre(
    ["jira", "issue", "comments", "list", "ABC-123", "--raw", "--limit", "1"],
    { nodeArgs: ["--import", hookPath], env: jiraEnv },
  );
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, true);
  assert.deepEqual(envelope.data, providerPayload);
  assert.deepEqual(envelope.meta, {});
});

test("jira issue comments list requires an explicit issue key", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => { throw new Error("network call attempted"); };
  `);

  const result = await runIre(["jira", "issue", "comments", "list"], {
    nodeArgs: ["--import", hookPath],
    env: jiraEnv,
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "MISSING_ARGUMENT");
  assert.deepEqual(envelope.error.details, { argument: "KEY" });
  assert.equal("data" in envelope, false);
});

test("jira issue comments list rejects limits above 100 before network calls", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => { throw new Error("network call attempted"); };
  `);

  const result = await runIre(
    ["jira", "issue", "comments", "list", "ABC-123", "--limit", "101"],
    { nodeArgs: ["--import", hookPath], env: jiraEnv },
  );
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "INVALID_LIMIT");
  assert.equal(envelope.error.message, "Jira issue comments limit must be between 1 and 100");
  assert.deepEqual(envelope.error.details, { limit: 101, min: 1, max: 100 });
  assert.equal("data" in envelope, false);
});

test("jira issue comments list maps provider failures to stable exit codes", async () => {
  for (const scenario of [
    { status: 404, exitCode: 4, code: "JIRA_ISSUE_NOT_FOUND" },
    { status: 401, exitCode: 3, code: "JIRA_AUTH_FAILED" },
    { status: 503, exitCode: 5, code: "JIRA_PROVIDER_ERROR" },
  ]) {
    const hookPath = await writeFetchHook(`
      globalThis.fetch = async () => Response.json({ errorMessages: ["failed"] }, { status: ${scenario.status} });
    `);

    const result = await runIre(["jira", "issue", "comments", "list", "ABC-FAIL"], {
      nodeArgs: ["--import", hookPath],
      env: jiraEnv,
    });
    const envelope = parseJson(result.stdout);

    assert.equal(result.exitCode, scenario.exitCode);
    assert.equal(result.stderr, "");
    assert.equal(envelope.success, false);
    assert.equal(envelope.error.code, scenario.code);
    assert.equal("data" in envelope, false);
  }
});

test("jira issue comments list maps network and validation failures", async () => {
  const networkHookPath = await writeFetchHook(`
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  `);
  const networkResult = await runIre(["jira", "issue", "comments", "list", "ABC-NET"], {
    nodeArgs: ["--import", networkHookPath],
    env: jiraEnv,
  });
  const networkEnvelope = parseJson(networkResult.stdout);

  assert.equal(networkResult.exitCode, 6);
  assert.equal(networkEnvelope.error.code, "JIRA_NETWORK_ERROR");

  const validationHookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json({
      startAt: 0,
      maxResults: 50,
      total: 1,
      comments: [{ id: "bad", body: "Missing timestamps" }]
    });
  `);
  const validationResult = await runIre(["jira", "issue", "comments", "list", "ABC-BAD"], {
    nodeArgs: ["--import", validationHookPath],
    env: jiraEnv,
  });
  const validationEnvelope = parseJson(validationResult.stdout);

  assert.equal(validationResult.exitCode, 1);
  assert.equal(validationEnvelope.error.code, "INTERNAL_ERROR");
  assert.equal(validationEnvelope.error.message, "Normalized Jira issue comments output failed validation");
});
