import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

import { type ParsedArgs } from '../../types.js';
import { withConnection } from '../../connection.js';
import { captureSnapshotSubstrate } from '../../measure/snapshot.js';
import { sanitizeString } from '../../measure/redaction.js';
import { DEFAULT_SETTLE_TIMEOUT_MS } from '../../measure/settle.js';
import { createOneshotSession } from '../../../session/commands.js';
import { getActiveSession } from '../../../session-context.js';
import { isUrlRef, readMeta, resolveSnapRef, type SnapRef } from '../../../output/artifact.js';
import {
  emitResult,
  fact,
  text,
  formatArtifactList,
  type ArtifactEntry,
  type RenderableResult,
} from '../../../output/render.js';
import { rejectUnsupportedGate } from '../gate-guard.js';

const USAGE = `Usage: capture measure snap [url|snap] [--freeze-animations] [--settle-timeout <ms>] [--capture-unsettled] [--pixels] [--state <state[:selector]>]... [--viewport <WxH>]

Drive the page (or re-capture states over a base snapshot) and write one
settled snapshot substrate directory: geometry, styles, hit-test, text,
forms, animation, ax, queries, focus, scroll, layers, and (with --pixels)
per-element crops. Every other measure/motion query leaf reads this
artifact instead of re-driving the browser.

Options:
  --freeze-animations         Pause CSS/WAAPI animation before capture
  --settle-timeout <ms>       Override the default 5000ms settle wait
  --capture-unsettled         Write full substrate despite non-settlement,
                               marking unstable regions
  --pixels                    Also write per-element raster crops
  --state <state[:selector]>  Force a pseudo-state or real control state
                               (repeatable)
  --viewport <WxH>            Viewport label recorded with the snapshot

A URL outside a session writes under a private one-shot session. With an
active session, snapshots are written under that session and later resolve
by their snap id.`;

interface SnapshotMetaForBase {
  readonly url?: string | null;
}

export interface MeasureSnapCapture {
  readonly id: string;
  readonly dir: string;
  readonly base?: SnapRef;
}

function generateSnapId(): string {
  return `snap-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

function readArrayCount(filePath: string, field: string): number | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    return Array.isArray(value[field]) ? value[field].length : undefined;
  } catch {
    return undefined;
  }
}

function existingArtifacts(dir: string): ArtifactEntry[] {
  const known = [
    'geometry.json', 'styles.json', 'hittest.json', 'text.json', 'forms.json',
    'animation.json', 'ax.json', 'queries.json', 'focus.json', 'scroll.json',
    'layers.json', 'states.json', 'pixels.json', 'churn.json', 'screenshot.png', 'dom.html',
  ];
  const entries: ArtifactEntry[] = [];
  const geometryCount = readArrayCount(path.join(dir, 'geometry.json'), 'elements');
  for (const name of known) {
    if (!fs.existsSync(path.join(dir, name))) continue;
    entries.push({
      name,
      ...(name === 'geometry.json' && geometryCount !== undefined ? { note: `${geometryCount} elements` } : {}),
    });
  }
  if (fs.existsSync(path.join(dir, 'crops'))) entries.push({ name: 'crops/' });
  return entries;
}

function settledNote(settled: boolean, captured: boolean, settleMs: number, settleTimeoutMs: number, unstableCount: number) {
  if (settled) {
    return fact`Settled after ${settleMs}ms (two consecutive identical captures; DOM quiet ≥300ms).`;
  }
  if (captured) {
    return fact`Captured after ${settleMs}ms despite non-settlement (--capture-unsettled). Full substrate written; ${unstableCount} unstable region(s) marked.`;
  }
  return fact`Page did not settle within ${settleTimeoutMs}ms. No queryable substrate was written; evidence artifacts only (${unstableCount} unstable region(s)).`;
}

/**
 * Captures one snapshot without emitting it. URL-taking query leaves use this
 * seam rather than importing the substrate directly, preserving snap as the
 * sole live-driving primitive.
 */
export async function captureMeasureSnap(parsed: ParsedArgs, targetRef = parsed.positional[0]): Promise<MeasureSnapCapture> {
  if (parsed.positional.length > 1) {
    throw new Error('measure snap accepts at most one positional URL or snapshot reference');
  }
  if (parsed.settleTimeout !== undefined && (!Number.isFinite(parsed.settleTimeout) || parsed.settleTimeout <= 0)) {
    throw new Error('--settle-timeout must be a positive number of milliseconds');
  }

  let base: SnapRef | undefined;
  let baseUrl: string | null = null;
  if (targetRef && !isUrlRef(targetRef)) {
    base = await resolveSnapRef(targetRef);
    baseUrl = readMeta<SnapshotMetaForBase>(base).url ?? null;
  }

  const active = getActiveSession();
  const destination = active
    ? path.join(active.dir, 'measure', 'snaps')
    : createOneshotSession('measure').artifactsDir;
  const snapId = generateSnapId();
  const snapDir = path.join(destination, snapId);

  // A positional URL is an explicit alternate target, matching --url's
  // existing connection semantics. A base snapshot uses the active tab when
  // available; otherwise its recorded URL identifies the tab to re-capture.
  const connectionArgs: ParsedArgs = targetRef && isUrlRef(targetRef)
    ? { ...parsed, url: targetRef, target: undefined }
    : !parsed.target && !active?.targetId && baseUrl
      ? { ...parsed, url: baseUrl }
      : parsed;

  await withConnection(connectionArgs, async (client, tab) => {
    await captureSnapshotSubstrate({
      target: { client, tabId: tab.id },
      url: tab.url || baseUrl,
      path: snapDir,
      snapId,
      settleTimeout: parsed.settleTimeout ?? DEFAULT_SETTLE_TIMEOUT_MS,
      freezeAnimations: parsed.freezeAnimations,
      captureUnsettled: parsed.captureUnsettled,
      pixels: parsed.pixels,
      state: parsed.state ?? [],
      viewport: parsed.viewport ?? null,
    });
  }, { settle: 0 });

  return { id: snapId, dir: snapDir, ...(base ? { base } : {}) };
}

export async function cmdMeasureSnap(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (rejectUnsupportedGate(parsed, 'measure snap')) return;

  try {
    const captured = await captureMeasureSnap(parsed);
    const meta = readMeta<{
      url: string | null;
      viewport: string | null;
      settled: boolean;
      settleMs: number;
      settleTimeoutMs: number;
      unstableRegionCount: number;
      states: readonly string[];
    }>({ kind: 'snap', id: captured.id, dir: captured.dir });
    const elements = readArrayCount(path.join(captured.dir, 'geometry.json'), 'elements');
    const artifacts = existingArtifacts(captured.dir);

    const result: RenderableResult = {
      tag: 'snapshot',
      attestation: {
        kind: 'snapshot',
        id: captured.id,
        path: captured.dir,
        note: settledNote(meta.settled, fs.existsSync(path.join(captured.dir, 'geometry.json')), meta.settleMs, meta.settleTimeoutMs, meta.unstableRegionCount),
      },
      attrs: {
        url: meta.url ?? undefined,
        viewport: meta.viewport ?? undefined,
        elements,
        settled: meta.settled,
        'settle-ms': meta.settleMs,
        ...(captured.base ? { base: sanitizeString(captured.base.id) } : {}),
        ...(meta.states.length ? { states: meta.states.length } : {}),
      },
      summary: meta.settled || fs.existsSync(path.join(captured.dir, 'geometry.json'))
        ? text`Snapshot substrate captured. Sensitive control and token-like values are represented as redacted state, geometry, and length facts; raw values are not emitted.`
        : text`The evidence snapshot is not queryable because the settledness requirement was not met.`,
      artifacts: formatArtifactList(artifacts),
      followUp: meta.settled || fs.existsSync(path.join(captured.dir, 'geometry.json'))
        ? fact`Query snapshot ${captured.id} with \`capture measure check ${captured.id}\`, \`capture measure census --snap ${captured.id} --axis color\`, or \`capture measure map focus ${captured.id}\`.`
        : fact`Re-run with \`--freeze-animations\`, a longer \`--settle-timeout\`, or \`--capture-unsettled\` to choose a queryable capture.`,
    };
    emitResult(result, { json: parsed.json });
  } catch (err) {
    const result: RenderableResult = {
      tag: 'error',
      attrs: { command: 'measure snap', status: 'capture_failed' },
      summary: text`Snapshot capture could not complete. The requested target, snapshot reference, or capture transport was unavailable.`,
    };
    emitResult(result, { json: parsed.json });
    process.exitCode = 1;
  }
}
