import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnvironment, scanEnvReferences, findReferences, isEnvGitignored } from '../../src/checks/environment.js';
import { formatHuman, toJson } from '../../src/core/reporter.js';
import { makeProject, envRef, metaRef } from '../helpers.js';

const SECRET = 'super-secret-value-123';
const opts = { env: {} };
const titles = (results) => results.map((r) => `${r.status} ${r.title}`);

test('missing .env fails and offers a fix', async () => {
  const root = makeProject({ '.env.example': 'A=\nB=' });
  const r = (await checkEnvironment(root, opts)).find((x) => x.fixId === 'create-env');
  assert.equal(r.status, 'fail');
  assert.deepEqual(r.fixData.keys, ['A', 'B']);
});

test('missing keys: fail when referenced in code, warn otherwise; extra keys warn', async () => {
  const root = makeProject({
    '.env.example': 'DATABASE_URL=\nOPTIONAL_FLAG=\n',
    '.env': `EXTRA=${SECRET}\n`,
    '.gitignore': '.env\n',
    'src/db.js': `const url = ${envRef('DATABASE_URL')};`,
  });
  const t = titles(await checkEnvironment(root, opts));
  assert.ok(t.includes('fail DATABASE_URL is missing'));
  assert.ok(t.includes('warn OPTIONAL_FLAG is listed in .env.example but not set (may be optional)'));
  assert.ok(t.includes('warn EXTRA is not documented in .env.example'));
});

test('keys set in the process environment count as set', async () => {
  const root = makeProject({ '.env.example': 'TOKEN=', '.env': '', '.gitignore': '.env' });
  const results = await checkEnvironment(root, { env: { TOKEN: 'x' } });
  assert.equal(results.find((r) => r.status === 'pass').title, 'All keys from .env.example are set');
});

test('detects process.env, bracket and import.meta.env references', () => {
  const bracket = (key, q) => ['process', '.env[', q, key, q, ']'].join('');
  const keys = findReferences(`${envRef('A')}; ${bracket('B', "'")}; ${bracket('C', '"')}; ${metaRef('VITE_D')};`);
  assert.deepEqual([...keys].sort(), ['A', 'B', 'C', 'VITE_D']);
});

test('reference scan skips node_modules, build output, .git and gitignored dirs', async () => {
  const root = makeProject({
    'src/a.ts': envRef('KEEP'),
    'node_modules/x/index.js': envRef('NM'),
    'dist/out.js': envRef('DIST'),
    '.git/hooks/x.js': envRef('GIT'),
    'generated/y.js': envRef('GEN'),
  });
  const { references } = await scanEnvReferences(root, { ignoredNames: new Set(['generated']) });
  assert.deepEqual([...references.keys()], ['KEEP']);
});

test('undefined code references are labelled with their source', async () => {
  const root = makeProject({ 'src/api.js': envRef('API_BASE_URL') + envRef('NODE_ENV') });
  const r = (await checkEnvironment(root, opts)).find((x) => /API_BASE_URL/.test(x.title));
  assert.equal(r.status, 'warn');
  assert.deepEqual(r.details, ['Referenced in src/api.js']);
  assert.ok(!(await checkEnvironment(root, opts)).some((x) => /NODE_ENV/.test(x.title)));
});

test('.env not in .gitignore warns with a fix', async () => {
  const root = makeProject({ '.env': 'A=1' });
  assert.ok((await checkEnvironment(root, opts)).some((r) => r.fixId === 'gitignore-env'));
  assert.equal(isEnvGitignored('node_modules\n.env*\n'), true);
});

test('ambiguous lines are reported, not guessed', async () => {
  const root = makeProject({ '.env': `GOOD=1\nthis is broken ${SECRET}\n`, '.gitignore': '.env' });
  const r = (await checkEnvironment(root, opts)).find((x) => /line 2/.test(x.title));
  assert.equal(r.status, 'warn');
});

test('secret values never appear in human or JSON output', async () => {
  const root = makeProject({
    '.env.example': 'DB=\nAPI_KEY=example-value\n',
    '.env': `DB=postgres://user:${SECRET}@localhost/db\nAPI_KEY=${SECRET}\nOTHER="${SECRET}"\nbroken ${SECRET}`,
    'src/x.js': envRef('MISSING_ONE'),
  });
  const report = { project: { name: 'x', type: 'Node.js', root }, results: await checkEnvironment(root, opts) };
  const human = formatHuman(report, { verbose: true });
  const json = toJson(report, { version: '0.0.0' });
  assert.ok(!human.includes(SECRET));
  assert.ok(!json.includes(SECRET));
  assert.ok(!json.includes('example-value'));
});
