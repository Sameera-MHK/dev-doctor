import { runCommand } from '../utils/process-info.js';
import { UtilityMissingError } from '../utils/errors.js';
import { lsofListeners, describeUnixProcess, killUnix, isRunningUnix } from './unix.js';

/** Working directory via `lsof -a -p PID -d cwd -Fn`; only visible for your own processes without root. */
export async function darwinCwd(pid, run = runCommand) {
  const r = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  if (r.missing) return { reason: 'lsof not found' };
  const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith('n'));
  return line ? { cwd: line.slice(1) } : { reason: 'not accessible (permission denied or another user)' };
}

export function createDarwinAdapter({ run = runCommand, kill } = {}) {
  return {
    platform: 'darwin',
    async findListeners(port) {
      const listeners = await lsofListeners(port, run);
      if (listeners === null) throw new UtilityMissingError('lsof');
      return listeners;
    },
    describeProcess: (pid) => describeUnixProcess(pid, { run, getCwd: (p) => darwinCwd(p, run) }),
    isRunning: async (pid) => isRunningUnix(pid, kill),
    killProcess: async (pid, { force = false } = {}) => killUnix(pid, force, kill),
  };
}
