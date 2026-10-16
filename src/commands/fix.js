import { runDiagnostics } from '../core/runner.js';
import { EXIT } from '../core/exit-codes.js';
import { STATUS } from '../core/diagnostics.js';
import { collectFixes } from '../fixes/index.js';
import { describeListener } from '../checks/ports.js';
import { getPlatformAdapter } from '../platform/index.js';
import { resolveProjectRoot } from '../utils/paths.js';
import { isInteractive, askConfirm, askSelect } from '../utils/prompt.js';

export function formatFix(fix, index) {
  const lines = [
    `${index + 1}. ${fix.problem}`,
    `   Why it matters:  ${fix.why}`,
    `   Proposed change: ${fix.change}`,
    `   Modifies files:  ${fix.modifiesFiles ? 'yes' : 'no'}`,
    `   Terminates a process: ${fix.terminatesProcess ? 'yes' : 'no'}`,
    `   Expected outcome: ${fix.expected}`,
  ];
  if (fix.preview) {
    lines.push('   Preview:');
    for (const line of fix.preview.trimEnd().split('\n')) lines.push(`     ${line}`);
  }
  return lines.join('\n');
}

export async function fixCommand(opts, { out = process.stdout } = {}) {
  const root = resolveProjectRoot(opts.cwd);
  const adapter = getPlatformAdapter();
  const { results } = await runDiagnostics(root, { adapter });
  const fixes = collectFixes(results, root);
  const write = (text = '') => out.write(`${text}\n`);

  write('Dev Doctor fix');
  if (fixes.length === 0) {
    write('No automatic fixes available.');
    const manual = [...new Set(results.filter((r) => r.hint && r.status === STATUS.FAIL).map((r) => r.hint))];
    if (manual.length > 0) {
      write('', 'Manual steps:');
      manual.forEach((m, i) => write(`  ${i + 1}. ${m}`));
    }
    return EXIT.OK;
  }

  write('');
  fixes.forEach((fix, i) => write(formatFix(fix, i) + '\n'));
  if (opts.dryRun) {
    write('Dry run: no changes were made.');
    return EXIT.OK;
  }

  const interactive = isInteractive({ ci: opts.ci });
  if (!interactive && !opts.yes) {
    write('Not running interactively; no changes were made. Re-run with --yes to apply these fixes.');
    return EXIT.DIAGNOSTIC_FAILURE;
  }

  const ctx = {
    adapter,
    interactive,
    // Interactive: terminatePortProcess asks its own confirmation. Non-interactive: --yes was given.
    yes: !interactive,
    confirm: askConfirm,
    choose: (targets) => askSelect('Which process should be terminated?', targets.map((t) => ({ name: describeListener(t), value: t }))),
  };

  let failed = 0;
  for (const fix of fixes) {
    if (interactive && !fix.terminatesProcess && !(await askConfirm(`Apply: ${fix.change}?`))) {
      write(`Skipped: ${fix.problem}`);
      continue;
    }
    const applied = await fix.apply(ctx);
    if (!applied.ok) {
      failed++;
      write(`FAIL  ${applied.message}`);
      continue;
    }
    const verified = await fix.verify(ctx);
    if (!verified.ok) failed++;
    write(`${verified.ok ? 'PASS' : 'FAIL'}  ${applied.message}; ${verified.message}`);
  }
  return failed > 0 ? EXIT.DIAGNOSTIC_FAILURE : EXIT.OK;
}
