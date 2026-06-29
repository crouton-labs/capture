import { mkdtempSync, writeFileSync, chmodSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const scriptPath = '/Users/silasrhyneer/.crouter/personal/bin/reddit-scan';

interface StubOptions {
  sessionStartMode?: 'success' | 'fail-empty';
  execTargets?: Record<string, string>;
  listTabs?: Array<{ id: string; title: string; url: string }>;
}

function makeStubCapture(dir: string, options: StubOptions = {}): { binDir: string; logPath: string } {
  const binDir = join(dir, 'bin');
  const logPath = join(dir, 'capture-calls.log');
  mkdirSync(binDir, { recursive: true });
  const capturePath = join(binDir, 'capture');
  const sessionStartMode = options.sessionStartMode ?? 'success';
  const listTabs = options.listTabs ?? [
    { id: 'tab-existing', title: 'Reddit', url: 'https://old.reddit.com/r/worldbuilding/' },
    { id: 'tab-other', title: 'Other', url: 'https://example.com/' },
  ];
  const execTargets = options.execTargets ?? {
    'tab-existing': '[{"id":"abc","sub":"worldbuilding","sort":"new","title":"hello","created":1,"comments":0,"author":"bot","flair":"","permalink":"/r/worldbuilding/comments/abc/hello/","self":""}]',
  };
  const execBranches = Object.entries(execTargets)
    .map(([target, payload], index) => {
      const keyword = index === 0 ? 'if' : 'elif';
      return `${keyword} [[ "$*" == *"--target ${target}"* ]]; then\n      cat <<'JSON'\n${payload}\nJSON`;
    })
    .join('\n');

  const script = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${logPath}"
case "$1" in
  session)
    case "$2" in
      start)
        case "${sessionStartMode}" in
          success)
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
          fail-empty)
            exit 1
            ;;
          *)
            echo "unexpected session start mode: ${sessionStartMode}" >&2
            exit 1
            ;;
        esac
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
${JSON.stringify(listTabs, null, 2)}
JSON
    ;;
  exec)
${execBranches}
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

test('reddit-scan falls back to an existing reddit.com tab when a fresh session fails with empty stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reddit-scan-fallback-'));
  const { binDir, logPath } = makeStubCapture(dir, {
    sessionStartMode: 'fail-empty',
    listTabs: [
      { id: 'tab-bad', title: 'Not Reddit', url: 'https://www.notreddit.com/' },
      { id: 'tab-existing', title: 'Reddit', url: 'https://old.reddit.com/r/worldbuilding/' },
      { id: 'tab-other', title: 'Other', url: 'https://example.com/' },
    ],
    execTargets: {
      'tab-existing': '[{"id":"abc","sub":"worldbuilding","sort":"new","title":"hello","created":1,"comments":0,"author":"bot","flair":"","permalink":"/r/worldbuilding/comments/abc/hello/","self":""}]',
    },
  });
  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
  };

  const output = execFileSync(scriptPath, ['worldbuilding', '--json'], {
    env,
    encoding: 'utf8',
  });

  assert.deepEqual(JSON.parse(output), [
    {
      id: 'abc',
      sub: 'worldbuilding',
      sort: 'new',
      title: 'hello',
      created: 1,
      comments: 0,
      author: 'bot',
      flair: '',
      permalink: '/r/worldbuilding/comments/abc/hello/',
      self: '',
    },
  ]);

  const calls = readFileSync(logPath, 'utf8').trim().split('\n');
  assert.deepEqual(calls.slice(0, 2), [
    'session start --url https://www.reddit.com/',
    'list',
  ]);
  assert.ok(calls[2]?.startsWith('exec --target tab-existing '));
  assert.ok(calls.every((line) => !line.includes('tab-bad')));
  assert.equal(calls.filter((line) => line === 'session stop cap-fresh').length, 0);
});

test('reddit-scan rejects non-Reddit origins and error-only scan output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reddit-scan-errors-'));
  const { binDir, logPath } = makeStubCapture(dir, {
    sessionStartMode: 'fail-empty',
    listTabs: [
      { id: 'tab-bad', title: 'Not Reddit', url: 'https://www.notreddit.com/' },
      { id: 'tab-existing', title: 'Reddit', url: 'https://old.reddit.com/r/worldbuilding/' },
    ],
    execTargets: {
      'tab-existing': '[{"error":"worldbuilding/new: HTTP 500"}]',
    },
  });
  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
  };

  assert.throws(
    () => execFileSync(scriptPath, ['worldbuilding'], { env, encoding: 'utf8' }),
    /failed to return usable data|no existing reddit\.com tab/i,
  );

  const calls = readFileSync(logPath, 'utf8').trim().split('\n');
  assert.ok(calls.some((line) => line.startsWith('exec --target tab-existing ')));
  assert.ok(calls.every((line) => !line.includes('tab-bad')));
});
