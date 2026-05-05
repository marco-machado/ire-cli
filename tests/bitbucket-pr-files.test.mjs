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
    const child = spawn(process.execPath, [...(options.nodeArgs ?? []), cliPath, ...args], {
      cwd,
      env: { PATH: process.env.PATH, HOME: home, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (exitCode) => { resolve({ exitCode, stdout, stderr }); });
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
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed: ${stderr}`));
    });
  });
}

test("bitbucket pr files fetches changed files with explicit repo and pagination", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);

      if (url !== "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pullrequests/42/diffstat?pagelen=50") {
        return Response.json({ message: "unexpected url", url }, { status: 500 });
      }

      const expectedAuthorization = "Basic " + Buffer.from("bb-user:bb-secret").toString("base64");
      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }

      return Response.json({
        values: [
          { status: "modified", old: { path: "src/old.ts" }, new: { path: "src/new.ts" } },
          { status: "added", old: null, new: { path: "tests/new.test.ts" } },
          { status: "removed", old: { path: "docs/old.md" }, new: null }
        ],
        next: "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pullrequests/42/diffstat?page=2"
      });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "files", "42", "--repo", "workspace-one/repo-one"], {
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
  assert.deepEqual(envelope.data, {
    files: [
      { path: "src/new.ts", previousPath: "src/old.ts", status: "modified" },
      { path: "tests/new.test.ts", previousPath: null, status: "added" },
      { path: "docs/old.md", previousPath: null, status: "removed" },
    ],
    pagination: {
      limit: 50,
      nextCursor: "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pullrequests/42/diffstat?page=2",
      hasNextPage: true,
    },
  });
  assert.deepEqual(envelope.meta, { bitbucket: { workspace: "workspace-one", repo: "repo-one" } });
});

test("bitbucket pr files reuses config and Git remote repository resolution", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("config-workspace/config-repo")) return Response.json({ values: [] });
      if (url.includes("remote-workspace/remote-repo")) return Response.json({ values: [] });
      return Response.json({ url }, { status: 500 });
    };
  `);

  const configDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await mkdir(join(configDir, ".git"));
  await mkdir(join(configDir, ".ire"), { recursive: true });
  await writeFile(join(configDir, ".ire", "config.json"), JSON.stringify({ bitbucket: { workspace: "config-workspace", repo: "config-repo" } }));

  const fromConfig = await runIre(["bitbucket", "pr", "files", "7"], {
    cwd: configDir,
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(fromConfig.exitCode, 0);
  assert.deepEqual(parseJson(fromConfig.stdout).meta.bitbucket, { workspace: "config-workspace", repo: "config-repo" });

  const remoteDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await runCommand("git", ["init"], { cwd: remoteDir });
  await runCommand("git", ["remote", "add", "origin", "git@bitbucket.org:remote-workspace/remote-repo.git"], { cwd: remoteDir });

  const fromRemote = await runIre(["bitbucket", "pr", "files", "8"], {
    cwd: remoteDir,
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(fromRemote.exitCode, 0);
  assert.deepEqual(parseJson(fromRemote.stdout).meta.bitbucket, { workspace: "remote-workspace", repo: "remote-repo" });
});

test("bitbucket pr files propagates limit and cursor and rejects invalid limits", async () => {
  const cursor = "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests/9/diffstat?page=2&pagelen=25";
  const cursorHookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => String(input) === ${JSON.stringify(cursor)}
      ? Response.json({ values: [] })
      : Response.json({ url: String(input) }, { status: 500 });
  `);

  const result = await runIre(["bitbucket", "pr", "files", "9", "--repo", "ws/repo", "--limit", "25", "--cursor", cursor], {
    nodeArgs: ["--import", cursorHookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(parseJson(result.stdout).data.pagination, { limit: 25, nextCursor: null, hasNextPage: false });

  const failHookPath = await writeFetchHook(`globalThis.fetch = async () => { throw new Error("network call attempted"); };`);
  const invalid = await runIre(["bitbucket", "pr", "files", "9", "--repo", "ws/repo", "--limit", "101"], {
    nodeArgs: ["--import", failHookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(invalid.exitCode, 2);
  assert.equal(parseJson(invalid.stdout).error.code, "INVALID_LIMIT");
});

test("bitbucket pr files maps provider, not-found, network, repo, and validation failures", async () => {
  const cases = [
    { status: 401, exitCode: 3, code: "BITBUCKET_AUTH_FAILED" },
    { status: 403, exitCode: 3, code: "BITBUCKET_AUTH_FAILED" },
    { status: 404, exitCode: 4, code: "BITBUCKET_PR_NOT_FOUND" },
    { status: 500, exitCode: 5, code: "BITBUCKET_PROVIDER_ERROR" },
  ];

  for (const failure of cases) {
    const hookPath = await writeFetchHook(`globalThis.fetch = async () => Response.json({ message: "failed" }, { status: ${failure.status} });`);
    const result = await runIre(["bitbucket", "pr", "files", "12", "--repo", "ws/repo"], {
      nodeArgs: ["--import", hookPath],
      env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
    });
    assert.equal(result.exitCode, failure.exitCode);
    assert.equal(parseJson(result.stdout).error.code, failure.code);
  }

  const networkHookPath = await writeFetchHook(`globalThis.fetch = async () => { throw new Error("offline"); };`);
  const network = await runIre(["bitbucket", "pr", "files", "13", "--repo", "ws/repo"], {
    nodeArgs: ["--import", networkHookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(network.exitCode, 6);
  assert.equal(parseJson(network.stdout).error.code, "BITBUCKET_NETWORK_ERROR");

  const validationHookPath = await writeFetchHook(`globalThis.fetch = async () => Response.json({ values: [{ status: "modified", old: null, new: null }] });`);
  const validation = await runIre(["bitbucket", "pr", "files", "13", "--repo", "ws/repo"], {
    nodeArgs: ["--import", validationHookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(validation.exitCode, 1);
  assert.equal(parseJson(validation.stdout).error.code, "INTERNAL_ERROR");

  const invalidRepo = await runIre(["bitbucket", "pr", "files", "13", "--repo", "not-a-repo"], {
    nodeArgs: ["--import", networkHookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(invalidRepo.exitCode, 2);
  assert.equal(parseJson(invalidRepo.stdout).error.code, "BITBUCKET_REPO_INVALID");
});
