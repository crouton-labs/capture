import { mkdtempSync, writeFileSync, chmodSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const scriptPath = '/Users/silasrhyneer/.crouter/personal/bin/reddit-scan';

function makeStubCapture(dir: string): { binDir: string; logPath: string } {
  const binDir = join(dir, 'bin');
  const logPath = join(dir, 'capture-calls.log');
  mkdirSync(binDir, { recursive: true });
  const capturePath = join(binDir, 'capture');
  const script = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${logPath}"
case "$1" in
  session)
    case "$2" in
      start)
        cat <<'JSON'
{
  "sessionId": "cap-fresh",
  "bundleDir": "/tmp/capture-sessions/cap-fresh",
  "harId": "har-1",
  "targetId": null,
  "pageLoadTimedOut": false,
  "shotsDir": "/tmp/capture-sessions/cap-fresh/shots",
  "a11yDir": "/tmp/capture-sessions/cap-fresh/a11y"
}
JSON
        ;;
      stop)
        exit 0
        ;;
      *)
        echo "unexpected session subcommand: $2" >&2
        exit 1
        ;;
    esac
    ;;
  list)
    cat <<'JSON'
[
  {"id":"tab-existing","title":"Reddit","url":"https://www.reddit.com/r/worldbuilding/","port":9222,"app":"Arc"},
  {"id":"tab-other","title":"Other","url":"https://example.com/","port":9222,"app":"Arc"}
]
JSON
    ;;
  exec)
    if [[ "$*" == *"--target tab-existing"* ]]; then
      cat <<'JSON'
[{"id":"abc","sub":"worldbuilding","sort":"new","title":"hello","created":1,"comments":0,"author":"bot","flair":"","permalink":"/r/worldbuilding/comments/abc/hello/","self":""}]
JSON
    else
      echo "unexpected exec call: $*" >&2
      exit 1
    fi
    ;;
  *)
    echo "unexpected command: $*" >&2
    exit 1
    ;;
esac
`;
  writeFileSync(capturePath, script);
  chmodSync(capturePath, 0o755);
  return { binDir, logPath };
}

test('reddit-scan falls back to an existing reddit.com tab when a fresh session is unusable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reddit-scan-fallback-'));
  const { binDir, logPath } = makeStubCapture(dir);
  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
  };

  const output = execFileSync(scriptPath, ['worldbuilding', '--json'], {
    env,
    encoding: 'utf8',
  });

  assert.equal(
    output.trim(),
    '[{"id":"abc","sub":"worldbuilding","sort":"new","title":"hello","created":1,"comments":0,"author":"bot","flair":"","permalink":"/r/worldbuilding/comments/abc/hello/","self":""}]',
  );

  const calls = readFileSync(logPath, 'utf8').trim().split('\n');
  assert.deepEqual(calls.slice(0, 3), [
    'session start --url https://www.reddit.com/',
    'session stop cap-fresh',
    'list',
  ]);
  assert.ok(calls.some((line) => line.startsWith('exec --target tab-existing ')));
  assert.equal(calls.filter((line) => line === 'session stop cap-fresh').length, 1);
});
