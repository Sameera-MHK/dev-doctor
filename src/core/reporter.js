import { Chalk } from 'chalk';
import { STATUS, summarize } from './diagnostics.js';
import { redact } from '../utils/redact.js';

export { redact };

const LABELS = { [STATUS.PASS]: 'PASS', [STATUS.WARN]: 'WARN', [STATUS.FAIL]: 'FAIL', [STATUS.INFO]: 'INFO' };

export function colorEnabled({ color = true, stream = process.stdout, env = process.env } = {}) {
  if (!color || 'NO_COLOR' in env) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') return true;
  return Boolean(stream.isTTY);
}

export function formatHuman(report, { verbose = false, color = false } = {}) {
  const c = new Chalk({ level: color ? 1 : 0 });
  const paint = { pass: c.green, warn: c.yellow, fail: c.red, info: c.cyan };
  const lines = [c.bold('Dev Doctor')];
  if (report.project) lines.push(`Project: ${report.project.name}${report.project.type !== 'Unknown' ? ` (${report.project.type})` : ''}`);

  const categories = [...new Set(report.results.map((r) => r.category))];
  for (const category of categories) {
    lines.push('', c.bold(category));
    for (const r of report.results.filter((x) => x.category === category)) {
      lines.push(`  ${paint[r.status](LABELS[r.status].padEnd(4))}  ${redact(r.title)}`);
      const showDetails = verbose || r.status === STATUS.FAIL;
      if (showDetails) for (const d of r.details ?? []) lines.push(c.dim(`        ${redact(d)}`));
    }
  }

  const s = summarize(report.results);
  lines.push('', c.bold('Summary'), `  ${s.fail} error${s.fail === 1 ? '' : 's'}, ${s.warn} warning${s.warn === 1 ? '' : 's'}, ${s.pass} passed`);

  const steps = [...new Set(report.results.filter((r) => r.hint && (r.status === STATUS.FAIL || r.status === STATUS.WARN)).map((r) => r.hint))];
  if (steps.length > 0) {
    lines.push('', c.bold('Recommended next steps:'));
    steps.forEach((step, i) => lines.push(`  ${i + 1}. ${redact(step)}`));
  }
  return lines.join('\n') + '\n';
}

export function toJson(report, { version } = {}) {
  const results = report.results.map(({ category, status, title, details, hint, fixId, data }) => ({
    category, status, title, details: details ?? [], hint: hint ?? null, fixAvailable: Boolean(fixId), ...(data ? { data } : {}),
  }));
  const payload = {
    tool: 'dev-doctor',
    version,
    project: report.project ? { name: report.project.name, type: report.project.type, root: report.project.root } : null,
    summary: summarize(report.results),
    results,
  };
  return redact(JSON.stringify(payload, null, 2)) + '\n';
}
