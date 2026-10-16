import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collectFixes } from '../../src/fixes/index.js';
import { checkEnvironment } from '../../src/checks/environment.js';
import { formatFix } from '../../src/commands/fix.js';
import { safeProjectPath } from '../../src/utils/paths.js';
import { makeProject } from '../helpers.js';

test('create-env fix previews key names only and never overwrites', async () => {
  const root = makeProject({ '.env.example': 'API_KEY=example-secret\nDB_URL=postgres://x\n' });
  const [fix] = collectFixes(await checkEnvironment(root, { env: {} }), root);
  assert.equal(fix.id, 'create-env');
  assert.equal(fix.modifiesFiles, true);
  assert.equal(fix.terminatesProcess, false);
  assert.ok(fix.preview.includes('API_KEY=\n'));
  assert.ok(!fix.preview.includes('example-secret'));

  const text = formatFix(fix, 0);
  for (const label of ['Why it matters', 'Proposed change', 'Modifies files:  yes', 'Terminates a process: no', 'Expected outcome', 'Preview']) {
    assert.ok(text.includes(label), label);
  }
  assert.ok(!fs.existsSync(path.join(root, '.env')), 'preview must not write');

  assert.equal((await fix.apply()).ok, true);
  assert.equal((await fix.verify()).ok, true);
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=mine\n');
  assert.equal((await fix.apply()).ok, false);
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'API_KEY=mine\n');
});

test('gitignore fix appends .env and verifies', async () => {
  const root = makeProject({ '.env': 'A=1', '.gitignore': 'node_modules' });
  const fix = collectFixes(await checkEnvironment(root, { env: {} }), root).find((f) => f.id === 'gitignore-env');
  await fix.apply();
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'node_modules\n.env\n');
  assert.equal((await fix.verify()).ok, true);
});

test('kill-port fix is marked as terminating a process', () => {
  const [fix] = collectFixes([{ title: 'Port 3000 is occupied', fixId: 'kill-port', fixData: { port: 3000 } }], '/tmp');
  assert.equal(fix.terminatesProcess, true);
  assert.equal(fix.modifiesFiles, false);
});

test('writes outside the project are refused', () => {
  assert.throws(() => safeProjectPath('/tmp/project', '../etc/passwd'), /outside the project/);
  assert.throws(() => safeProjectPath('/tmp/project', '/etc/passwd'), /outside the project/);
  assert.equal(safeProjectPath('/tmp/project', '.env'), path.resolve('/tmp/project/.env'));
});
