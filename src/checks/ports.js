import net from 'node:net';
import path from 'node:path';
import { result, STATUS } from '../core/diagnostics.js';
import { DevDoctorError } from '../utils/errors.js';
import { parseEnv } from '../utils/env-parser.js';
import { readTextIfExists } from '../utils/paths.js';
import { redactCommandLine } from '../utils/redact.js';
import { allDependencies } from './project.js';

const CATEGORY = 'Ports';

export const DEFAULT_PORTS = [3000, 3001, 4200, 5000, 5173, 8000, 8080];

const FRAMEWORK_PORTS = [
  ['next', 3000], ['react-scripts', 3000], ['nuxt', 3000], ['vite', 5173], ['@angular/core', 4200], ['astro', 4321],
];

export function parsePort(value) {
  const text = String(value).trim();
  const port = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DevDoctorError(`Invalid port "${value}": expected an integer between 1 and 65535`);
  }
  return port;
}

/** Ports this project is likely to use: config, PORT in .env, script flags, framework defaults. */
export function detectProjectPorts(project, config = {}) {
  const ports = new Set();
  for (const p of config.ports ?? []) ports.add(parsePort(p));

  const envText = readTextIfExists(path.join(project.root, '.env'));
  const envPort = envText ? parseEnv(envText).entries.get('PORT')?.value : undefined;
  if (envPort && /^\d+$/.test(envPort) && Number(envPort) <= 65535 && Number(envPort) > 0) ports.add(Number(envPort));

  const pkg = project.packageJson;
  for (const script of Object.values(pkg?.scripts ?? {})) {
    if (typeof script !== 'string') continue;
    for (const match of script.matchAll(/(?:--port[= ]|\s-p\s+)(\d{2,5})\b/g)) {
      const port = Number(match[1]);
      if (port > 0 && port <= 65535) ports.add(port);
    }
  }
  const deps = allDependencies(pkg);
  for (const [dep, port] of FRAMEWORK_PORTS) {
    if (deps[dep]) {
      ports.add(port);
      break;
    }
  }
  return [...ports].sort((a, b) => a - b);
}

function listenOnce(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => resolve(error.code));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve('free')));
  });
}

/** Try to bind the port. Returns 'free', 'in-use' or 'denied'. */
export async function bindTest(port) {
  for (const host of ['127.0.0.1', '::']) {
    const outcome = await listenOnce(port, host);
    if (outcome === 'EADDRINUSE') return 'in-use';
    if (outcome === 'EACCES') return 'denied';
    // EADDRNOTAVAIL / EAFNOSUPPORT: that address family is unavailable; try the next one.
  }
  return 'free';
}

/** Merge IPv4/IPv6 entries of the same process. */
export function dedupeListeners(listeners) {
  const byKey = new Map();
  for (const l of listeners) {
    const key = l.pid ?? 'unknown';
    const existing = byKey.get(key);
    if (existing) {
      existing.addresses = [...new Set([...existing.addresses, ...l.addresses])];
      existing.name ??= l.name;
    } else {
      byKey.set(key, { ...l, addresses: [...new Set(l.addresses)] });
    }
  }
  return [...byKey.values()];
}

function isInside(dir, root) {
  const rel = path.relative(root, dir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 'current' when the process runs in (or from) the project, 'other' when it clearly does not, else 'unknown'. */
export function projectAssociation(details, projectRoot) {
  if (!projectRoot) return 'unknown';
  if (details.cwd) return isInside(details.cwd, projectRoot) ? 'current' : 'other';
  if (details.command && details.command.includes(projectRoot)) return 'current';
  return 'unknown';
}

/** Inspect one port: { port, state: 'free'|'in-use'|'denied', listeners, error? } */
export async function inspectPort(port, { adapter, bind = bindTest, describe = false, projectRoot = null } = {}) {
  let listeners = [];
  let error = null;
  try {
    listeners = dedupeListeners(await adapter.findListeners(port));
  } catch (e) {
    error = e.message;
  }
  if (describe) {
    for (const l of listeners) {
      if (!l.pid) continue;
      const details = await adapter.describeProcess(l.pid);
      // Command lines are redacted here so secrets never reach any reporter or JSON.
      Object.assign(l, details, { name: l.name ?? details.name ?? null, command: redactCommandLine(details.command ?? null) });
      l.project = projectAssociation(l, projectRoot);
    }
  }
  if (listeners.length > 0) return { port, state: 'in-use', listeners, error };
  const state = await bind(port);
  return { port, state, listeners: [], error };
}

export function describeListener(l) {
  if (!l.pid) return 'an inaccessible process';
  return `${l.name ?? 'unknown process'} (PID ${l.pid})`;
}

const ASSOCIATION = { current: 'current project', other: 'another project or location', unknown: 'unknown' };

function field(l, name, value) {
  if (value !== null && value !== undefined) return String(value);
  return `unavailable${l.unavailable?.[name] ? ` (${l.unavailable[name]})` : ''}`;
}

/** Focused, multi-line description of one listener; missing data is labelled, never invented. */
export function formatProcessDetails(port, l) {
  if (!l.pid) return [`Port ${port}: owning process is not accessible (PID unavailable)`];
  const lines = [
    `Port:              ${port}`,
    `PID:               ${l.pid}`,
    `Name:              ${field(l, 'name', l.name)}`,
    `Command:           ${field(l, 'command', l.command)}`,
    `Parent PID:        ${field(l, 'ppid', l.ppid)}`,
    `Working directory: ${field(l, 'cwd', l.cwd)}`,
    `Project:           ${ASSOCIATION[l.project] ?? 'unknown'}`,
    `Listening on:      ${l.addresses.join(', ') || 'unavailable'}`,
  ];
  if (l.user) lines.splice(3, 0, `User:              ${l.user}`);
  if (l.exists === false) lines.push('Note:              the process exited while it was being inspected');
  return lines;
}

export function portResults(inspections, { occupiedStatus = STATUS.FAIL } = {}) {
  return inspections.map((i) => {
    const details = [];
    if (i.error) details.push(i.error);
    for (const l of i.listeners) {
      details.push(`PID ${l.pid ?? '?'}  ${l.name ?? '?'}  ${l.addresses.join(', ')}${l.user ? `  user: ${l.user}` : ''}`);
      if (l.command) details.push(`  ${l.command}`);
      if (l.cwd) details.push(`  cwd: ${l.cwd}${l.project ? ` (${ASSOCIATION[l.project]})` : ''}`);
    }
    const data = { port: i.port, state: i.state, listeners: i.listeners };

    if (i.state === 'free') return result(CATEGORY, STATUS.PASS, `Port ${i.port} is available`, { details, data });
    if (i.state === 'denied') {
      return result(CATEGORY, STATUS.INFO, `Port ${i.port} needs elevated privileges to test`, { details, data });
    }
    const known = i.listeners.filter((l) => l.pid);
    if (known.length === 0) {
      return result(CATEGORY, occupiedStatus, `Port ${i.port} is in use (process details not accessible)`, {
        details,
        data,
        hint: `Port ${i.port} is held by a process you cannot inspect; it may belong to another user or need elevated permissions.`,
      });
    }
    return result(CATEGORY, occupiedStatus, `Port ${i.port} is occupied by ${known.map(describeListener).join(', ')}`, {
      details,
      data,
      hint: `Inspect the process using port ${i.port}, or stop it with "dev-doctor ports --kill ${i.port}".`,
      // Only offer termination for ports the project needs, not for generic common ports.
      ...(occupiedStatus === STATUS.FAIL ? { fixId: 'kill-port', fixData: { port: i.port } } : {}),
    });
  });
}

export async function inspectPorts(ports, options = {}) {
  const inspections = [];
  for (const port of ports) inspections.push(await inspectPort(port, options));
  return inspections;
}

export async function checkPorts(ports, { occupiedStatus, ...options } = {}) {
  return portResults(await inspectPorts(ports, options), { occupiedStatus });
}
