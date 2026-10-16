import { createRequire } from 'node:module';
import { Command, Option, CommanderError } from 'commander';
import { diagnoseCommand } from './commands/doctor.js';
import { portsCommand } from './commands/ports.js';
import { fixCommand } from './commands/fix.js';
import { EXIT } from './core/exit-codes.js';
import { DevDoctorError } from './utils/errors.js';

const { version } = createRequire(import.meta.url)('../package.json');

function addCommonOptions(command) {
  return command
    .option('--cwd <path>', 'project directory to inspect', process.cwd())
    .option('--json', 'print machine-readable JSON to stdout')
    .option('-v, --verbose', 'show more details')
    .option('--ci', 'CI mode: no prompts, no colors, non-zero exit on failures')
    .addOption(new Option('--fail-on <level>', 'exit non-zero on this level or worse').choices(['fail', 'warn']))
    .option('--no-color', 'disable colored output');
}

export function buildProgram(setExit) {
  const program = new Command();
  program
    .name('dev-doctor')
    .description('Diagnose and safely fix common local development environment problems.')
    .version(version, '-V, --version')
    .exitOverride()
    .addHelpText('after', '\nExit codes:\n  0  no failures\n  1  diagnostics found failures (or a requested action did not succeed)\n  2  dev-doctor could not run (invalid input or unexpected error)');

  const diagnose = (categories) => async (opts) => setExit(await diagnoseCommand(categories, opts, { version }));

  addCommonOptions(program.command('doctor', { isDefault: true }).description('run the full diagnostic suite (default)'))
    .action(diagnose(['project', 'node', 'packages', 'env', 'ports', 'services']));
  addCommonOptions(program.command('node').description('check the Node.js version against project requirements'))
    .action(diagnose(['node']));
  addCommonOptions(program.command('packages').description('check package.json, lockfiles and installed dependencies'))
    .action(diagnose(['project', 'packages']));
  addCommonOptions(program.command('env').description('compare .env files with .env.example and code references (keys only)'))
    .action(diagnose(['env']));
  addCommonOptions(program.command('services').description('check Docker and PostgreSQL/MongoDB/Redis TCP availability'))
    .action(diagnose(['services']));

  addCommonOptions(program.command('ports').description('show which processes are listening on ports'))
    .argument('[ports...]', 'ports to check (default: common development ports)')
    .option('--kill <port>', 'stop the process listening on <port> (asks for confirmation)')
    .option('--pid <pid>', 'with --kill: the exact process to stop when several listen on the port')
    .option('-y, --yes', 'confirm stopping without a prompt (required when non-interactive)')
    .option('--force', 'with --kill: force terminate if the same process is still running after a graceful stop')
    .action(async (ports, opts) => setExit(await portsCommand(ports, opts, { version })));

  program.command('fix')
    .description('diagnose, then preview and apply safe fixes with confirmation')
    .option('--cwd <path>', 'project directory to inspect', process.cwd())
    .option('--dry-run', 'only show the available fixes')
    .option('-y, --yes', 'apply fixes without prompts (required when non-interactive)')
    .option('--ci', 'CI mode: never prompt')
    .action(async (opts) => setExit(await fixCommand(opts)));

  return program;
}

export async function main(argv) {
  const setExit = (code) => {
    process.exitCode = code;
  };
  try {
    await buildProgram(setExit).parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help and version exit with 0; usage errors (already printed by commander) with 2.
      process.exitCode = error.exitCode === 0 ? EXIT.OK : EXIT.ERROR;
      return;
    }
    if (error instanceof DevDoctorError) {
      process.stderr.write(`dev-doctor: ${error.message}\n`);
    } else {
      process.stderr.write(`dev-doctor: unexpected error: ${error?.message ?? error}\n`);
    }
    process.exitCode = EXIT.ERROR;
  }
}
