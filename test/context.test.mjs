import test from "node:test";
import assert from "node:assert/strict";
import { compileContext } from "../src/context.mjs";

const session = {
  id: "s1",
  name: "auth",
  workspace: "/tmp/project",
  tasks: [{ id: "t1", title: "Fix auth", status: "pending" }],
  runs: [
    { id: "r1", runtime: "claude", status: "completed", output: "Use token rotation" },
    { id: "r2", runtime: "codex", status: "failed", output: "ignore this" },
  ],
};

test("summary context includes successful previous results and open tasks", () => {
  const context = compileContext(session, "Implement it", "summary");
  assert.match(context.prompt, /Use token rotation/);
  assert.match(context.prompt, /Fix auth/);
  assert.doesNotMatch(context.prompt, /ignore this/);
  assert.deepEqual(context.manifest.previousRunIds, ["r1"]);
});

test("task context excludes previous results", () => {
  const context = compileContext(session, "Review independently", "task");
  assert.doesNotMatch(context.prompt, /Use token rotation/);
});
