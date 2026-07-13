/**
 * U22 — orphan standalone HAR/API hard cut (M23).
 *
 * The session HAR manager (`src/har-manager.ts`) appended to by the internal
 * streaming recorder (`src/cdp/har-recorder.ts`) is the ONLY HAR ownership
 * lane. The legacy standalone owners — `executeInBrowser` (per-call HAR +
 * loose `/tmp` output via `writeHarAndPrintSummary`), `TabSession` (its own
 * HAR recording lifecycle), and the removed `navigateAndRecord` ownership
 * API — are deleted outright, with no stripped compatibility shell and no
 * stale public re-export left in the `src/cdp.ts` barrel.
 *
 * `test/session-har.test.ts` proves the surviving lane's behavior; this file
 * proves the orphan lanes are gone from both the module namespace and the
 * source tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.resolve('src');

/** Every .ts file under src/, recursively. */
function sourceFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

test('the three orphan HAR owner modules are deleted, not stubbed', () => {
  for (const rel of ['src/cdp/execute.ts', 'src/cdp/har-output.ts', 'src/tab-session.ts']) {
    assert.equal(fs.existsSync(path.resolve(rel)), false, `${rel} must be deleted`);
  }
});

test('the cdp barrel namespace lacks the three stale exports and keeps the live surface', async () => {
  const mod = await import('../src/cdp.js');
  // Hard-cut: no export and no forwarding shim under the old names.
  for (const stale of ['executeInBrowser', 'navigateAndRecord', 'HARRecorder']) {
    assert.equal(stale in mod, false, `barrel must not export ${stale}`);
  }
  // Retained surface (the deletion must not take live exports with it).
  for (const live of [
    'CDPClient',
    'detectCdpPort',
    'listTargets',
    'findTab',
    'findTabById',
    'openTab',
    'captureScreenshot',
    'getAccessibilityTree',
    'navigateAndWait', // tab open's load-wait helper survives in record.ts
    'ConsoleRecorder',
    'acquireTabLock',
    'isTabLocked',
    'releaseTabLock',
    'withTabLock',
    'cdpMain',
  ]) {
    assert.equal(typeof (mod as Record<string, unknown>)[live], 'function', `barrel must keep exporting ${live}`);
  }
});

test('no source references the orphan HAR APIs (grep proof)', () => {
  // The plan's grep: executeInBrowser | writeHarAndPrintSummary | TabSession |
  // harOutPath | createHar? — plus navigateAndRecord, whose record.ts stub
  // existed solely to keep the barrel compiling until this cut.
  const forbidden =
    /executeInBrowser|writeHarAndPrintSummary|TabSession|harOutPath|createHar\?|navigateAndRecord/;
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, 'utf-8');
    const m = text.match(forbidden);
    if (m) offenders.push(`${path.relative(process.cwd(), file)}: ${m[0]}`);
  }
  assert.deepEqual(offenders, []);
});

test('the sole live HAR lane — session manager + internal streaming recorder — is retained', () => {
  assert.equal(fs.existsSync(path.join(SRC, 'har-manager.ts')), true, 'src/har-manager.ts must survive');
  assert.equal(fs.existsSync(path.join(SRC, 'cdp', 'har-recorder.ts')), true, 'src/cdp/har-recorder.ts must survive');
  // HARRecorder stays a direct internal import of the recorder bridge, never a public barrel export.
  const bridge = fs.readFileSync(path.join(SRC, 'cdp', 'recorder-bridge.ts'), 'utf-8');
  assert.match(bridge, /import \{ HARRecorder \} from '\.\/har-recorder\.js'/);
});
