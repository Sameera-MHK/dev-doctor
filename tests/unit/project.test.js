import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject, checkProject, detectProjectType } from '../../src/checks/project.js';
import { makeProject } from '../helpers.js';

test('valid package.json passes and detects project type', () => {
  const root = makeProject({ 'package.json': { name: 'app', dependencies: { react: '1', vite: '5' } } });
  const project = loadProject(root);
  assert.equal(project.name, 'app');
  assert.equal(project.type, 'Vite');
  assert.equal(checkProject(project)[0].status, 'pass');
});

test('invalid package.json fails', () => {
  const project = loadProject(makeProject({ 'package.json': '{ "name": ' }));
  const [r] = checkProject(project);
  assert.equal(r.status, 'fail');
  assert.match(r.title, /not valid JSON/);
});

test('non-object package.json fails', () => {
  assert.equal(checkProject(loadProject(makeProject({ 'package.json': '[]' })))[0].status, 'fail');
});

test('missing package.json fails', () => {
  const [r] = checkProject(loadProject(makeProject()));
  assert.equal(r.status, 'fail');
  assert.match(r.title, /not found/);
});

test('detectProjectType falls back to Node.js', () => {
  assert.equal(detectProjectType({}), 'Node.js');
  assert.equal(detectProjectType({ dependencies: { next: '14', react: '18' } }), 'Next.js');
});
