import chalk from "chalk";
import ora from "ora";

// Shared column width for aligned output (agents, providers, models).
export const COL = 14;

export function clearScreen() {
  if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");
}

// clack-style chrome (chalk only, no prompt dependency). The status strip that opens every
// control-center loop uses the same ◆ │ └ frame the prompts render with, so menu and data
// read as one surface.
export function intro(title) {
  console.log(chalk.cyan(`\n  ◆  ${chalk.bold(title)}`));
  console.log(chalk.cyan("  │"));
}
export function outro(message = "") {
  console.log(chalk.cyan("  │"));
  console.log(chalk.cyan(`  └  ${chalk.dim(message)}`));
}

// One-line session header: version and project always visible, no ASCII box.
export function header(version, projectDir) {
  console.log(chalk.cyan(`\n  ◆  ${chalk.bold("ahub")}${version ? chalk.dim(`  v${version}`) : ""}${projectDir ? chalk.dim(`  ·  ${projectDir}`) : ""}`));
}

// Key-value row for the status strip: label in dim, value regular — aligned, no borders.
// Padding is by display width (CJK counts double), so Chinese and ASCII labels line up.
const LABEL_WIDTH = 12; // fits "Active model" (en) and "当前模型" (zh) alike
const displayWidth = (text) => [...text].reduce((width, ch) => width + (ch.codePointAt(0) > 0xff ? 2 : 1), 0);
export function row(label, value) {
  console.log(`  ${chalk.dim(label)}${" ".repeat(Math.max(1, LABEL_WIDTH - displayWidth(label) + 2))}${value}`);
}

export function divider() {
  console.log(chalk.dim(`  ${"─".repeat(46)}`));
}

export function section(title, subtitle) {
  console.log(`\n${chalk.cyan.bold(`  ◆  ${title}`)}`);
  if (subtitle) console.log(chalk.dim(`     ${subtitle}`));
}

export function hint(value) { console.log(chalk.dim(`\n  ${value}`)); }
export function success(value) { console.log(chalk.green(`  ✓ ${value}`)); }
export function warning(value) { console.log(chalk.yellow(`  ! ${value}`)); }

export function statusMark(state, labels = {}) {
  if (state === "ready" || state === "installed" || state === true) return chalk.green(labels.ready ?? "● Ready");
  if (state === "missing" || state === "not installed" || state === false) return chalk.yellow(labels.needsSetup ?? "○ Needs setup");
  return chalk.dim(labels.unavailable ?? "○ Unavailable");
}

export function spinner(text) {
  if (!process.stdout.isTTY) return { start() { return this; }, succeed() {}, fail() {}, stop() {} };
  return ora({ text, color: "cyan" }).start();
}
