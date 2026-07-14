#!/usr/bin/env node
// Single esbuild-option authority for `bin/capture`. Both `npm run build`
// (writes bin/capture) and `npm run check:bin` (byte-compares a temporary
// bundle against the committed bin/capture, never rewriting it) resolve
// their esbuild options from this one module so the two invocations can
// never drift apart (U23).
import * as esbuild from 'esbuild';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const entry = path.join(repoRoot, 'src', 'capture.ts');
const binPath = path.join(repoRoot, 'bin', 'capture');

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

/** @param {string} outfile */
function buildOptions(outfile) {
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['esbuild'],
    banner: { js: '#!/usr/bin/env node' },
    define: {
      'globalThis.__CAPTURE_VERSION__': JSON.stringify(pkg.version),
    },
    logLevel: 'silent',
  };
}

async function buildTo(outfile) {
  mkdirSync(path.dirname(outfile), { recursive: true });
  await esbuild.build(buildOptions(outfile));
}

async function writeMode() {
  await buildTo(binPath);
  chmodSync(binPath, 0o755);
  console.log(`built ${path.relative(repoRoot, binPath)} (version ${pkg.version})`);
}

async function checkMode() {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'capture-build-check-'));
  const tmpFile = path.join(tmpDir, 'capture');
  try {
    await buildTo(tmpFile);

    let committed;
    try {
      committed = readFileSync(binPath);
    } catch (err) {
      console.error(
        `check:bin FAILED — ${path.relative(repoRoot, binPath)} does not exist ` +
          `or is unreadable (${err.code ?? err.message}). Run \`npm run build\` first.`,
      );
      process.exitCode = 1;
      return;
    }

    const fresh = readFileSync(tmpFile);
    if (!committed.equals(fresh)) {
      console.error(
        `check:bin FAILED — bin/capture is stale: a fresh build from ` +
          `src/capture.ts (version ${pkg.version}) does not byte-match the ` +
          `committed executable (committed ${committed.length} bytes, fresh ` +
          `${fresh.length} bytes). Run \`npm run build\` and commit the result.`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `check:bin OK — bin/capture is byte-identical to a fresh build (version ${pkg.version}).`,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

const mode = process.argv.includes('--check') ? 'check' : 'write';

if (mode === 'check') {
  await checkMode();
} else {
  await writeMode();
}
