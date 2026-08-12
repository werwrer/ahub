import test from "node:test";
import assert from "node:assert/strict";
import { validateDeepSeekCredential } from "../src/providers.mjs";

test("DeepSeek validation distinguishes valid and rejected credentials", async () => {
  const valid = await validateDeepSeekCredential("key", { fetch: async () => ({ ok: true, status: 200 }) });
  const invalid = await validateDeepSeekCredential("bad", { fetch: async () => ({ ok: false, status: 401 }) });
  assert.deepEqual(valid, { ok: true });
  assert.deepEqual(invalid, { ok: false, reason: "invalid-key", status: 401 });
});
