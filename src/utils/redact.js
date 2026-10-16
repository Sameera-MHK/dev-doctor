const SECRET_WORDS = 'password|passwd|pwd|token|secret|api[-_]?key|apikey|auth|credential|access[-_]?key|private[-_]?key';

/** Mask credentials embedded in URLs (scheme://user:pass@host). */
export function redact(text) {
  return String(text).replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@');
}

/**
 * Mask common secrets in a process command line: URL credentials, --password=x / --token x style flags,
 * SECRET_KEY=x style assignments and Bearer/Basic tokens. Over-redaction is preferred to leaking.
 */
export function redactCommandLine(command) {
  if (command === null || command === undefined) return command;
  return redact(command)
    .replace(new RegExp(`(--?[A-Za-z0-9_-]*(?:${SECRET_WORDS})[A-Za-z0-9_-]*)(=|\\s+)("[^"]*"|'[^']*'|\\S+)`, 'gi'), '$1$2***')
    .replace(new RegExp(`\\b([A-Za-z0-9_]*(?:${SECRET_WORDS})[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\\s*]\\S*)`, 'gi'), '$1=***')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***');
}
