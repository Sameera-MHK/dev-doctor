const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;

/**
 * Parse dotenv-style text. Returns entries (key -> { value, line }) and issues.
 * Issues only contain line numbers and messages, never file content.
 */
export function parseEnv(text) {
  const entries = new Map();
  const issues = [];
  const lines = String(text).split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;
    line = line.replace(/^export\s+/, '');

    const match = KEY_LINE.exec(line);
    if (!match) {
      issues.push({ line: lineNo, message: 'line could not be parsed as KEY=value' });
      continue;
    }
    const key = match[1];
    let raw = match[2];
    let value;

    const quote = raw[0];
    if (quote === '"' || quote === "'" || quote === '`') {
      let end = raw.indexOf(quote, 1);
      if (end !== -1) {
        value = raw.slice(1, end);
      } else {
        // Multi-line quoted value: read until the closing quote.
        const parts = [raw.slice(1)];
        let closed = false;
        while (i + 1 < lines.length) {
          i++;
          const next = lines[i];
          end = next.indexOf(quote);
          if (end !== -1) {
            parts.push(next.slice(0, end));
            closed = true;
            break;
          }
          parts.push(next);
        }
        if (!closed) {
          issues.push({ line: lineNo, message: `unterminated quoted value for ${key}` });
          continue;
        }
        value = parts.join('\n');
      }
    } else {
      const comment = raw.search(/\s#/);
      if (comment !== -1) raw = raw.slice(0, comment);
      value = raw.trim();
    }

    if (entries.has(key)) issues.push({ line: lineNo, message: `${key} is defined more than once` });
    entries.set(key, { value, line: lineNo });
  }

  return { entries, issues };
}
