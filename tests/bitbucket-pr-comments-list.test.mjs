import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed: ${stderr}`));
    });
  });
}

const bitbucketEnv = {
  IRE_BITBUCKET_EMAIL: "bb-user",
  IRE_BITBUCKET_API_TOKEN: "bb-secret",
};

test("bitbucket pr comments list fetches an explicit repo and emits normalized paginated comments", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);

      if (url !== "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pullrequests/42/comments?pagelen=50") {
        return Response.json({ message: "unexpected url", url }, { status: 500 });
      }

      const expectedAuthorization = "Basic " + Buffer.from("bb-user:bb-secret").toString("base64");
      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }

      return Response.json({
        values: [{
          id: 1001,
          user: { account_id: "author-1", display_name: "Author One" },
          content: { raw: "Please update this line." },
          deleted: false,
          inline: { path: "src/bitbucket.ts", from: null, to: 27 },
          created_on: "2026-05-04T12:34:56.000Z",
          updated_on: "2026-05-04T13:45:01.000Z"
        }],
        next: "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pullrequests/42/comments?page=2"
      });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "comments", "list", "42", "--repo", "workspace-one/repo-one"], {
    nodeArgs: ["--import", hookPath],
    env: bitbucketEnv,
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("bb-secret"), false);
  assert.deepEqual(envelope, {
    success: true,
    schemaVersion: "1.0",
    data: {
      comments: [{
        id: 1001,
        author: { accountId: "author-1", displayName: "Author One" },
        body: "Please update this line.",
        deleted: false,
        inline: { path: "src/bitbucket.ts", from: null, to: 27 },
        created: "2026-05-04T12:34:56.000Z",
        updated: "2026-05-04T13:45:01.000Z",
      }],
      pagination: {
        limit: 50,
        nextCursor: "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pullrequests/42/comments?page=2",
        hasNextPage: true,
      },
    },
    meta: { bitbucket: { workspace: "workspace-one", repo: "repo-one" } },
  });
});

test("bitbucket pr comments list normalizes an author with no account_id to a null accountId", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => {
      return Response.json({
        values: [{
          id: 1002,
          user: {
            display_name: "Former user",
            type: "user",
            uuid: "{11111111-1111-1111-1111-111111111111}"
          },
          content: { raw: "Left before account_id was assigned." },
          deleted: false,
          inline: null,
          created_on: "2026-05-04T12:34:56.000Z",
          updated_on: "2026-05-04T13:45:01.000Z"
        }]
      });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "comments", "list", "42", "--repo", "workspace-one/repo-one"], {
    nodeArgs: ["--import", hookPath],
    env: bitbucketEnv,
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, true);
  assert.deepEqual(envelope.data.comments[0].author, {
    accountId: null,
    displayName: "Former user",
  });
});

test("bitbucket pr comments list reuses repository resolution from config and Git remote", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("config-workspace/config-repo")) {
        return Response.json({ values: [] });
      }
      if (url.includes("remote-workspace/remote-repo")) {
        return Response.json({ values: [] });
      }
      return Response.json({ url }, { status: 500 });
    };
  `);

  const configDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await mkdir(join(configDir, ".git"));
  await mkdir(join(configDir, ".ire"), { recursive: true });
  await writeFile(
    join(configDir, ".ire", "config.json"),
    JSON.stringify({ bitbucket: { workspace: "config-workspace", repo: "config-repo" } }),
  );

  const fromConfig = await runIre(["bitbucket", "pr", "comments", "list", "42"], {
    cwd: configDir,
    nodeArgs: ["--import", hookPath],
    env: bitbucketEnv,
  });
  assert.equal(fromConfig.exitCode, 0);
  assert.deepEqual(parseJson(fromConfig.stdout).meta.bitbucket, {
    workspace: "config-workspace",
    repo: "config-repo",
  });

  const remoteDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await runCommand("git", ["init"], { cwd: remoteDir });
  await runCommand("git", ["remote", "add", "origin", "git@bitbucket.org:remote-workspace/remote-repo.git"], { cwd: remoteDir });

  const fromRemote = await runIre(["bitbucket", "pr", "comments", "list", "42"], {
    cwd: remoteDir,
    nodeArgs: ["--import", hookPath],
    env: bitbucketEnv,
  });
  assert.equal(fromRemote.exitCode, 0);
  assert.deepEqual(parseJson(fromRemote.stdout).meta.bitbucket, {
    workspace: "remote-workspace",
    repo: "remote-repo",
  });
});

test("bitbucket pr comments list propagates limit and cursor and emits last-page pagination", async () => {
  const cursor = "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests/42/comments?page=2&pagelen=25";
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url !== ${JSON.stringify(cursor)}) {
        return Response.json({ url }, { status: 500 });
      }
      return Response.json({ values: [] });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "comments", "list", "42", "--repo", "ws/repo", "--limit", "25", "--cursor", cursor], {
    nodeArgs: ["--import", hookPath],
    env: bitbucketEnv,
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(envelope.data, {
    comments: [],
    pagination: { limit: 25, nextCursor: null, hasNextPage: false },
  });
});

test("bitbucket pr comments list validates required ID and bounded limit before network calls", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => { throw new Error("network call attempted"); };
  `);

  const missing = await runIre(["bitbucket", "pr", "comments", "list"], {
    nodeArgs: ["--import", hookPath],
    env: bitbucketEnv,
  });
  assert.equal(missing.exitCode, 2);
  assert.equal(parseJson(missing.stdout).error.code, "MISSING_ARGUMENT");

  const invalidId = await runIre(["bitbucket", "pr", "comments", "list", "abc", "--repo", "ws/repo"], {
    nodeArgs: ["--import", hookPath],
    env: bitbucketEnv,
  });
  assert.equal(invalidId.exitCode, 2);
  assert.equal(parseJson(invalidId.stdout).error.code, "INVALID_ARGUMENT");

  const invalidLimit = await runIre(["bitbucket", "pr", "comments", "list", "42", "--repo", "ws/repo", "--limit", "101"], {
    nodeArgs: ["--import", hookPath],
    env: bitbucketEnv,
  });
  assert.equal(invalidLimit.exitCode, 2);
  assert.equal(parseJson(invalidLimit.stdout).error.code, "INVALID_LIMIT");
});

test("bitbucket pr comments list maps provider failures to stable exit codes", async () => {
  const cases = [
    { status: 401, exitCode: 3, code: "BITBUCKET_AUTH_FAILED" },
    { status: 403, exitCode: 3, code: "BITBUCKET_AUTH_FAILED" },
    { status: 404, exitCode: 4, code: "BITBUCKET_PR_NOT_FOUND" },
    { status: 500, exitCode: 5, code: "BITBUCKET_PROVIDER_ERROR" },
  ];

  for (const failure of cases) {
    const hookPath = await writeFetchHook(`
      globalThis.fetch = async () => Response.json({ message: "failed" }, { status: ${failure.status} });
    `);
    const result = await runIre(["bitbucket", "pr", "comments", "list", "42", "--repo", "ws/repo"], {
      nodeArgs: ["--import", hookPath],
      env: bitbucketEnv,
    });
    const envelope = parseJson(result.stdout);

    assert.equal(result.exitCode, failure.exitCode);
    assert.equal(result.stderr, "");
    assert.equal(envelope.success, false);
    assert.equal(envelope.error.code, failure.code);
  }
});

test("bitbucket pr comments list maps repository, network, and validation failures", async () => {
  const networkHookPath = await writeFetchHook(`
    globalThis.fetch = async () => { throw new Error("offline"); };
  `);
  const network = await runIre(["bitbucket", "pr", "comments", "list", "42", "--repo", "ws/repo"], {
    nodeArgs: ["--import", networkHookPath],
    env: bitbucketEnv,
  });
  assert.equal(network.exitCode, 6);
  assert.equal(parseJson(network.stdout).error.code, "BITBUCKET_NETWORK_ERROR");

  const validationHookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json({ values: [{ id: 1, content: { raw: "Missing timestamps" } }] });
  `);
  const validation = await runIre(["bitbucket", "pr", "comments", "list", "42", "--repo", "ws/repo"], {
    nodeArgs: ["--import", validationHookPath],
    env: bitbucketEnv,
  });
  assert.equal(validation.exitCode, 1);
  assert.equal(parseJson(validation.stdout).error.message, "Normalized Bitbucket pull request comments output failed validation");

  const invalidRepo = await runIre(["bitbucket", "pr", "comments", "list", "42", "--repo", "not-a-repo"], {
    nodeArgs: ["--import", networkHookPath],
    env: bitbucketEnv,
  });
  assert.equal(invalidRepo.exitCode, 2);
  assert.equal(parseJson(invalidRepo.stdout).error.code, "BITBUCKET_REPO_INVALID");
});
