import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { analyzeChromeTrace } from '../src/cdp/trace-analysis.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/traces/${name}`, import.meta.url), 'utf8'));
}

test('trace analysis maps the real Chrome vitals fixture and preserves DevTools insight names', async () => {
  const analysis = await analyzeChromeTrace(fixture('vitals-with-interaction.json') as object[]);

  assert.deepEqual(analysis.source, {
    format: 'chrome-performance-trace',
    engine: '@paulirish/trace_engine@0.0.65',
  });
  assert.equal(analysis.insightSets.length, 1);

  const set = analysis.insightSets[0];
  assert.deepEqual(set.insightNames, [
    'INPBreakdown', 'LCPBreakdown', 'LCPDiscovery', 'CLSCulprits', 'RenderBlocking',
    'NetworkDependencyTree', 'ImageDelivery', 'DocumentLatency', 'FontDisplay', 'Viewport',
    'DOMSize', 'ThirdParties', 'DuplicatedJavaScript', 'SlowCSSSelector', 'ForcedReflow',
    'Cache', 'CharacterSet', 'ModernHTTP', 'LegacyJavaScript',
  ]);

  assert.equal(set.metrics.lcp.status, 'observed');
  if (set.metrics.lcp.status === 'observed') {
    assert.equal(set.metrics.lcp.value.durationMs, 313.812);
    assert.deepEqual(set.metrics.lcp.value.subpartsMs, {
      ttfb: 4.914,
      loadDelay: 2.201,
      loadDuration: 302.794,
      renderDelay: 3.903,
    });
    assert.deepEqual(set.metrics.lcp.attribution, {
      element: "IMG id='hero'",
      nodeId: 5,
      resourceUrl: 'http://127.0.0.1:54685/hero.png',
    });
  }

  assert.equal(set.metrics.inp.status, 'observed');
  if (set.metrics.inp.status === 'observed') {
    assert.deepEqual(set.metrics.inp.value, {
      durationMs: 257.758,
      interactionType: 'click',
      interactionId: 6612,
      inputDelayMs: 1.963,
      mainThreadHandlingMs: 252.868,
      presentationDelayMs: 2.927,
    });
    assert.deepEqual(set.metrics.inp.attribution, { targetNodeId: 7 });
  }

  assert.equal(set.metrics.cls.status, 'observed');
  assert.equal(set.metrics.cls.value.value, 0.6062774999999999);
  assert.deepEqual(set.metrics.cls.value.clusters, [{
    value: 0.6062774999999999,
    shiftCount: 2,
    culprits: [
      { kind: 'unsized-image', url: 'http://127.0.0.1:54685/hero.png', nodeId: 8 },
      { kind: 'unsized-image', url: 'http://127.0.0.1:54685/hero.png', nodeId: 8 },
    ],
  }]);
  assert.equal(set.metrics.inp.provenance.origin, 'lab');
  assert.ok(set.metrics.inp.provenance.limitations.some((limit) => limit.includes('No recorded interaction')));
});

test('trace analysis reports no INP observation for a real trace with no interaction', async () => {
  const analysis = await analyzeChromeTrace(fixture('vitals-no-interaction.json') as { traceEvents: object[] });
  assert.equal(analysis.insightSets.length, 1);

  const inp = analysis.insightSets[0].metrics.inp;
  assert.deepEqual(inp, {
    status: 'not-observed',
    reason: 'not-present-in-recording',
    provenance: {
      origin: 'lab',
      producer: 'Chrome performance trace analyzed by DevTools Trace Engine',
      scope: 'recording-window',
      limitations: [
        'Only interactions that occurred during this trace can be measured.',
        'No recorded interaction is not a zero-millisecond interaction.',
        'This is not a real-user field percentile.',
      ],
    },
  });
});
