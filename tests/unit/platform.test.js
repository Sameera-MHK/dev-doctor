import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLsof, killUnix } from '../../src/platform/unix.js';
import { parseSs, createLinuxAdapter } from '../../src/platform/linux.js';
import { createDarwinAdapter } from '../../src/platform/darwin.js';
import { parseNetstat, parseTasklist, createWin32Adapter } from '../../src/platform/win32.js';
import { getPlatformAdapter } from '../../src/platform/index.js';
import { ok, missing, failed } from '../helpers.js';

test('parseLsof groups fields by process', () => {
  const out = 'p100\ncnode\nn*:3000\nn[::1]:3000\np200\ncpython3\nn127.0.0.1:3000\n';
  assert.deepEqual(parseLsof(out), [
    { pid: 100, name: 'node', addresses: ['*:3000', '[::1]:3000'] },
    { pid: 200, name: 'python3', addresses: ['127.0.0.1:3000'] },
  ]);
});

test('parseSs handles process info and inaccessible sockets', () => {
  const out = [
    'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=123,fd=20),("node",pid=124,fd=20))',
    'LISTEN 0 511 [::]:3000 [::]:*',
  ].join('\n');
  assert.deepEqual(parseSs(out), [
    { pid: 123, name: 'node', addresses: ['0.0.0.0:3000'] },
    { pid: 124, name: 'node', addresses: ['0.0.0.0:3000'] },
    { pid: null, name: null, addresses: ['[::]:3000'] },
  ]);
});

test('parseNetstat finds IPv4 and IPv6 listeners regardless of locale', () => {
  const out = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4321',
    '  TCP    [::]:3000              [::]:0                 ABHÖREN         4321',
    '  TCP    127.0.0.1:3000         127.0.0.1:52000        ESTABLISHED     4321',
    '  TCP    0.0.0.0:30000          0.0.0.0:0              LISTENING       999',
    '  UDP    0.0.0.0:3000           *:*                                    777',
  ].join('\r\n');
  assert.deepEqual(parseNetstat(out, 3000).map((l) => [l.pid, l.addresses[0]]), [[4321, '0.0.0.0:3000'], [4321, '[::]:3000']]);
});

test('parseTasklist reads the image name', () => {
  assert.equal(parseTasklist('"node.exe","4321","Console","1","45,000 K"\r\n'), 'node.exe');
  assert.equal(parseTasklist('INFO: No tasks are running which match the specified criteria.'), null);
});

test('darwin adapter uses lsof and reports when it is missing', async () => {
  const calls = [];
  const adapter = createDarwinAdapter({ run: async (cmd, args) => { calls.push([cmd, ...args]); return ok('p1\ncnode\nn*:3000\n'); } });
  assert.equal((await adapter.findListeners(3000))[0].pid, 1);
  assert.deepEqual(calls[0], ['lsof', '-nP', '-iTCP:3000', '-sTCP:LISTEN', '-Fpcn']);
  await assert.rejects(createDarwinAdapter({ run: async () => missing() }).findListeners(3000), /lsof/);
  // lsof exits 1 with no output when the port is empty.
  assert.deepEqual(await createDarwinAdapter({ run: async () => failed() }).findListeners(3000), []);
});

test('linux adapter falls back from ss to lsof, then reports missing tools', async () => {
  const adapter = createLinuxAdapter({ run: async (cmd) => (cmd === 'ss' ? missing() : ok('p7\ncnode\nn*:3000\n')) });
  assert.equal((await adapter.findListeners(3000))[0].pid, 7);
  await assert.rejects(createLinuxAdapter({ run: async () => missing() }).findListeners(3000), /ss or lsof/);
});

test('win32 adapter resolves names and maps taskkill failures', async () => {
  const run = async (cmd, args) => {
    if (cmd === 'netstat') return ok('  TCP    0.0.0.0:3000   0.0.0.0:0   LISTENING   55\n');
    if (cmd === 'tasklist') return ok('"node.exe","55","Console","1","1 K"');
    if (cmd === 'taskkill') return args.includes('/F') ? ok() : failed('', 'ERROR: Access is denied.');
    return missing();
  };
  const adapter = createWin32Adapter({ run });
  assert.deepEqual(await adapter.findListeners(3000), [{ pid: 55, name: 'node.exe', addresses: ['0.0.0.0:3000'] }]);
  assert.deepEqual(await adapter.killProcess(55), { ok: false, reason: 'permission' });
  assert.deepEqual(await adapter.killProcess(55, { force: true }), { ok: true });
  await assert.rejects(createWin32Adapter({ run: async () => missing() }).findListeners(3000), /netstat/);
});

test('killUnix sends SIGTERM by default and maps errors', () => {
  const sent = [];
  assert.deepEqual(killUnix(5, false, (pid, sig) => sent.push([pid, sig])), { ok: true });
  killUnix(5, true, (pid, sig) => sent.push([pid, sig]));
  assert.deepEqual(sent, [[5, 'SIGTERM'], [5, 'SIGKILL']]);
  const thrower = (code) => () => { throw Object.assign(new Error(code), { code }); };
  assert.equal(killUnix(5, false, thrower('EPERM')).reason, 'permission');
  assert.equal(killUnix(5, false, thrower('ESRCH')).reason, 'not-found');
});

test('getPlatformAdapter picks the right adapter', () => {
  assert.equal(getPlatformAdapter('win32').platform, 'win32');
  assert.equal(getPlatformAdapter('darwin').platform, 'darwin');
  assert.equal(getPlatformAdapter('linux').platform, 'linux');
  assert.equal(getPlatformAdapter('freebsd').platform, 'linux');
});
