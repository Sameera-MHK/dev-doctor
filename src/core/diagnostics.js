export const STATUS = Object.freeze({
  PASS: 'pass',
  WARN: 'warn',
  FAIL: 'fail',
  INFO: 'info',
});

/**
 * A diagnostic result. Checks only return data; reporters decide how to show it.
 * extra may hold: details (string[]), hint (string), fixId (string), fixData (object), data (object).
 */
export function result(category, status, title, extra = {}) {
  return { category, status, title, ...extra };
}

export function summarize(results) {
  const summary = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const r of results) summary[r.status] += 1;
  return summary;
}

export function hasFailures(results, failOn = 'fail') {
  return results.some((r) => r.status === STATUS.FAIL || (failOn === 'warn' && r.status === STATUS.WARN));
}
