import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

/** Create a temporary project directory with the given files ({ 'path': 'content' }). */
export function makeProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-doctor-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

// Built from parts so dev-doctor's own env scan does not treat test strings as real references.
export const envRef = (key) => ['process', 'env', key].join('.');
export const metaRef = (key) => ['import', 'meta', 'env', key].join('.');

/** Listen on a random free port on 127.0.0.1. */
export function listen() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

export async function freePort() {
  const { server, port } = await listen();
  await new Promise((r) => server.close(r));
  return port;
}

export const ok = (stdout = '') => ({ ok: true, code: 0, stdout, stderr: '', missing: false, timedOut: false });
export const missing = () => ({ ok: false, code: null, stdout: '', stderr: '', missing: true, timedOut: false });
export const failed = (stdout = '', stderr = '') => ({ ok: false, code: 1, stdout, stderr, missing: false, timedOut: false });
