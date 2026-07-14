import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { spawnHeadlessChrome } from './fixtures/chrome.js';
import { liveChromeOpts } from './fixtures/live-chrome.js';

// Launches two real Chrome-for-Testing instances — a real-Chrome case, gated with
// liveChromeOpts (option-(c) environment ruling) so it never runs in the Chrome-free
// deterministic gate; it runs under `npm run test:live`. This file is in MIXED_LIVE_FILES.
test('Chrome-for-Testing fixtures isolate concurrent CDP processes and remove profiles', { ...liveChromeOpts, timeout: 15_000 }, async () => {
  const [first, second] = await Promise.all([spawnHeadlessChrome(), spawnHeadlessChrome()]);
  assert.notEqual(first.port, second.port);
  assert.notEqual(first.profileDir, second.profileDir);
  assert.ok((await fetch(`http://127.0.0.1:${first.port}/json/version`)).ok);
  assert.ok((await fetch(`http://127.0.0.1:${second.port}/json/version`)).ok);
  await Promise.all([first.close(), second.close()]);
  await assert.rejects(access(first.profileDir));
  await assert.rejects(access(second.profileDir));
});

test('Chrome fixture reports an early child exit with buffered stderr and removes its profile', async () => {
  const before = (await readdir(tmpdir())).filter((name) => name.startsWith('capture-chrome-')).sort();
  await assert.rejects(
    spawnHeadlessChrome({
      executablePath: process.execPath,
      rawArgs: true,
      args: ['-e', 'console.error("intentional fixture exit"); process.exit(23)'],
      timeoutMs: 1_000,
    }),
    /exited before CDP became ready \(code=23, signal=none\)[\s\S]*intentional fixture exit/,
  );
  const after = (await readdir(tmpdir())).filter((name) => name.startsWith('capture-chrome-')).sort();
  assert.deepEqual(after, before);
});
