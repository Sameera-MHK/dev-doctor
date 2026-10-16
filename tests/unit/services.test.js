import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverServices, checkServices, tcpCheck } from '../../src/checks/services.js';
import { loadProject } from '../../src/checks/project.js';
import { formatHuman, toJson } from '../../src/core/reporter.js';
import { makeProject, listen, freePort, ok, missing, failed } from '../helpers.js';

const SECRET = 'p4ssw0rd-secret';

test('discovers services from env, compose files and dependencies', () => {
  const root = makeProject({
    'package.json': { dependencies: { ioredis: '5' } },
    '.env': `DATABASE_URL=postgres://admin:${SECRET}@db.local:6543/app\n`,
    'compose.yaml': 'services:\n  cache:\n    image: "mongo:7"\n',
  });
  const { docker, services } = discoverServices(loadProject(root), {}, { env: {} });
  assert.equal(docker.required, true);
  const byId = Object.fromEntries(services.map((s) => [s.id, s]));
  assert.deepEqual(byId.postgres.endpoint, { host: 'db.local', port: 6543 });
  assert.deepEqual(byId.mongodb.endpoint, { host: 'localhost', port: 27017 });
  assert.deepEqual(byId.redis.reasons, ['dependency "ioredis"']);
  assert.ok(!JSON.stringify(services).includes(SECRET));
});

test('.dev-doctor.json can configure or disable services', () => {
  const root = makeProject({ 'package.json': { dependencies: { pg: '8', redis: '4' } } });
  const config = { services: { docker: false, postgres: { host: '127.0.0.1', port: 5433 }, redis: false } };
  const { docker, services } = discoverServices(loadProject(root), config, { env: {} });
  assert.equal(docker.required, false);
  assert.deepEqual(services.map((s) => [s.id, s.endpoint]), [['postgres', { host: '127.0.0.1', port: 5433 }]]);
});

test('tcpCheck reports reachable and unreachable ports', async () => {
  const { server, port } = await listen();
  assert.equal(await tcpCheck('127.0.0.1', port), true);
  server.close();
  assert.equal(await tcpCheck('127.0.0.1', await freePort(), 500), false);
});

test('Docker unavailable: FAIL when required, INFO otherwise', async () => {
  const required = await checkServices({ docker: { required: true, reasons: ['compose.yaml'] }, services: [] }, { run: async () => missing() });
  assert.equal(required[0].status, 'fail');
  const optional = await checkServices({ docker: { required: false, reasons: [] }, services: [] }, { run: async () => missing() });
  assert.equal(optional[0].status, 'info');
});

test('Docker daemon not running', async () => {
  const run = async (cmd, args) => (args[0] === '--version' ? ok('Docker version 27') : failed('', 'Cannot connect'));
  const [r] = await checkServices({ docker: { required: true, reasons: ['compose.yaml'] }, services: [] }, { run });
  assert.equal(r.status, 'fail');
  assert.equal(r.title, 'Docker daemon is not running');
});

test('unreachable database warns; reachable one does not claim auth works; no credentials printed', async () => {
  const root = makeProject({ '.env': `DATABASE_URL=postgres://admin:${SECRET}@localhost:1/app\nREDIS_URL=redis://:${SECRET}@localhost:2\n` });
  const discovery = discoverServices(loadProject(root), {}, { env: {} });
  const results = await checkServices(discovery, { run: async () => missing(), tcp: async (host, port) => port === 2 });
  const pg = results.find((r) => /PostgreSQL/.test(r.title));
  const redis = results.find((r) => /Redis/.test(r.title));
  assert.equal(pg.status, 'warn');
  assert.equal(redis.status, 'pass');
  assert.ok(redis.details.some((d) => /authentication and queries were not verified/.test(d)));
  const report = { project: null, results };
  assert.ok(!formatHuman(report, { verbose: true }).includes(SECRET));
  assert.ok(!toJson(report).includes(SECRET));
});

test('MongoDB SRV strings are skipped, not guessed', async () => {
  const root = makeProject({ '.env': 'MONGODB_URI=mongodb+srv://u:p@cluster.example.net/db\n' });
  const results = await checkServices(discoverServices(loadProject(root), {}, { env: {} }), { run: async () => missing() });
  assert.ok(results.some((r) => r.status === 'info' && /SRV/.test(r.title)));
});
