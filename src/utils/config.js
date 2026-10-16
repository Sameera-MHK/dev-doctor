import path from 'node:path';
import { readTextIfExists } from './paths.js';
import { DevDoctorError } from './errors.js';

export const CONFIG_FILE = '.dev-doctor.json';

/**
 * Optional project config:
 * { "ports": [3000], "failOn": "fail" | "warn",
 *   "services": { "docker": true, "postgres": { "host": "localhost", "port": 5432 }, "redis": false } }
 */
export function loadConfig(root) {
  const text = readTextIfExists(path.join(root, CONFIG_FILE));
  if (text === null) return {};
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    throw new DevDoctorError(`${CONFIG_FILE} is not valid JSON`);
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new DevDoctorError(`${CONFIG_FILE} must contain a JSON object`);
  }
  if (config.ports !== undefined && !Array.isArray(config.ports)) {
    throw new DevDoctorError(`${CONFIG_FILE}: "ports" must be an array`);
  }
  if (config.failOn !== undefined && !['fail', 'warn'].includes(config.failOn)) {
    throw new DevDoctorError(`${CONFIG_FILE}: "failOn" must be "fail" or "warn"`);
  }
  return config;
}
