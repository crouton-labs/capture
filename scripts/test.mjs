#!/usr/bin/env node
// Test-profile authority (U23). The file lists below ARE the documented
// profile — there is no separate prose spec elsewhere. This encodes the
// plan's option-(c) environment ruling: real-Chrome-dependent suites are a
// separately classified live tier (`--live` / `npm run test:live`), never
// mixed into the deterministic gate that runs on every push/PR.
//
// - Deterministic (default): every `test/*.test.ts` file EXCEPT the 2
//   fully-live files below. This list is derived at runtime via readdir
//   minus the hardcoded live exclusion, so a newly added deterministic test
//   file is picked up automatically and can never be silently dropped.
// - Live (`--live`): the 2 fully-live files below PLUS 15 mixed files whose
//   real-Chrome cases are individually gated with `test/fixtures/live-chrome.ts`
//   (`liveChromeOpts` on the describe/test, with any file-scope Chrome
//   `before` hook made a no-op unless CAPTURE_LIVE_CHROME=1) and whose
//   remaining stub/pure cases are deterministic and run in the default
//   profile (re-running harmlessly under this one). This combined list IS
//   hardcoded — it is not derived — because "which files contain a live
//   case" is not mechanically inferable from a directory listing.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const testDir = path.join(repoRoot, 'test');

// Fully-live: EVERY test in the file genuinely exercises a real Chrome
// (there are no stub/pure cases to salvage). The whole file is live-tier only.
const FULLY_LIVE_FILES = [
  'measure-focus-geometry-identity.test.ts',
  'measure-geometry-hittest.test.ts',
];

// Mixed: the file's stub/pure cases are deterministic and run by default; its
// real-Chrome describes/tests are individually gated (`liveChromeOpts`) and
// only run under the live profile.
const MIXED_LIVE_FILES = [
  'measure-animation-freeze-invariants.test.ts',
  'measure-animation.test.ts',
  'measure-ax-queries-media-invariants.test.ts',
  'measure-cleanup-coverage.test.ts',
  'measure-css-provenance-invariants.test.ts',
  'measure-geometry-hittest-invariants.test.ts',
  'measure-layers-styles.test.ts',
  'measure-mutating-invariants.test.ts',
  'measure-pixels.test.ts',
  'measure-snap.test.ts',
  'measure-text-forms-invariants.test.ts',
  'measure-text-forms.test.ts',
  'snapshot-settledness.test.ts',
  'motion-rec.test.ts',
  'session-start.test.ts',
];

function allTestFiles() {
  return readdirSync(testDir)
    .filter((name) => name.endsWith('.test.ts'))
    .sort();
}

function deterministicFiles() {
  const exclude = new Set(FULLY_LIVE_FILES);
  return allTestFiles().filter((name) => !exclude.has(name));
}

function liveFiles() {
  // Order: fully-live first, then mixed, matching the plan's enumeration;
  // dedupe defensively in case a name is ever listed in both.
  const seen = new Set();
  const out = [];
  for (const name of [...FULLY_LIVE_FILES, ...MIXED_LIVE_FILES]) {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

const isLive = process.argv.includes('--live');
const files = isLive ? liveFiles() : deterministicFiles();
const concurrency = isLive ? 2 : 8;
const timeout = 120000;

const missing = files.filter((name) => !allTestFiles().includes(name));
if (missing.length > 0) {
  console.error(
    `test.mjs: profile references missing test file(s): ${missing.join(', ')}`,
  );
  process.exitCode = 1;
  process.exit(1);
}

const nodeArgs = [
  '--import',
  'tsx',
  '--import',
  './test/fixtures/isolate-capture-root.ts',
  '--test',
  `--test-concurrency=${concurrency}`,
  `--test-timeout=${timeout}`,
  ...files.map((name) => path.join('test', name)),
];

console.log(
  `test.mjs: ${isLive ? 'live' : 'deterministic'} profile — ${files.length} file(s), ` +
    `--test-concurrency=${concurrency} --test-timeout=${timeout}` +
    (isLive ? ' env CAPTURE_LIVE_CHROME=1' : ''),
);
for (const name of files) {
  console.log(`  ${name}`);
}

const child = spawn(process.execPath, nodeArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: isLive ? { ...process.env, CAPTURE_LIVE_CHROME: '1' } : process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  console.error(`test.mjs: failed to spawn test runner: ${err.message}`);
  process.exit(1);
});
