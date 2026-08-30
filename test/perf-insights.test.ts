import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { cmdPerfInsights } from '../src/cdp/commands/perf/insights.js';
import { CAPTURE_ROOT } from '../src/session/artifacts.js';

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const write = process.stdout.write.bind(process.stdout);
  let output = '';
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
    return output;
  } finally {
    process.stdout.write = write;
  }
}

test('perf insights reports a no-navigation trace as finalized evidence outside its navigation-scoped engine result', async () => {
  const artifactRoot = path.join(CAPTURE_ROOT, `perf-insights-no-navigation-${process.pid}-${Date.now()}`);
  const trace = JSON.stringify({ traceEvents: [] });

  try {
    for (const completion of ['complete', 'partial'] as const) {
      const traceDir = path.join(artifactRoot, 'perf', 'traces', `trace-no-navigation-${completion}`);
      fs.mkdirSync(traceDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(traceDir, 'trace.json'), trace, { mode: 0o600 });
      fs.writeFileSync(path.join(traceDir, 'meta.json'), JSON.stringify({
        completion,
        files: [{ name: 'trace.json', bytes: Buffer.byteLength(trace) }],
      }), { mode: 0o600 });

      const output = await captureStdout(() => cmdPerfInsights({ command: 'perf', positional: [traceDir] }));
      assert.match(output, /0 navigation-scoped insight set\(s\)/);
      assert.match(output, /does not describe the other performance evidence recorded in trace\.json/);
      if (completion === 'complete') assert.match(output, /trace was recorded successfully and finalized \(completion=complete\)/);
      else {
        assert.match(output, /trace artifact was finalized with completion=partial/);
        assert.doesNotMatch(output, /recorded successfully/);
      }
    }
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});
