import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

import { type ParsedArgs } from '../../types.js';
import { withConnection } from '../../connection.js';
import { captureSnapshotSubstrate } from '../../measure/snapshot.js';
import { createOneshotSession } from '../../../session/commands.js';
import { getActiveSession } from '../../../session-context.js';
import { emitResult, fact, line, lineList, renderResult, text, type FactLine, type RenderableResult } from '../../../output/render.js';
import { rejectUnsupportedGate } from '../gate-guard.js';
import {
  SWEEP_AXES,
  analyzeSweepSamples,
  applySweepEmulation,
  isSweepAxis,
  numericSweepValues,
  readSweepEnvironment,
  readSweepSnapshot,
  refineNumericSweep,
  restoreSweepEnvironment,
  type SweepArtifact,
  type SweepAxis,
  type SweepRecovery,
  type SweepSample,
  writeSweepArtifact,
  writeSweepRecoveryArtifact,
} from '../../measure/sweep.js';

const USAGE = `Usage: capture measure sweep [url] --axis <width|dpr|zoom|color-scheme|reduced-motion> [--from <val>] [--to <val>] [--viewport-height <val>]

Responsive/environment sampling: applies CDP Emulation settings, captures the
settled snapshot substrate at sampled points, and recursively brackets observed
state changes across numeric axes.

Options:
  --axis <axis>             width|dpr|zoom|color-scheme|reduced-motion
  --from <val>              Numeric range start; color-scheme/reduced-motion value
  --to <val>                Numeric range end; color-scheme/reduced-motion value
  --viewport-height <val>   Fixed viewport height for width/dpr sweeps

A URL outside a session writes snapshots and sweep.json under one private
one-shot measure directory. Each sampled snapshot path is printed in the result.`;

const SAMPLE_LIMIT = 96;

export interface SweepCommandDependencies {
  readonly withConnection: typeof withConnection;
  readonly captureSnapshotSubstrate: typeof captureSnapshotSubstrate;
  readonly getActiveSession: typeof getActiveSession;
  readonly createOneshotSession: typeof createOneshotSession;
  readonly emitResult: typeof emitResult;
}

const defaultDependencies: SweepCommandDependencies = { withConnection, captureSnapshotSubstrate, getActiveSession, createOneshotSession, emitResult };

function sweepId(): string {
  return `sweep-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

/** Lists a bounded set of regular files already written to a failed snapshot directory. */
function writtenSnapshotArtifacts(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort().slice(0, 64);
  } catch {
    return [];
  }
}

function parsePositive(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} must be a positive number`);
  return value;
}

function valuesForAxis(axis: SweepAxis, parsed: ParsedArgs): Array<number | string> {
  if (axis === 'width') return numericSweepValues(parsePositive(parsed.from, 320, '--from'), parsePositive(parsed.to, 1440, '--to'), axis);
  if (axis === 'dpr') return numericSweepValues(parsePositive(parsed.from, 1, '--from'), parsePositive(parsed.to, 3, '--to'), axis);
  if (axis === 'zoom') return numericSweepValues(parsePositive(parsed.from, 0.5, '--from'), parsePositive(parsed.to, 2, '--to'), axis);
  if (axis === 'color-scheme') {
    const from = parsed.from ?? 'light';
    const to = parsed.to ?? 'dark';
    if (!['light', 'dark'].includes(from) || !['light', 'dark'].includes(to) || from === to) throw new Error('color-scheme uses distinct --from/--to values from light,dark');
    return [from, to];
  }
  const from = parsed.from ?? 'no-preference';
  const to = parsed.to ?? 'reduce';
  if (!['no-preference', 'reduce'].includes(from) || !['no-preference', 'reduce'].includes(to) || from === to) throw new Error('reduced-motion uses distinct --from/--to values from no-preference,reduce');
  return [from, to];
}

export function transitionSections(artifact: SweepArtifact): FactLine[] {
  const ranges = artifact.ranges.map((range) => line(fact`  observed matching fingerprint ${range.from}–${range.to} → ${range.snapId} (${range.snapDir})`));
  const transitions = artifact.transitions.flatMap((transition, index) => {
    const header = line(fact`${index + 1}. bracketed between ${transition.bracket.from} and ${transition.bracket.to} — ${transition.before} → ${transition.after}`);
    const changes = transition.changes.slice(0, 12).map((change) => {
      const provenance = change.provenance?.source ? fact` (${change.provenance.selector ?? 'winning declaration'}${change.provenance.specificity ? `, specificity ${change.provenance.specificity}` : ''}, ${change.provenance.source})` : change.provenance?.selector ? fact` (${change.provenance.selector}${change.provenance.specificity ? `, specificity ${change.provenance.specificity}` : ''})` : text``;
      return line(fact`   ${change.selector} ${change.property}: ${change.before ?? 'unset'} → ${change.after ?? 'unset'}`, provenance);
    });
    return [header, ...changes];
  });
  const uncertainty = artifact.uncertainties.map((interval) => fact`  ${interval.from}–${interval.to}: ${interval.reason === 'sampling_limit' ? `not sampled after the ${artifact.sampleLimit} sample limit` : 'adjacent sampled endpoints at resolution limit'}`);
  const settled = artifact.samples.map((sample) => {
    const caveats = sample.unstableRegions.map((region) => fact` region ${region.id}${region.selector ? ` (${region.selector})` : ''}${region.reason ? `: ${region.reason}` : ''}`);
    const sampleFact = fact`  ${sample.value}: ${sample.snapId} (${sample.snapDir}) settled=${String(sample.settled)}`;
    return caveats.length ? line(sampleFact, line(text` — unstable`, lineList(caveats))) : sampleFact;
  });
  return [
    lineList([text`Observed matching-fingerprint spans (no assertion about unsampled values):`, ...(ranges.length ? ranges : [text`  none`])]),
    lineList([text`Observed state changes (bracketed by samples):`, ...(transitions.length ? transitions : [text`  none observed across sampled values`])]),
    lineList([text`Sampling uncertainty:`, ...(uncertainty.length ? uncertainty : [text`  none`])]),
    lineList([text`Captured sample paths and settledness:`, ...settled]),
    artifact.environmentRestoration ? lineList([
      text`Environment restoration provenance:`,
      fact`  observed/restored effective settings: ${artifact.environmentRestoration.observed.join(', ')}`,
      fact`  CDP does not expose prior override configuration for: ${artifact.environmentRestoration.unobservable.join(', ')}`,
    ]) : text``,
  ];
}

export function renderSweepArtifact(artifact: SweepArtifact): string {
  return renderResult({ tag: 'sweep', attrs: { axis: artifact.axis, from: artifact.from, to: artifact.to, samples: artifact.samples.length, transitions: artifact.transitions.length }, summary: fact`Sweep samples are recorded as observed state facts.`, sections: transitionSections(artifact), followUp: artifact.samples.length > 1 ? fact`Compare two sampled substrates with \`capture measure diff --before ${artifact.samples[0].snapDir} --after ${artifact.samples[1].snapDir}\`.` : undefined });
}

export async function cmdMeasureSweep(parsed: ParsedArgs, args: string[]): Promise<void> {
  await runMeasureSweep(parsed, args);
}

/** Runs sweep orchestration; dependency overrides keep the thrown-capture recovery path verifiable without a browser. */
export async function runMeasureSweep(parsed: ParsedArgs, _args: string[], overrides: Partial<SweepCommandDependencies> = {}): Promise<void> {
  const dependencies = { ...defaultDependencies, ...overrides };
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (rejectUnsupportedGate(parsed, 'measure sweep')) return;
  if (parsed.positional.length > 1) {
    dependencies.emitResult({ tag: 'error', attrs: { command: 'measure sweep', status: 'invalid_input' }, summary: text`Measure sweep accepts at most one positional URL.` }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  if (!isSweepAxis(parsed.axis)) {
    dependencies.emitResult({ tag: 'error', attrs: { command: 'measure sweep', status: 'invalid_axis' }, summary: fact`--axis is required and must be one of ${SWEEP_AXES.join(', ')}.` }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  const axis = parsed.axis;
  const active = dependencies.getActiveSession();
  const oneShot = active ? undefined : dependencies.createOneshotSession('measure');
  const snapsDir = active ? path.join(active.dir, 'measure', 'snaps') : oneShot!.artifactsDir;
  const artifactDir = active ? path.join(active.dir, 'measure', 'sweeps', sweepId()) : path.join(oneShot!.dir, 'measure', 'sweeps', sweepId());
  const recoverySamples: Array<SweepRecovery['samples'][number]> = [];
  let environmentRestoration: SweepRecovery['environmentRestoration'] = 'not_attempted';
  try {
    const values = valuesForAxis(axis, parsed);
    const connectionArgs: ParsedArgs = parsed.positional[0] ? { ...parsed, url: parsed.positional[0], target: undefined } : parsed;
    const samplesByValue = new Map<string, SweepSample>();
    let uncertainties: SweepArtifact['uncertainties'] = [];
    let environmentFacts: SweepArtifact['environmentRestoration'];
    await dependencies.withConnection(connectionArgs, async (client, tab) => {
      const baseline = await readSweepEnvironment(client);
      environmentFacts = {
        observed: ['viewport width/height', 'device pixel ratio', 'page scale', ...(baseline.media === undefined ? [] : [`effective media type (${baseline.media})`]), 'prefers-color-scheme', 'prefers-reduced-motion'],
        unobservable: ['arbitrary pre-existing device metrics fields', 'arbitrary media feature overrides', ...(baseline.media === undefined ? ['arbitrary pre-existing media types (not observable or restored)'] : [])],
      };
      const samplingEnvironment = { ...baseline, height: parsed.viewportHeight === undefined ? baseline.height : parsePositive(parsed.viewportHeight, 1, '--viewport-height') };
      const capture = async (value: number | string): Promise<SweepSample> => {
        const key = String(value);
        const prior = samplesByValue.get(key);
        if (prior) return prior;
        await applySweepEmulation(client, axis, value, samplingEnvironment);
        const id = `snap-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
        const dir = path.join(snapsDir, id);
        const recovery: SweepRecovery['samples'][number] = { value, snapId: id, snapDir: dir, status: 'pending', captured: false, settled: false, unstableRegions: [], artifacts: [] };
        recoverySamples.push(recovery);
        let result;
        try {
          result = await dependencies.captureSnapshotSubstrate({
            target: { client, tabId: tab.id }, url: tab.url, path: dir, snapId: id,
            settleTimeout: parsed.settleTimeout, freezeAnimations: parsed.freezeAnimations,
            captureUnsettled: parsed.captureUnsettled, pixels: parsed.pixels, state: parsed.state ?? [],
            viewport: `${axis === 'width' ? value : samplingEnvironment.width}x${samplingEnvironment.height}`,
          });
        } catch (error) {
          Object.assign(recovery, { status: 'failed', failure: 'capture_threw', artifacts: writtenSnapshotArtifacts(dir) });
          throw error;
        }
        Object.assign(recovery, { status: result.captured ? 'captured' : 'evidence_only', captured: result.captured, settled: result.settled, unstableRegions: result.unstableRegions, artifacts: result.artifacts });
        if (!result.captured) throw new Error('evidence-only snapshot');
        const sample = readSweepSnapshot(id, dir, value, result.unstableRegions, result.settled);
        samplesByValue.set(key, sample);
        return sample;
      };
      try {
        for (const value of values) await capture(value);
        if (axis === 'width' || axis === 'dpr' || axis === 'zoom') {
          const tolerance = axis === 'width' ? 1 : 0.01;
          const refined = await refineNumericSweep([...samplesByValue.values()], tolerance, capture, SAMPLE_LIMIT);
          samplesByValue.clear();
          for (const sample of refined.samples) samplesByValue.set(String(sample.value), sample);
          uncertainties = refined.uncertainties;
        }
      } finally {
        try {
          await restoreSweepEnvironment(client, baseline);
          environmentRestoration = 'restored';
        } catch (error) {
          environmentRestoration = 'failed';
          throw error;
        }
      }
    }, { settle: 0 });

    const samples = (axis === 'width' || axis === 'dpr' || axis === 'zoom') ? [...samplesByValue.values()].sort((a, b) => Number(a.value) - Number(b.value)) : values.map((value) => samplesByValue.get(String(value))!).filter(Boolean);
    const from = values[0];
    const to = values[values.length - 1];
    const analyzed = analyzeSweepSamples(axis, from, to, samples);
    const artifact: SweepArtifact = { axis, from, to, capturedAt: new Date().toISOString(), samples, ...analyzed, uncertainties, sampleLimit: SAMPLE_LIMIT, environmentRestoration: environmentFacts };
    const artifactPath = writeSweepArtifact(artifactDir, artifact);
    const result: RenderableResult = {
      tag: 'sweep', attrs: { axis, from, to, samples: samples.length, transitions: artifact.transitions.length, path: artifactDir },
      summary: fact`Sweep artifact written to ${artifactPath}. It records sampled snapshot paths, discrete-state fingerprints, bracketed observed changes, and sampling uncertainty.`,
      sections: transitionSections(artifact),
      followUp: samples.length > 1 ? fact`Compare two sampled substrates with \`capture measure diff --before ${samples[0].snapDir} --after ${samples[1].snapDir}\`.` : undefined,
    };
    dependencies.emitResult(result, { json: parsed.json });
  } catch {
    const evidenceOnly = recoverySamples.some((sample) => sample.status === 'evidence_only');
    const recoveryPath = writeSweepRecoveryArtifact(artifactDir, { axis, capturedAt: new Date().toISOString(), reason: evidenceOnly ? 'evidence_only' : 'capture_failed', environmentRestoration, samples: recoverySamples });
    dependencies.emitResult({
      tag: 'error', attrs: { command: 'measure sweep', status: evidenceOnly ? 'evidence_only' : 'sweep_failed', path: recoveryPath },
      summary: fact`Sweep did not produce a queryable sample set. Recovery artifact: ${recoveryPath}.`,
      sections: recoverySamples.length ? [text`Partial snapshot/recovery provenance:`, ...recoverySamples.map((sample) => fact`${sample.value}: ${sample.snapDir} status=${sample.status} captured=${sample.captured} settled=${sample.settled} artifacts=${sample.artifacts.join(', ') || 'none'} unstable=${sample.unstableRegions.map((region) => `${region.id}${region.reason ? `:${region.reason}` : ''}`).join(', ') || 'none'}`), fact`environment restoration: ${environmentRestoration}`] : undefined,
    }, { json: parsed.json });
    process.exitCode = 1;
  }
}
