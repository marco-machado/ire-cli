import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function runIre(args, options = {}) {
  const cwd = options.cwd ?? (await mkdtemp(join(tmpdir(), "ire-cli-test-")));
  const home = options.home ?? (await mkdtemp(join(tmpdir(), "ire-cli-home-")));

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: { PATH: process.env.PATH, HOME: home, ...options.env },
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
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

test("auth check reports a stable not-implemented envelope", async () => {
  const result = await runIre(["auth", "check"]);
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.deepEqual(envelope, {
    success: false,
    schemaVersion: "1.0",
    error: {
      code: "NOT_IMPLEMENTED",
      message: "auth check is not implemented yet",
      details: { command: "auth check" },
    },
    meta: {},
  });
});
