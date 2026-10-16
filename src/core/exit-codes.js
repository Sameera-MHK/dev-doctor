// 0: no failures, 1: diagnostics found failures, 2: the tool itself could not run.
export const EXIT = Object.freeze({
  OK: 0,
  DIAGNOSTIC_FAILURE: 1,
  ERROR: 2,
});
