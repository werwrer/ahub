import { createInterface } from "node:readline/promises";
import { isCancel, autocomplete, confirm, multiselect, password, select as clackSelect, text } from "@clack/prompts";

function exitError() { return Object.assign(new Error("exit"), { code: "EXIT" }); }
function cancelledError() { return Object.assign(new Error("cancelled"), { code: "CANCELLED" }); }

// Esc navigates back: resolve to the choice that is a back/exit item.
// Ctrl+C (EXIT code) propagates up to terminate the program.
const BACK_VALUES = ["back", "exit", "__back__"];
function cancelFallback(choices) {
  for (const key of BACK_VALUES) {
    const choice = choices.find((item) => item.value === key);
    if (choice) return choice.value;
  }
  return undefined;
}

// Choice normalization shared by every prompt: callers pass {name|label, value, hint|description}
// (the injected-test shape and the call-site shape stay identical). Separator instances from
// @inquirer/core are mapped to a disabled dash row so old call sites keep rendering grouped menus.
function toOption(choice) {
  if (choice?.type === "separator") {
    return { label: choice.line ?? choice.name ?? "─".repeat(24), value: Symbol("separator"), disabled: true };
  }
  return {
    label: choice.name ?? choice.label ?? String(choice.value),
    value: choice.value,
    ...(choice.hint ?? choice.description ? { hint: choice.hint ?? choice.description } : {}),
    ...(choice.disabled ? { disabled: true } : {}),
  };
}

// clack maps both Escape and Ctrl+C to the same cancel symbol. A parallel keypress observer
// records which one was pressed so the adapter can keep the two-key contract:
// Esc = go back (CANCELLED / back-value), Ctrl+C = exit the program (EXIT).
async function run(factory, choices, input) {
  let sawCtrlC = false;
  const onKeypress = (_str, key) => {
    if (key?.ctrl && key?.name === "c") sawCtrlC = true;
  };
  if (input?.on) input.on("keypress", onKeypress);
  try {
    const result = await factory();
    if (isCancel(result)) {
      if (sawCtrlC) throw exitError();
      const back = cancelFallback(choices ?? []);
      if (back !== undefined) return back;
      throw cancelledError();
    }
    return result;
  } finally {
    if (input?.off) input.off("keypress", onKeypress);
  }
}

// clack validators return undefined for OK; ahub call sites return true (legacy inquirer shape).
const validator = (validate) => (value) => {
  if (!validate) return undefined;
  const result = validate(value);
  return result === true ? undefined : result;
};

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

  const ask = (message, options = {}) => terminal
    ? run(() => text({
        message,
        defaultValue: options.default,
        placeholder: options.placeholder,
        validate: validator(options.validate),
        input, output,
      }), [], input)
    : askFallback(message);

  const select = async (message, choices) => {
    if (!terminal) {
      output.write(`\n${message}\n`);
      choices.forEach((choice, index) => output.write(`  ${index + 1}. ${choice.name ?? choice.label}\n`));
      while (true) {
        const answer = await askFallback(`Choose 1-${choices.length}`);
        const choice = choices[Number(answer) - 1];
        if (choice) return choice.value;
        output.write("Please enter one of the listed numbers.\n");
      }
    }
    return run(() => clackSelect({
      message,
      options: choices.map(toOption),
      maxItems: 14,
      input, output,
    }), choices, input);
  };

  // Filterable picker for long lists (models, providers). Short lists stay a plain select —
  // a filter line over four items is noise, not help.
  const search = async (message, choices) => {
    if (!terminal || choices.length <= 8) return select(message, choices);
    return run(() => autocomplete({
      message,
      options: choices.map(toOption),
      maxItems: 12,
      input, output,
    }), choices, input);
  };

  const confirmPrompt = (message, initial = true) => terminal
    ? run(() => confirm({ message, initialValue: initial, input, output }), [], input)
    : Promise.resolve(initial);

  const askPassword = (message) => terminal
    ? run(() => password({
        message,
        validate: validator((value) => value.trim() ? true : "API key cannot be empty"),
        input, output,
      }), [], input)
    : askFallback(message);

  const checkbox = async (message, choices) => {
    if (!terminal) return choices.filter((choice) => choice.checked).map((choice) => choice.value);
    const options = choices.map(toOption);
    const picked = await run(() => multiselect({
      message,
      options,
      initialValues: choices.filter((choice) => choice.checked).map((choice) => choice.value),
      required: true,
      input, output,
    }), choices, input);
    return picked;
  };

  return { ask, select, search, confirm: confirmPrompt, password: askPassword, checkbox, interactive: terminal };
}
