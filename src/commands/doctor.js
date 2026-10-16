import { runDiagnostics } from '../core/runner.js';
import { formatHuman, toJson, colorEnabled } from '../core/reporter.js';
import { hasFailures } from '../core/diagnostics.js';
import { EXIT } from '../core/exit-codes.js';
import { resolveProjectRoot } from '../utils/paths.js';

/** Shared handler for doctor, node, packages, env and services. Returns an exit code. */
export async function diagnoseCommand(categories, opts, { version }) {
  const root = resolveProjectRoot(opts.cwd);
  const report = await runDiagnostics(root, { categories, verbose: opts.verbose });
  if (opts.json) {
    process.stdout.write(toJson(report, { version }));
  } else {
    process.stdout.write(formatHuman(report, { verbose: opts.verbose, color: colorEnabled({ color: opts.color && !opts.ci }) }));
  }
  const failOn = opts.failOn ?? report.config.failOn ?? 'fail';
  return hasFailures(report.results, failOn) ? EXIT.DIAGNOSTIC_FAILURE : EXIT.OK;
}
