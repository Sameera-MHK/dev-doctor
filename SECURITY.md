# Security Policy

## Guarantees

Dev Doctor is designed to be safe to run in any project:

- **Offline.** It makes no network requests except TCP connection checks to the local services it reports on. No telemetry, no uploads.
- **Read-only by default.** `dev-doctor`, `doctor`, `node`, `packages`, `env`, `services` and `ports` (without `--kill`) never modify files or processes.
- **No secret output.** Environment files are compared by key name only. Values are never printed, logged, stored or included in JSON. URL credentials are masked as a final safeguard.
- **No project code execution.** Scripts in package.json, Compose files and config files are read as data and never executed.
- **No shell injection.** Subprocesses are started with argument arrays. On Windows, package-manager version checks use a shell with fixed arguments only. Ports are validated as integers from 1 to 65535.
- **No privilege escalation.** It never uses `sudo` or requests administrator access.
- **Safe termination.** Only one unambiguous PID on an explicitly selected port is targeted, after confirmation (or `--yes` when non-interactive); if any listener cannot be identified it refuses. It refuses to terminate itself, its parent shell, PIDs 0-4 and known system processes. The target is re-checked right before signalling, a graceful stop is always attempted first, and force is a separate step (second confirmation or `--force`) only while the same PID still holds the port. Release is only reported after a fresh check.
- **Process details.** Command lines are redacted (URL credentials, password/token/secret/key flags and assignments, Bearer tokens) before display or JSON output. Other processes' environment variables are never read. On Windows the PID is passed to PowerShell through an environment variable and cast to an integer, never interpolated into the script.
- **Writes stay inside the project.** `fix` refuses paths outside the project directory and never overwrites `.env`.

## Permissions

Listing processes owned by other users may require elevated permissions (for example `lsof` on macOS only shows your own processes). Dev Doctor reports "process details not accessible" in that case rather than asking for more privileges.

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Report them privately through GitHub Security Advisories on the project repository (Security tab → "Report a vulnerability"), or contact the maintainers listed in package.json. We aim to respond within 7 days.

## Supported versions

Only the latest released version receives security fixes.
