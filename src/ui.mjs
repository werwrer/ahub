import chalk from "chalk";
import ora from "ora";

const width = 58;
const line = "─".repeat(width);

export function clearScreen() {
  if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");
}

export function banner(version = "", tagline = "Your coding agents, one simple control center") {
  console.log(chalk.cyan.bold("\n  ┌──────────────────────────────────────────────────────────┐"));
  console.log(chalk.cyan.bold("  │") + chalk.white.bold("   ahub") + chalk.dim(`   ${tagline}`));
  console.log(chalk.cyan.bold("  └──────────────────────────────────────────────────────────┘") + (version ? chalk.dim(`  v${version}`) : ""));
}

export function section(title, subtitle) {
  console.log(`\n${chalk.cyan.bold(title)}`);
  console.log(chalk.dim(line));
  if (subtitle) console.log(chalk.dim(subtitle));
}

export function hint(value) { console.log(chalk.dim(`\n  ${value}`)); }
export function success(value) { console.log(chalk.green(`\n  ✓ ${value}`)); }
export function warning(value) { console.log(chalk.yellow(`\n  ! ${value}`)); }

export function statusMark(state, labels = {}) {
  if (state === "ready" || state === "installed" || state === true) return chalk.green(labels.ready ?? "● Ready");
  if (state === "missing" || state === "not installed" || state === false) return chalk.yellow(labels.needsSetup ?? "○ Needs setup");
  return chalk.dim(labels.unavailable ?? "○ Unavailable");
}

export function spinner(text) {
  if (!process.stdout.isTTY) return { start() { return this; }, succeed() {}, fail() {}, stop() {} };
  return ora({ text, color: "cyan" }).start();
}
