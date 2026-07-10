import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';

import { buildCensus } from '../src/cdp/measure/census.js';
import { renderResult, type RenderableResult } from '../src/output/render.js';
import type { SnapRef } from '../src/output/artifact.js';
import { CAPTURE_ROOT } from '../src/session/artifacts.js';

const ROOT = path.join(CAPTURE_ROOT, `census-test-${process.pid}-${Date.now()}`);

function snapshot(id: string, colors: string[], unstable = false): SnapRef {
  const dir = path.join(ROOT, 'measure', 'snaps', id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ settled: !unstable }), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'geometry.json'), JSON.stringify({
    elements: colors.map((_, index) => ({ id: `el-${index}`, selector: `.card-${index}`, rect: { x: index * 20, y: index * 30, width: 20, height: 20 } })),
    ...(unstable ? { unstableRegions: [{ id: 'region-1', elementIds: ['el-0'], reason: 'mutation evidence' }] } : {}),
  }), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'styles.json'), JSON.stringify({
    elements: colors.map((color, index) => ({ id: `el-${index}`, selector: `.card-${index}`, computed: { color, 'background-color': '#ffffff' }, winningDeclarations: [{ selector: `.card-${index}`, source: `cards.css:${index + 1}` }] })),
  }), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'text.json'), JSON.stringify({ elements: [] }), { mode: 0o600 });
  return { kind: 'snap', id, dir };
}

test('census aggregates two snapshot color distributions and groups near duplicates', () => {
  try {
    const first = snapshot('snap-first', ['#0f172a', '#ffffff'], true);
    const second = snapshot('snap-second', ['#0f172b', '#ffffff']);
    const report = buildCensus('color', [first, second]);
    const rendered: string[] = [];
    for (const [index, section] of report.lines.entries()) {
      try {
        rendered.push(renderResult({ tag: 'census', attrs: { axis: report.axis, snapshots: report.snapshots.length }, sections: [section] } satisfies RenderableResult));
      } catch (err) {
        throw new Error(`section ${index}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const output = rendered.join('\n');

    assert.equal(report.snapshots.length, 2);
    assert.match(output, /#ffffff ×6/);
    assert.match(output, /Near-duplicate: #0f172a and #0f172b/);
    assert.match(output, /nondeterminism caveat: unstable region region-1/);
  } finally {
    fs.rmSync(ROOT, { recursive: true, force: true });
  }
});
