import net from 'node:net';
import path from 'node:path';
import { result, STATUS } from '../core/diagnostics.js';
import { parseEnv } from '../utils/env-parser.js';
import { exists, readTextIfExists } from '../utils/paths.js';
import { runCommand } from '../utils/process-info.js';
import { allDependencies } from './project.js';
import { LOCAL_FILES } from './environment.js';

const CATEGORY = 'Services';

export const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

export const SERVICES = {
  postgres: {
    label: 'PostgreSQL', port: 5432, schemes: ['postgres:', 'postgresql:'], images: /postgres|postgis/i,
    deps: ['pg', 'postgres', 'pg-promise'], urlKeys: ['DATABASE_URL', 'POSTGRES_URL', 'PG_URL'], hostKey: 'PGHOST', portKey: 'PGPORT',
  },
  mongodb: {
    label: 'MongoDB', port: 27017, schemes: ['mongodb:', 'mongodb+srv:'], images: /mongo/i,
    deps: ['mongodb', 'mongoose'], urlKeys: ['DATABASE_URL', 'MONGODB_URI', 'MONGODB_URL', 'MONGO_URL', 'MONGO_URI'], hostKey: 'MONGO_HOST', portKey: 'MONGO_PORT',
  },
  redis: {
    label: 'Redis', port: 6379, schemes: ['redis:', 'rediss:'], images: /redis|valkey/i,
    deps: ['redis', 'ioredis'], urlKeys: ['REDIS_URL'], hostKey: 'REDIS_HOST', portKey: 'REDIS_PORT',
  },
};

/** Merge local env files (later files win) and the process environment. Values are used only to find host/port. */
function loadEnvValues(root, env) {
  const values = new Map();
  for (const file of LOCAL_FILES) {
    const text = readTextIfExists(path.join(root, file));
    if (text === null) continue;
    for (const [key, { value }] of parseEnv(text).entries) values.set(key, value);
  }
  for (const [key, value] of Object.entries(env)) values.set(key, value);
  return values;
}

function endpointFromUrl(value, spec) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!spec.schemes.includes(url.protocol)) return null;
  if (url.protocol === 'mongodb+srv:') return { srv: true };
  // Multi-host strings like "mongodb://a:1,b:2" are reduced to the first host by URL parsing.
  return { host: url.hostname.replace(/^\[|\]$/g, '') || 'localhost', port: Number(url.port) || spec.port };
}

/** Work out which services the project appears to need and where they should be. */
export function discoverServices(project, config = {}, { env = process.env } = {}) {
  const { root } = project;
  const values = loadEnvValues(root, env);
  const deps = allDependencies(project.packageJson);
  const composeFile = COMPOSE_FILES.find((f) => exists(path.join(root, f))) ?? null;
  const composeText = composeFile ? readTextIfExists(path.join(root, composeFile)) ?? '' : '';
  const images = [...composeText.matchAll(/^\s*image:\s*["']?([^\s"'#]+)/gm)].map((m) => m[1]);
  const serviceConfig = config.services ?? {};

  const docker = { required: false, reasons: [] };
  if (composeFile) docker.reasons.push(composeFile);
  if (exists(path.join(root, 'Dockerfile'))) docker.reasons.push('Dockerfile');
  docker.required = serviceConfig.docker === undefined ? docker.reasons.length > 0 : Boolean(serviceConfig.docker);
  if (serviceConfig.docker) docker.reasons.push('.dev-doctor.json');

  const services = [];
  for (const [id, spec] of Object.entries(SERVICES)) {
    const configured = serviceConfig[id];
    if (configured === false) continue;
    const reasons = [];
    let endpoint = null;

    if (configured && typeof configured === 'object') {
      reasons.push('.dev-doctor.json');
      endpoint = { host: configured.host ?? 'localhost', port: Number(configured.port) || spec.port };
    }
    for (const key of spec.urlKeys) {
      const value = values.get(key);
      const found = value ? endpointFromUrl(value, spec) : null;
      if (found) {
        reasons.push(key);
        endpoint ??= found;
        break;
      }
    }
    if (values.get(spec.hostKey) || values.get(spec.portKey)) {
      reasons.push(spec.hostKey);
      endpoint ??= { host: values.get(spec.hostKey) || 'localhost', port: Number(values.get(spec.portKey)) || spec.port };
    }
    if (images.some((image) => spec.images.test(image))) reasons.push(composeFile);
    const dep = spec.deps.find((d) => deps[d]);
    if (dep) reasons.push(`dependency "${dep}"`);

    if (reasons.length === 0) continue;
    services.push({ id, label: spec.label, reasons, endpoint: endpoint ?? { host: 'localhost', port: spec.port } });
  }
  return { docker, services };
}

export function tcpCheck(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function checkServices(discovery, { run = runCommand, tcp = tcpCheck } = {}) {
  const results = [];
  const { docker, services } = discovery;
  const why = (reasons) => [`Detected from ${reasons.join(', ')}`];

  const cli = await run('docker', ['--version'], { timeout: 5000 });
  if (!cli.ok) {
    if (docker.required) {
      results.push(result(CATEGORY, STATUS.FAIL, 'Docker CLI not found', { details: why(docker.reasons), hint: 'Install Docker Desktop or Docker Engine.' }));
    } else {
      results.push(result(CATEGORY, STATUS.INFO, 'Docker CLI not found (not required by this project)'));
    }
  } else {
    const daemon = await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 8000 });
    if (daemon.ok) {
      results.push(result(CATEGORY, STATUS.PASS, `Docker daemon is running (${daemon.stdout.trim()})`));
    } else {
      results.push(result(CATEGORY, docker.required ? STATUS.FAIL : STATUS.WARN, 'Docker daemon is not running', {
        details: docker.required ? why(docker.reasons) : [],
        hint: 'Start Docker Desktop or the Docker service.',
      }));
    }
  }

  for (const service of services) {
    const { endpoint } = service;
    if (endpoint.srv) {
      results.push(result(CATEGORY, STATUS.INFO, `${service.label} uses an SRV connection string; TCP check skipped`, { details: why(service.reasons) }));
      continue;
    }
    const where = `${endpoint.host}:${endpoint.port}`;
    if (await tcp(endpoint.host, endpoint.port)) {
      results.push(result(CATEGORY, STATUS.PASS, `${service.label} is reachable at ${where}`, {
        details: [...why(service.reasons), 'TCP connection only; authentication and queries were not verified'],
      }));
    } else {
      results.push(result(CATEGORY, STATUS.WARN, `${service.label} is not reachable at ${where}`, {
        details: why(service.reasons),
        hint: `Verify ${service.label} is running if this project needs it${discovery.docker.reasons.some((r) => r.includes('compose')) ? ' (e.g. "docker compose up -d")' : ''}.`,
      }));
    }
  }

  if (services.length === 0) results.push(result(CATEGORY, STATUS.INFO, 'No database services detected'));
  return results;
}
