import path from 'node:path';
import semver from 'semver';
import { result, STATUS } from '../core/diagnostics.js';
import { readTextIfExists } from '../utils/paths.js';
import { getToolVersion } from '../utils/process-info.js';

const CATEGORY = 'Node.js';
const ALIAS = /^(lts\/|lts$|node$|stable$|latest$|current$|system$)/i;

/** Compare the running Node.js version with a .nvmrc / .node-version value. */
export function checkVersionFile(file, value, current) {
  const wanted = value.trim().replace(/^v/i, '');
  if (!wanted) return result(CATEGORY, STATUS.WARN, `${file} is empty`);
  if (ALIAS.test(wanted)) {
    return result(CATEGORY, STATUS.INFO, `${file} uses alias "${wanted}"; cannot verify offline`);
  }
  const hint = `Switch Node.js versions, e.g. "nvm use" or "fnm use" (reads ${file}).`;
  if (semver.valid(wanted)) {
    if (semver.eq(current, wanted)) return result(CATEGORY, STATUS.PASS, `Node.js ${current} matches ${file} (${wanted})`);
    if (semver.major(current) === semver.major(wanted)) {
      return result(CATEGORY, STATUS.WARN, `Node.js ${current} differs from ${file} (${wanted})`, { hint });
    }
    return result(CATEGORY, STATUS.FAIL, `Node.js ${current} does not match ${file} (${wanted})`, { hint });
  }
  if (semver.validRange(wanted)) {
    if (semver.satisfies(current, wanted)) return result(CATEGORY, STATUS.PASS, `Node.js ${current} matches ${file} (${wanted})`);
    return result(CATEGORY, STATUS.FAIL, `Node.js ${current} does not match ${file} (${wanted})`, { hint });
  }
  return result(CATEGORY, STATUS.WARN, `${file} contains an unrecognized version "${wanted}"`);
}

export function checkEngines(range, current) {
  if (!semver.validRange(range)) {
    return result(CATEGORY, STATUS.WARN, `engines.node "${range}" is not a valid version range`);
  }
  if (semver.satisfies(current, range)) {
    return result(CATEGORY, STATUS.PASS, `Node.js ${current} satisfies engines.node (${range})`);
  }
  return result(CATEGORY, STATUS.FAIL, `Node.js ${current} does not satisfy engines.node (${range})`, {
    hint: `Install and use a Node.js version matching "${range}" (e.g. with nvm, fnm or volta).`,
  });
}

export async function checkNode(project, { nodeVersion = process.version, getVersion = getToolVersion } = {}) {
  const current = semver.clean(nodeVersion) ?? nodeVersion;
  const results = [result(CATEGORY, STATUS.INFO, `Node.js ${current}`)];

  const npmVersion = await getVersion('npm');
  results.push(npmVersion
    ? result(CATEGORY, STATUS.INFO, `npm ${npmVersion}`)
    : result(CATEGORY, STATUS.WARN, 'npm was not found on PATH', { hint: 'Reinstall Node.js or fix your PATH so npm is available.' }));

  const range = project.packageJson?.engines?.node;
  if (typeof range === 'string') results.push(checkEngines(range, current));

  for (const file of ['.nvmrc', '.node-version']) {
    const text = readTextIfExists(path.join(project.root, file), 1024);
    if (text !== null) results.push(checkVersionFile(file, text.split(/\r?\n/)[0], current));
  }

  if (typeof range !== 'string' && results.length === 2) {
    results.push(result(CATEGORY, STATUS.INFO, 'No required Node.js version declared (engines.node, .nvmrc, .node-version)'));
  }
  return results;
}
