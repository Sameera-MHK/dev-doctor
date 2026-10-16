import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProject, freePort, listen } from '../helpers.js';

const BIN = fileURLToPath(new URL('../../bin/dev-doctor.js', import.meta.url));
const SECRET = 'integration-secret-xyz';

/** Run the CLI non-interactively (stdin is not a TTY). */
function cli(args, cwd) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NO_COLOR: '1' }, timeout: 60000 }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
    child.stdin.end();
  });
}

test('--help and --version exit 0', async () => {
  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: dev-doctor/);
  const version = await cli(['--version']);
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('invalid input exits 2 with a message on stderr', async () => {
  const bad = await cli(['ports', '70000']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /Invalid port/);
  assert.equal(bad.stdout, '');
  assert.equal((await cli(['--unknown-flag'])).code, 2);
  assert.equal((await cli(['doctor', '--cwd', '/definitely/not/here'])).code, 2);
});

test('env --json is valid JSON, has no secrets and fails on missing keys', async () => {
  const root = makeProject({ '.env.example': 'A=\nB=\n', '.env': `A=${SECRET}\n`, '.gitignore': '.env' });
  const r = await cli(['env', '--json', '--cwd', root]);
  assert.equal(r.code, 0, 'B is optional: not referenced in code');
  const data = JSON.parse(r.stdout);
  assert.equal(data.tool, 'dev-doctor');
  assert.ok(data.results.some((x) => x.title.startsWith('B is listed')));
  assert.ok(!r.stdout.includes(SECRET));
});

test('CI exit codes follow failures and --fail-on', async () => {
  const broken = makeProject({ 'package.json': '{ nope' });
  assert.equal((await cli(['packages', '--ci', '--cwd', broken])).code, 1);

  const clean = makeProject({ 'package.json': { name: 'clean' } });
  const ok = await cli(['packages', '--ci', '--cwd', clean]);
  assert.equal(ok.code, 0, ok.stdout);
  assert.match(ok.stdout, /No lockfile found/);
  assert.equal((await cli(['packages', '--ci', '--fail-on', 'warn', '--cwd', clean])).code, 1);

  fs.writeFileSync(path.join(clean, '.dev-doctor.json'), JSON.stringify({ failOn: 'warn' }));
  assert.equal((await cli(['packages', '--ci', '--cwd', clean])).code, 1);
});

test('full doctor run produces parseable JSON', async () => {
  const root = makeProject({ 'package.json': { name: 'full' } });
  const r = await cli(['--json', '--ci', '--cwd', root]);
  const data = JSON.parse(r.stdout);
  assert.equal(data.project.name, 'full');
  const categories = new Set(data.results.map((x) => x.category));
  for (const c of ['Project', 'Node.js', 'Packages', 'Ports', 'Services']) assert.ok(categories.has(c), c);
});

test('fix --dry-run and non-interactive fix change nothing without --yes', async () => {
  const root = makeProject({ 'package.json': { name: 'f' }, '.env.example': 'TOKEN=\n' });
  const dry = await cli(['fix', '--dry-run', '--cwd', root]);
  assert.equal(dry.code, 0);
  assert.match(dry.stdout, /\.env file is missing/);
  assert.match(dry.stdout, /Dry run: no changes were made/);

  const refused = await cli(['fix', '--cwd', root]);
  assert.equal(refused.code, 1);
  assert.ok(!fs.existsSync(path.join(root, '.env')));

  const applied = await cli(['fix', '--yes', '--cwd', root]);
  assert.equal(applied.code, 0, applied.stdout);
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8').includes('TOKEN=\n'), true);
});

test('ports --kill on a free port does nothing and succeeds', async () => {
  const port = await freePort();
  const r = await cli(['ports', '--kill', String(port), '--json']);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).status, 'free');
});

test('non-interactive ports never prompts and --kill is refused without --yes', async () => {
  const { server, port } = await listen();
  try {
    const r = await cli(['ports', String(port)]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, new RegExp(`Port ${port} is (occupied|in use)`));
    assert.ok(!/What do you want to do|\?\s*$/.test(r.stdout));

    const kill = await cli(['ports', '--kill', String(port)]);
    assert.equal(kill.code, 1);
    // Either refused for lack of --yes, or because this test process is dev-doctor's parent.
    assert.match(kill.stdout, /--yes|Refusing|cannot be identified/);
    assert.equal(server.listening, true, 'the test server must still be running');
  } finally {
    server.close();
  }
});

test('invalid --pid exits 2', async () => {
  const r = await cli(['ports', '--kill', '3000', '--pid', '12abc']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Invalid process ID/);
});
