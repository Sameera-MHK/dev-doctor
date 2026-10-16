import { describeListener, formatProcessDetails } from '../checks/ports.js';

/**
 * Interactive follow-up after a ports report: pick a process (when several), then Inspect / Stop / Skip.
 * Only call this from an interactive terminal. `terminate(port, pid)` runs the safe termination flow.
 * Returns the termination outcome, or null when nothing was stopped.
 */
export async function portsWorkflow(inspections, { select, log, terminate }) {
  const candidates = inspections.flatMap((i) => i.listeners.filter((l) => l.pid).map((listener) => ({ port: i.port, listener })));
  if (candidates.length === 0) return null;

  let chosen = candidates[0];
  if (candidates.length > 1) {
    chosen = await select('Several ports are occupied. Which process do you want to work with?', [
      ...candidates.map((c) => ({ name: `Port ${c.port}: ${describeListener(c.listener)}`, value: c })),
      { name: 'Skip', value: null },
    ]);
    if (!chosen) return null;
  }

  const { port, listener } = chosen;
  for (;;) {
    const action = await select(`Port ${port} is used by ${describeListener(listener)}. What do you want to do?`, [
      { name: 'Inspect process', value: 'inspect' },
      { name: 'Stop process', value: 'stop' },
      { name: 'Skip', value: 'skip' },
    ]);
    if (action === 'inspect') {
      log(formatProcessDetails(port, listener).join('\n'));
      continue;
    }
    if (action === 'stop') {
      const outcome = await terminate(port, listener.pid);
      log(outcome.message);
      return outcome;
    }
    return null;
  }
}
