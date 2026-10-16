import { STATUS } from './diagnostics.js';
import { loadProject, checkProject } from '../checks/project.js';
import { checkNode } from '../checks/node-version.js';
import { checkPackages } from '../checks/packages.js';
import { checkEnvironment } from '../checks/environment.js';
import { checkPorts, detectProjectPorts, DEFAULT_PORTS } from '../checks/ports.js';
import { checkServices, discoverServices } from '../checks/services.js';
import { getPlatformAdapter } from '../platform/index.js';
import { loadConfig } from '../utils/config.js';

export const ALL_CATEGORIES = ['project', 'node', 'packages', 'env', 'ports', 'services'];

/** Run the selected read-only checks. Never modifies anything. */
export async function runDiagnostics(root, { categories = ALL_CATEGORIES, verbose = false, adapter = getPlatformAdapter() } = {}) {
  const config = loadConfig(root);
  const project = loadProject(root);
  const results = [];
  const run = (name) => categories.includes(name);

  if (run('project')) results.push(...checkProject(project));
  if (run('node')) results.push(...(await checkNode(project)));
  if (run('packages')) results.push(...(await checkPackages(project)));
  if (run('env')) results.push(...(await checkEnvironment(root)));
  if (run('ports')) {
    const projectPorts = detectProjectPorts(project, config);
    const ports = projectPorts.length > 0 ? projectPorts : DEFAULT_PORTS;
    // Ports the project itself uses are failures when taken; generic common ports only warn.
    const occupiedStatus = projectPorts.length > 0 ? STATUS.FAIL : STATUS.WARN;
    results.push(...(await checkPorts(ports, { adapter, describe: verbose, occupiedStatus })));
  }
  if (run('services')) results.push(...(await checkServices(discoverServices(project, config))));

  return { project, config, results };
}
