import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNode, checkEngines, checkVersionFile } from '../../src/checks/node-version.js';
import { loadProject } from '../../src/checks/project.js';
import { makeProject } from '../helpers.js';

test('engines.node match and mismatch', () => {
  assert.equal(checkEngines('>=18', '20.1.0').status, 'pass');
  assert.equal(checkEngines('^18.0.0', '20.1.0').status, 'fail');
  assert.equal(checkEngines('not a range!', '20.1.0').status, 'warn');
});

test('.nvmrc exact, same major, other major, range and alias', () => {
  assert.equal(checkVersionFile('.nvmrc', 'v20.1.0', '20.1.0').status, 'pass');
  assert.equal(checkVersionFile('.nvmrc', '20.5.0', '20.1.0').status, 'warn');
  assert.equal(checkVersionFile('.nvmrc', '18.0.0', '20.1.0').status, 'fail');
  assert.equal(checkVersionFile('.nvmrc', '20', '20.1.0').status, 'pass');
  assert.equal(checkVersionFile('.nvmrc', '18', '20.1.0').status, 'fail');
  assert.equal(checkVersionFile('.nvmrc', 'lts/iron', '20.1.0').status, 'info');
  assert.equal(checkVersionFile('.nvmrc', 'banana', '20.1.0').status, 'warn');
});

test('checkNode reads engines, .nvmrc and .node-version', async () => {
  const root = makeProject({ 'package.json': { engines: { node: '>=22' } }, '.nvmrc': '18\n', '.node-version': '20.1.0' });
  const results = await checkNode(loadProject(root), { nodeVersion: 'v20.1.0', getVersion: async () => '10.0.0' });
  const titles = results.map((r) => `${r.status} ${r.title}`);
  assert.ok(titles.includes('fail Node.js 20.1.0 does not satisfy engines.node (>=22)'));
  assert.ok(titles.includes('fail Node.js 20.1.0 does not match .nvmrc (18)'));
  assert.ok(titles.includes('pass Node.js 20.1.0 matches .node-version (20.1.0)'));
});

test('checkNode warns when npm is missing and notes no requirement', async () => {
  const results = await checkNode(loadProject(makeProject({ 'package.json': {} })), { nodeVersion: 'v22.0.0', getVersion: async () => null });
  assert.ok(results.some((r) => r.status === 'warn' && /npm was not found/.test(r.title)));
  assert.ok(results.some((r) => /No required Node.js version/.test(r.title)));
});
