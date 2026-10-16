import path from 'node:path';
import { inspectPort, describeListener, formatProcessDetails, parsePort } from '../checks/ports.js';
import { DevDoctorError } from '../utils/errors.js';

// Never terminate these, even when they hold a port.
const PROTECTED_NAMES = new Set([
  'launchd', 'kernel_task', 'windowserver', 'loginwindow', 'systemd', 'init', 'sshd', 'dockerd',
  'system', 'system idle process', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
  'services.exe', 'lsass.exe', 'svchost.exe', 'explorer.exe', 'dwm.exe',
]);

export function parsePid(value) {
  const text = String(value).trim();
  const pid = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff) {
    throw new DevDoctorError(`Invalid process ID "${value}": expected a positive integer`);
  }
  return pid;
}

/** Returns a reason string if the process must not be terminated, otherwise null. */
export function killSafetyReason(listener, { currentPid = process.pid, parentPid = process.ppid } = {}) {
  const { pid } = listener;
  if (!Number.isInteger(pid) || pid <= 4) return 'it is a system process';
  if (pid === currentPid) return 'it is dev-doctor itself';
  if (pid === parentPid) return 'it is the shell or process that started dev-doctor';
  const name = path.basename(String(listener.name ?? '')).toLowerCase();
  if (PROTECTED_NAMES.has(name)) return `"${listener.name}" is a protected system process`;
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until the port is free or the target process has exited, or the timeout passes. */
async function waitAfterSignal(port, pid, deps, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const i = await inspectPort(port, deps);
    if (i.state === 'free') return;
    if (!(await deps.adapter.isRunning(pid))) return;
    if (Date.now() >= deadline) return;
    await sleep(200);
  }
}

/**
 * Terminate the process listening on a port, safely:
 * - the target must be unambiguous (single listener, --pid, or an interactive choice) and pass safety rules;
 * - explicit confirmation (or --yes when non-interactive);
 * - re-check the target right before signalling; graceful first;
 * - force only as a separate, explicit step (--force or a second confirmation) while the same PID still holds the port;
 * - "released" is only reported after a fresh check finds the port free.
 * Returns { port, pid, status: 'released'|'free'|'cancelled'|'refused'|'failed', message }.
 */
export async function terminatePortProcess(portValue, options) {
  const { adapter, bind, interactive, yes = false, force = false, confirm, choose, waitMs = 3000, safety, projectRoot } = options;
  const log = options.log ?? (() => {});
  const port = parsePort(portValue);
  const requestedPid = options.pid === undefined || options.pid === null ? null : parsePid(options.pid);
  const deps = { adapter, bind };
  let target = null;
  const done = (status, message) => ({ port, pid: target?.pid ?? requestedPid, status, message });

  const inspection = await inspectPort(port, { ...deps, describe: true, projectRoot });
  if (inspection.state === 'free') return done('free', `Port ${port} is already free; nothing was terminated`);
  const candidates = inspection.listeners;
  if (candidates.length === 0 || candidates.some((l) => !l.pid)) {
    return done('refused', `Port ${port} is in use, but its owning process cannot be identified reliably${inspection.error ? ` (${inspection.error})` : ''}. Nothing was terminated; dev-doctor does not request elevated permissions.`);
  }

  if (requestedPid !== null) {
    target = candidates.find((l) => l.pid === requestedPid) ?? null;
    if (!target) return done('refused', `PID ${requestedPid} is not listening on port ${port} (listeners: ${candidates.map(describeListener).join(', ')}). Nothing was terminated.`);
  } else if (candidates.length === 1) {
    target = candidates[0];
  } else if (!interactive) {
    return done('refused', `Port ${port} is used by ${candidates.length} processes (${candidates.map(describeListener).join(', ')}). Re-run with --pid <pid> to choose one.`);
  } else {
    target = await choose(candidates);
    if (!target) return done('cancelled', 'No process selected; nothing was terminated');
  }

  const label = describeListener(target);
  const unsafe = killSafetyReason(target, safety);
  if (unsafe) return done('refused', `Refusing to terminate ${label}: ${unsafe}`);

  log(formatProcessDetails(port, target).join('\n'));
  if (interactive && !yes) {
    if (!(await confirm(`Stop ${label} listening on port ${port}?`))) return done('cancelled', 'Cancelled; nothing was terminated');
  } else if (!interactive && !yes) {
    return done('refused', `Not running interactively. Re-run with --yes to stop ${label}.`);
  }

  // The process may have exited, or the port changed hands, while we were asking.
  const before = await inspectPort(port, deps);
  if (!before.listeners.some((l) => l.pid === target.pid)) {
    if (before.state === 'free') return done('free', `${label} exited before it was stopped; port ${port} is now free (verified)`);
    return done('refused', `${label} is no longer listening on port ${port}; the port is now held by ${before.listeners.map(describeListener).join(', ') || 'an unidentified process'}. Nothing was terminated.`);
  }

  const verify = async (action) => {
    const after = await inspectPort(port, deps);
    if (after.state === 'free') return done('released', `${action} ${label}; port ${port} was released (verified by a fresh check)`);
    const running = await adapter.isRunning(target.pid);
    const holdsPort = after.listeners.some((l) => l.pid === target.pid);
    if (!running || !holdsPort) {
      const others = after.listeners.filter((l) => l.pid !== target.pid).map(describeListener).join(', ') || 'an unidentified process';
      return done('failed', `${label} ${running ? 'is no longer listening' : 'exited'}, but port ${port} is still in use by ${others}. Nothing else was terminated.`);
    }
    return null; // still running and still holding the port
  };

  const graceful = await adapter.killProcess(target.pid, { force: false });
  if (!graceful.ok && graceful.reason === 'permission') {
    return done('failed', `Permission denied stopping ${label}. dev-doctor does not use sudo; stop it yourself if appropriate.`);
  }
  if (!graceful.ok && graceful.reason !== 'not-found') return done('failed', `Could not stop ${label}: ${graceful.message ?? graceful.reason}`);

  await waitAfterSignal(port, target.pid, deps, waitMs);
  const afterGraceful = await verify(graceful.ok ? 'Stopped' : 'Process had already exited:');
  if (afterGraceful) return afterGraceful;

  // Same PID is still running and still holds the port: force only as an explicit, separate action.
  let allowForce = force;
  if (!allowForce && interactive) allowForce = await confirm(`${label} is still running after a graceful stop request. Force terminate it?`);
  if (!allowForce) {
    return done('failed', `${label} is still running after a graceful stop request; port ${port} is still in use. Re-run with --force to force terminate it.`);
  }

  const forced = await adapter.killProcess(target.pid, { force: true });
  if (!forced.ok && forced.reason === 'permission') return done('failed', `Permission denied force terminating ${label}.`);
  if (!forced.ok && forced.reason !== 'not-found') return done('failed', `Could not force terminate ${label}: ${forced.message ?? forced.reason}`);
  await waitAfterSignal(port, target.pid, deps, waitMs);
  return (await verify('Force terminated')) ?? done('failed', `${label} is still running after force termination; port ${port} is still in use.`);
}
