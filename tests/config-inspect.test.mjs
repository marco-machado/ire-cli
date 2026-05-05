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
    const child = spawn(process.execPath, [
      ...(options.nodeArgs ?? []),
      cliPath,
      ...args,
    ], {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

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

test("config inspect emits a successful JSON envelope", async () => {
  const result = await runIre(["config", "inspect"]);
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, true);
  assert.equal(envelope.schemaVersion, "1.0");
  assert.equal(typeof envelope.data, "object");
  assert.deepEqual(envelope.meta, {});
});

test("config inspect reports defaulted config fields", async () => {
  const result = await runIre(["config", "inspect"]);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(parseJson(result.stdout).data, {
    config: {
      jira: {
        baseUrl: { value: null, source: "default" },
        email: { value: null, source: "default" },
        apiToken: { value: null, source: "default" },
      },
      bitbucket: {
        workspace: { value: null, source: "default" },
        repo: { value: null, source: "default" },
        username: { value: null, source: "default" },
        appPassword: { value: null, source: "default" },
      },
    },
  });
});

test("config inspect resolves process environment values and redacts secrets", async () => {
  const result = await runIre(["config", "inspect"], {
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
      IRE_BITBUCKET_WORKSPACE: "example-workspace",
      IRE_BITBUCKET_REPO: "example-repo",
      IRE_BITBUCKET_USERNAME: "bb-user",
      IRE_BITBUCKET_APP_PASSWORD: "bb-secret",
    },
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(parseJson(result.stdout).data.config, {
    jira: {
      baseUrl: { value: "https://jira.example.test", source: "env" },
      email: { value: "agent@example.test", source: "env" },
      apiToken: { value: "<redacted>", source: "env" },
    },
    bitbucket: {
      workspace: { value: "example-workspace", source: "env" },
      repo: { value: "example-repo", source: "env" },
      username: { value: "bb-user", source: "env" },
      appPassword: { value: "<redacted>", source: "env" },
    },
  });
});

test("config inspect reads project env from the git root", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  const nestedDir = join(projectDir, "packages", "cli");
  await mkdir(join(projectDir, ".git"));
  await mkdir(nestedDir, { recursive: true });
  await writeFile(
    join(projectDir, ".env"),
    [
      "IRE_JIRA_EMAIL=project-agent@example.test",
      "IRE_JIRA_API_TOKEN=project-env-secret",
    ].join("\n"),
  );

  const result = await runIre(["config", "inspect"], { cwd: nestedDir });
  const config = parseJson(result.stdout).data.config;

  assert.equal(result.exitCode, 0);
  assert.deepEqual(config.jira.email, {
    value: "project-agent@example.test",
    source: "project-env",
  });
  assert.deepEqual(config.jira.apiToken, {
    value: "<redacted>",
    source: "project-env",
  });
  assert.deepEqual(config.bitbucket.workspace, {
    value: null,
    source: "default",
  });
});

test("config inspect respects flag env project and user config precedence", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  const nestedDir = join(projectDir, "nested");
  const homeDir = await mkdtemp(join(tmpdir(), "ire-cli-home-"));
  await mkdir(join(projectDir, ".git"));
  await mkdir(join(projectDir, ".ire"), { recursive: true });
  await mkdir(join(homeDir, ".config", "ire-cli"), { recursive: true });
  await mkdir(nestedDir, { recursive: true });

  await writeFile(
    join(homeDir, ".config", "ire-cli", "config.json"),
    JSON.stringify({
      jira: {
        baseUrl: "https://user-jira.example.test",
        email: "user-agent@example.test",
        apiToken: "user-jira-secret",
      },
      bitbucket: {
        workspace: "user-workspace",
        repo: "user-repo",
        username: "user-bb",
        appPassword: "user-bb-secret",
      },
    }),
  );
  await writeFile(
    join(projectDir, ".ire", "config.json"),
    JSON.stringify({
      jira: {
        baseUrl: "https://project-config-jira.example.test",
      },
      bitbucket: {
        workspace: "project-config-workspace",
        repo: "project-config-repo",
      },
    }),
  );
  await writeFile(
    join(projectDir, ".env"),
    [
      "IRE_JIRA_EMAIL=project-env-agent@example.test",
      "IRE_BITBUCKET_USERNAME=project-env-bb",
    ].join("\n"),
  );

  const result = await runIre(
    [
      "config",
      "inspect",
      "--jira-email",
      "flag-agent@example.test",
      "--bitbucket-app-password",
      "flag-bb-secret",
    ],
    {
      cwd: nestedDir,
      home: homeDir,
      env: {
        IRE_BITBUCKET_WORKSPACE: "env-workspace",
      },
    },
  );
  const config = parseJson(result.stdout).data.config;

  assert.equal(result.exitCode, 0);
  assert.deepEqual(config, {
    jira: {
      baseUrl: {
        value: "https://project-config-jira.example.test",
        source: "project-config",
      },
      email: { value: "flag-agent@example.test", source: "flag" },
      apiToken: { value: "<redacted>", source: "user-config" },
    },
    bitbucket: {
      workspace: { value: "env-workspace", source: "env" },
      repo: { value: "project-config-repo", source: "project-config" },
      username: { value: "project-env-bb", source: "project-env" },
      appPassword: { value: "<redacted>", source: "flag" },
    },
  });
});

test("config inspect emits a structured validation failure", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await mkdir(join(projectDir, ".git"));
  await mkdir(join(projectDir, ".ire"), { recursive: true });
  await writeFile(
    join(projectDir, ".ire", "config.json"),
    JSON.stringify({ jira: { baseUrl: 123 } }),
  );

  const result = await runIre(["config", "inspect"], { cwd: projectDir });
  const envelope = parseJson(result.stdout);

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(envelope.success, false);
  assert.equal(envelope.schemaVersion, "1.0");
  assert.equal(envelope.error.code, "CONFIG_VALIDATION_ERROR");
  assert.match(envelope.error.message, /Invalid project config/);
  assert.deepEqual(envelope.meta, {});
  assert.equal("data" in envelope, false);
});

test("config inspect preserves explicit null values without undefined output", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await mkdir(join(projectDir, ".git"));
  await mkdir(join(projectDir, ".ire"), { recursive: true });
  await writeFile(
    join(projectDir, ".ire", "config.json"),
    JSON.stringify({
      jira: {
        baseUrl: null,
        apiToken: null,
      },
    }),
  );

  const result = await runIre(["config", "inspect"], { cwd: projectDir });
  const config = parseJson(result.stdout).data.config;

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.includes("undefined"), false);
  assert.deepEqual(config.jira.baseUrl, {
    value: null,
    source: "project-config",
  });
  assert.deepEqual(config.jira.apiToken, {
    value: null,
    source: "project-config",
  });
});

test("config inspect does not make provider network calls", async () => {
  const hookDir = await mkdtemp(join(tmpdir(), "ire-cli-hook-"));
  const hookPath = join(hookDir, "disable-fetch.mjs");
  await writeFile(
    hookPath,
    "globalThis.fetch = () => { throw new Error('network call attempted'); };",
  );

  const result = await runIre(["config", "inspect"], {
    nodeArgs: ["--import", hookPath],
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(parseJson(result.stdout).success, true);
});

test("config inspect uses cwd for project files outside a git repository", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "ire-cli-nongit-"));
  await mkdir(join(cwd, ".ire"), { recursive: true });
  await writeFile(
    join(cwd, ".ire", "config.json"),
    JSON.stringify({
      jira: {
        baseUrl: "https://cwd-config-jira.example.test",
      },
    }),
  );
  await writeFile(join(cwd, ".env"), "IRE_JIRA_EMAIL=cwd-env@example.test");

  const result = await runIre(["config", "inspect"], { cwd });
  const config = parseJson(result.stdout).data.config;

  assert.equal(result.exitCode, 0);
  assert.deepEqual(config.jira.baseUrl, {
    value: "https://cwd-config-jira.example.test",
    source: "project-config",
  });
  assert.deepEqual(config.jira.email, {
    value: "cwd-env@example.test",
    source: "project-env",
  });
});
