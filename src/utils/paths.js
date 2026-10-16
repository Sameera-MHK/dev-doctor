import fs from 'node:fs';
import path from 'node:path';
import { DevDoctorError } from './errors.js';

export function resolveProjectRoot(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    throw new DevDoctorError(`Directory not found: ${root}`);
  }
  if (!stat.isDirectory()) throw new DevDoctorError(`Not a directory: ${root}`);
  return root;
}

/** Resolve a path inside the project root; refuse anything that escapes it. */
export function safeProjectPath(root, relativePath) {
  const target = path.resolve(root, relativePath);
  const rel = path.relative(root, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new DevDoctorError(`Refusing to access a path outside the project: ${relativePath}`);
  }
  return target;
}

export function exists(file) {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

export function readTextIfExists(file, maxBytes = 1024 * 1024) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
