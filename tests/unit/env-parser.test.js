import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../../src/utils/env-parser.js';

test('parses keys, comments, empty and quoted values', () => {
  const { entries, issues } = parseEnv([
    '# comment',
    '',
    'A=1',
    'export B="two words"',
    "C='single # not a comment'",
    'D=',
    'E=value # inline comment',
    'F = spaced ',
  ].join('\n'));
  assert.deepEqual(issues, []);
  assert.equal(entries.get('A').value, '1');
  assert.equal(entries.get('B').value, 'two words');
  assert.equal(entries.get('C').value, 'single # not a comment');
  assert.equal(entries.get('D').value, '');
  assert.equal(entries.get('E').value, 'value');
  assert.equal(entries.get('F').value, 'spaced');
});

test('handles multi-line quoted values and Windows line endings', () => {
  const { entries, issues } = parseEnv('KEY="line1\r\nline2"\r\nNEXT=1\r\n');
  assert.deepEqual(issues, []);
  assert.equal(entries.get('KEY').value, 'line1\nline2');
  assert.equal(entries.get('NEXT').value, '1');
});

test('reports unparseable lines and unterminated quotes without content', () => {
  const { entries, issues } = parseEnv('not a valid line secretvalue\nOPEN="never closed\nX=1');
  assert.equal(entries.has('OPEN'), false);
  assert.equal(issues.length, 2);
  for (const issue of issues) assert.ok(!issue.message.includes('secretvalue'));
});

test('reports duplicate keys', () => {
  const { issues } = parseEnv('A=1\nA=2');
  assert.match(issues[0].message, /more than once/);
});
