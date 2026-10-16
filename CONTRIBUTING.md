# Contributing to Dev Doctor

Thanks for helping! Bug reports, fixes and new checks are welcome.

## Setup

```bash
git clone https://github.com/Sameera-MHK/dev-doctor.git
cd dev-doctor
npm install
npm test
node bin/dev-doctor.js --help
```

Requires Node.js 22.12 or newer.

## Project layout

```
bin/dev-doctor.js      executable entry
src/cli.js             commands and options (Commander)
src/commands/          command handlers
src/checks/            diagnostics; return structured results, never print
src/core/              runner, reporter, termination, exit codes
src/platform/          macOS / Linux / Windows process adapters
src/fixes/             repair actions (separate from diagnostics)
src/utils/             parsing, paths, subprocess and prompt helpers
tests/unit, tests/integration
```

## Guidelines

- Keep the default scan read-only. Anything that changes files or processes belongs in `src/fixes/` or behind an explicit flag, with a preview and confirmation.
- Never print or store environment variable values.
- Run subprocesses with `runCommand(cmd, args)` (argument arrays, timeouts). Do not build shell strings from input.
- Checks return `result(category, status, title, { details, hint })`; presentation lives in `src/core/reporter.js`.
- Add tests with `node:test`. Do not kill real user processes in tests; use child processes you start, temp directories and mock adapters.
- Keep dependencies minimal.

## Pull requests

1. Create a branch and keep the change focused.
2. Run `npm test`.
3. Add a line to `CHANGELOG.md` under "Unreleased".
4. Describe what you changed and how you tested it, including the OS.

By contributing you agree that your contributions are licensed under the MIT License and that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
