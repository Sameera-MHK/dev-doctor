import fs from 'node:fs';
import path from 'node:path';
import { result, STATUS } from '../core/diagnostics.js';

const CATEGORY = 'Project';

// Order matters: frameworks before the libraries they build on.
const PROJECT_TYPES = [
  ['next', 'Next.js'],
  ['nuxt', 'Nuxt'],
  ['@angular/core', 'Angular'],
  ['@sveltejs/kit', 'SvelteKit'],
  ['@remix-run/react', 'Remix'],
  ['astro', 'Astro'],
  ['vite', 'Vite'],
  ['react-scripts', 'Create React App'],
  ['@nestjs/core', 'NestJS'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
];

export function allDependencies(pkg) {
  return { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
}

export function detectProjectType(pkg) {
  if (!pkg) return 'Unknown';
  const deps = allDependencies(pkg);
  for (const [dep, type] of PROJECT_TYPES) {
    if (deps[dep]) return type;
  }
  return 'Node.js';
}

/** Load package.json without executing anything. */
export function loadProject(root) {
  const file = path.join(root, 'package.json');
  const project = { root, name: path.basename(root), packageJson: null, packageJsonExists: false, packageJsonError: null, type: 'Unknown' };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return project;
  }
  project.packageJsonExists = true;
  try {
    const pkg = JSON.parse(text);
    if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) throw new Error('package.json must contain a JSON object');
    project.packageJson = pkg;
    if (typeof pkg.name === 'string' && pkg.name) project.name = pkg.name;
    project.type = detectProjectType(pkg);
  } catch (error) {
    project.packageJsonError = error.message;
  }
  return project;
}

export function checkProject(project) {
  if (!project.packageJsonExists) {
    return [result(CATEGORY, STATUS.FAIL, 'package.json not found', { hint: 'Run dev-doctor from your project root, or create package.json with "npm init".' })];
  }
  if (project.packageJsonError) {
    return [result(CATEGORY, STATUS.FAIL, 'package.json is not valid JSON', { details: [project.packageJsonError], hint: 'Fix the syntax error in package.json.' })];
  }
  return [result(CATEGORY, STATUS.PASS, `package.json is valid (${project.type} project)`)];
}
