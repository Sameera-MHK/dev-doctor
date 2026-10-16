import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatHuman, toJson, redact, colorEnabled } from '../../src/core/reporter.js';
import { result } from '../../src/core/diagnostics.js';

const report = {
  project: { name: 'demo', type: 'Vite', root: '/tmp/demo' },
  results: [
    result('Ports', 'fail', 'Port 3000 is occupied by node (PID 1)', { details: ['PID 1 node'], hint: 'Stop it.', fixId: 'kill-port', fixData: { port: 3000 } }),
    result('Ports', 'pass', 'Port 5173 is available'),
    result('Environment variables', 'warn', 'X is not documented', { details: ['Defined in .env'], hint: 'Document X.' }),
  ],
};

test('human output has statuses, summary and next steps without colors', () => {
  const text = formatHuman(report, { color: false });
  assert.match(text, /Project: demo \(Vite\)/);
  assert.match(text, /FAIL {2}Port 3000 is occupied/);
  assert.match(text, /1 error, 1 warning, 1 passed/);
  assert.match(text, /1\. Stop it\.\n {2}2\. Document X\./);
  assert.ok(!text.includes('\u001b['));
  assert.ok(!text.includes('Defined in .env'), 'warning details only in verbose');
  assert.ok(formatHuman(report, { verbose: true }).includes('Defined in .env'));
});

test('JSON output parses and contains no internal fix data', () => {
  const data = JSON.parse(toJson(report, { version: '1.2.3' }));
  assert.equal(data.version, '1.2.3');
  assert.deepEqual(data.summary, { pass: 1, warn: 1, fail: 1, info: 0 });
  assert.equal(data.results[0].fixAvailable, true);
  assert.equal(data.results[0].fixData, undefined);
});

test('redact masks URL credentials', () => {
  assert.equal(redact('postgres://user:pw@host/db and redis://:pw@x'), 'postgres://***@host/db and redis://***@x');
});

test('colors are disabled for pipes and NO_COLOR', () => {
  assert.equal(colorEnabled({ stream: { isTTY: false }, env: {} }), false);
  assert.equal(colorEnabled({ stream: { isTTY: true }, env: { NO_COLOR: '' } }), false);
  assert.equal(colorEnabled({ stream: { isTTY: true }, env: {} }), true);
  assert.equal(colorEnabled({ color: false, stream: { isTTY: true }, env: {} }), false);
});
