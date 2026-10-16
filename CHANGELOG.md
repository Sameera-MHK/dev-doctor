# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added

- `ports`: process inspection now includes command line (redacted), parent PID, user, working directory and project association (current project / another location / unknown) on macOS, Linux and Windows, with unavailable fields labelled.
- `ports`: interactive Inspect / Stop / Skip workflow, with process selection when several ports are occupied, and a focused view for a single port.
- `ports --kill`: `--pid` for an unambiguous target, re-check before signalling, force only as a separate step while the same process still holds the port, and handling of processes that exit early or ports taken over by another process.

- `doctor` (default): full diagnostic report with PASS / WARN / FAIL / INFO statuses, `--verbose`, `--json`, `--ci`, `--fail-on` and `--cwd`.
- `node`: checks the running Node.js version against `engines.node`, `.nvmrc` and `.node-version`.
- `packages`: validates package.json, lockfiles, package manager availability and installed dependencies.
- `env`: compares `.env*` files with `.env.example` by key name and finds `process.env` / `import.meta.env` references in source code. Never prints values.
- `ports`: shows processes listening on ports (macOS, Linux, Windows adapters) and `--kill` with confirmation, graceful-first termination and release verification.
- `services`: Docker CLI/daemon checks and PostgreSQL, MongoDB and Redis TCP reachability.
- `fix`: previews and applies safe fixes (create `.env` from the template with empty values, add `.env` to `.gitignore`, stop a process blocking a project port) and re-verifies them.
- Optional `.dev-doctor.json` configuration.
