import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const STATE_VERSION = 1;

export function paths(root) {
  const dir = join(root, ".ahub");
  return { dir, state: join(dir, "state.json"), config: join(dir, "config.json"), secrets: join(dir, "secrets.json"), lock: join(dir, "state.lock") };
}

export function legacyPaths(root) {
  const dir = join(root, ".agenthub");
  return { dir, state: join(dir, "state.json"), config: join(dir, "config.json") };
}

export async function migrateLegacyState(root) {
  const current = paths(root);
  const legacy = legacyPaths(root);
  if (!(await exists(current.state)) && await exists(legacy.state)) {
    await rename(legacy.dir, current.dir);
    return true;
  }
  return false;
}

export function emptyState() {
  return { version: STATE_VERSION, revision: 0, sessions: [], events: [] };
}

export async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function loadState(root) {
  await migrateLegacyState(root);
  const file = paths(root).state;
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    if (value.version !== STATE_VERSION) throw new Error(`unsupported state version ${value.version}`);
    return value;
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("not initialized; run `ahub init`");
    if (error instanceof SyntaxError) throw new Error(`invalid state file: ${file}`);
    throw error;
  }
}

export async function saveState(root, state) {
  const file = paths(root).state;
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function acquireLock(root, timeoutMs = 10_000) {
  const lock = paths(root).lock;
  const started = Date.now();
  await mkdir(paths(root).dir, { recursive: true });
  while (true) {
    try {
      await mkdir(lock);
      return async () => rm(lock, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - (await stat(lock)).mtimeMs;
        if (age > timeoutMs * 3) {
          await rm(lock, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      if (Date.now() - started >= timeoutMs) throw new Error("ahub state is busy; retry the command");
      await wait(20 + Math.floor(Math.random() * 30));
    }
  }
}

export async function mutate(root, type, data, change) {
  const release = await acquireLock(root);
  try {
    const state = await loadState(root);
    const result = change(state);
    state.revision += 1;
    state.events.push({ id: crypto.randomUUID(), revision: state.revision, type, at: new Date().toISOString(), data });
    await saveState(root, state);
    return result;
  } finally {
    await release();
  }
}

export function findSession(state, idOrName) {
  const session = state.sessions.find((item) => item.id === idOrName || item.name === idOrName);
  if (!session) throw new Error(`session not found: ${idOrName}`);
  return session;
}
