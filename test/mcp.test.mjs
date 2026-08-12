import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delegate, handle, redact, resolveShortcuts } from "../plugins/ahub/server/ahub-mcp.mjs";

test("MCP server advertises host-context delegation tools", async () => {
  const initialized = await handle({ method: "initialize", params: { protocolVersion: "2025-06-18" } });
  const listed = await handle({ method: "tools/list" });
  assert.equal(initialized.serverInfo.name, "ahub");
  assert.deepEqual(listed.tools.map((tool) => tool.name), ["delegate", "status"]);
  assert.match(listed.tools[0].description, /host.*context/iu);
});

test("shortcut dimensions compose without coupling model, context, and role", () => {
  const route = resolveShortcuts(["/ds", "/fresh", "/review"], {
    "/ds": { model: "ds4f" },
    "/fresh": { contextMode: "fresh" },
    "/review": { role: "reviewer" },
  });
  assert.deepEqual(route, { model: "ds4f", contextMode: "fresh", role: "reviewer" });
});

test("outbound context redacts common secrets", () => {
  const value = redact("API_KEY=secret-value token: abcdefghijklmnopqrstuvwxyz sk-test_abcdefghijklmnop");
  assert.doesNotMatch(value, /secret-value|abcdefghijklmnopqrstuvwxyz|sk-test_/u);
  assert.match(value, /REDACTED/u);
});

test("delegate sends host-selected context and returns DeepSeek output", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-workspace-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { model: "deepseek-v4-flash" } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "private-key", verifiedAt: "now" } }));
  let sent;
  try {
    const result = await delegate({ task: "continue the design", context: "The host discussed option A.", workspace }, {
      credentialHome,
      fetch: async (_url, request) => {
        sent = { headers: request.headers, body: JSON.parse(request.body) };
        return { ok: true, json: async () => ({ choices: [{ message: { content: "Choose option A." } }] }) };
      },
    });
    assert.equal(result.output, "Choose option A.");
    assert.equal(result.contextMode, "related");
    assert.match(sent.body.messages[1].content, /host discussed option A/u);
    assert.equal(sent.headers.Authorization, "Bearer private-key");
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("full host context requires explicit confirmation", async () => {
  await assert.rejects(() => delegate({ task: "analyze", contextMode: "full" }), /confirmation/u);
});
