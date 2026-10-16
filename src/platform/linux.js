import fs from 'node:fs/promises';
import { runCommand } from '../utils/process-info.js';
import { UtilityMissingError } from '../utils/errors.js';
import { lsofListeners, describeUnixProcess, killUnix, isRunningUnix } from './unix.js';

/** Working directory from /proc/PID/cwd. /proc/PID/environ is never read. */
export async function linuxCwd(pid, readlink = fs.readlink) {
  try {
    return { cwd: await readlink(`/proc/${pid}/cwd`) };
  } catch (error) {
    if (error.code === 'EACCES' || error.code === 'EPERM') return { reason: 'permission denied' };
    if (error.code === 'ENOENT') return { reason: 'process has exited' };
    return { reason: 'not available' };
  }
}

/** Parse `ss -ltnpH` output. Process info is absent when the socket belongs to another user. */
export function parseSs(output) {
  const listeners = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const columns = line.trim().split(/\s+/);
    const address = columns[3] ?? null;
    const users = [...line.matchAll(/\("([^"]*)",pid=(\d+)/g)];
    if (users.length === 0) {
      listeners.push({ pid: null, name: null, addresses: [address] });
      continue;
    }
    for (const [, name, pid] of users) listeners.push({ pid: Number(pid), name, addresses: [address] });
  }
  return listeners;
}

export function createLinuxAdapter({ run = runCommand, kill, readlink } = {}) {
  return {
    platform: 'linux',
    async findListeners(port) {
      const r = await run('ss', ['-ltnpH', `sport = :${port}`]);
      if (!r.missing && r.ok) return parseSs(r.stdout);
      const listeners = await lsofListeners(port, run);
      if (listeners === null) throw new UtilityMissingError('ss or lsof');
      return listeners;
    },
    describeProcess: (pid) => describeUnixProcess(pid, { run, getCwd: (p) => linuxCwd(p, readlink) }),
    isRunning: async (pid) => isRunningUnix(pid, kill),
    killProcess: async (pid, { force = false } = {}) => killUnix(pid, force, kill),
  };
}
