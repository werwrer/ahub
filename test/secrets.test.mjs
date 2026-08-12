import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProviderCredential, getProviderSecret, loadSecrets, removeProviderSecret, setProviderSecret } from "../src/secrets.mjs";
import { paths } from "../src/store.mjs";

test("project credentials are private, retrievable, and removable", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-secrets-"));
  try {
    await setProviderSecret(root, "deepseek", " secret-value ");
    assert.equal(await getProviderSecret(root, "deepseek"), "secret-value");
    assert.equal((await stat(paths(root).secrets)).mode & 0o777, 0o600);
    assert.doesNotMatch(await readFile(paths(root).secrets, "utf8"), /DEEPSEEK_API_KEY/u);
    assert.equal(await removeProviderSecret(root, "deepseek"), true);
    assert.deepEqual(await loadSecrets(root), {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ahub credentials work across projects without modifying project secrets", async () => {
  const first = await mkdtemp(join(tmpdir(), "ahub-global-first-"));
  const second = await mkdtemp(join(tmpdir(), "ahub-global-second-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-global-home-"));
  const options = { scope: "ahub", credentialHome, verifiedAt: "2026-08-12T00:00:00.000Z" };
  try {
    await setProviderSecret(first, "deepseek", "global-secret", options);
    assert.equal(await getProviderSecret(second, "deepseek", { credentialHome }), "global-secret");
    assert.equal((await getProviderCredential(second, "deepseek", { credentialHome })).scope, "ahub");
    const file = join(credentialHome, ".ahub", "credentials.json");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await loadSecrets(first), {});
    assert.equal(await removeProviderSecret(second, "deepseek", { scope: "ahub", credentialHome }), true);
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});
