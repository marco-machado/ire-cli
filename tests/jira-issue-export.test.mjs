import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
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

async function writeFetchHook(source) {
  const hookDir = await mkdtemp(join(tmpdir(), "ire-cli-fetch-hook-"));
  const hookPath = join(hookDir, "mock-fetch.mjs");
  await writeFile(hookPath, source);
  return hookPath;
}

async function writeProjectConfig(config) {
  const cwd = await mkdtemp(join(tmpdir(), "ire-cli-project-"));
  await mkdir(join(cwd, ".git"));
  await mkdir(join(cwd, ".ire"));
  await writeFile(join(cwd, ".ire", "config.json"), JSON.stringify(config));
  return cwd;
}

const jiraConfig = {
  jira: {
    baseUrl: "https://jira.example.test",
    email: "agent@example.test",
    apiToken: "jira-secret",
    issueExport: {
      fieldMappings: {
        sprints: ["customfield_10020"],
        storyPoints: ["customfield_10016"],
        testPlan: ["customfield_11747", "customfield_11748"],
        regression: ["customfield_11734"],
        acceptanceCriteria: ["customfield_11745", "customfield_11735"],
      },
    },
  },
};

function minimalIssueFields(overrides = {}) {
  return {
    summary: "Minimal issue",
    description: null,
    status: { name: "To Do" },
    issuetype: { name: "Task" },
    priority: null,
    project: { key: "ABC", name: "Agent Bridge" },
    assignee: null,
    reporter: null,
    labels: [],
    created: "2026-05-04T12:00:00.000+0000",
    updated: "2026-05-04T12:30:00.000+0000",
    attachment: [],
    subtasks: [],
    issuelinks: [],
    ...overrides,
  };
}

test("jira issue export emits a complete curated issue with Markdown and semantic fields", async () => {
  const cwd = await writeProjectConfig(jiraConfig);
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const headers = new Headers(init.headers);
      const expectedAuthorization = "Basic " + Buffer.from("agent@example.test:jira-secret").toString("base64");

      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }

      if (url.pathname === "/rest/api/3/issue/ABC-123") {
        return Response.json({
          id: "10001",
          key: "ABC-123",
          fields: {
            summary: "Export Jira context",
            description: {
              type: "doc",
              version: 1,
              content: [
                { type: "paragraph", content: [{ type: "text", text: "First paragraph." }] },
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Second " },
                    { type: "text", text: "bold", marks: [{ type: "strong" }] },
                    { type: "text", text: " paragraph." }
                  ]
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "List item" }] }]
                    }
                  ]
                },
                {
                  type: "codeBlock",
                  attrs: { language: "js" },
                  content: [{ type: "text", text: "const answer = 42;" }]
                }
              ]
            },
            status: { name: "In Progress" },
            issuetype: { name: "Story" },
            priority: { name: "High" },
            project: { key: "ABC", name: "Agent Bridge" },
            assignee: { accountId: "assignee-1", displayName: "Assignee One" },
            reporter: { accountId: "reporter-1", displayName: "Reporter One" },
            labels: ["agent", "export"],
            created: "2026-05-04T12:34:56.000+0000",
            updated: "2026-05-04T13:45:01.000+0000",
            parent: { key: "ABC-100", fields: { summary: "Parent issue" } },
            customfield_10020: [
              { name: "Sprint 1", state: "closed" },
              { name: "Sprint 2", state: "active" }
            ],
            customfield_10016: 8,
            customfield_11747: {
              type: "doc",
              version: 1,
              content: []
            },
            customfield_11748: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: "Run the suite." }] }]
            },
            customfield_11734: { value: "No" },
            customfield_11745: null,
            customfield_11735: null,
            attachment: [
              {
                filename: "screen.png",
                mimeType: "image/png",
                size: 1234,
                content: "https://jira.example.test/secure/attachment/1/screen.png"
              }
            ],
            subtasks: [
              {
                key: "ABC-124",
                fields: {
                  summary: "Child task",
                  status: { name: "To Do" }
                }
              }
            ],
            issuelinks: [
              {
                type: { outward: "relates to", inward: "is related by" },
                outwardIssue: {
                  key: "ABC-125",
                  fields: {
                    summary: "Related bug",
                    issuetype: { name: "Bug" },
                    status: { name: "Done" }
                  }
                }
              }
            ]
          }
        });
      }

      if (url.pathname === "/rest/api/3/issue/ABC-123/comment") {
        if (url.searchParams.get("maxResults") !== "100" || url.searchParams.get("startAt") !== "0") {
          return Response.json({ message: "unexpected pagination", url: String(url) }, { status: 500 });
        }
        return Response.json({
          startAt: 0,
          maxResults: 100,
          total: 1,
          comments: [
            {
              id: "20001",
              author: { accountId: "commenter-1", displayName: "Commenter One" },
              created: "2026-05-04T14:00:00.000+0000",
              body: {
                type: "doc",
                version: 1,
                content: [{ type: "paragraph", content: [{ type: "text", text: "Looks good." }] }]
              }
            }
          ]
        });
      }

      return Response.json({ message: "unexpected url", url: String(url) }, { status: 500 });
    };
  `);

  const result = await runIre(["jira", "issue", "export", "ABC-123"], {
    cwd,
    nodeArgs: ["--import", hookPath],
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("jira-secret"), false);
  assert.deepEqual(JSON.parse(result.stdout), {
    success: true,
    schemaVersion: "1.0",
    data: {
      key: "ABC-123",
      summary: "Export Jira context",
      description:
        "First paragraph.\n\nSecond **bold** paragraph.\n\n- List item\n\n```js\nconst answer = 42;\n```",
      status: "In Progress",
      issueType: "Story",
      priority: "High",
      project: { key: "ABC", name: "Agent Bridge" },
      assignee: { accountId: "assignee-1", displayName: "Assignee One" },
      reporter: { accountId: "reporter-1", displayName: "Reporter One" },
      labels: ["agent", "export"],
      sprints: [
        { name: "Sprint 1", state: "closed" },
        { name: "Sprint 2", state: "active" },
      ],
      storyPoints: 8,
      parent: { key: "ABC-100", summary: "Parent issue" },
      created: "2026-05-04T12:34:56.000Z",
      updated: "2026-05-04T13:45:01.000Z",
      customFields: {
        testPlan: "Run the suite.",
        regression: "No",
        acceptanceCriteria: null,
      },
      comments: [
        {
          author: { accountId: "commenter-1", displayName: "Commenter One" },
          created: "2026-05-04T14:00:00.000Z",
          body: "Looks good.",
        },
      ],
      attachments: [
        {
          filename: "screen.png",
          mimeType: "image/png",
          size: 1234,
          contentUrl: "https://jira.example.test/secure/attachment/1/screen.png",
        },
      ],
      subtasks: [{ key: "ABC-124", summary: "Child task", status: "To Do" }],
      issueLinks: [
        {
          relationship: "relates to",
          key: "ABC-125",
          summary: "Related bug",
          type: "Bug",
          status: "Done",
        },
      ],
    },
    meta: {},
  });
});

test("jira issue export returns raw ADF consistently and fetches every comment page", async () => {
  const cwd = await writeProjectConfig(jiraConfig);
  const description = {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: "Raw description" }] }],
  };
  const testPlan = {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: "Raw test plan" }] }],
  };
  const firstComment = {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }],
  };
  const secondComment = {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }],
  };
  const hookPath = await writeFetchHook(`
    const description = ${JSON.stringify(description)};
    const testPlan = ${JSON.stringify(testPlan)};
    const comments = [${JSON.stringify(firstComment)}, ${JSON.stringify(secondComment)}];

    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/api/3/issue/ABC-200") {
        return Response.json({
          key: "ABC-200",
          fields: {
            summary: "Raw export",
            description,
            status: { name: "To Do" },
            issuetype: { name: "Task" },
            priority: null,
            project: { key: "ABC", name: "Agent Bridge" },
            assignee: null,
            reporter: null,
            labels: [],
            created: "2026-05-04T12:00:00.000+0000",
            updated: "2026-05-04T12:30:00.000+0000",
            customfield_11747: testPlan,
            attachment: [],
            subtasks: [],
            issuelinks: []
          }
        });
      }

      if (url.pathname === "/rest/api/3/issue/ABC-200/comment") {
        const startAt = Number(url.searchParams.get("startAt"));
        return Response.json({
          startAt,
          maxResults: 100,
          total: 2,
          comments: [{
            id: String(startAt + 1),
            author: null,
            created: startAt === 0
              ? "2026-05-04T13:00:00.000+0000"
              : "2026-05-04T14:00:00.000+0000",
            body: comments[startAt]
          }]
        });
      }

      return Response.json({ message: "unexpected url", url: String(url) }, { status: 500 });
    };
  `);

  const result = await runIre(
    ["jira", "issue", "export", "ABC-200", "--adf-format", "raw"],
    { cwd, nodeArgs: ["--import", hookPath] },
  );
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(envelope.data.description, description);
  assert.deepEqual(envelope.data.customFields.testPlan, testPlan);
  assert.deepEqual(envelope.data.comments, [
    { author: null, created: "2026-05-04T13:00:00.000Z", body: firstComment },
    { author: null, created: "2026-05-04T14:00:00.000Z", body: secondComment },
  ]);
});

test("jira issue export downloads authenticated attachments safely and overwrites existing files", async () => {
  const cwd = await writeProjectConfig(jiraConfig);
  const downloadDir = join(cwd, "downloads");
  await mkdir(downloadDir);
  await writeFile(join(downloadDir, "screen.txt"), "stale");
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const headers = new Headers(init.headers);
      const expectedAuthorization = "Basic " + Buffer.from("agent@example.test:jira-secret").toString("base64");
      if (headers.get("authorization") !== expectedAuthorization) {
        return Response.json({ message: "unexpected authorization" }, { status: 401 });
      }

      if (url.pathname === "/rest/api/3/issue/ABC-300") {
        return Response.json({
          key: "ABC-300",
          fields: {
            summary: "Download attachment",
            description: null,
            status: { name: "To Do" },
            issuetype: { name: "Task" },
            priority: null,
            project: { key: "ABC", name: "Agent Bridge" },
            assignee: null,
            reporter: null,
            labels: [],
            created: "2026-05-04T12:00:00.000+0000",
            updated: "2026-05-04T12:30:00.000+0000",
            attachment: [{
              filename: "/tmp/screen.txt",
              mimeType: "text/plain",
              size: 5,
              content: "https://jira.example.test/secure/attachment/300/screen.txt"
            }],
            subtasks: [],
            issuelinks: []
          }
        });
      }

      if (url.pathname === "/rest/api/3/issue/ABC-300/comment") {
        return Response.json({ startAt: 0, maxResults: 100, total: 0, comments: [] });
      }

      if (url.pathname === "/secure/attachment/300/screen.txt") {
        return new Response("fresh", {
          status: 200,
          headers: { "content-type": "text/plain" }
        });
      }

      return Response.json({ message: "unexpected url", url: String(url) }, { status: 500 });
    };
  `);

  const result = await runIre(
    ["jira", "issue", "export", "ABC-300", "--download-attachments", downloadDir],
    { cwd, nodeArgs: ["--import", hookPath] },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(await readFile(join(downloadDir, "screen.txt"), "utf8"), "fresh");
  await assert.rejects(readFile(join(cwd, "screen.txt"), "utf8"), { code: "ENOENT" });
});

test("jira issue export renders supported and unknown ADF nodes as readable Markdown", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/comment")) {
        return Response.json({ startAt: 0, maxResults: 100, total: 0, comments: [] });
      }
      return Response.json({
        key: "ABC-400",
        fields: {
          summary: "ADF fidelity",
          description: {
            type: "doc",
            version: 1,
            content: [
              { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Docs", marks: [{ type: "link", attrs: { href: "https://example.test/docs" } }] },
                  { type: "hardBreak" },
                  { type: "mention", attrs: { text: "Marco" } },
                  { type: "text", text: " " },
                  { type: "emoji", attrs: { shortName: ":wave:" } },
                  { type: "text", text: " " },
                  { type: "inlineCard", attrs: { url: "https://example.test/card" } }
                ]
              },
              { type: "blockquote", content: [
                { type: "paragraph", content: [{ type: "text", text: "First quote" }] },
                { type: "paragraph", content: [{ type: "text", text: "Second quote" }] }
              ] },
              {
                type: "orderedList",
                attrs: { order: 2 },
                content: [
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Two" }] }] }
                ]
              },
              {
                type: "bulletList",
                content: [{
                  type: "listItem",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "Parent" }] },
                    { type: "bulletList", content: [{
                      type: "listItem",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Child" }] }]
                    }] }
                  ]
                }]
              },
              {
                type: "table",
                content: [
                  { type: "tableRow", content: [
                    { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }] },
                    { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Value" }] }] }
                  ] },
                  { type: "tableRow", content: [
                    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
                    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] }
                  ] }
                ]
              },
              { type: "panel", attrs: { panelType: "warning" }, content: [
                { type: "paragraph", content: [{ type: "text", text: "First warning" }] },
                { type: "paragraph", content: [{ type: "text", text: "Second warning" }] }
              ] },
              { type: "paragraph", content: [
                { type: "text", text: "literal *markdown*" },
                { type: "hardBreak" },
                { type: "text", text: "next line" }
              ] },
              { type: "mediaSingle", content: [{ type: "media", attrs: { id: "media-123", alt: "diagram" } }] },
              { type: "futureNode", content: [{ type: "paragraph", content: [{ type: "text", text: "Fallback" }] }] }
            ]
          },
          status: { name: "To Do" },
          issuetype: { name: "Task" },
          priority: null,
          project: { key: "ABC", name: "Agent Bridge" },
          assignee: null,
          reporter: null,
          labels: [],
          created: "2026-05-04T12:00:00.000+0000",
          updated: "2026-05-04T12:30:00.000+0000",
          attachment: [],
          subtasks: [],
          issuelinks: []
        }
      });
    };
  `);

  const result = await runIre(["jira", "issue", "export", "ABC-400"], {
    nodeArgs: ["--import", hookPath],
    env: {
      IRE_JIRA_BASE_URL: "https://jira.example.test",
      IRE_JIRA_EMAIL: "agent@example.test",
      IRE_JIRA_API_TOKEN: "jira-secret",
    },
  });
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(
    envelope.data.description,
    "## Title\n\n[Docs](https://example.test/docs)  \n@Marco :wave: https://example.test/card\n\n> First quote\n>\n> Second quote\n\n2. One\n3. Two\n\n- Parent\n  - Child\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\n> [!WARNING]\n> First warning\n>\n> Second warning\n\nliteral \\*markdown\\*  \nnext line\n\n[media: diagram]\n\nFallback",
  );
});

test("jira issue export validates arguments, options, and field mapping config before network calls", async () => {
  const hookPath = await writeFetchHook(`
    globalThis.fetch = async () => {
      throw new Error("network call attempted");
    };
  `);
  const env = {
    IRE_JIRA_BASE_URL: "https://jira.example.test",
    IRE_JIRA_EMAIL: "agent@example.test",
    IRE_JIRA_API_TOKEN: "jira-secret",
  };

  const missing = await runIre(["jira", "issue", "export"], {
    nodeArgs: ["--import", hookPath],
    env,
  });
  const invalidFormat = await runIre(
    ["jira", "issue", "export", "ABC-500", "--adf-format", "html"],
    { nodeArgs: ["--import", hookPath], env },
  );
  const invalidConfigCwd = await writeProjectConfig({
    ...jiraConfig,
    jira: {
      ...jiraConfig.jira,
      issueExport: { fieldMappings: { testPlan: [] } },
    },
  });
  const invalidConfig = await runIre(["jira", "issue", "export", "ABC-500"], {
    cwd: invalidConfigCwd,
    nodeArgs: ["--import", hookPath],
  });
  const unsafeConfigCwd = await writeProjectConfig({
    ...jiraConfig,
    jira: {
      ...jiraConfig.jira,
      issueExport: { fieldMappings: { "unsafe-key": ["customfield_1"] } },
    },
  });
  const unsafeConfig = await runIre(["jira", "issue", "export", "ABC-500"], {
    cwd: unsafeConfigCwd,
    nodeArgs: ["--import", hookPath],
  });

  assert.equal(missing.exitCode, 2);
  assert.equal(JSON.parse(missing.stdout).error.code, "MISSING_ARGUMENT");
  assert.equal(invalidFormat.exitCode, 2);
  assert.equal(JSON.parse(invalidFormat.stdout).error.code, "INVALID_OPTION");
  assert.equal(invalidConfig.exitCode, 2);
  assert.equal(JSON.parse(invalidConfig.stdout).error.code, "CONFIG_VALIDATION_ERROR");
  assert.equal(JSON.parse(invalidConfig.stdout).error.details[0].path, "jira.issueExport.fieldMappings.testPlan");
  assert.equal(unsafeConfig.exitCode, 2);
  assert.equal(JSON.parse(unsafeConfig.stdout).error.code, "CONFIG_VALIDATION_ERROR");
});

test("jira issue export maps malformed output and attachment failures to structured errors", async () => {
  const env = {
    IRE_JIRA_BASE_URL: "https://jira.example.test",
    IRE_JIRA_EMAIL: "agent@example.test",
    IRE_JIRA_API_TOKEN: "jira-secret",
  };
  const malformedHook = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/comment")) {
        return Response.json({ startAt: 0, maxResults: 100, total: 0, comments: [] });
      }
      return Response.json({ key: "ABC-600", fields: {} });
    };
  `);
  const attachmentHook = await writeFetchHook(`
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/api/3/issue/ABC-601") {
        return Response.json({
          key: "ABC-601",
          fields: {
            summary: "Attachment failure",
            description: null,
            status: { name: "To Do" },
            issuetype: { name: "Task" },
            priority: null,
            project: { key: "ABC", name: "Agent Bridge" },
            assignee: null,
            reporter: null,
            labels: [],
            created: "2026-05-04T12:00:00.000+0000",
            updated: "2026-05-04T12:30:00.000+0000",
            attachment: [{
              filename: "failed.txt",
              mimeType: "text/plain",
              size: 1,
              content: "https://jira.example.test/secure/attachment/601/failed.txt"
            }],
            subtasks: [],
            issuelinks: []
          }
        });
      }
      if (url.pathname.endsWith("/comment")) {
        return Response.json({ startAt: 0, maxResults: 100, total: 0, comments: [] });
      }
      return Response.json({ message: "download failed" }, { status: 500 });
    };
  `);

  const malformed = await runIre(["jira", "issue", "export", "ABC-600"], {
    nodeArgs: ["--import", malformedHook],
    env,
  });
  const downloadDir = await mkdtemp(join(tmpdir(), "ire-cli-attachments-"));
  const attachmentFailure = await runIre(
    ["jira", "issue", "export", "ABC-601", "--download-attachments", downloadDir],
    { nodeArgs: ["--import", attachmentHook], env },
  );

  assert.equal(malformed.exitCode, 1);
  assert.equal(JSON.parse(malformed.stdout).error.code, "INTERNAL_ERROR");
  assert.equal(attachmentFailure.exitCode, 5);
  assert.equal(JSON.parse(attachmentFailure.stdout).error.code, "JIRA_PROVIDER_ERROR");
  assert.equal(attachmentFailure.stdout.includes("jira-secret"), false);
});

test("jira issue export rejects malformed pagination and configured sprint/story-point values", async () => {
  const malformedPaginationHook = await writeFetchHook(`
    const fields = ${JSON.stringify(minimalIssueFields())};
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/comment")) {
        return Response.json({ startAt: 0, comments: [] });
      }
      return Response.json({ key: "ABC-700", fields });
    };
  `);
  const malformedMappingsCwd = await writeProjectConfig({
    ...jiraConfig,
    jira: {
      ...jiraConfig.jira,
      issueExport: {
        fieldMappings: {
          sprints: ["customfield_10020"],
          storyPoints: ["customfield_10016"],
        },
      },
    },
  });
  const malformedMappingsHook = await writeFetchHook(`
    const fields = ${JSON.stringify(minimalIssueFields({
      customfield_10020: [{ name: "Sprint without state" }],
      customfield_10016: "five",
    }))};
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/comment")) {
        return Response.json({ startAt: 0, maxResults: 100, total: 0, comments: [] });
      }
      return Response.json({ key: "ABC-701", fields });
    };
  `);
  const env = {
    IRE_JIRA_BASE_URL: "https://jira.example.test",
    IRE_JIRA_EMAIL: "agent@example.test",
    IRE_JIRA_API_TOKEN: "jira-secret",
  };

  const malformedPagination = await runIre(["jira", "issue", "export", "ABC-700"], {
    nodeArgs: ["--import", malformedPaginationHook],
    env,
  });
  const malformedMappings = await runIre(["jira", "issue", "export", "ABC-701"], {
    cwd: malformedMappingsCwd,
    nodeArgs: ["--import", malformedMappingsHook],
  });

  assert.equal(malformedPagination.exitCode, 1);
  assert.equal(JSON.parse(malformedPagination.stdout).error.code, "INTERNAL_ERROR");
  assert.equal(malformedMappings.exitCode, 1);
  assert.equal(JSON.parse(malformedMappings.stdout).error.code, "INTERNAL_ERROR");
});

test("jira issue export refuses to overwrite an attachment symlink", async () => {
  const cwd = await writeProjectConfig(jiraConfig);
  const downloadDir = join(cwd, "downloads");
  const outsideFile = join(cwd, "outside.txt");
  await mkdir(downloadDir);
  await writeFile(outsideFile, "outside");
  await symlink(outsideFile, join(downloadDir, "linked.txt"));
  const hookPath = await writeFetchHook(`
    const fields = ${JSON.stringify(minimalIssueFields({
      attachment: [{
        filename: "linked.txt",
        mimeType: "text/plain",
        size: 5,
        content: "https://jira.example.test/secure/attachment/702/linked.txt",
      }],
    }))};
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/comment")) {
        return Response.json({ startAt: 0, maxResults: 100, total: 0, comments: [] });
      }
      if (url.pathname.includes("/secure/attachment/")) {
        return new Response("fresh", { status: 200 });
      }
      return Response.json({ key: "ABC-702", fields });
    };
  `);

  const result = await runIre(
    ["jira", "issue", "export", "ABC-702", "--download-attachments", downloadDir],
    { cwd, nodeArgs: ["--import", hookPath] },
  );

  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.stdout).error.code, "JIRA_ATTACHMENT_WRITE_FAILED");
  assert.equal(await readFile(outsideFile, "utf8"), "outside");
});

test("jira issue export maps authentication and network failures", async () => {
  const authHook = await writeFetchHook(`
    globalThis.fetch = async () => Response.json({ message: "denied" }, { status: 401 });
  `);
  const networkHook = await writeFetchHook(`
    globalThis.fetch = async () => { throw new Error("offline"); };
  `);
  const env = {
    IRE_JIRA_BASE_URL: "https://jira.example.test",
    IRE_JIRA_EMAIL: "agent@example.test",
    IRE_JIRA_API_TOKEN: "jira-secret",
  };

  const auth = await runIre(["jira", "issue", "export", "ABC-800"], {
    nodeArgs: ["--import", authHook],
    env,
  });
  const network = await runIre(["jira", "issue", "export", "ABC-800"], {
    nodeArgs: ["--import", networkHook],
    env,
  });

  assert.equal(auth.exitCode, 3);
  assert.equal(JSON.parse(auth.stdout).error.code, "JIRA_AUTH_FAILED");
  assert.equal(network.exitCode, 6);
  assert.equal(JSON.parse(network.stdout).error.code, "JIRA_NETWORK_ERROR");
});
