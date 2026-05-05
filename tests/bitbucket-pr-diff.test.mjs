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

test("bitbucket pr diff fetches an explicit repo and emits a normalized diff envelope", async () => {
  const diff = "diff --git a/src/a.ts b/src/a.ts\n+export const a = 1;\n";
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);

      if (url !== "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pullrequests/42/diff") {
        return Response.json({ message: "unexpected url", url }, { status: 500 });
      }

      const expectedAuthorization = "Basic " + Buffer.from("bb-user:bb-secret").toString("base64");
      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }

      if (headers.get("accept") !== "text/plain") {
        return Response.json({ message: "unexpected accept", accept: headers.get("accept") }, { status: 500 });
      }

      return new Response(${JSON.stringify(diff)}, {
        headers: { "content-type": "text/plain" }
      });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "diff", "42", "--repo", "workspace-one/repo-one"], {
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
  assert.deepEqual(envelope.data, { diff });
  assert.deepEqual(envelope.meta, { bitbucket: { workspace: "workspace-one", repo: "repo-one" } });
});

test("bitbucket pr diff reuses config and Git remote repository resolution", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === "https://api.bitbucket.org/2.0/repositories/config-workspace/config-repo/pullrequests/7/diff") return new Response("config diff");
      if (url === "https://api.bitbucket.org/2.0/repositories/remote-workspace/remote-repo/pullrequests/8/diff") return new Response("remote diff");
      return Response.json({ url }, { status: 500 });
    };
  `);

  const configDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await mkdir(join(configDir, ".git"));
  await mkdir(join(configDir, ".ire"), { recursive: true });
  await writeFile(join(configDir, ".ire", "config.json"), JSON.stringify({ bitbucket: { workspace: "config-workspace", repo: "config-repo" } }));

  const fromConfig = await runIre(["bitbucket", "pr", "diff", "7"], {
    cwd: configDir,
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(fromConfig.exitCode, 0);
  assert.deepEqual(parseJson(fromConfig.stdout).meta.bitbucket, { workspace: "config-workspace", repo: "config-repo" });

  const remoteDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await runCommand("git", ["init"], { cwd: remoteDir });
  await runCommand("git", ["remote", "add", "origin", "git@bitbucket.org:remote-workspace/remote-repo.git"], { cwd: remoteDir });

  const fromRemote = await runIre(["bitbucket", "pr", "diff", "8"], {
    cwd: remoteDir,
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(fromRemote.exitCode, 0);
  assert.deepEqual(parseJson(fromRemote.stdout).meta.bitbucket, { workspace: "remote-workspace", repo: "remote-repo" });
});

test("bitbucket pr diff validates required ID before network calls", async () => {
  const hookPath = await writeFetchHook(`globalThis.fetch = async () => { throw new Error("network call attempted"); };`);

  const missing = await runIre(["bitbucket", "pr", "diff", "--repo", "ws/repo"], {
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(missing.exitCode, 2);
  assert.equal(parseJson(missing.stdout).error.code, "MISSING_ARGUMENT");

  const invalid = await runIre(["bitbucket", "pr", "diff", "0", "--repo", "ws/repo"], {
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(invalid.exitCode, 2);
  assert.equal(parseJson(invalid.stdout).error.code, "INVALID_ARGUMENT");
});

test("bitbucket pr diff maps provider, network, and repository failures", async () => {
  const cases = [
    { status: 401, exitCode: 3, code: "BITBUCKET_AUTH_FAILED" },
    { status: 403, exitCode: 3, code: "BITBUCKET_AUTH_FAILED" },
    { status: 404, exitCode: 4, code: "BITBUCKET_PR_NOT_FOUND" },
    { status: 500, exitCode: 5, code: "BITBUCKET_PROVIDER_ERROR" },
  ];

  for (const failure of cases) {
    const hookPath = await writeFetchHook(`globalThis.fetch = async () => new Response("failed", { status: ${failure.status} });`);
    const result = await runIre(["bitbucket", "pr", "diff", "12", "--repo", "ws/repo"], {
      nodeArgs: ["--import", hookPath],
      env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
    });
    assert.equal(result.exitCode, failure.exitCode);
    assert.equal(parseJson(result.stdout).error.code, failure.code);
  }

  const networkHookPath = await writeFetchHook(`globalThis.fetch = async () => { throw new Error("offline"); };`);
  const network = await runIre(["bitbucket", "pr", "diff", "13", "--repo", "ws/repo"], {
    nodeArgs: ["--import", networkHookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(network.exitCode, 6);
  assert.equal(parseJson(network.stdout).error.code, "BITBUCKET_NETWORK_ERROR");

  const invalidRepo = await runIre(["bitbucket", "pr", "diff", "13", "--repo", "not-a-repo"], {
    nodeArgs: ["--import", networkHookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(invalidRepo.exitCode, 2);
  assert.equal(parseJson(invalidRepo.stdout).error.code, "BITBUCKET_REPO_INVALID");

  const missing = await runIre(["bitbucket", "pr", "diff", "13"], {
    nodeArgs: ["--import", networkHookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(missing.exitCode, 2);
  assert.equal(parseJson(missing.stdout).error.code, "BITBUCKET_REPO_MISSING");

  const ambiguousDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await runCommand("git", ["init"], { cwd: ambiguousDir });
  await runCommand("git", ["remote", "add", "one", "git@bitbucket.org:ws-one/repo-one.git"], { cwd: ambiguousDir });
  await runCommand("git", ["remote", "add", "two", "https://bitbucket.org/ws-two/repo-two.git"], { cwd: ambiguousDir });
  const ambiguous = await runIre(["bitbucket", "pr", "diff", "13"], {
    cwd: ambiguousDir,
    nodeArgs: ["--import", networkHookPath],
    env: { IRE_BITBUCKET_EMAIL: "bb-user", IRE_BITBUCKET_API_TOKEN: "bb-secret" },
  });
  assert.equal(ambiguous.exitCode, 7);
  assert.equal(parseJson(ambiguous.stdout).error.code, "BITBUCKET_REPO_AMBIGUOUS");
});
