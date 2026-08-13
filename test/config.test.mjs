import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_CONFIG_VERSION, migrateConfig } from "../src/config.mjs";

test("migrateConfig stamps the current version on a versionless config", () => {
  const config = migrateConfig({ models: { fast: { model: "x" } } });
  assert.equal(config.version, CURRENT_CONFIG_VERSION);
});

test("migrateConfig refuses a newer-than-supported config instead of mis-merging", () => {
  assert.throws(() => migrateConfig({ version: 99 }), /newer than this ahub supports/u);
});

test("migrateConfig forward-migrates an older config to the current version", () => {
  const config = migrateConfig({ version: 0, models: { fast: { model: "x" } } });
  assert.equal(config.version, CURRENT_CONFIG_VERSION);
  assert.equal(config.models.fast.model, "x");
});
