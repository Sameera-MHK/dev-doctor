import { runCommand } from '../utils/process-info.js';

/** Parse `lsof -Fpcn` output into listeners. */
export function parseLsof(output) {
  const listeners = [];
  let current = null;
  for (const line of output.split(/\r?\n/)) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') {
      current = { pid: Number(value), name: null, addresses: [] };
      listeners.push(current);
    } else if (field === 'c' && current) {
      current.name = value;
    } else if (field === 'n' && current) {
      current.addresses.push(value);
    }
  }
  return listeners;
}

export async function lsofListeners(port, run = runCommand) {
  const r = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpcn']);
  if (r.missing) return null;
  // lsof exits with 1 when nothing matches.
  return r.stdout.trim() ? parseLsof(r.stdout) : [];
}

/** Parse `ps -o ppid=,user=,command=` output. */
export function parsePs(output) {
  const match = /^\s*(\d+)\s+(\S+)\s*(.*)$/.exec(output.trim());
  if (!match) return null;
  return { ppid: Number(match[1]), user: match[2], command: match[3].trim() || null };
}

/**
 * Process details on Unix. Every field may be null; `unavailable` says why.
 * getCwd(pid) returns { cwd } or { reason }.
 */
export async function describeUnixProcess(pid, { run = runCommand, getCwd } = {}) {
  const details = { exists: true, ppid: null, user: null, command: null, cwd: null, unavailable: {} };
  const r = await run('ps', ['-o', 'ppid=,user=,command=', '-p', String(pid)]);
  const parsed = r.ok ? parsePs(r.stdout) : null;
  if (r.missing) {
    details.unavailable.command = 'ps not found';
  } else if (!parsed) {
    // ps exits non-zero when the PID does not exist.
    return { ...details, exists: false, unavailable: { command: 'process has exited' } };
  } else {
    Object.assign(details, parsed);
    if (!parsed.command) details.unavailable.command = 'not accessible';
  }
  const cwd = await getCwd(pid);
  if (cwd.cwd) details.cwd = cwd.cwd;
  else details.unavailable.cwd = cwd.reason;
  return details;
}

/** Signal 0 checks existence without affecting the process. EPERM means it exists but belongs to someone else. */
export function isRunningUnix(pid, kill = process.kill.bind(process)) {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** Send a signal; returns { ok } or { ok: false, reason: 'permission' | 'not-found' | 'error' }. */
export function killUnix(pid, force, kill = process.kill.bind(process)) {
  try {
    kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    return { ok: true };
  } catch (error) {
    if (error.code === 'EPERM') return { ok: false, reason: 'permission' };
    if (error.code === 'ESRCH') return { ok: false, reason: 'not-found' };
    return { ok: false, reason: 'error', message: error.message };
  }
}
