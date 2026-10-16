import { execFile } from 'node:child_process';

/**
 * Run a command with an argument array (no shell) and a timeout. Never throws.
 * The shell option exists only for Windows .cmd shims and must be used with fixed arguments.
 */
export function runCommand(command, args = [], { timeout = 5000, shell = false, env } = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, shell, env: env ? { ...process.env, ...env } : undefined, windowsHide: true, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ ok: true, code: 0, stdout: String(stdout), stderr: String(stderr), missing: false, timedOut: false });
        return;
      }
      resolve({
        ok: false,
        code: typeof error.code === 'number' ? error.code : null,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        missing: error.code === 'ENOENT',
        timedOut: Boolean(error.killed),
      });
    });
  });
}

/** Get a tool's version, e.g. `npm --version`. Returns null when it is not available. */
export async function getToolVersion(tool, { run = runCommand, platform = process.platform } = {}) {
  // Package managers are .cmd shims on Windows and need a shell; the arguments are constant.
  const r = await run(tool, ['--version'], { timeout: 8000, shell: platform === 'win32' });
  if (!r.ok) return null;
  return r.stdout.trim().split(/\r?\n/)[0] || null;
}
