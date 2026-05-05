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

test("bitbucket pr get fetches an explicit repo and emits a normalized PR envelope", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);

      if (url !== "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pullrequests/42") {
        return Response.json({ message: "unexpected url", url }, { status: 500 });
      }

      const expectedAuthorization = "Basic " + Buffer.from("bb-user:bb-secret").toString("base64");
      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }

      return Response.json({
        id: 42,
        title: "Add PR read primitive",
        description: "Provider description",
        state: "OPEN",
        author: { account_id: "author-1", display_name: "Author One" },
        source: { branch: { name: "feature/pr-get" }, commit: { hash: "abc123" } },
        destination: { branch: { name: "main" }, commit: { hash: "def456" } },
        reviewers: [{ account_id: "reviewer-1", display_name: "Reviewer One" }],
        created_on: "2026-05-04T12:34:56.000Z",
        updated_on: "2026-05-04T13:45:01.000Z"
      });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "get", "42", "--repo", "workspace-one/repo-one"], {
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
    id: 42,
    title: "Add PR read primitive",
    description: "Provider description",
    state: "OPEN",
    author: { accountId: "author-1", displayName: "Author One" },
    source: { branch: "feature/pr-get", commit: "abc123" },
    destination: { branch: "main", commit: "def456" },
    reviewers: [{ accountId: "reviewer-1", displayName: "Reviewer One" }],
    created: "2026-05-04T12:34:56.000Z",
    updated: "2026-05-04T13:45:01.000Z",
  });
  assert.deepEqual(envelope.meta, {
    bitbucket: {
      workspace: "workspace-one",
      repo: "repo-one",
    },
  });
});

test("bitbucket pr get accepts a Bitbucket API token as the Basic auth password", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);
      const expectedAuthorization = "Basic " + Buffer.from("bb-user:bb-api-token").toString("base64");

      if (url !== "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests/43") {
        return Response.json({ message: "unexpected url", url }, { status: 500 });
      }
      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }

      return Response.json({ id: 43, title: "Provider payload" });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "get", "43", "--repo", "ws/repo", "--raw"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-api-token",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.includes("bb-api-token"), false);
  assert.deepEqual(envelope.data, { id: 43, title: "Provider payload" });
});

test("bitbucket pr get falls back to config defaults when --repo is absent", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await mkdir(join(projectDir, ".git"));
  await mkdir(join(projectDir, ".ire"), { recursive: true });
  await writeFile(
    join(projectDir, ".ire", "config.json"),
    JSON.stringify({ bitbucket: { workspace: "config-workspace", repo: "config-repo" } }),
  );
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url !== "https://api.bitbucket.org/2.0/repositories/config-workspace/config-repo/pullrequests/7") {
        return Response.json({ url }, { status: 500 });
      }
      return Response.json({
        id: 7, title: "From config", description: null, state: "MERGED",
        author: null,
        source: { branch: { name: "feature" }, commit: { hash: "abc" } },
        destination: { branch: { name: "main" }, commit: { hash: "def" } },
        reviewers: [], created_on: "2026-05-04T12:00:00.000Z", updated_on: "2026-05-04T13:00:00.000Z"
      });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "get", "7"], {
    cwd: projectDir,
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(envelope.success, true);
  assert.deepEqual(envelope.meta.bitbucket, { workspace: "config-workspace", repo: "config-repo" });
});

test("bitbucket pr get infers an unambiguous Bitbucket SSH remote", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await runCommand("git", ["init"], { cwd: projectDir });
  await runCommand("git", ["remote", "add", "origin", "git@bitbucket.org:remote-workspace/remote-repo.git"], { cwd: projectDir });
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url !== "https://api.bitbucket.org/2.0/repositories/remote-workspace/remote-repo/pullrequests/8") {
        return Response.json({ url }, { status: 500 });
      }
      return Response.json({
        id: 8, title: "From remote", description: null, state: "OPEN",
        author: null,
        source: { branch: { name: "feature" }, commit: { hash: "abc" } },
        destination: { branch: { name: "main" }, commit: { hash: "def" } },
        reviewers: [], created_on: "2026-05-04T12:00:00.000Z", updated_on: "2026-05-04T13:00:00.000Z"
      });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "get", "8"], {
    cwd: projectDir,
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(envelope.meta.bitbucket, { workspace: "remote-workspace", repo: "remote-repo" });
});

test("bitbucket pr get infers an unambiguous Bitbucket HTTPS remote", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await runCommand("git", ["init"], { cwd: projectDir });
  await runCommand("git", ["remote", "add", "origin", "https://bitbucket.org/https-workspace/https-repo.git"], { cwd: projectDir });
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url !== "https://api.bitbucket.org/2.0/repositories/https-workspace/https-repo/pullrequests/9") {
        return Response.json({ url }, { status: 500 });
      }
      return Response.json({
        id: 9, title: "From https", description: null, state: "DECLINED",
        author: null,
        source: { branch: { name: "feature" }, commit: { hash: "abc" } },
        destination: { branch: { name: "main" }, commit: { hash: "def" } },
        reviewers: [], created_on: "2026-05-04T12:00:00.000Z", updated_on: "2026-05-04T13:00:00.000Z"
      });
    };
  `);

  const result = await runIre(["bitbucket", "pr", "get", "9"], {
    cwd: projectDir,
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(envelope.meta.bitbucket, { workspace: "https-workspace", repo: "https-repo" });
});

test("bitbucket pr get rejects ambiguous and missing repository identity before network calls", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => { throw new Error("network call attempted"); };
  `);
  const ambiguousDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await runCommand("git", ["init"], { cwd: ambiguousDir });
  await runCommand("git", ["remote", "add", "one", "git@bitbucket.org:ws-one/repo-one.git"], { cwd: ambiguousDir });
  await runCommand("git", ["remote", "add", "two", "https://bitbucket.org/ws-two/repo-two.git"], { cwd: ambiguousDir });

  const ambiguous = await runIre(["bitbucket", "pr", "get", "10"], {
    cwd: ambiguousDir,
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  const ambiguousEnvelope = parseJson(ambiguous.stdout);
  assert.equal(ambiguous.exitCode, 7);
  assert.equal(ambiguousEnvelope.success, false);
  assert.equal(ambiguousEnvelope.error.code, "BITBUCKET_REPO_AMBIGUOUS");
  assert.deepEqual(ambiguousEnvelope.error.details.remotes, [
    { workspace: "ws-one", repo: "repo-one" },
    { workspace: "ws-two", repo: "repo-two" },
  ]);

  const missing = await runIre(["bitbucket", "pr", "get", "10"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  const missingEnvelope = parseJson(missing.stdout);
  assert.equal(missing.exitCode, 2);
  assert.equal(missingEnvelope.success, false);
  assert.equal(missingEnvelope.error.code, "BITBUCKET_REPO_MISSING");
});

test("bitbucket pr get --raw returns the provider-native payload in a success envelope", async () => {
  const providerPayload = {
    id: 11,
    title: "Raw payload",
    links: { html: { href: "https://bitbucket.org/ws/repo/pull-requests/11" } },
    custom: { providerSpecific: true },
  };
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json(${JSON.stringify(providerPayload)});
  `);

  const result = await runIre(["bitbucket", "pr", "get", "11", "--repo", "raw-ws/raw-repo", "--raw"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(envelope.data, providerPayload);
  assert.deepEqual(envelope.meta.bitbucket, { workspace: "raw-ws", repo: "raw-repo" });
});

test("bitbucket pr get maps provider failures to stable exit codes", async () => {
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
    const result = await runIre(["bitbucket", "pr", "get", "12", "--repo", "ws/repo"], {
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

test("bitbucket pr get maps network and validation failures", async () => {
  const networkHookPath = await writeFetchHook(`
    globalThis.fetch = async () => { throw new Error("offline"); };
  `);
  const network = await runIre(["bitbucket", "pr", "get", "13", "--repo", "ws/repo"], {
    nodeArgs: ["--import", networkHookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  assert.equal(network.exitCode, 6);
  assert.equal(parseJson(network.stdout).error.code, "BITBUCKET_NETWORK_ERROR");

  const validationHookPath = await writeFetchHook(`
    globalThis.fetch = async () => Response.json({ id: 13, title: "Malformed" });
  `);
  const validation = await runIre(["bitbucket", "pr", "get", "13", "--repo", "ws/repo"], {
    nodeArgs: ["--import", validationHookPath],
    env: {
      IRE_BITBUCKET_EMAIL: "bb-user",
      IRE_BITBUCKET_API_TOKEN: "bb-secret",
    },
  });
  assert.equal(validation.exitCode, 1);
  assert.equal(parseJson(validation.stdout).error.code, "INTERNAL_ERROR");
});
