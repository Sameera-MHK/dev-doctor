import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePort, inspectPort, portResults, dedupeListeners, bindTest, checkPorts, detectProjectPorts } from '../../src/checks/ports.js';
import { loadProject } from '../../src/checks/project.js';
import { getPlatformAdapter } from '../../src/platform/index.js';
import { UtilityMissingError } from '../../src/utils/errors.js';
import { listen, freePort, makeProject } from '../helpers.js';

test('parsePort accepts 1-65535 and rejects everything else', () => {
  assert.equal(parsePort('3000'), 3000);
  assert.equal(parsePort(65535), 65535);
  for (const bad of ['0', '65536', '-1', '3000.5', 'abc', '', '3000; rm -rf /', '1e3']) {
    assert.throws(() => parsePort(bad), /Invalid port/);
  }
});

test('free port is reported as available', async () => {
  const port = await freePort();
  assert.equal(await bindTest(port), 'free');
  const [r] = await checkPorts([port], { adapter: getPlatformAdapter() });
  assert.equal(r.status, 'pass');
});

test('occupied port is detected with the real platform adapter', async () => {
  const { server, port } = await listen();
  try {
    const i = await inspectPort(port, { adapter: getPlatformAdapter() });
    assert.equal(i.state, 'in-use');
    // When the OS tools report the owner, it must be this test process.
    for (const l of i.listeners) if (l.pid) assert.equal(l.pid, process.pid);
  } finally {
    server.close();
  }
});

test('missing OS utility falls back to a bind test and reports the limitation', async () => {
  const { server, port } = await listen();
  try {
    const adapter = { findListeners: async () => { throw new UtilityMissingError('lsof'); } };
    const [r] = portResults([await inspectPort(port, { adapter })]);
    assert.equal(r.status, 'fail');
    assert.match(r.title, /process details not accessible/);
    assert.match(r.details[0], /lsof/);
    assert.equal(r.fixId, undefined);
  } finally {
    server.close();
  }
});

test('inaccessible process is distinguished from an empty port', async () => {
  const adapter = { findListeners: async () => [] };
  const busy = portResults([await inspectPort(1234, { adapter, bind: async () => 'in-use' })])[0];
  const empty = portResults([await inspectPort(1234, { adapter, bind: async () => 'free' })])[0];
  assert.match(busy.title, /not accessible/);
  assert.equal(empty.status, 'pass');
});

test('IPv4 and IPv6 listeners of one process are merged', () => {
  const merged = dedupeListeners([
    { pid: 10, name: 'node', addresses: ['127.0.0.1:3000'] },
    { pid: 10, name: 'node', addresses: ['[::1]:3000'] },
    { pid: 11, name: 'other', addresses: ['*:3000'] },
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].addresses, ['127.0.0.1:3000', '[::1]:3000']);
});

test('occupied project port fails with a kill fix; common port only warns', () => {
  const inspection = { port: 3000, state: 'in-use', listeners: [{ pid: 42, name: 'node', addresses: ['*:3000'] }] };
  const [fail] = portResults([inspection]);
  assert.equal(fail.status, 'fail');
  assert.equal(fail.title, 'Port 3000 is occupied by node (PID 42)');
  assert.equal(fail.fixId, 'kill-port');
  const [warn] = portResults([inspection], { occupiedStatus: 'warn' });
  assert.equal(warn.status, 'warn');
  assert.equal(warn.fixId, undefined);
});

test('detects project ports from scripts, .env and framework', () => {
  const root = makeProject({
    'package.json': { scripts: { dev: 'vite --port 4000', api: 'node server.js -p 9000' }, devDependencies: { vite: '5' } },
    '.env': 'PORT=8081',
  });
  assert.deepEqual(detectProjectPorts(loadProject(root), { ports: [7000] }), [4000, 5173, 7000, 8081, 9000]);
});
