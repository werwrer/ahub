import { createInterface } from "node:readline/promises";
import inquirer from "inquirer";

function normalizeError(error) {
  if (error?.name === "ExitPromptError") throw Object.assign(new Error("cancelled"), { code: "CANCELLED" });
  throw error;
}

// Esc (or Ctrl+C) in a menu navigates back: resolve to the choice that is a back/exit item.
const BACK_VALUES = ["back", "exit", "__back__"];
function cancelFallback(choices) {
  for (const key of BACK_VALUES) {
    const choice = choices.find((item) => item.value === key);
    if (choice) return choice.value;
  }
  return undefined;
}
async function guardBack(runPromise, choices) {
  try {
    return await runPromise;
  } catch (error) {
    if (error?.code !== "CANCELLED") throw error;
    const back = cancelFallback(choices);
    if (back !== undefined) return back;
    throw error;
  }
}

// Always-visible key hints (inquirer renders these as the green help line).
const NAV_HINT = "↑↓ 选择 · Enter 确认 · Esc 返回  (↑↓ move · Enter confirm · Esc back)";
const SEARCH_HINT = "输入过滤 · ↑↓ 选择 · Enter 确认 · Esc 返回  (type to filter · Esc back)";
const instructions = (hint) => ({ navigation: hint, pager: hint });

export function createPrompts(input = process.stdin, output = process.stdout) {
  const terminal = Boolean(input.isTTY && output.isTTY);
  const askFallback = async (message) => {
    const readline = createInterface({ input, output });
    try {
      return (await readline.question(`${message}: `)).trim();
    } finally {
      readline.close();
    }
  };
  const run = async (question) => {
    try {
      return (await inquirer.prompt([question], {}, { input, output })).value;
    } catch (error) {
      return normalizeError(error);
    }
  };

  const ask = (message, options = {}) => terminal
    ? run({ type: "input", name: "value", message, default: options.default, validate: options.validate })
    : askFallback(message);
  const select = async (message, choices) => {
    const normalized = choices.map((choice) => ({ ...choice, name: choice.name ?? choice.label }));
    if (terminal) return guardBack(run({ type: "select", name: "value", message, choices: normalized, pageSize: 12, loop: true, instructions: instructions(NAV_HINT) }), choices);
    output.write(`\n${message}\n`);
    choices.forEach((choice, index) => output.write(`  ${index + 1}. ${choice.name ?? choice.label}\n`));
    while (true) {
      const answer = await askFallback(`Choose 1-${choices.length}`);
      const choice = choices[Number(answer) - 1];
      if (choice) return choice.value;
      output.write("Please enter one of the listed numbers.\n");
    }
  };
  const search = async (message, choices) => {
    const normalized = choices.map((choice) => ({ ...choice, name: choice.name ?? choice.label }));
    if (!terminal || normalized.length <= 8) return select(message, normalized);
    return guardBack(run({
      type: "search",
      name: "value",
      message,
      pageSize: 12,
      instructions: instructions(SEARCH_HINT),
      source: async (term = "") => {
        const query = term.trim().toLocaleLowerCase();
        return query ? normalized.filter((choice) => choice.name.toLocaleLowerCase().includes(query)) : normalized;
      },
    }), normalized);
  };
  const confirm = (message, initial = true) => terminal
    ? run({ type: "confirm", name: "value", message, default: initial })
    : Promise.resolve(initial);
  const password = (message) => terminal
    ? run({ type: "password", name: "value", message, mask: "•", validate: (value) => value.trim() ? true : "API key cannot be empty" })
    : askFallback(message);
  const checkbox = (message, choices) => terminal
    ? guardBack(run({ type: "checkbox", name: "value", message, choices: choices.map((choice) => ({ ...choice, name: choice.name ?? choice.label })), loop: true, instructions: "空格 选择 · Enter 确认 · Esc 返回  (Space toggle · Enter confirm · Esc back)", validate: (items) => items.length ? true : "Select at least one option" }), choices)
    : Promise.resolve(choices.filter((choice) => choice.checked).map((choice) => choice.value));

  return { ask, select, search, confirm, password, checkbox, interactive: terminal };
}
