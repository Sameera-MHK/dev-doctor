import fs from 'node:fs';
import { safeProjectPath, readTextIfExists } from '../utils/paths.js';
import { checkEnvironment, isEnvGitignored } from '../checks/environment.js';
import { inspectPort } from '../checks/ports.js';
import { terminatePortProcess } from '../core/terminate.js';

/**
 * Build the fixes offered for a set of diagnostic results.
 * Each fix: { id, problem, why, change, preview, modifiesFiles, terminatesProcess, expected, apply(ctx), verify(ctx) }.
 * apply returns { ok, message }; verify returns { ok, message }.
 */
export function collectFixes(results, root) {
  const fixes = [];
  for (const r of results) {
    if (r.fixId === 'create-env') fixes.push(createEnvFix(r, root));
    else if (r.fixId === 'gitignore-env') fixes.push(gitignoreFix(r, root));
    else if (r.fixId === 'kill-port') fixes.push(killPortFix(r));
  }
  return fixes;
}

function createEnvFix(r, root) {
  const { template, keys } = r.fixData;
  // Keys only, with empty values: never copy template values or invent credentials.
  const content = `# Created by dev-doctor from ${template}. Fill in your own values.\n${keys.map((k) => `${k}=`).join('\n')}\n`;
  return {
    id: 'create-env',
    problem: r.title,
    why: 'Tools such as dotenv, Vite and Next.js load variables from .env; without it the app may fail to start.',
    change: `Create .env with the ${keys.length} key names from ${template}, all with empty values`,
    preview: content,
    modifiesFiles: true,
    terminatesProcess: false,
    expected: '.env exists and lists every expected key; you still need to fill in the values',
    async apply() {
      const file = safeProjectPath(root, '.env');
      try {
        fs.writeFileSync(file, content, { flag: 'wx' }); // 'wx' fails if .env already exists: never overwrite.
      } catch (error) {
        if (error.code === 'EEXIST') return { ok: false, message: '.env already exists; it was not modified' };
        throw error;
      }
      return { ok: true, message: 'Created .env' };
    },
    async verify() {
      const results = await checkEnvironment(root);
      const stillMissing = results.some((x) => x.fixId === 'create-env');
      return stillMissing ? { ok: false, message: '.env is still missing' } : { ok: true, message: '.env now exists' };
    },
  };
}

function gitignoreFix(r, root) {
  return {
    id: 'gitignore-env',
    problem: r.title,
    why: 'Without a .gitignore entry, secrets in .env can be committed and pushed by accident.',
    change: 'Append ".env" to .gitignore (created if missing)',
    preview: '+ .env\n',
    modifiesFiles: true,
    terminatesProcess: false,
    expected: 'git ignores .env (files already committed still need "git rm --cached .env")',
    async apply() {
      const file = safeProjectPath(root, '.gitignore');
      const current = readTextIfExists(file) ?? '';
      const prefix = current && !current.endsWith('\n') ? '\n' : '';
      fs.appendFileSync(file, `${prefix}.env\n`);
      return { ok: true, message: 'Added .env to .gitignore' };
    },
    async verify() {
      const ok = isEnvGitignored(readTextIfExists(safeProjectPath(root, '.gitignore')));
      return { ok, message: ok ? '.env is listed in .gitignore' : '.env is still not ignored' };
    },
  };
}

function killPortFix(r) {
  const { port } = r.fixData;
  return {
    id: 'kill-port',
    problem: r.title,
    why: `Your dev server cannot start on port ${port} while another process is listening on it.`,
    change: `Ask the process on port ${port} to stop (graceful first; force only if you confirm)`,
    preview: null,
    modifiesFiles: false,
    terminatesProcess: true,
    expected: `Port ${port} becomes available`,
    async apply(ctx) {
      const outcome = await terminatePortProcess(port, ctx);
      return { ok: outcome.status === 'released' || outcome.status === 'free', message: outcome.message };
    },
    async verify(ctx) {
      const i = await inspectPort(port, ctx);
      return { ok: i.state === 'free', message: i.state === 'free' ? `Port ${port} is free` : `Port ${port} is still in use` };
    },
  };
}
