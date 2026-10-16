import { confirm, select } from '@inquirer/prompts';

export function isInteractive({ ci = false } = {}) {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY) && !ci && !process.env.CI;
}

// Prompts are written to stderr so stdout stays clean (e.g. for --json).
const context = { output: process.stderr };

export async function askConfirm(message, defaultValue = false) {
  try {
    return await confirm({ message, default: defaultValue }, context);
  } catch {
    return false; // Ctrl+C or closed input counts as "no".
  }
}

export async function askSelect(message, choices) {
  try {
    return await select({ message, choices }, context);
  } catch {
    return null;
  }
}
