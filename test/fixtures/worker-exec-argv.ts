/**
 * execArgv for a test-spawned capture worker: the parent's exec flags minus
 * the isolate-capture-root preamble. The preamble unconditionally re-randomizes
 * `CAPTURE_ROOT` per process, so a worker re-running it would bind its control
 * socket and artifacts under a fresh root while the parent addresses the
 * original. Workers instead inherit `CAPTURE_ROOT` through the environment —
 * exactly how the built bin's empty-execArgv self-spawn behaves. Every other
 * flag (notably tsx) is forwarded so `.ts` entries stay loadable.
 */
import * as path from 'node:path';

const ISOLATE_PREAMBLE = path.resolve('test/fixtures/isolate-capture-root.ts');

export function workerExecArgv(): string[] {
  const filtered: string[] = [];
  for (let i = 0; i < process.execArgv.length; i += 1) {
    const flag = process.execArgv[i];
    if (flag === '--import' && i + 1 < process.execArgv.length
        && path.resolve(process.execArgv[i + 1]) === ISOLATE_PREAMBLE) {
      i += 1;
      continue;
    }
    if (flag.startsWith('--import=') && path.resolve(flag.slice('--import='.length)) === ISOLATE_PREAMBLE) continue;
    filtered.push(flag);
  }
  return filtered;
}
