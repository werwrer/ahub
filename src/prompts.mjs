import { createInterface } from "node:readline/promises";
import inquirer from "inquirer";

function normalizeError(error) {
  if (error?.name === "ExitPromptError") throw Object.assign(new Error("cancelled"), { code: "CANCELLED" });
  throw error;
}

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
    if (terminal) return run({ type: "select", name: "value", message, choices: normalized, pageSize: 12, loop: false, theme: { helpMode: "never" } });
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
    return run({
      type: "search",
      name: "value",
      message,
      pageSize: 12,
      source: async (term = "") => {
        const query = term.trim().toLocaleLowerCase();
        return query ? normalized.filter((choice) => choice.name.toLocaleLowerCase().includes(query)) : normalized;
      },
      theme: { helpMode: "never" },
    });
  };
  const confirm = (message, initial = true) => terminal
    ? run({ type: "confirm", name: "value", message, default: initial })
    : Promise.resolve(initial);
  const password = (message) => terminal
    ? run({ type: "password", name: "value", message, mask: "•", validate: (value) => value.trim() ? true : "API key cannot be empty" })
    : askFallback(message);
  const checkbox = (message, choices) => terminal
    ? run({ type: "checkbox", name: "value", message, choices: choices.map((choice) => ({ ...choice, name: choice.name ?? choice.label })), loop: false, instructions: false, validate: (items) => items.length ? true : "Select at least one option" })
    : Promise.resolve(choices.filter((choice) => choice.checked).map((choice) => choice.value));

  return { ask, select, search, confirm, password, checkbox, interactive: terminal };
}
