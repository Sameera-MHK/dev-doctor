import fs from 'node:fs';
import path from 'node:path';
import { result, STATUS } from '../core/diagnostics.js';
import { exists } from '../utils/paths.js';
import { getToolVersion } from '../utils/process-info.js';

const CATEGORY = 'Packages';

export const LOCKFILES = [
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
];

const KNOWN_MANAGERS = new Set(['npm', 'yarn', 'pnpm', 'bun']);

export function findLockfiles(root) {
  return LOCKFILES.filter(([file]) => exists(path.join(root, file))).map(([file, manager]) => ({ file, manager }));
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

export async function checkPackages(project, { getVersion = getToolVersion } = {}) {
  const pkg = project.packageJson;
  if (!pkg) return [];
  const { root } = project;
  const results = [];

  const lockfiles = findLockfiles(root);
  const lockManagers = [...new Set(lockfiles.map((l) => l.manager))];
  const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : null;
  const manager = (declared && KNOWN_MANAGERS.has(declared) ? declared : null) ?? (lockManagers.length === 1 ? lockManagers[0] : 'npm');
  const install = `${manager} install`;

  if (lockManagers.length > 1) {
    results.push(result(CATEGORY, STATUS.WARN, 'Multiple lockfiles detected', {
      details: lockfiles.map((l) => `${l.file} (${l.manager})`),
      hint: `Agree on one package manager (likely ${manager}) and remove the other lockfiles yourself.`,
    }));
  } else if (lockfiles.length === 0) {
    results.push(result(CATEGORY, STATUS.WARN, 'No lockfile found', { hint: `Run "${install}" and commit the generated lockfile.` }));
  } else {
    results.push(result(CATEGORY, STATUS.PASS, `Lockfile: ${lockfiles.map((l) => l.file).join(', ')} (${lockManagers[0]})`));
  }

  if (declared && lockManagers.length > 0 && !lockManagers.includes(declared)) {
    results.push(result(CATEGORY, STATUS.WARN, `packageManager is "${declared}" but the lockfile belongs to ${lockManagers.join(', ')}`));
  }

  const version = await getVersion(manager);
  if (version) {
    results.push(result(CATEGORY, STATUS.PASS, `${manager} ${version} is available`));
  } else {
    results.push(result(CATEGORY, STATUS.FAIL, `${manager} is used by this project but was not found`, {
      hint: manager === 'npm' ? 'Reinstall Node.js to restore npm.' : `Install ${manager} (e.g. "corepack enable") and try again.`,
    }));
  }

  const names = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
  if (names.length === 0) {
    results.push(result(CATEGORY, STATUS.INFO, 'No dependencies declared'));
    return results;
  }
  if (exists(path.join(root, '.pnp.cjs'))) {
    results.push(result(CATEGORY, STATUS.INFO, "Yarn Plug'n'Play detected; node_modules checks skipped"));
    return results;
  }

  const nodeModules = path.join(root, 'node_modules');
  if (!exists(nodeModules)) {
    results.push(result(CATEGORY, STATUS.FAIL, 'Dependencies are not installed (node_modules not found)', { hint: `Run "${install}".` }));
    return results;
  }

  const missing = names.filter((name) => !exists(path.join(nodeModules, name, 'package.json')));
  if (missing.length > 0) {
    results.push(result(CATEGORY, STATUS.FAIL, `${missing.length} of ${names.length} dependencies are not installed`, {
      details: missing.slice(0, 10).concat(missing.length > 10 ? [`...and ${missing.length - 10} more`] : []),
      hint: `Run "${install}".`,
    }));
  } else {
    results.push(result(CATEGORY, STATUS.PASS, `All ${names.length} declared dependencies are installed`));
  }

  // npm writes node_modules/.package-lock.json on install; an older one means the lockfile changed since.
  const lockTime = mtime(path.join(root, 'package-lock.json'));
  const installTime = mtime(path.join(nodeModules, '.package-lock.json'));
  if (lockTime && installTime && lockTime > installTime + 1000) {
    results.push(result(CATEGORY, STATUS.WARN, 'package-lock.json changed since dependencies were last installed', { hint: 'Run "npm install".' }));
  }
  return results;
}
