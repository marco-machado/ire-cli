import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

const bitbucketEnv = {
  IRE_BITBUCKET_EMAIL: "bb-user",
  IRE_BITBUCKET_API_TOKEN: "bb-secret",
};

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

function prBody(overrides = {}) {
  return {
    id: 42,
    title: "Add PR export",
    description: "Export for review analysis",
    state: "MERGED",
    draft: false,
    author: { account_id: "author-1", display_name: "Author One" },
    source: { branch: { name: "feature/export" }, commit: { hash: "abc123" } },
    destination: { branch: { name: "main" }, commit: { hash: "def456" } },
    reviewers: [{ account_id: "reviewer-1", display_name: "Reviewer One" }],
    participants: [
      {
        user: { account_id: "reviewer-1", display_name: "Reviewer One" },
        role: "REVIEWER",
        approved: true,
        state: "approved",
        participated_on: "2026-05-04T13:00:00.000Z",
      },
    ],
    merge_commit: { hash: "merge999" },
    closed_by: { account_id: "reviewer-1", display_name: "Reviewer One" },
    comment_count: 2,
    task_count: 0,
    created_on: "2026-05-04T12:00:00.000Z",
    updated_on: "2026-05-04T14:00:00.000Z",
    ...overrides,
  };
}

function defaultExportHookSource() {
  return `
    const auth = "Basic " + Buffer.from("bb-user:bb-secret").toString("base64");
    const base = "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pullrequests/42";

    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);
      if (headers.get("authorization") !== auth) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }

      if (url === base) {
        return Response.json(${JSON.stringify(prBody())});
      }

      if (url === base + "/comments?pagelen=100") {
        return Response.json({
          values: [
            {
              id: 1001,
              user: { account_id: "reviewer-1", display_name: "Reviewer One" },
              content: { raw: "Please rename this." },
              deleted: false,
              pending: false,
              inline: { path: "src/bitbucket.ts", from: null, to: 10 },
              created_on: "2026-05-04T12:10:00.000Z",
              updated_on: "2026-05-04T12:10:00.000Z"
            },
            {
              id: 1002,
              parent: { id: 1001 },
              user: { account_id: "author-1", display_name: "Author One" },
              content: { raw: "Done." },
              deleted: false,
              pending: false,
              inline: { path: "src/bitbucket.ts", from: null, to: 10 },
              created_on: "2026-05-04T12:20:00.000Z",
              updated_on: "2026-05-04T12:20:00.000Z"
            }
          ],
          next: base + "/comments?page=2&pagelen=100"
        });
      }

      if (url === base + "/comments?page=2&pagelen=100") {
        return Response.json({
          values: [
            {
              id: 1003,
              user: { account_id: "reviewer-1", display_name: "Reviewer One" },
              content: { raw: "General note." },
              deleted: false,
              pending: false,
              created_on: "2026-05-04T12:30:00.000Z",
              updated_on: "2026-05-04T12:30:00.000Z"
            },
            {
              id: 1004,
              user: { account_id: "reviewer-1", display_name: "Reviewer One" },
              content: { raw: "deleted noise" },
              deleted: true,
              pending: false,
              created_on: "2026-05-04T12:05:00.000Z",
              updated_on: "2026-05-04T12:05:00.000Z"
            }
          ]
        });
      }

      if (url === base + "/diffstat?pagelen=100") {
        return Response.json({
          values: [
            {
              status: "modified",
              old: { path: "src/bitbucket.ts" },
              new: { path: "src/bitbucket.ts" },
              lines_added: 10,
              lines_removed: 2
            }
          ],
          next: base + "/diffstat?page=2&pagelen=100"
        });
      }

      if (url === base + "/diffstat?page=2&pagelen=100") {
        return Response.json({
          values: [
            {
              status: "added",
              old: null,
              new: { path: "src/bitbucket-export.ts" },
              lines_added: 40,
              lines_removed: 0
            }
          ]
        });
      }

      if (url === base + "/activity?pagelen=50") {
        return Response.json({
          values: [
            {
              update: {
                state: "OPEN",
                date: "2026-05-04T12:00:00.000Z",
                author: { account_id: "author-1", display_name: "Author One" }
              }
            },
            {
              approval: {
                date: "2026-05-04T13:00:00.000Z",
                user: { account_id: "reviewer-1", display_name: "Reviewer One" }
              }
            }
          ],
          next: base + "/activity?page=2&pagelen=50"
        });
      }

      if (url === base + "/activity?page=2&pagelen=50") {
        return Response.json({
          values: [
            {
              changes_request: {
                date: "2026-05-04T12:40:00.000Z",
                user: { account_id: "reviewer-1", display_name: "Reviewer One" }
              }
            },
            {
              update: {
                state: "MERGED",
                date: "2026-05-04T14:00:00.000Z",
                author: { account_id: "author-1", display_name: "Author One" }
              }
            }
          ]
        });
      }

      if (url === base + "/diff") {
        return new Response("diff --git a/src/bitbucket.ts b/src/bitbucket.ts\\n", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }

      return Response.json({ message: "unexpected url", url }, { status: 500 });
    };
  `;
}

test("bitbucket pr export aggregates PR, comments, files, activity, diff, and metrics", async () => {
  const hookPath = await writeFetchHook(defaultExportHookSource());

  const result = await runIre(["bitbucket", "pr", "export", "42", "--repo", "workspace-one/repo-one"], {
    nodeArgs: ["--import", hookPath],
    env: bitbucketEnv,
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("bb-secret"), false);
  assert.equal(envelope.success, true);
  assert.equal(envelope.schemaVersion, "1.0");
  assert.deepEqual(envelope.meta, {
    bitbucket: { workspace: "workspace-one", repo: "repo-one" },
  });

  assert.equal(envelope.data.id, 42);
  assert.equal(envelope.data.title, "Add PR export");
  assert.equal(envelope.data.state, "MERGED");
  assert.equal(envelope.data.draft, false);
  assert.deepEqual(envelope.data.author, { accountId: "author-1", displayName: "Author One" });
  assert.deepEqual(envelope.data.source, { branch: "feature/export", commit: "abc123" });
  assert.equal(envelope.data.mergeCommit, "merge999");
  assert.equal(envelope.data.comments.length, 4);
  assert.equal(envelope.data.comments[1].parentId, 1001);
  assert.equal(envelope.data.files.length, 2);
  assert.equal(envelope.data.files[0].linesAdded, 10);
  assert.equal(envelope.data.activity.length, 4);
  assert.equal(envelope.data.diff.includes("diff --git"), true);

  assert.equal(envelope.data.metrics.commentsTotal, 3);
  assert.equal(envelope.data.metrics.commentsDeleted, 1);
  assert.equal(envelope.data.metrics.commentsInline, 2);
  assert.equal(envelope.data.metrics.commentsGeneral, 1);
  assert.equal(envelope.data.metrics.maxThreadDepth, 2);
  assert.equal(envelope.data.metrics.threadCount, 3);
  assert.equal(envelope.data.metrics.filesChanged, 2);
  assert.equal(envelope.data.metrics.linesAdded, 50);
  assert.equal(envelope.data.metrics.linesRemoved, 2);
  assert.equal(envelope.data.metrics.commentDensityPerFile, 1.5);
  assert.equal(envelope.data.metrics.firstApprovalAt, "2026-05-04T13:00:00.000Z");
  assert.equal(envelope.data.metrics.firstApprovalLagSeconds, 3600);
  assert.equal(envelope.data.metrics.approvalCount, 1);
  assert.equal(envelope.data.metrics.changesRequestedCount, 1);
  assert.equal(envelope.data.metrics.firstCommentAt, "2026-05-04T12:10:00.000Z");
  assert.equal(envelope.data.metrics.firstCommentLagSeconds, 600);
  assert.deepEqual(envelope.data.metrics.commentsByFile, [
    { path: "src/bitbucket.ts", count: 2 },
  ]);
});

test("bitbucket pr export --output writes the envelope to disk and sets meta.outputPath", async () => {
  const hookPath = await writeFetchHook(defaultExportHookSource());
  const outDir = await mkdtemp(join(tmpdir(), "ire-cli-export-out-"));
  const nestedPath = join(outDir, "nested", "pr-42.json");

  const result = await runIre(
    ["bitbucket", "pr", "export", "42", "--repo", "workspace-one/repo-one", "--output", nestedPath],
    {
      nodeArgs: ["--import", hookPath],
      env: bitbucketEnv,
    },
  );
  const envelope = parseJson(result.stdout);
  const fileBody = await readFile(nestedPath, "utf8");
  const fileEnvelope = JSON.parse(fileBody);

  assert.equal(result.exitCode, 0);
  assert.equal(envelope.meta.outputPath, nestedPath);
  assert.deepEqual(fileEnvelope, envelope);
  assert.equal(fileBody.includes("bb-secret"), false);
});

test("bitbucket pr export --output overwrites an existing file", async () => {
  const hookPath = await writeFetchHook(defaultExportHookSource());
  const outDir = await mkdtemp(join(tmpdir(), "ire-cli-export-out-"));
  const outPath = join(outDir, "pr.json");
  await writeFile(outPath, "stale\n", "utf8");

  const result = await runIre(
    ["bitbucket", "pr", "export", "42", "--repo", "workspace-one/repo-one", "--output", outPath],
    {
      nodeArgs: ["--import", hookPath],
      env: bitbucketEnv,
    },
  );

  assert.equal(result.exitCode, 0);
  const fileBody = await readFile(outPath, "utf8");
  assert.equal(fileBody.startsWith("{"), true);
  assert.equal(fileBody.includes("stale"), false);
});

test("bitbucket pr export --output fails when path is a directory", async () => {
  const hookPath = await writeFetchHook(defaultExportHookSource());
  const outDir = await mkdtemp(join(tmpdir(), "ire-cli-export-out-"));

  const result = await runIre(
    ["bitbucket", "pr", "export", "42", "--repo", "workspace-one/repo-one", "--output", outDir],
    {
      nodeArgs: ["--import", hookPath],
      env: bitbucketEnv,
    },
  );
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 2);
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "BITBUCKET_EXPORT_WRITE_FAILED");
  assert.equal(envelope.error.details.path, outDir);
});

test("bitbucket pr export requires a positive integer id", async () => {
  const missing = await runIre(["bitbucket", "pr", "export", "--repo", "ws/repo"], {
    env: bitbucketEnv,
  });
  assert.equal(missing.exitCode, 2);
  assert.equal(parseJson(missing.stdout).error.code, "MISSING_ARGUMENT");

  const invalid = await runIre(["bitbucket", "pr", "export", "nope", "--repo", "ws/repo"], {
    env: bitbucketEnv,
  });
  assert.equal(invalid.exitCode, 2);
  assert.equal(parseJson(invalid.stdout).error.code, "INVALID_ARGUMENT");
});

test("bitbucket pr export surfaces not found without writing output", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "ire-cli-export-out-"));
  const outPath = join(outDir, "should-not-exist.json");
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json({ message: "missing" }, { status: 404 });
  `);

  const result = await runIre(
    ["bitbucket", "pr", "export", "99", "--repo", "ws/repo", "--output", outPath],
    {
      nodeArgs: ["--import", hookPath],
      env: bitbucketEnv,
    },
  );
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 4);
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "BITBUCKET_PR_NOT_FOUND");

  let wrote = true;
  try {
    await readFile(outPath, "utf8");
  } catch {
    wrote = false;
  }
  assert.equal(wrote, false);
});

test("bitbucket pr export handles empty comments and activity", async () => {
  const hookPath = await writeFetchHook(`
    const base = "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests/7";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === base) {
        return Response.json(${JSON.stringify(prBody({ id: 7, comment_count: 0 }))});
      }
      if (url === base + "/comments?pagelen=100") return Response.json({ values: [] });
      if (url === base + "/diffstat?pagelen=100") return Response.json({ values: [] });
      if (url === base + "/activity?pagelen=50") return Response.json({ values: [] });
      if (url === base + "/diff") return new Response("", { status: 200 });
      return Response.json({ message: "unexpected", url }, { status: 500 });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "export", "7", "--repo", "ws/repo"], {
    nodeArgs: ["--import", hookPath],
    env: bitbucketEnv,
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(envelope.data.comments.length, 0);
  assert.equal(envelope.data.activity.length, 0);
  assert.equal(envelope.data.metrics.commentsTotal, 0);
  assert.equal(envelope.data.metrics.maxThreadDepth, 0);
  assert.equal(envelope.data.metrics.firstApprovalAt, null);
  assert.equal(envelope.data.metrics.firstApprovalLagSeconds, null);
  assert.equal(envelope.data.metrics.commentDensityPerFile, null);
  assert.equal(envelope.data.metrics.linesAdded, 0);
  assert.equal(envelope.data.metrics.linesRemoved, 0);
});

test("bitbucket pr export computes maxThreadDepth for nested replies", async () => {
  const hookPath = await writeFetchHook(`
    const base = "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests/8";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === base) {
        return Response.json(${JSON.stringify(prBody({ id: 8 }))});
      }
      if (url === base + "/comments?pagelen=100") {
        return Response.json({
          values: [
            {
              id: 1,
              user: { account_id: "a", display_name: "A" },
              content: { raw: "root" },
              deleted: false,
              created_on: "2026-05-04T12:10:00.000Z",
              updated_on: "2026-05-04T12:10:00.000Z"
            },
            {
              id: 2,
              parent: { id: 1 },
              user: { account_id: "b", display_name: "B" },
              content: { raw: "reply" },
              deleted: false,
              created_on: "2026-05-04T12:11:00.000Z",
              updated_on: "2026-05-04T12:11:00.000Z"
            },
            {
              id: 3,
              parent: { id: 2 },
              user: { account_id: "a", display_name: "A" },
              content: { raw: "nested" },
              deleted: false,
              created_on: "2026-05-04T12:12:00.000Z",
              updated_on: "2026-05-04T12:12:00.000Z"
            }
          ]
        });
      }
      if (url === base + "/diffstat?pagelen=100") return Response.json({ values: [] });
      if (url === base + "/activity?pagelen=50") return Response.json({ values: [] });
      if (url === base + "/diff") return new Response("", { status: 200 });
      return Response.json({ message: "unexpected", url }, { status: 500 });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "export", "8", "--repo", "ws/repo"], {
    nodeArgs: ["--import", hookPath],
    env: bitbucketEnv,
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(envelope.data.metrics.maxThreadDepth, 3);
  assert.equal(envelope.data.metrics.threadCount, 1);
});
