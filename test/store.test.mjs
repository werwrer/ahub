import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, loadState, mutate, saveState } from "../src/store.mjs";

test("event mutations increment revisions and persist", async () => {
  const root = await mkdtemp(join(tmpdir(), "agenthub-test-"));
  try {
    await saveState(root, emptyState());
    await mutate(root, "TestEvent", { ok: true }, (state) => state.sessions.push({ id: "s1" }));
    const state = await loadState(root);
    assert.equal(state.revision, 1);
    assert.equal(state.events[0].type, "TestEvent");
    assert.equal(state.sessions[0].id, "s1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent mutations do not lose agent events", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-concurrent-"));
  try {
    await saveState(root, emptyState());
    await Promise.all(Array.from({ length: 20 }, (_, index) => mutate(
      root,
      "ConcurrentEvent",
      { index },
      (state) => state.sessions.push({ id: `s${index}` }),
    )));
    const state = await loadState(root);
    assert.equal(state.revision, 20);
    assert.equal(state.events.length, 20);
    assert.equal(state.sessions.length, 20);
    assert.equal(new Set(state.sessions.map((session) => session.id)).size, 20);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
