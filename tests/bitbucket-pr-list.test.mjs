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

test("bitbucket pr list fetches an explicit repo and emits normalized PR summaries with pagination", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);

      if (url !== "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pullrequests?pagelen=50") {
        return Response.json({ message: "unexpected url", url }, { status: 500 });
      }

      const expectedAuthorization = "Basic " + Buffer.from("bb-user:bb-secret").toString("base64");
      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }

      return Response.json({
        values: [{
          id: 42,
          title: "Add PR list primitive",
          state: "OPEN",
          author: { account_id: "author-1", display_name: "Author One" },
          source: { branch: { name: "feature/pr-list" }, commit: { hash: "abc123" } },
          destination: { branch: { name: "main" }, commit: { hash: "def456" } },
          created_on: "2026-05-04T12:34:56.000Z",
          updated_on: "2026-05-04T13:45:01.000Z"
        }],
        next: "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pullrequests?page=2"
      });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "list", "--repo", "workspace-one/repo-one"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("bb-secret"), false);
  assert.equal(envelope.success, true);
  assert.equal(envelope.schemaVersion, "1.0");
  assert.deepEqual(envelope.data, {
    prs: [{
      id: 42,
      title: "Add PR list primitive",
      state: "OPEN",
      author: { accountId: "author-1", displayName: "Author One" },
      source: { branch: "feature/pr-list" },
      destination: { branch: "main" },
      created: "2026-05-04T12:34:56.000Z",
      updated: "2026-05-04T13:45:01.000Z",
    }],
    pagination: {
      limit: 50,
      nextCursor: "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pullrequests?page=2",
      hasNextPage: true,
    },
  });
  assert.deepEqual(envelope.meta, {
    bitbucket: {
      workspace: "workspace-one",
      repo: "repo-one",
    },
  });
});

test("bitbucket pr list reuses repository resolution from config and Git remote", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("config-workspace/config-repo")) {
        return Response.json({ values: [], next: "next-config" });
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

  const fromConfig = await runIre(["bitbucket", "pr", "list"], {
    cwd: configDir,
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  assert.equal(fromConfig.exitCode, 0);
  assert.deepEqual(parseJson(fromConfig.stdout).meta.bitbucket, {
    workspace: "config-workspace",
    repo: "config-repo",
  });

  const remoteDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await runCommand("git", ["init"], { cwd: remoteDir });
  await runCommand("git", ["remote", "add", "origin", "git@bitbucket.org:remote-workspace/remote-repo.git"], { cwd: remoteDir });

  const fromRemote = await runIre(["bitbucket", "pr", "list"], {
    cwd: remoteDir,
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  assert.equal(fromRemote.exitCode, 0);
  assert.deepEqual(parseJson(fromRemote.stdout).meta.bitbucket, {
    workspace: "remote-workspace",
    repo: "remote-repo",
  });
});

test("bitbucket pr list propagates limit and cursor and emits last-page pagination", async () => {
  const cursor = "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests?page=2&pagelen=25";
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url !== ${JSON.stringify(cursor)}) {
        return Response.json({ url }, { status: 500 });
      }
      return Response.json({ values: [] });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "list", "--repo", "ws/repo", "--limit", "25", "--cursor", cursor], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(envelope.data.pagination, {
    limit: 25,
    nextCursor: null,
    hasNextPage: false,
  });
});

test("bitbucket pr list rejects limits above 100 before network calls", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => { throw new Error("network call attempted"); };
  `);

  const result = await runIre(["bitbucket", "pr", "list", "--repo", "ws/repo", "--limit", "101"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 2);
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "INVALID_LIMIT");
});

test("bitbucket pr list maps provider failures to stable exit codes", async () => {
  const cases = [
    { status: 401, exitCode: 3, code: "BITBUCKET_AUTH_FAILED" },
    { status: 403, exitCode: 3, code: "BITBUCKET_AUTH_FAILED" },
    { status: 500, exitCode: 5, code: "BITBUCKET_PROVIDER_ERROR" },
  ];

  for (const failure of cases) {
    const hookPath = await writeFetchHook(`
      globalThis.fetch = async () => Response.json({ message: "failed" }, { status: ${failure.status} });
    `);
    const result = await runIre(["bitbucket", "pr", "list", "--repo", "ws/repo"], {
      nodeArgs: ["--import", hookPath],
      env: {
        IRE_BITBUCKET_EMAIL: "bb-user",
        IRE_BITBUCKET_API_TOKEN: "bb-secret",
      },
    });
    const envelope = parseJson(result.stdout);

    assert.equal(result.exitCode, failure.exitCode);
    assert.equal(result.stderr, "");
    assert.equal(envelope.success, false);
    assert.equal(envelope.error.code, failure.code);
  }
});

test("bitbucket pr list maps repository, network, and validation failures", async () => {
  const networkHookPath = await writeFetchHook(`
    globalThis.fetch = async () => { throw new Error("offline"); };
  `);
  const network = await runIre(["bitbucket", "pr", "list", "--repo", "ws/repo"], {
    nodeArgs: ["--import", networkHookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  assert.equal(network.exitCode, 6);
  assert.equal(parseJson(network.stdout).error.code, "BITBUCKET_NETWORK_ERROR");

  const validationHookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json({ values: [{ id: 1, title: "Malformed" }] });
  `);
  const validation = await runIre(["bitbucket", "pr", "list", "--repo", "ws/repo"], {
    nodeArgs: ["--import", validationHookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  assert.equal(validation.exitCode, 1);
  assert.equal(parseJson(validation.stdout).error.code, "INTERNAL_ERROR");

  const invalidRepo = await runIre(["bitbucket", "pr", "list", "--repo", "not-a-repo"], {
    nodeArgs: ["--import", networkHookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  assert.equal(invalidRepo.exitCode, 2);
  assert.equal(parseJson(invalidRepo.stdout).error.code, "BITBUCKET_REPO_INVALID");
});
