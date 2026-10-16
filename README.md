# Dev Doctor

[![npm](https://img.shields.io/npm/v/dev-env-doctor.svg)](https://www.npmjs.com/package/dev-env-doctor)
[![CI](https://github.com/Sameera-MHK/dev-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/Sameera-MHK/dev-doctor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js >= 22.12](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)

Diagnose — and safely fix — the problems that stop a JavaScript or Node.js project from starting: busy ports, the wrong Node.js version, missing dependencies, `.env` files out of sync with `.env.example`, and local services that are not running.

- **Offline.** No API key, no telemetry, nothing is uploaded.
- **Read-only by default.** Changes only happen through `fix` or `ports --kill`, with a preview and confirmation.
- **No secrets in output.** `.env` files are compared by key name only; command lines are redacted.
- **Cross-platform.** macOS, Linux and Windows.

```bash
npx dev-env-doctor
```

## Contents

- [Installation](#installation)
- [Example](#example)
- [Commands](#commands)
- [Configuration](#configuration)
- [Exit codes](#exit-codes)
- [Security](#security)
- [Supported operating systems](#supported-operating-systems)
- [Limitations](#limitations)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Installation

Requires Node.js 22.12 or newer.

Run it once in any project, without installing:

```bash
npx dev-env-doctor
```

Or install it, then use the `dev-doctor` command:

```bash
npm install -g dev-env-doctor
dev-doctor
```

As a project dev dependency (for scripts and CI):

```bash
npm install -D dev-env-doctor
npx dev-doctor --ci
```

From source:

```bash
git clone https://github.com/Sameera-MHK/dev-doctor.git
cd dev-doctor
npm install
npm link
```

## Example

```
Dev Doctor
Project: my-react-app (Vite)

Project
  PASS  package.json is valid (Vite project)

Node.js
  INFO  Node.js 22.12.0
  INFO  npm 11.6.0
  PASS  Node.js 22.12.0 satisfies engines.node (>=20)

Packages
  WARN  Multiple lockfiles detected
  PASS  npm 11.6.0 is available
  PASS  All 24 declared dependencies are installed

Environment variables
  INFO  Template: .env.example (6 keys)
  FAIL  DATABASE_URL is missing
        Documented in .env.example
        Referenced in src/db.ts
  WARN  API_BASE_URL is not documented in .env.example

Ports
  FAIL  Port 5173 is occupied by node (PID 8421)

Services
  PASS  Docker daemon is running (27.3.1)
  WARN  PostgreSQL is not reachable at localhost:5432

Summary
  2 errors, 3 warnings, 5 passed

Recommended next steps:
  1. Agree on one package manager (likely npm) and remove the other lockfiles yourself.
  2. Set DATABASE_URL in your local .env file.
  3. Add API_BASE_URL (without its value) to .env.example.
  4. Inspect the process using port 5173, or stop it with "dev-doctor ports --kill 5173".
  5. Verify PostgreSQL is running if this project needs it (e.g. "docker compose up -d").
```

## Commands

| Command | What it does |
| --- | --- |
| `dev-doctor` / `dev-doctor doctor` | Full diagnosis of the current project |
| `dev-doctor node` | Node.js version vs `engines.node`, `.nvmrc`, `.node-version` |
| `dev-doctor packages` | package.json, lockfiles, package manager, installed dependencies |
| `dev-doctor env` | `.env*` files vs `.env.example` and code references (keys only) |
| `dev-doctor ports [ports...]` | Which processes listen on ports |
| `dev-doctor ports --kill <port>` | Stop the process on a port, safely |
| `dev-doctor services` | Docker, PostgreSQL, MongoDB, Redis availability |
| `dev-doctor fix` | Preview and apply safe fixes |

Common options (all diagnostic commands):

| Option | Description |
| --- | --- |
| `--cwd <path>` | Project directory (default: current directory) |
| `--json` | JSON on stdout only; errors go to stderr |
| `-v, --verbose` | Show details for every finding (process command lines, sources) |
| `--ci` | No prompts, no colors |
| `--fail-on <fail\|warn>` | Exit 1 on failures only (default) or on warnings too |
| `--no-color` | Disable colors (also disabled when piped or `NO_COLOR` is set) |

### doctor

Checks the project (package.json and project type), Node.js and npm versions, the package manager and lockfiles, dependency installation, environment variables, ports and local services.

Ports: if the project declares ports (`.dev-doctor.json`, `PORT` in `.env`, `--port`/`-p` in scripts, or framework defaults such as 5173 for Vite, 3000 for Next.js, 4200 for Angular), a busy port is a **FAIL**. Otherwise common development ports (3000, 3001, 4200, 5000, 5173, 8000, 8080) are checked and a busy one is only a **WARN**.

### env

- Reads `.env`, `.env.local`, `.env.development`, `.env.development.local` and the first template found from `.env.example`, `.env.sample`, `.env.template`, `.env.dist`.
- Compares **key names only**. Values are never printed or stored.
- Finds `process.env.KEY`, `process.env['KEY']` and `import.meta.env.KEY` in `.js/.jsx/.ts/.tsx/.mjs/.cjs/.vue/.svelte/.astro` files, skipping `node_modules`, `.git`, build output (`dist`, `build`, `.next`, ...) and plain names from `.gitignore`.
- A template key that is not set is a **FAIL** only when the code references it; otherwise it is a **WARN** ("may be optional"). Keys set in the shell environment count as set.
- Keys in `.env` missing from the template, keys referenced in code but defined nowhere, and `.env` not in `.gitignore` are **WARN**s, each labelled with its source.
- Lines that cannot be parsed are reported by line number, not guessed.

### ports

```bash
dev-doctor ports                # common development ports (or "ports" in .dev-doctor.json)
dev-doctor ports 3000           # focused view of one port
dev-doctor ports 3000 5173      # specific ports; busy ones are FAIL (exit 1)
dev-doctor ports --json
dev-doctor ports --kill 3000                # stop the process on 3000, asks for confirmation
dev-doctor ports --kill 3000 --pid 8421     # pick the exact process when several share the port
dev-doctor ports --kill 3000 --yes          # non-interactive
dev-doctor ports --kill 3000 --yes --force  # allow force termination if it survives a graceful stop
```

#### Process inspection

For every occupied port Dev Doctor collects what the OS allows:

| Field | macOS | Linux | Windows |
| --- | --- | --- | --- |
| PID, process name | `lsof` | `ss` (or `lsof`) | `netstat`, `tasklist` |
| Command line | `ps` | `ps` | PowerShell `Win32_Process` |
| Parent PID | `ps` | `ps` | PowerShell `Win32_Process` |
| User | `ps` | `ps` | not collected |
| Working directory | `lsof -d cwd` (own processes only) | `/proc/<pid>/cwd` | not available |
| Project association | from working directory, else command line | same | command line only |

Project association is **current project**, **another project or location**, or **unknown**. Anything the OS does not expose, or that permissions hide, is shown as `unavailable (reason)`; it is never guessed. If a port is busy but its owner cannot be seen at all, the report says so instead of calling the port free. IPv4 and IPv6 listeners of the same process are merged.

Command lines are redacted before they reach any output (human or JSON): URL credentials, `--password=…`/`--token …`-style flags, `SECRET_KEY=…`-style assignments and `Bearer`/`Basic` tokens become `***`. Environment variables of other processes are never read.

#### Interactive workflow

In an interactive terminal, after the report you can pick a process (when several ports are occupied) and choose **Inspect process**, **Stop process** or **Skip**. Stopping uses the same safe flow as `--kill`. When stdin is not a terminal, in `--ci` mode or with `--json`, no prompt is ever shown.

#### Safe termination (`--kill`)

1. Validates the port (1–65535) and `--pid` (positive integer). PIDs are passed as arguments, never through a shell.
2. Lists every listener on the port. The target must be unambiguous: a single listener, `--pid`, or an interactive choice. If any listener cannot be identified (for example another user's process), it refuses.
3. Refuses to stop dev-doctor itself, the shell that started it, PIDs 0–4 and known system processes. It only ever targets that one PID; it never kills "all Node.js processes".
4. Shows PID, name, command line and working directory, then asks for confirmation (declining cancels; non-interactive runs need `--yes`).
5. Checks again that the same PID still holds the port, in case it exited or the port changed hands meanwhile.
6. Sends a graceful stop (SIGTERM / `taskkill`).
7. If the same process is still running and still holds the port, force termination (SIGKILL / `taskkill /F`) is offered as a separate step: a second confirmation, or `--force`.
8. Re-scans the port. "Released" is only reported when that fresh check finds it free. If the process exited but something else now holds the port, it says so and touches nothing else.

Permission errors are reported as-is; Dev Doctor never uses `sudo` or requests elevation.

`--kill` exit codes: 0 when the port is free afterwards (or already was), 1 when it was refused, cancelled or the port is still in use, 2 for invalid input.

### services

Docker CLI and daemon, plus TCP reachability of PostgreSQL, MongoDB and Redis. Services are only checked when the project appears to need them: Compose files and images, dependencies (`pg`, `mongoose`, `ioredis`, ...), or connection variables (`DATABASE_URL`, `MONGODB_URI`, `REDIS_URL`, `PGHOST`, ...). Host and port are taken from those values; credentials are never shown. A successful TCP connection does **not** mean authentication or queries work, and the report says so.

Nothing is started, stopped or reconfigured.

### fix

```bash
dev-doctor fix --dry-run   # list fixes, change nothing
dev-doctor fix             # confirm each fix
dev-doctor fix --yes       # apply without prompts (required when non-interactive)
```

Each fix shows the problem, why it matters, the proposed change, whether it modifies files or terminates a process, the expected outcome and a preview. After applying, the relevant check is re-run and the result is reported.

Available fixes:

| Fix | Change |
| --- | --- |
| `.env` missing | Creates `.env` with the key names from the template and **empty values** (never copies template values, never overwrites) |
| `.env` not ignored | Appends `.env` to `.gitignore` |
| Project port busy | Stops the process on that port (same safety rules as `ports --kill`) |

Everything else gets manual instructions. Dev Doctor never installs or upgrades packages, deletes lockfiles, changes Node.js versions, runs migrations or uses `sudo`.

## Configuration

Optional `.dev-doctor.json` in the project root:

```json
{
  "ports": [3000, 5173],
  "failOn": "fail",
  "services": {
    "docker": true,
    "postgres": { "host": "localhost", "port": 5433 },
    "redis": false
  }
}
```

- `ports`: ports the project uses (checked by `doctor` and `ports`).
- `failOn`: `"fail"` (default) or `"warn"`; `--fail-on` overrides it.
- `services`: `true`/object to require or point a check somewhere, `false` to skip it.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No failures (or the requested action succeeded) |
| 1 | Diagnostics found failures, or a requested action was refused or did not succeed |
| 2 | Dev Doctor could not run (invalid arguments, bad config, unexpected error) |

In CI:

```bash
dev-doctor --ci              # exit 1 on FAIL
dev-doctor --ci --fail-on warn
dev-doctor --ci --json > dev-doctor.json
```

## Security

See [SECURITY.md](SECURITY.md). In short: offline, read-only by default, never prints secrets, never executes project scripts, no shell string interpolation, no `sudo`, and writes only inside the project directory.

## Supported operating systems

| OS | Process inspection |
| --- | --- |
| macOS | `lsof`, `ps` |
| Linux | `ss` (falls back to `lsof`), `ps`, `/proc` |
| Windows | `netstat`, `tasklist`, PowerShell, `taskkill` |

When these tools are missing, Dev Doctor falls back to a bind test: it can still tell whether a port is busy, but not which process owns it.

The test suite has been run locally on macOS. Linux and Windows support is covered by unit tests with mocked tool output and by the GitHub Actions matrix (ubuntu, macos, windows × Node 22, 24); treat them as verified only once that CI is green.

## Limitations

- Environment references are found with patterns; dynamic access (`process.env[name]`) and destructuring (`const { A } = process.env`) are not detected.
- `.gitignore` support is basic: plain names are skipped during the scan; glob patterns are not evaluated.
- Service checks are TCP-only and use default ports unless configured; ports remapped in Compose files are not parsed.
- On macOS, `lsof` only shows your own processes without elevated permissions; other users' processes appear as "process details not accessible", and their working directory as unavailable.
- Working directories are not available on Windows, so project association there relies on the command line.
- On Windows, console programs such as `node.exe` cannot be stopped gracefully (`taskkill` without `/F` is refused), so stopping them always needs the separate force step (`--force` or a second confirmation).
- Command-line redaction is pattern-based; unusual secret formats may not be recognized.
- `.nvmrc` aliases such as `lts/*` cannot be verified offline.

## Development

```bash
npm install
npm test
node bin/dev-doctor.js --help
npm link            # makes "dev-doctor" available globally from this checkout
npm pack --dry-run  # see what would be published
```

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Please report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © sameera_mhk
# dev-doctor
