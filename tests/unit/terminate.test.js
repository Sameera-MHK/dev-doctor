import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { terminatePortProcess, killSafetyReason, parsePid } from '../../src/core/terminate.js';
import { getPlatformAdapter } from '../../src/platform/index.js';

/**
 * A fake OS: processes that may listen on port 3000. Nothing real is ever signalled.
 * procs: [{ pid, name, ignoresTerm, inaccessible }]; onExit(pid, model) can simulate another process taking the port.
 */
function fakeSystem(procs, { killResult, onExit } = {}) {
  const model = new Map(procs.map((p) => [p.pid, { running: true, ...p }]));
  const kills = [];
  const listeners = () => [...model.values()].filter((p) => p.running).map((p) => ({ pid: p.inaccessible ? null : p.pid, name: p.name, addresses: ['*:3000'] }));
  const adapter = {
    findListeners: async () => listeners(),
    describeProcess: async (pid) => ({ exists: model.get(pid)?.running ?? false, ppid: 1, user: 'me', command: `${model.get(pid)?.name} --token=hunter2`, cwd: null, unavailable: { cwd: 'permission denied' } }),
    isRunning: async (pid) => model.get(pid)?.running ?? false,
    killProcess: async (pid, { force }) => {
      kills.push({ pid, force });
      if (killResult) return killResult;
      const p = model.get(pid);
      if (!p || !p.running) return { ok: false, reason: 'not-found' };
      if (force || !p.ignoresTerm) {
        p.running = false;
        onExit?.(pid, model);
      }
      return { ok: true };
    },
  };
  return { model, kills, adapter, bind: async () => (listeners().length > 0 ? 'in-use' : 'free') };
}

const base = { waitMs: 50, confirm: async () => true, choose: async (t) => t[0], safety: { currentPid: 1, parentPid: 2 } };
const node = (pid = 4242, extra = {}) => ({ pid, name: 'node', ...extra });

test('parsePid validates process identifiers', () => {
  assert.equal(parsePid('123'), 123);
  for (const bad of ['0', '-1', 'abc', '1.5', '12; rm -rf /', '', '99999999999']) assert.throws(() => parsePid(bad), /Invalid process ID/);
});

test('invalid ports are rejected before anything else happens', async () => {
  const sys = fakeSystem([node()]);
  await assert.rejects(terminatePortProcess('70000', { ...base, ...sys, interactive: false, yes: true }), /Invalid port/);
  assert.equal(sys.kills.length, 0);
});

test('safety rules refuse self, parent, low PIDs and system processes', () => {
  assert.match(killSafetyReason({ pid: 100, name: 'node' }, { currentPid: 100, parentPid: 1 }), /dev-doctor itself/);
  assert.match(killSafetyReason({ pid: 100, name: 'zsh' }, { currentPid: 1, parentPid: 100 }), /started dev-doctor/);
  assert.match(killSafetyReason({ pid: 1, name: 'launchd' }), /system process/);
  assert.match(killSafetyReason({ pid: 900, name: 'svchost.exe' }), /protected/);
  assert.equal(killSafetyReason({ pid: 900, name: 'node' }, { currentPid: 1, parentPid: 2 }), null);
});

test('dev-doctor never stops itself', async () => {
  const sys = fakeSystem([node(process.pid)]);
  const r = await terminatePortProcess(3000, { ...base, ...sys, safety: undefined, interactive: false, yes: true });
  assert.equal(r.status, 'refused');
  assert.equal(sys.kills.length, 0);
});

test('free port: nothing to do', async () => {
  const sys = fakeSystem([]);
  assert.equal((await terminatePortProcess(3000, { ...base, ...sys, interactive: false, yes: true })).status, 'free');
});

test('non-interactive execution is refused without --yes', async () => {
  const sys = fakeSystem([node()]);
  const r = await terminatePortProcess(3000, { ...base, ...sys, interactive: false });
  assert.equal(r.status, 'refused');
  assert.match(r.message, /--yes/);
  assert.equal(sys.kills.length, 0);
});

test('user cancellation terminates nothing; details are shown before asking', async () => {
  const sys = fakeSystem([node()]);
  const logged = [];
  const r = await terminatePortProcess(3000, { ...base, ...sys, interactive: true, confirm: async () => false, log: (t) => logged.push(t) });
  assert.equal(r.status, 'cancelled');
  assert.equal(sys.kills.length, 0);
  assert.match(logged[0], /PID:\s+4242/);
  assert.match(logged[0], /--token=\*\*\*/);
  assert.ok(!logged[0].includes('hunter2'));
});

test('graceful termination releases the port and is verified', async () => {
  const sys = fakeSystem([node()]);
  const r = await terminatePortProcess(3000, { ...base, ...sys, interactive: false, yes: true });
  assert.equal(r.status, 'released');
  assert.match(r.message, /verified/);
  assert.deepEqual(sys.kills, [{ pid: 4242, force: false }]);
});

test('a process that stays alive is not force killed without explicit consent', async () => {
  const sys = fakeSystem([node(4242, { ignoresTerm: true })]);
  const r = await terminatePortProcess(3000, { ...base, ...sys, interactive: false, yes: true });
  assert.equal(r.status, 'failed');
  assert.match(r.message, /still running.*--force/);
  assert.deepEqual(sys.kills, [{ pid: 4242, force: false }]);

  const asked = [];
  const sys2 = fakeSystem([node(4242, { ignoresTerm: true })]);
  const confirm = async (msg) => { asked.push(msg); return asked.length === 1; }; // yes to stop, no to force
  const r2 = await terminatePortProcess(3000, { ...base, ...sys2, interactive: true, confirm });
  assert.equal(r2.status, 'failed');
  assert.match(asked[1], /still running after a graceful stop request\. Force terminate/);
  assert.deepEqual(sys2.kills, [{ pid: 4242, force: false }]);
});

test('explicit force termination (--force or a second confirmation)', async () => {
  const sys = fakeSystem([node(4242, { ignoresTerm: true })]);
  const r = await terminatePortProcess(3000, { ...base, ...sys, interactive: false, yes: true, force: true });
  assert.equal(r.status, 'released');
  assert.match(r.message, /Force terminated/);
  assert.deepEqual(sys.kills, [{ pid: 4242, force: false }, { pid: 4242, force: true }]);

  const sys2 = fakeSystem([node(4242, { ignoresTerm: true })]);
  assert.equal((await terminatePortProcess(3000, { ...base, ...sys2, interactive: true, confirm: async () => true })).status, 'released');
});

test('Windows console process: graceful stop unsupported, force stays a separate explicit step', async () => {
  const sys = fakeSystem([node()]);
  const realKill = sys.adapter.killProcess;
  sys.adapter.killProcess = async (pid, opts) => (opts.force ? realKill(pid, opts) : (sys.kills.push({ pid, force: false }), { ok: false, reason: 'graceful-unsupported' }));
  const r = await terminatePortProcess(3000, { ...base, ...sys, interactive: false, yes: true });
  assert.equal(r.status, 'failed');
  assert.match(r.message, /cannot be stopped gracefully.*--force/);
  assert.deepEqual(sys.kills, [{ pid: 4242, force: false }]);

  const sys2 = fakeSystem([node()]);
  const realKill2 = sys2.adapter.killProcess;
  sys2.adapter.killProcess = async (pid, opts) => (opts.force ? realKill2(pid, opts) : { ok: false, reason: 'graceful-unsupported' });
  assert.equal((await terminatePortProcess(3000, { ...base, ...sys2, interactive: false, yes: true, force: true })).status, 'released');
});

test('process exits before termination (while the user is confirming)', async () => {
  const sys = fakeSystem([node()]);
  const confirm = async () => { sys.model.get(4242).running = false; return true; };
  const r = await terminatePortProcess(3000, { ...base, ...sys, interactive: true, confirm });
  assert.equal(r.status, 'free');
  assert.match(r.message, /exited before it was stopped/);
  assert.equal(sys.kills.length, 0);
});

test('port taken over by another process during confirmation: nothing is terminated', async () => {
  const sys = fakeSystem([node()]);
  const confirm = async () => {
    sys.model.get(4242).running = false;
    sys.model.set(5555, { pid: 5555, name: 'python', running: true });
    return true;
  };
  const r = await terminatePortProcess(3000, { ...base, ...sys, interactive: true, confirm });
  assert.equal(r.status, 'refused');
  assert.match(r.message, /python \(PID 5555\)/);
  assert.equal(sys.kills.length, 0);
});

test('process already gone when signalled is handled', async () => {
  const sys = fakeSystem([node()], { killResult: { ok: false, reason: 'not-found' } });
  sys.adapter.isRunning = async () => false;
  const realFind = sys.adapter.findListeners;
  let calls = 0;
  sys.adapter.findListeners = async () => (++calls > 2 ? [] : realFind());
  const r = await terminatePortProcess(3000, { ...base, ...sys, bind: async () => (calls > 2 ? 'free' : 'in-use'), interactive: false, yes: true });
  assert.equal(r.status, 'released');
  assert.match(r.message, /already exited/);
});

test('port remains occupied after the target exits', async () => {
  const sys = fakeSystem([node()], {
    onExit: (pid, model) => model.set(777, { pid: 777, name: 'other', running: true }),
  });
  const r = await terminatePortProcess(3000, { ...base, ...sys, interactive: false, yes: true, force: true });
  assert.equal(r.status, 'failed');
  assert.match(r.message, /exited, but port 3000 is still in use by other \(PID 777\)/);
  assert.deepEqual(sys.kills, [{ pid: 4242, force: false }], 'the new process must not be touched');
});

test('permission failures are reported without escalation', async () => {
  const sys = fakeSystem([node()], { killResult: { ok: false, reason: 'permission' } });
  const r = await terminatePortProcess(3000, { ...base, ...sys, interactive: false, yes: true });
  assert.equal(r.status, 'failed');
  assert.match(r.message, /Permission denied.*sudo/);
});

test('multiple listener candidates require an unambiguous target', async () => {
  const procs = () => [node(501), { pid: 502, name: 'python' }];
  const sys = fakeSystem(procs());
  const r = await terminatePortProcess(3000, { ...base, ...sys, interactive: false, yes: true });
  assert.equal(r.status, 'refused');
  assert.match(r.message, /2 processes.*--pid/);
  assert.equal(sys.kills.length, 0);

  const byPid = fakeSystem(procs());
  const r2 = await terminatePortProcess(3000, { ...base, ...byPid, pid: 502, interactive: false, yes: true });
  assert.equal(r2.status, 'failed', 'port still held by 501, so not released');
  assert.deepEqual(byPid.kills, [{ pid: 502, force: false }]);

  const wrongPid = fakeSystem(procs());
  assert.equal((await terminatePortProcess(3000, { ...base, ...wrongPid, pid: 999, interactive: false, yes: true })).status, 'refused');
  assert.equal(wrongPid.kills.length, 0);

  const chosen = fakeSystem(procs());
  await terminatePortProcess(3000, { ...base, ...chosen, interactive: true, choose: async (t) => t[1] });
  assert.deepEqual(chosen.kills, [{ pid: 502, force: false }]);

  const none = fakeSystem(procs());
  assert.equal((await terminatePortProcess(3000, { ...base, ...none, interactive: true, choose: async () => null })).status, 'cancelled');
});

test('an inaccessible listener on the port makes the target unreliable: refused', async () => {
  const sys = fakeSystem([node(), { pid: 600, name: 'hidden', inaccessible: true }]);
  const r = await terminatePortProcess(3000, { ...base, ...sys, interactive: false, yes: true });
  assert.equal(r.status, 'refused');
  assert.match(r.message, /cannot be identified reliably/);
  assert.equal(sys.kills.length, 0);
});

test('protected processes are never terminated', async () => {
  const sys = fakeSystem([{ pid: 900, name: 'explorer.exe' }]);
  assert.equal((await terminatePortProcess(3000, { ...base, ...sys, interactive: false, yes: true })).status, 'refused');
  assert.equal(sys.kills.length, 0);
});

test('stops a controlled child process and verifies the port is released', async () => {
  const child = spawn(process.execPath, ['-e', `
    const s = require('net').createServer().listen(0, '127.0.0.1', () => console.log(s.address().port));
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    // Output can arrive in several chunks; wait for a complete line holding the port number.
    let output = '';
    while (!/^\d+\r?\n/m.test(output)) {
      const [chunk] = await once(child.stdout, 'data');
      output += chunk;
    }
    const port = Number(/^(\d+)\r?\n/m.exec(output)[1]);
    const r = await terminatePortProcess(port, { ...base, adapter: getPlatformAdapter(), safety: undefined, pid: child.pid, interactive: false, yes: true, force: true, waitMs: 5000 });
    // If the OS tools cannot see the owner, dev-doctor must refuse rather than guess.
    assert.ok(['released', 'refused'].includes(r.status), r.message);
    if (r.status === 'released') assert.match(r.message, /verified/);
  } finally {
    child.kill('SIGKILL');
  }
});
