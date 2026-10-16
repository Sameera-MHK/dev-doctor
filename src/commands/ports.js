import { inspectPorts, portResults, parsePort, DEFAULT_PORTS, describeListener, formatProcessDetails } from '../checks/ports.js';
import { STATUS, hasFailures } from '../core/diagnostics.js';
import { formatHuman, toJson, colorEnabled } from '../core/reporter.js';
import { terminatePortProcess, parsePid } from '../core/terminate.js';
import { portsWorkflow } from '../core/port-workflow.js';
import { EXIT } from '../core/exit-codes.js';
import { getPlatformAdapter } from '../platform/index.js';
import { loadConfig } from '../utils/config.js';
import { resolveProjectRoot } from '../utils/paths.js';
import { isInteractive, askConfirm, askSelect } from '../utils/prompt.js';

const isSuccess = (outcome) => outcome.status === 'released' || outcome.status === 'free';

export async function portsCommand(portArgs, opts, { version }) {
  const root = resolveProjectRoot(opts.cwd);
  const adapter = getPlatformAdapter();
  // Never prompt when stdin/stderr are not terminals, in CI, or when JSON is requested.
  const interactive = isInteractive({ ci: opts.ci }) && !opts.json;
  // Human-readable progress goes to stderr when stdout carries JSON.
  const log = (text) => (opts.json ? process.stderr : process.stdout).write(`${text}\n`);

  const terminate = (port, pid) => terminatePortProcess(port, {
    adapter,
    pid,
    projectRoot: root,
    interactive,
    yes: opts.yes,
    force: opts.force,
    confirm: askConfirm,
    log,
    choose: (targets) => askSelect(`Port ${port} has several listeners. Which process should be stopped?`, [
      ...targets.map((t) => ({ name: describeListener(t), value: t })),
      { name: 'Cancel', value: null },
    ]),
  });

  if (opts.kill !== undefined) {
    const port = parsePort(opts.kill);
    const pid = opts.pid === undefined ? undefined : parsePid(opts.pid);
    const outcome = await terminate(port, pid);
    if (opts.json) process.stdout.write(JSON.stringify(outcome, null, 2) + '\n');
    else log(outcome.message);
    return isSuccess(outcome) ? EXIT.OK : EXIT.DIAGNOSTIC_FAILURE;
  }

  const explicit = portArgs.map(parsePort);
  const config = loadConfig(root);
  const ports = [...new Set(explicit.length > 0 ? explicit : (config.ports ?? DEFAULT_PORTS).map(parsePort))];
  const inspections = await inspectPorts(ports, { adapter, describe: true, projectRoot: root });
  const results = portResults(inspections, { occupiedStatus: explicit.length > 0 ? STATUS.FAIL : STATUS.WARN });
  const report = { project: null, results };

  if (opts.json) {
    process.stdout.write(toJson(report, { version }));
    return hasFailures(results) ? EXIT.DIAGNOSTIC_FAILURE : EXIT.OK;
  }

  process.stdout.write(formatHuman(report, { verbose: opts.verbose, color: colorEnabled({ color: opts.color && !opts.ci }) }));
  // A single requested port gets a focused view of every listener.
  if (ports.length === 1 && inspections[0].listeners.length > 0) {
    for (const l of inspections[0].listeners) log(`\n${formatProcessDetails(ports[0], l).join('\n')}`);
  }

  if (interactive) {
    log('');
    await portsWorkflow(inspections, { select: askSelect, log, terminate });
  }
  // The exit code reflects the report above.
  return hasFailures(results) ? EXIT.DIAGNOSTIC_FAILURE : EXIT.OK;
}
