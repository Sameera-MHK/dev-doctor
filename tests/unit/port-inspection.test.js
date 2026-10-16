import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectPort, formatProcessDetails, projectAssociation, portResults } from '../../src/checks/ports.js';
import { redactCommandLine } from '../../src/utils/redact.js';
import { parsePs, describeUnixProcess, isRunningUnix } from '../../src/platform/unix.js';
import { darwinCwd, createDarwinAdapter } from '../../src/platform/darwin.js';
import { linuxCwd, createLinuxAdapter } from '../../src/platform/linux.js';
import { parseWin32Process, createWin32Adapter } from '../../src/platform/win32.js';
import { portsWorkflow } from '../../src/core/port-workflow.js';
import { ok, missing, failed } from '../helpers.js';

const errorWith = (code) => Object.assign(new Error(code), { code });

test('command-line secrets are redacted', () => {
  const cases = [
    ['node app.js --password=hunter2', 'node app.js --password=***'],
    ['node app.js --api-key abc123 --port 3000', 'node app.js --api-key *** --port 3000'],
    ['psql postgres://admin:s3cret@db:5432/app', 'psql postgres://***@db:5432/app'],
    ['env DB_PASSWORD=s3cret API_TOKEN="a b" node x.js', 'env DB_PASSWORD=*** API_TOKEN=*** node x.js'],
    ['curl -H Authorization: Bearer eyJhbGciOi.payload.sig', 'curl -H Authorization: Bearer ***'],
    ['node server.js --secret=\'x y\'', 'node server.js --secret=***'],
    ['vite --port 5173 --host', 'vite --port 5173 --host'],
  ];
  for (const [input, expected] of cases) assert.equal(redactCommandLine(input), expected);
  assert.equal(redactCommandLine(null), null);
});

test('project association uses cwd, then command line', () => {
  assert.equal(projectAssociation({ cwd: '/work/app' }, '/work/app'), 'current');
  assert.equal(projectAssociation({ cwd: '/work/app/packages/web' }, '/work/app'), 'current');
  assert.equal(projectAssociation({ cwd: '/work/other' }, '/work/app'), 'other');
  assert.equal(projectAssociation({ cwd: '/work/app-two' }, '/work/app'), 'other');
  assert.equal(projectAssociation({ command: 'node /work/app/server.js' }, '/work/app'), 'current');
  assert.equal(projectAssociation({ command: 'node server.js' }, '/work/app'), 'unknown');
  assert.equal(projectAssociation({ cwd: '/work/app' }, null), 'unknown');
});

test('inspectPort enriches listeners, redacts and associates', async () => {
  const adapter = {
    findListeners: async () => [{ pid: 10, name: 'node', addresses: ['*:3000'] }],
    describeProcess: async () => ({ exists: true, ppid: 9, user: 'me', command: 'node x.js --token=abc', cwd: '/proj', unavailable: {} }),
  };
  const i = await inspectPort(3000, { adapter, describe: true, projectRoot: '/proj' });
  assert.equal(i.listeners[0].command, 'node x.js --token=***');
  assert.equal(i.listeners[0].project, 'current');
  assert.equal(i.listeners[0].ppid, 9);
  const json = JSON.stringify(portResults([i]));
  assert.ok(!json.includes('abc'));
});

test('missing and permission-denied information is labelled, not invented', () => {
  const lines = formatProcessDetails(3000, {
    pid: 10, name: null, command: null, ppid: null, cwd: null, addresses: ['*:3000'], project: 'unknown',
    unavailable: { command: 'not accessible (permission denied)', cwd: 'permission denied' },
  }).join('\n');
  assert.match(lines, /Name:\s+unavailable\n/);
  assert.match(lines, /Command:\s+unavailable \(not accessible \(permission denied\)\)/);
  assert.match(lines, /Parent PID:\s+unavailable/);
  assert.match(lines, /Working directory:\s+unavailable \(permission denied\)/);
  assert.match(lines, /Project:\s+unknown/);
  assert.match(formatProcessDetails(3000, { pid: null, addresses: [] })[0], /not accessible/);
});

test('a process exiting during inspection is noted', async () => {
  const adapter = {
    findListeners: async () => [{ pid: 10, name: 'node', addresses: ['*:3000'] }],
    describeProcess: async () => ({ exists: false, ppid: null, user: null, command: null, cwd: null, unavailable: { command: 'process has exited' } }),
  };
  const i = await inspectPort(3000, { adapter, describe: true });
  assert.match(formatProcessDetails(3000, i.listeners[0]).join('\n'), /exited while it was being inspected/);
});

test('unix: ps parsing, missing ps, exited processes and isRunning', async () => {
  assert.deepEqual(parsePs(' 123 alice /usr/bin/node a.js\n'), { ppid: 123, user: 'alice', command: '/usr/bin/node a.js' });
  const calls = [];
  const d = await describeUnixProcess(42, { run: async (...a) => { calls.push(a); return ok('1 bob node\n'); }, getCwd: async () => ({ cwd: '/x' }) });
  assert.deepEqual(calls[0].slice(0, 2), ['ps', ['-o', 'ppid=,user=,command=', '-p', '42']]);
  assert.equal(d.cwd, '/x');
  const gone = await describeUnixProcess(42, { run: async () => failed(), getCwd: async () => ({ reason: 'x' }) });
  assert.equal(gone.exists, false);
  const noPs = await describeUnixProcess(42, { run: async () => missing(), getCwd: async () => ({ reason: 'permission denied' }) });
  assert.equal(noPs.unavailable.command, 'ps not found');
  assert.equal(noPs.unavailable.cwd, 'permission denied');

  assert.equal(isRunningUnix(5, () => true), true);
  assert.equal(isRunningUnix(5, () => { throw errorWith('EPERM'); }), true);
  assert.equal(isRunningUnix(5, () => { throw errorWith('ESRCH'); }), false);
});

test('macOS: cwd from lsof, permission denied when hidden', async () => {
  assert.deepEqual(await darwinCwd(5, async () => ok('p5\nfcwd\nn/Users/me/app\n')), { cwd: '/Users/me/app' });
  assert.match((await darwinCwd(5, async () => failed())).reason, /not accessible/);
  const adapter = createDarwinAdapter({ run: async (cmd) => (cmd === 'ps' ? ok('1 me node app.js') : ok('n/app\n')), kill: () => true });
  const d = await adapter.describeProcess(5);
  assert.equal(d.cwd, '/app');
  assert.equal(await adapter.isRunning(5), true);
});

test('Linux: cwd from /proc, permission denied and exited processes', async () => {
  assert.deepEqual(await linuxCwd(5, async (p) => (p === '/proc/5/cwd' ? '/srv/app' : '')), { cwd: '/srv/app' });
  assert.deepEqual(await linuxCwd(5, async () => { throw errorWith('EACCES'); }), { reason: 'permission denied' });
  assert.deepEqual(await linuxCwd(5, async () => { throw errorWith('ENOENT'); }), { reason: 'process has exited' });
  const adapter = createLinuxAdapter({ run: async () => ok('1 root nginx'), readlink: async () => { throw errorWith('EACCES'); } });
  const d = await adapter.describeProcess(5);
  assert.equal(d.user, 'root');
  assert.equal(d.unavailable.cwd, 'permission denied');
});

test('Windows: PowerShell receives the PID via env, never in the script', async () => {
  const calls = [];
  const run = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (cmd === 'powershell.exe') return ok('{"ProcessId":55,"ParentProcessId":4,"Name":"node.exe","CommandLine":"node.exe app.js --token=abc"}');
    if (cmd === 'tasklist') return ok('"node.exe","55","Console","1","1 K"');
    return missing();
  };
  const adapter = createWin32Adapter({ run });
  const d = await adapter.describeProcess(55);
  assert.equal(d.ppid, 4);
  assert.equal(d.command, 'node.exe app.js --token=abc', 'redaction happens in inspectPort');
  assert.equal(d.unavailable.cwd, 'not available on Windows');
  assert.equal(calls[0].opts.env.DEV_DOCTOR_PID, '55');
  assert.ok(!calls[0].args.join(' ').includes('55'));
  assert.equal(await adapter.isRunning(55), true);

  assert.equal(parseWin32Process(''), null);
  assert.equal(parseWin32Process('{"ProcessId":1,"ParentProcessId":0,"Name":"x","CommandLine":null}').command, null);
  const denied = createWin32Adapter({ run: async () => ok('{"ProcessId":9,"ParentProcessId":1,"Name":"svc.exe","CommandLine":null}') });
  assert.match((await denied.describeProcess(9)).unavailable.command, /permission denied/);
  const gone = createWin32Adapter({ run: async () => ok('') });
  assert.equal((await gone.describeProcess(9)).exists, false);
  const noShell = createWin32Adapter({ run: async () => missing() });
  assert.equal((await noShell.describeProcess(9)).unavailable.command, 'PowerShell not found');
});

const inspection = (port, ...pids) => ({ port, state: 'in-use', listeners: pids.map((pid) => ({ pid, name: 'node', addresses: [`*:${port}`] })) });

test('workflow: single process, inspect then skip', async () => {
  const answers = ['inspect', 'skip'];
  const logged = [];
  let terminated = false;
  const r = await portsWorkflow([inspection(3000, 10)], {
    select: async () => answers.shift(),
    log: (t) => logged.push(t),
    terminate: async () => { terminated = true; },
  });
  assert.equal(r, null);
  assert.equal(terminated, false);
  assert.match(logged[0], /PID:\s+10/);
});

test('workflow: several processes, choose one, stop it with its exact PID', async () => {
  const prompts = [];
  const select = async (message, choices) => {
    prompts.push(choices.map((c) => c.name));
    return prompts.length === 1 ? choices[1].value : 'stop';
  };
  let args;
  const r = await portsWorkflow([inspection(3000, 10), inspection(5173, 20)], {
    select, log: () => {}, terminate: async (port, pid) => { args = [port, pid]; return { status: 'released', message: 'ok' }; },
  });
  assert.deepEqual(args, [5173, 20]);
  assert.equal(r.status, 'released');
  assert.ok(prompts[0].includes('Skip'));
  assert.deepEqual(prompts[1], ['Inspect process', 'Stop process', 'Skip']);
});

test('workflow: skip at selection, and no prompts when nothing is identifiable', async () => {
  assert.equal(await portsWorkflow([inspection(3000, 10), inspection(3001, 11)], { select: async () => null, log: () => {}, terminate: async () => assert.fail() }), null);
  const noPrompt = async () => assert.fail('must not prompt');
  assert.equal(await portsWorkflow([{ port: 1, state: 'free', listeners: [] }, inspection(2, null)], { select: noPrompt, log: () => {}, terminate: noPrompt }), null);
});
