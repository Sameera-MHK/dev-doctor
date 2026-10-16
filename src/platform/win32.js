import { runCommand } from '../utils/process-info.js';
import { UtilityMissingError } from '../utils/errors.js';

/**
 * Parse `netstat -ano` output. Listening sockets have a foreign port of 0;
 * this avoids depending on the localized "LISTENING" state text.
 */
export function parseNetstat(output, port) {
  const listeners = [];
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP') continue;
    const [, local, foreign] = parts;
    const pid = Number(parts[parts.length - 1]);
    if (!local.endsWith(`:${port}`) || !foreign.endsWith(':0') || !Number.isInteger(pid)) continue;
    listeners.push({ pid, name: null, addresses: [local] });
  }
  return listeners;
}

/** Parse `tasklist /FO CSV /NH` output and return the image name. */
export function parseTasklist(output) {
  const match = /^"([^"]+)","(\d+)"/m.exec(output);
  return match ? match[1] : null;
}

// The PID is passed through an environment variable and cast to [int], so it is never interpolated into the script.
const DESCRIBE_SCRIPT = [
  '$p = [int]$env:DEV_DOCTOR_PID',
  '$x = Get-CimInstance Win32_Process -Filter "ProcessId = $p"',
  'if ($x) { $x | Select-Object ProcessId, ParentProcessId, Name, CommandLine | ConvertTo-Json -Compress }',
].join('; ');

/** Parse the JSON printed by DESCRIBE_SCRIPT. */
export function parseWin32Process(output) {
  const text = output.trim();
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    return { ppid: Number.isInteger(data.ParentProcessId) ? data.ParentProcessId : null, name: data.Name ?? null, command: data.CommandLine || null };
  } catch {
    return null;
  }
}

export function createWin32Adapter({ run = runCommand } = {}) {
  return {
    platform: 'win32',
    async findListeners(port) {
      const r = await run('netstat', ['-ano']);
      if (r.missing) throw new UtilityMissingError('netstat');
      const listeners = parseNetstat(r.stdout, port);
      for (const listener of listeners) {
        const t = await run('tasklist', ['/FI', `PID eq ${listener.pid}`, '/FO', 'CSV', '/NH']);
        if (t.ok) listener.name = parseTasklist(t.stdout);
      }
      return listeners;
    },
    async describeProcess(pid) {
      const details = { exists: true, ppid: null, user: null, command: null, cwd: null, unavailable: { cwd: 'not available on Windows', user: 'not collected on Windows' } };
      const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DESCRIBE_SCRIPT], { timeout: 10000, env: { DEV_DOCTOR_PID: String(pid) } });
      if (r.missing) {
        details.unavailable.command = 'PowerShell not found';
        return details;
      }
      const parsed = r.ok ? parseWin32Process(r.stdout) : null;
      if (r.ok && !parsed) return { ...details, exists: false, unavailable: { ...details.unavailable, command: 'process has exited' } };
      if (!parsed) {
        details.unavailable.command = 'not available';
        return details;
      }
      details.ppid = parsed.ppid;
      details.command = parsed.command;
      // CommandLine is empty for elevated or other users' processes.
      if (!parsed.command) details.unavailable.command = 'not accessible (permission denied)';
      return details;
    },
    async isRunning(pid) {
      const t = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
      return t.ok && parseTasklist(t.stdout) !== null;
    },
    async killProcess(pid, { force = false } = {}) {
      const args = ['/PID', String(pid)];
      if (force) args.push('/F');
      const r = await run('taskkill', args);
      if (r.ok) return { ok: true };
      if (r.missing) return { ok: false, reason: 'error', message: 'taskkill not found' };
      const text = `${r.stdout} ${r.stderr}`;
      if (/access is denied/i.test(text)) return { ok: false, reason: 'permission' };
      if (/not found/i.test(text)) return { ok: false, reason: 'not-found' };
      return { ok: false, reason: 'error', message: text.trim() };
    },
  };
}
