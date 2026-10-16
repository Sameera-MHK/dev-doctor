import fs from 'node:fs/promises';
import path from 'node:path';
import { result, STATUS } from '../core/diagnostics.js';
import { parseEnv } from '../utils/env-parser.js';
import { readTextIfExists } from '../utils/paths.js';

const CATEGORY = 'Environment variables';

export const TEMPLATE_FILES = ['.env.example', '.env.sample', '.env.template', '.env.dist'];
export const LOCAL_FILES = ['.env', '.env.local', '.env.development', '.env.development.local'];

export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.svelte-kit',
  '.output', '.turbo', '.cache', '.vercel', '.netlify', '.parcel-cache', 'tmp', 'vendor',
]);

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte', '.astro']);

// Set by the runtime, shell or build tool; not expected in .env files.
const BUILTIN_KEYS = new Set([
  'NODE_ENV', 'CI', 'HOME', 'PATH', 'PWD', 'USER', 'SHELL', 'TZ', 'LANG', 'TERM', 'NO_COLOR', 'DEBUG',
  'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL', 'PORT', 'HOST',
]);

const REFERENCE_PATTERNS = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\]/g,
  /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
];

/** Plain names from .gitignore (no globs or nested paths); used to skip directories and files. */
export function gitignoreNames(text) {
  const names = new Set();
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^\//, '').replace(/\/$/, '');
    if (!line || line.startsWith('#') || line.startsWith('!') || /[*?[\]/]/.test(line)) continue;
    names.add(line);
  }
  return names;
}

export function isEnvGitignored(text) {
  const patterns = new Set(['.env', '/.env', '.env*', '/.env*', '*.env', '.env.*']);
  return (text ?? '').split(/\r?\n/).some((line) => patterns.has(line.trim()));
}

export function findReferences(source) {
  const keys = new Set();
  for (const pattern of REFERENCE_PATTERNS) {
    for (const match of source.matchAll(pattern)) keys.add(match[1]);
  }
  return keys;
}

/** Find env variable references in source files. Returns key -> Set of relative file paths. */
export async function scanEnvReferences(root, { maxFiles = 5000, ignoredNames = new Set() } = {}) {
  const references = new Map();
  let scanned = 0;
  let truncated = false;
  const queue = [root];

  while (queue.length > 0) {
    const dir = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name) || ignoredNames.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) queue.push(full);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      if (scanned >= maxFiles) {
        truncated = true;
        break;
      }
      scanned++;
      const text = readTextIfExists(full);
      if (text === null) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      for (const key of findReferences(text)) {
        if (!references.has(key)) references.set(key, new Set());
        references.get(key).add(rel);
      }
    }
    if (truncated) break;
  }
  return { references, scanned, truncated };
}

function readEnvFile(root, file) {
  const text = readTextIfExists(path.join(root, file));
  if (text === null) return null;
  const { entries, issues } = parseEnv(text);
  return { file, entries, issues };
}

/** Collect env data. Values stay in memory only and are never returned in results. */
export async function analyzeEnvironment(root) {
  const gitignoreText = readTextIfExists(path.join(root, '.gitignore'));
  const template = TEMPLATE_FILES.map((f) => readEnvFile(root, f)).find(Boolean) ?? null;
  const locals = LOCAL_FILES.map((f) => readEnvFile(root, f)).filter(Boolean);
  const scan = await scanEnvReferences(root, { ignoredNames: gitignoreNames(gitignoreText) });
  return { template, locals, ...scan, gitignoreText };
}

function sources(files, limit = 3) {
  const list = [...files];
  return list.slice(0, limit).join(', ') + (list.length > limit ? ` (+${list.length - limit} more)` : '');
}

export function environmentResults(data, { env = process.env } = {}) {
  const { template, locals, references } = data;
  const results = [];

  if (!template && locals.length === 0 && references.size === 0) {
    return [result(CATEGORY, STATUS.INFO, 'No environment files or variable references found')];
  }

  for (const file of [template, ...locals].filter(Boolean)) {
    for (const issue of file.issues) {
      results.push(result(CATEGORY, STATUS.WARN, `${file.file} line ${issue.line}: ${issue.message}`, {
        hint: `Check line ${issue.line} of ${file.file}; dev-doctor does not guess ambiguous values.`,
      }));
    }
  }

  const localKeys = new Set(locals.flatMap((f) => [...f.entries.keys()]));
  const isSet = (key) => localKeys.has(key) || Object.prototype.hasOwnProperty.call(env, key);
  const templateKeys = template ? [...template.entries.keys()] : [];

  if (template) {
    results.push(result(CATEGORY, STATUS.INFO, `Template: ${template.file} (${templateKeys.length} keys)`));
  } else if (locals.length > 0) {
    results.push(result(CATEGORY, STATUS.WARN, 'No .env.example template found', {
      hint: 'Create .env.example listing the required keys without real values.',
    }));
  }

  if (template && locals.length === 0) {
    const unset = templateKeys.filter((k) => !Object.prototype.hasOwnProperty.call(env, k));
    if (unset.length > 0) {
      results.push(result(CATEGORY, STATUS.FAIL, '.env file is missing', {
        details: [`Keys from ${template.file} not set: ${unset.join(', ')}`],
        hint: `Create .env from ${template.file} and fill in your own values.`,
        fixId: 'create-env',
        fixData: { template: template.file, keys: templateKeys },
      }));
    }
  } else if (template) {
    for (const key of templateKeys) {
      if (isSet(key)) continue;
      const usedIn = references.get(key);
      if (usedIn) {
        results.push(result(CATEGORY, STATUS.FAIL, `${key} is missing`, {
          details: [`Documented in ${template.file}`, `Referenced in ${sources(usedIn)}`],
          hint: `Set ${key} in your local .env file.`,
        }));
      } else {
        results.push(result(CATEGORY, STATUS.WARN, `${key} is listed in ${template.file} but not set (may be optional)`, {
          details: [`Documented in ${template.file}`],
        }));
      }
    }
    const templateSet = new Set(templateKeys);
    for (const local of locals) {
      for (const key of local.entries.keys()) {
        if (!templateSet.has(key)) {
          results.push(result(CATEGORY, STATUS.WARN, `${key} is not documented in ${template.file}`, {
            details: [`Defined in ${local.file}`],
            hint: `Add ${key} (without its value) to ${template.file}.`,
          }));
        }
      }
    }
  }

  const templateSet = new Set(templateKeys);
  for (const [key, files] of references) {
    if (BUILTIN_KEYS.has(key) || templateSet.has(key) || isSet(key)) continue;
    results.push(result(CATEGORY, STATUS.WARN, `${key} is referenced in code but not defined`, {
      details: [`Referenced in ${sources(files)}`],
      hint: `Add ${key} to your .env file${template ? ` and ${template.file}` : ''} if the app needs it.`,
    }));
  }

  if (locals.some((f) => f.file === '.env') && !isEnvGitignored(data.gitignoreText)) {
    results.push(result(CATEGORY, STATUS.WARN, '.env is not listed in .gitignore', {
      details: ['Secrets in .env could be committed by accident'],
      hint: 'Add ".env" to .gitignore.',
      fixId: 'gitignore-env',
    }));
  }

  if (data.truncated) {
    results.push(result(CATEGORY, STATUS.INFO, `Source scan stopped after ${data.scanned} files; some references may be missing`));
  }

  if (!results.some((r) => r.status === STATUS.FAIL || r.status === STATUS.WARN)) {
    results.push(result(CATEGORY, STATUS.PASS, template ? `All keys from ${template.file} are set` : 'Environment variables look consistent'));
  }
  return results;
}

export async function checkEnvironment(root, options) {
  return environmentResults(await analyzeEnvironment(root), options);
}
