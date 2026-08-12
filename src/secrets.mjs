import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { paths } from "./store.mjs";

function globalSecretsFile(options = {}) {
  return resolve(options.credentialHome ?? homedir(), ".ahub", "credentials.json");
}

async function readSecretsFile(file) {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) throw new Error(`invalid secrets file: ${file}`);
    throw error;
  }
}

export async function loadSecrets(root) {
  return readSecretsFile(paths(root).secrets);
}

async function saveSecretsFile(file, secrets) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
}

export async function getProviderCredential(root, provider, options = {}) {
  const local = (await loadSecrets(root))[provider];
  if (local?.apiKey) return { ...local, scope: "project" };
  const global = (await readSecretsFile(globalSecretsFile(options)))[provider];
  return global?.apiKey ? { ...global, scope: "ahub" } : undefined;
}

export async function setProviderSecret(root, provider, apiKey, options = {}) {
  if (!apiKey?.trim()) throw new Error("API key cannot be empty");
  const scope = options.scope ?? "project";
  const file = scope === "ahub" ? globalSecretsFile(options) : paths(root).secrets;
  const secrets = await readSecretsFile(file);
  secrets[provider] = { apiKey: apiKey.trim(), updatedAt: new Date().toISOString(), ...(options.verifiedAt ? { verifiedAt: options.verifiedAt } : {}) };
  await saveSecretsFile(file, secrets);
}

export async function removeProviderSecret(root, provider, options = {}) {
  const scope = options.scope ?? "project";
  const file = scope === "ahub" ? globalSecretsFile(options) : paths(root).secrets;
  const secrets = await readSecretsFile(file);
  if (!secrets[provider]) return false;
  delete secrets[provider];
  if (Object.keys(secrets).length) await saveSecretsFile(file, secrets);
  else await rm(file, { force: true });
  return true;
}

export async function getProviderSecret(root, provider, options = {}) {
  return (await getProviderCredential(root, provider, options))?.apiKey;
}

export async function readHidden(prompt, input = process.stdin, output = process.stdout) {
  if (!input.isTTY) throw new Error("secure input requires an interactive terminal");
  let muted = false;
  const hiddenOutput = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) output.write(chunk, encoding);
      callback();
    },
  });
  const terminal = createInterface({ input, output: hiddenOutput, terminal: true });
  try {
    const answer = terminal.question(prompt);
    muted = true;
    const value = await answer;
    output.write("\n");
    return value;
  } finally {
    terminal.close();
  }
}
