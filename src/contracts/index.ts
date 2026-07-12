/**
 * U1 frozen Capture hard-cut contract surface. Import from this module for
 * descriptor/result/schema types; it has no browser, CLI, output, or process
 * side effects and remains intentionally unreachable from `src/capture.ts`
 * until the atomic U15 public cutover.
 */
export * from './primitives.js';
export * from './results.js';
export * from './routes.js';
export * from './snapshot.js';
export * from './neutral.js';
export * from './a11y.js';
export * from './cursor.js';
export * from './motion.js';
export * from './release.js';
