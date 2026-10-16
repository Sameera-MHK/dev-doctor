import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPackages } from '../../src/checks/packages.js';
import { loadProject } from '../../src/checks/project.js';
import { makeProject } from '../helpers.js';

const available = async () => '1.0.0';
const find = (results, re) => results.find((r) => re.test(r.title));

test('multiple lockfiles warn', async () => {
  const root = makeProject({ 'package.json': {}, 'package-lock.json': '{}', 'yarn.lock': '' });
  const results = await checkPackages(loadProject(root), { getVersion: available });
  assert.equal(find(results, /Multiple lockfiles/).status, 'warn');
});

test('missing node_modules fails with install hint', async () => {
  const root = makeProject({ 'package.json': { dependencies: { a: '1' } }, 'pnpm-lock.yaml': '' });
  const r = find(await checkPackages(loadProject(root), { getVersion: available }), /not installed/);
  assert.equal(r.status, 'fail');
  assert.match(r.hint, /pnpm install/);
});

test('missing individual dependencies fail; installed ones pass', async () => {
  const root = makeProject({
    'package.json': { dependencies: { a: '1' }, devDependencies: { b: '1' } },
    'package-lock.json': '{}',
    'node_modules/a/package.json': '{}',
  });
  const r = find(await checkPackages(loadProject(root), { getVersion: available }), /dependencies are not installed/);
  assert.equal(r.status, 'fail');
  assert.deepEqual(r.details, ['b']);

  const ok = makeProject({ 'package.json': { dependencies: { a: '1' } }, 'package-lock.json': '{}', 'node_modules/a/package.json': '{}' });
  assert.equal(find(await checkPackages(loadProject(ok), { getVersion: available }), /All 1 declared/).status, 'pass');
});

test('required package manager not available fails', async () => {
  const root = makeProject({ 'package.json': { packageManager: 'yarn@4.0.0' }, 'yarn.lock': '' });
  const r = find(await checkPackages(loadProject(root), { getVersion: async () => null }), /yarn is used/);
  assert.equal(r.status, 'fail');
});

test('no lockfile warns; invalid package.json skips package checks', async () => {
  const results = await checkPackages(loadProject(makeProject({ 'package.json': {} })), { getVersion: available });
  assert.equal(find(results, /No lockfile/).status, 'warn');
  assert.deepEqual(await checkPackages(loadProject(makeProject({ 'package.json': '{' }))), []);
});
