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
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
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
      if (exitCode === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed: ${stderr}`));
    });
  });
}

test("bitbucket pipelines steps list fetches a pipeline UUID and emits normalized steps", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);
      if (url !== "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pipelines/%7Bpipeline-1%7D/steps/?pagelen=50") {
        return Response.json({ message: "unexpected url", url }, { status: 500 });
      }
      const expectedAuthorization = "Basic " + Buffer.from("bb-user:bb-secret").toString("base64");
      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }
      return Response.json({
        values: [
          {
            uuid: "{step-1}", name: "Build", state: { name: "COMPLETED", result: { name: "SUCCESSFUL" } },
            started_on: "2026-05-04T12:34:56.000Z", completed_on: "2026-05-04T12:36:56.000Z", duration_in_seconds: 120
          },
          {
            uuid: "{step-2}", name: null, state: { name: "COMPLETED", result: { name: "FAILED" } },
            started_on: null, completed_on: null, duration_in_seconds: null
          }
        ],
        next: "next-steps-page"
      });
    };
  `);

  const result = await runIre(["bitbucket", "pipelines", "steps", "list", "{pipeline-1}", "--repo", "workspace-one/repo-one"], {
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(envelope.data, {
    steps: [
      {
        uuid: "{step-1}", name: "Build", state: "COMPLETED", result: "SUCCESSFUL",
        startedOn: "2026-05-04T12:34:56.000Z", completedOn: "2026-05-04T12:36:56.000Z", durationInSeconds: 120,
      },
      {
        uuid: "{step-2}", name: null, state: "COMPLETED", result: "FAILED",
        startedOn: null, completedOn: null, durationInSeconds: null,
      },
    ],
    pagination: { limit: 50, nextCursor: "next-steps-page", hasNextPage: true },
  });
  assert.deepEqual(envelope.meta, { bitbucket: { workspace: "workspace-one", repo: "repo-one" } });
});

test("bitbucket pipelines steps list supports cursor, caps limits, and reuses Git remote repo resolution", async () => {
  const cursor = "https://api.bitbucket.org/2.0/repositories/ws/repo/pipelines/%7Bp%7D/steps/?page=2&pagelen=25";
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === ${JSON.stringify(cursor)}) return Response.json({ values: [] });
      if (url === "https://api.bitbucket.org/2.0/repositories/remote-workspace/remote-repo/pipelines/%7Bpipeline-remote%7D/steps/?pagelen=100") return Response.json({ values: [] });
      return Response.json({ url }, { status: 500 });
    };
  `);

  const cursorResult = await runIre(["bitbucket", "pipelines", "steps", "list", "{p}", "--repo", "ws/repo", "--limit", "25", "--cursor", cursor], {
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  assert.equal(cursorResult.exitCode, 0);
  assert.deepEqual(parseJson(cursorResult.stdout).data.pagination, { limit: 25, nextCursor: null, hasNextPage: false });

  const remoteDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await runCommand("git", ["init"], { cwd: remoteDir });
  await runCommand("git", ["remote", "add", "origin", "git@bitbucket.org:remote-workspace/remote-repo.git"], { cwd: remoteDir });
  const capped = await runIre(["bitbucket", "pipelines", "steps", "list", "{pipeline-remote}", "--limit", "101"], {
    cwd: remoteDir,
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  assert.equal(capped.exitCode, 0);
  assert.deepEqual(parseJson(capped.stdout).meta, { bitbucket: { workspace: "remote-workspace", repo: "remote-repo" } });
  assert.deepEqual(parseJson(capped.stdout).data.pagination, { limit: 100, nextCursor: null, hasNextPage: false });
});

test("bitbucket pipelines steps list validates required UUID before network calls", async () => {
  const hookPath = await writeFetchHook(`globalThis.fetch = async () => Response.json({ message: "should not fetch" }, { status: 500 });`);

  const result = await runIre(["bitbucket", "pipelines", "steps", "list", "--repo", "ws/repo"], {
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(envelope.error.code, "MISSING_ARGUMENT");
  assert.deepEqual(envelope.error.details, { argument: "UUID" });
});

test("bitbucket pipelines steps list maps not found, auth, provider, and network errors", async () => {
  const notFoundHook = await writeFetchHook(`globalThis.fetch = async () => Response.json({ message: "missing" }, { status: 404 });`);
  const notFound = await runIre(["bitbucket", "pipelines", "steps", "list", "{missing}", "--repo", "ws/repo"], {
    nodeArgs: ["--import", notFoundHook],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  assert.equal(notFound.exitCode, 4);
  assert.equal(parseJson(notFound.stdout).error.code, "BITBUCKET_PIPELINE_NOT_FOUND");

  const authHook = await writeFetchHook(`globalThis.fetch = async () => Response.json({ message: "nope" }, { status: 401 });`);
  const auth = await runIre(["bitbucket", "pipelines", "steps", "list", "{pipeline}", "--repo", "ws/repo"], {
    nodeArgs: ["--import", authHook],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  assert.equal(auth.exitCode, 3);
  assert.equal(parseJson(auth.stdout).error.code, "BITBUCKET_AUTH_FAILED");

  const providerHook = await writeFetchHook(`globalThis.fetch = async () => Response.json({ message: "boom" }, { status: 503 });`);
  const provider = await runIre(["bitbucket", "pipelines", "steps", "list", "{pipeline}", "--repo", "ws/repo"], {
    nodeArgs: ["--import", providerHook],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  assert.equal(provider.exitCode, 5);
  assert.equal(parseJson(provider.stdout).error.code, "BITBUCKET_PROVIDER_ERROR");

  const networkHook = await writeFetchHook(`globalThis.fetch = async () => { throw new Error("offline"); };`);
  const network = await runIre(["bitbucket", "pipelines", "steps", "list", "{pipeline}", "--repo", "ws/repo"], {
    nodeArgs: ["--import", networkHook],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  assert.equal(network.exitCode, 6);
  assert.equal(parseJson(network.stdout).error.code, "BITBUCKET_NETWORK_ERROR");
});

test("bitbucket pipelines get fetches a UUID and emits a normalized pipeline run", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);
      if (url !== "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pipelines/%7Bpipeline-1%7D") {
        return Response.json({ message: "unexpected url", url }, { status: 500 });
      }
      const expectedAuthorization = "Basic " + Buffer.from("bb-user:bb-secret").toString("base64");
      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }
      return Response.json({
        uuid: "{pipeline-1}", build_number: 123, state: { name: "COMPLETED", result: { name: "SUCCESSFUL" } },
        target: { ref_name: "main" }, trigger: { name: "push" },
        created_on: "2026-05-04T12:34:56.000Z", completed_on: "2026-05-04T12:39:56.000Z", duration_in_seconds: 300
      });
    };
  `);

  const result = await runIre(["bitbucket", "pipelines", "get", "{pipeline-1}", "--repo", "workspace-one/repo-one"], {
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(envelope.data, {
    uuid: "{pipeline-1}", buildNumber: 123, state: "COMPLETED", result: "SUCCESSFUL", branch: "main", trigger: "push",
    created: "2026-05-04T12:34:56.000Z", completed: "2026-05-04T12:39:56.000Z", durationInSeconds: 300,
  });
  assert.deepEqual(envelope.meta, { bitbucket: { workspace: "workspace-one", repo: "repo-one" } });
});

test("bitbucket pipelines get reuses Git remote repo resolution", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === "https://api.bitbucket.org/2.0/repositories/remote-workspace/remote-repo/pipelines/%7Bpipeline-remote%7D") {
        return Response.json({
          uuid: "{pipeline-remote}", build_number: 7, state: { name: "IN_PROGRESS" }, target: { ref_name: "feature" },
          trigger: { name: "manual" }, created_on: "2026-05-04T10:00:00.000Z"
        });
      }
      return Response.json({ url }, { status: 500 });
    };
  `);
  const remoteDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await runCommand("git", ["init"], { cwd: remoteDir });
  await runCommand("git", ["remote", "add", "origin", "git@bitbucket.org:remote-workspace/remote-repo.git"], { cwd: remoteDir });

  const result = await runIre(["bitbucket", "pipelines", "get", "{pipeline-remote}"], {
    cwd: remoteDir,
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(parseJson(result.stdout).meta, { bitbucket: { workspace: "remote-workspace", repo: "remote-repo" } });
});

test("bitbucket pipelines list filters by branch and emits normalized pipelines with pagination", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);
      if (url !== "https://api.bitbucket.org/2.0/repositories/workspace-one/repo-one/pipelines/?pagelen=50&target.ref_name=main") {
        return Response.json({ message: "unexpected url", url }, { status: 500 });
      }
      const expectedAuthorization = "Basic " + Buffer.from("bb-user:bb-secret").toString("base64");
      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }
      return Response.json({
        values: [{
          uuid: "{pipeline-1}", build_number: 123, state: { name: "COMPLETED", result: { name: "SUCCESSFUL" } },
          target: { ref_name: "main" }, trigger: { name: "push" },
          created_on: "2026-05-04T12:34:56.000Z", completed_on: "2026-05-04T12:39:56.000Z", duration_in_seconds: 300
        }],
        next: "next-page"
      });
    };
  `);

  const result = await runIre(["bitbucket", "pipelines", "list", "--repo", "workspace-one/repo-one", "--branch", "main"], {
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("bb-secret"), false);
  assert.deepEqual(envelope.data, {
    pipelines: [{
      uuid: "{pipeline-1}", buildNumber: 123, state: "COMPLETED", result: "SUCCESSFUL", branch: "main", trigger: "push",
      created: "2026-05-04T12:34:56.000Z", completed: "2026-05-04T12:39:56.000Z", durationInSeconds: 300,
    }],
    pagination: { limit: 50, nextCursor: "next-page", hasNextPage: true },
  });
  assert.deepEqual(envelope.meta, { bitbucket: { workspace: "workspace-one", repo: "repo-one" } });
});

test("bitbucket pipelines latest returns the newest normalized pipeline and no-run filters exit not found", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === "https://api.bitbucket.org/2.0/repositories/ws/repo/pipelines/?pagelen=1&target.ref_name=feature") {
        return Response.json({ values: [{
          uuid: "{pipeline-latest}", build_number: 9, state: { name: "IN_PROGRESS" }, target: { ref_name: "feature" },
          trigger: { name: "manual" }, created_on: "2026-05-04T10:00:00.000Z"
        }] });
      }
      if (url === "https://api.bitbucket.org/2.0/repositories/ws/repo/pipelines/?pagelen=1&target.ref_name=empty") {
        return Response.json({ values: [] });
      }
      return Response.json({ url }, { status: 500 });
    };
  `);

  const latest = await runIre(["bitbucket", "pipelines", "latest", "--repo", "ws/repo", "--branch", "feature"], {
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  assert.equal(latest.exitCode, 0);
  assert.deepEqual(parseJson(latest.stdout).data, {
    uuid: "{pipeline-latest}", buildNumber: 9, state: "IN_PROGRESS", result: null, branch: "feature", trigger: "manual",
    created: "2026-05-04T10:00:00.000Z", completed: null, durationInSeconds: null,
  });

  const none = await runIre(["bitbucket", "pipelines", "latest", "--repo", "ws/repo", "--branch", "empty"], {
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  const envelope = parseJson(none.stdout);
  assert.equal(none.exitCode, 4);
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "BITBUCKET_PIPELINE_NOT_FOUND");
});

test("bitbucket pipelines list supports cursor, caps limits, and reuses Git remote repo resolution", async () => {
  const cursor = "https://api.bitbucket.org/2.0/repositories/ws/repo/pipelines/?page=2&pagelen=25";
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === ${JSON.stringify(cursor)}) return Response.json({ values: [] });
      if (url === "https://api.bitbucket.org/2.0/repositories/remote-workspace/remote-repo/pipelines/?pagelen=100") return Response.json({ values: [] });
      return Response.json({ url }, { status: 500 });
    };
  `);

  const cursorResult = await runIre(["bitbucket", "pipelines", "list", "--repo", "ws/repo", "--limit", "25", "--cursor", cursor], {
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  assert.equal(cursorResult.exitCode, 0);
  assert.deepEqual(parseJson(cursorResult.stdout).data.pagination, { limit: 25, nextCursor: null, hasNextPage: false });

  const remoteDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await runCommand("git", ["init"], { cwd: remoteDir });
  await runCommand("git", ["remote", "add", "origin", "git@bitbucket.org:remote-workspace/remote-repo.git"], { cwd: remoteDir });
  const capped = await runIre(["bitbucket", "pipelines", "list", "--limit", "101"], {
    cwd: remoteDir,
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  assert.equal(capped.exitCode, 0);
  assert.deepEqual(parseJson(capped.stdout).data.pagination, { limit: 100, nextCursor: null, hasNextPage: false });
});

test("bitbucket pipelines get validates required UUID before network calls", async () => {
  const hookPath = await writeFetchHook(`globalThis.fetch = async () => Response.json({ message: "should not fetch" }, { status: 500 });`);

  const result = await runIre(["bitbucket", "pipelines", "get", "--repo", "ws/repo"], {
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(envelope.error.code, "MISSING_ARGUMENT");
  assert.deepEqual(envelope.error.details, { argument: "UUID" });
});

test("bitbucket pipelines get maps not found to a structured exit code", async () => {
  const hookPath = await writeFetchHook(`globalThis.fetch = async () => Response.json({ message: "missing" }, { status: 404 });`);

  const result = await runIre(["bitbucket", "pipelines", "get", "{missing}", "--repo", "ws/repo"], {
    nodeArgs: ["--import", hookPath],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 4);
  assert.equal(envelope.success, false);
  assert.equal(envelope.error.code, "BITBUCKET_PIPELINE_NOT_FOUND");
  assert.deepEqual(envelope.error.details, { repo: { workspace: "ws", repo: "repo" }, uuid: "{missing}", status: 404 });
});

test("bitbucket pipelines get maps provider and network errors to structured exit codes", async () => {
  const providerHook = await writeFetchHook(`globalThis.fetch = async () => Response.json({ message: "boom" }, { status: 503 });`);
  const provider = await runIre(["bitbucket", "pipelines", "get", "{pipeline}", "--repo", "ws/repo"], {
    nodeArgs: ["--import", providerHook],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  assert.equal(provider.exitCode, 5);
  assert.equal(parseJson(provider.stdout).error.code, "BITBUCKET_PROVIDER_ERROR");

  const networkHook = await writeFetchHook(`globalThis.fetch = async () => { throw new Error("offline"); };`);
  const network = await runIre(["bitbucket", "pipelines", "get", "{pipeline}", "--repo", "ws/repo"], {
    nodeArgs: ["--import", networkHook],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  assert.equal(network.exitCode, 6);
  assert.equal(parseJson(network.stdout).error.code, "BITBUCKET_NETWORK_ERROR");
});

test("bitbucket pipelines list maps provider and network errors to structured exit codes", async () => {
  const providerHook = await writeFetchHook(`globalThis.fetch = async () => Response.json({ message: "boom" }, { status: 503 });`);
  const provider = await runIre(["bitbucket", "pipelines", "list", "--repo", "ws/repo"], {
    nodeArgs: ["--import", providerHook],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  assert.equal(provider.exitCode, 5);
  assert.equal(parseJson(provider.stdout).error.code, "BITBUCKET_PROVIDER_ERROR");

  const networkHook = await writeFetchHook(`globalThis.fetch = async () => { throw new Error("offline"); };`);
  const network = await runIre(["bitbucket", "pipelines", "list", "--repo", "ws/repo"], {
    nodeArgs: ["--import", networkHook],
    env: { IRE_BITBUCKET_USERNAME: "bb-user", IRE_BITBUCKET_APP_PASSWORD: "bb-secret" },
  });
  assert.equal(network.exitCode, 6);
  assert.equal(parseJson(network.stdout).error.code, "BITBUCKET_NETWORK_ERROR");
});
