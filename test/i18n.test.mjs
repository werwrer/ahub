import test from "node:test";
import assert from "node:assert/strict";
import { inferLanguage, translator } from "../src/i18n.mjs";

test("infers Chinese and English from the system locale", () => {
  assert.equal(inferLanguage({ LANG: "zh_CN.UTF-8" }), "zh-CN");
  assert.equal(inferLanguage({ LC_ALL: "zh-CN" }), "zh-CN");
  assert.equal(inferLanguage({ LANG: "en_US.UTF-8" }), "en");
});

test("translates primary navigation and interpolates values", () => {
  const zh = translator("zh-CN");
  const en = translator("en");
  assert.match(zh("controlCenter"), /控制中心/u);
  assert.match(zh("installNow", { cli: "Codex" }), /Codex/u);
  assert.match(en("language"), /Language/u);
});
