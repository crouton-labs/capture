import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

import { type ParsedArgs } from '../../types.js';
import { withConnection } from '../../connection.js';
import { isRecorderHeldClient } from '../../recorder-client.js';
import { captureSnapshotSubstrate } from '../../measure/snapshot.js';
import { sanitizeString } from '../../measure/redaction.js';
import { DEFAULT_SETTLE_TIMEOUT_MS } from '../../measure/settle.js';
import { createOneshotSession } from '../../../session/commands.js';
import { getActiveSession } from '../../../session-context.js';
import { removeArtifactTree } from '../../../session/artifacts.js';
import { ArtifactResolutionError, isUrlRef, readMeta, resolveSnapRef, type SnapRef } from '../../../output/artifact.js';
import {
  emitResult,
  fact,
  text,
  formatArtifactList,
  renderResult,
  toJsonResult,
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
  --viewport <WxH>            Temporarily capture at a CSS-pixel viewport (repeatable)

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
  readonly artifacts: readonly string[];
}

interface ViewportSpec {
  readonly label: string;
  readonly width: number;
  readonly height: number;
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

function artifactEntries(dir: string, artifacts: readonly string[]): ArtifactEntry[] {
  const entries: ArtifactEntry[] = [];
  const geometryCount = readArrayCount(path.join(dir, 'geometry.json'), 'elements');
  for (const name of artifacts) {
    entries.push({
      name,
      ...(name === 'geometry.json' && geometryCount !== undefined ? { note: `${geometryCount} elements` } : {}),
    });
  }
  return entries;
}

function parseViewport(value: string): ViewportSpec {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) {
    throw new Error(`--viewport must be formatted as WxH with positive integer CSS pixels; received "${value}"`);
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`--viewport dimensions must be positive safe integers; received "${value}"`);
  }
  return { label: `${width}x${height}`, width, height };
}

type ViewportClient = { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> };

type ViewportOwnership =
  | { readonly owner: 'native' }
  | { readonly owner: 'recorder' }
  | { readonly owner: 'foreign'; readonly reason: 'dpr-matched-no-display' | 'screen-info-unreadable' };

interface ScreenInfo {
  readonly devicePixelRatio?: unknown;
}

/**
 * CDP does not expose device-metrics override state. A recorder-held client is
 * explicitly owned by the recorder; otherwise, compare the page DPR to the
 * browser's actual displays. An emulated DPR that differs from every display
 * is a foreign override, while native browser chrome (outer vs. content size)
 * and native high-DPI displays are not ownership signals. If Chrome cannot
 * provide screen information, leave the target untouched rather than clearing
 * an override we cannot restore.
 *
 * `Emulation.getScreenInfos` is an experimental CDP method; if a future Chrome
 * removes or renames it the read fails and every viewport capture degrades to
 * `screen-info-unreadable` — i.e. all-refuse. That is the safe direction: it
 * never clears an override it cannot restore.
 */
async function viewportOwnership(client: ViewportClient): Promise<ViewportOwnership> {
  if (isRecorderHeldClient(client)) return { owner: 'recorder' };
  try {
    const [page, screens] = await Promise.all([
      client.send('Runtime.evaluate', {
        expression: 'window.devicePixelRatio',
        returnByValue: true,
      }) as Promise<{ result?: { value?: unknown } }>,
      client.send('Emulation.getScreenInfos') as Promise<{ screenInfos?: readonly ScreenInfo[] }>,
    ]);
    const dpr = page.result?.value;
    const displays = screens.screenInfos;
    if (typeof dpr === 'number' && Number.isFinite(dpr) && dpr > 0 && Array.isArray(displays) && displays.length > 0) {
      // A headed browser at page-zoom ≠ 100% multiplies window.devicePixelRatio
      // (display DPR × zoom), so a genuinely native but zoomed target reports a
      // DPR that matches no display and is refused here as foreign. Refusal is
      // the safe direction — it never clobbers an override it cannot restore —
      // and there is no clean CDP getter for the current zoom factor to subtract
      // it back out.
      if (displays.some((screen) => screen.devicePixelRatio === dpr)) return { owner: 'native' };
      return { owner: 'foreign', reason: 'dpr-matched-no-display' };
    }
  } catch {
    // An unreadable target is not evidence that its current override is ours.
  }
  return { owner: 'foreign', reason: 'screen-info-unreadable' };
}

/**
 * Refusal message for a non-native viewport target, stating only what was
 * measured: a recorder-held target, a DPR that matched no display (an override
 * is present but unreadable), or screen info that could not be read at all (no
 * override may exist — the read simply failed).
 */
function viewportRefusal(ownership: Exclude<ViewportOwnership, { owner: 'native' }>): string {
  if (ownership.owner === 'recorder') {
    return '--viewport cannot replace a recorder-owned device-metrics override because CDP cannot read and restore it';
  }
  if (ownership.reason === 'dpr-matched-no-display') {
    return '--viewport cannot replace a foreign-owned device-metrics override because CDP cannot read and restore it';
  }
  return '--viewport cannot confirm device-metrics override ownership because the browser screen information could not be read';
}

export async function withAppliedViewport<T>(client: ViewportClient, viewport: ViewportSpec | undefined, fn: () => Promise<T>): Promise<T> {
  if (!viewport) return fn();
  const ownership = await viewportOwnership(client);
  if (ownership.owner !== 'native') {
    throw new Error(viewportRefusal(ownership));
  }
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  try {
    return await fn();
  } finally {
    await client.send('Emulation.clearDeviceMetricsOverride');
  }
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
export async function captureMeasureSnap(parsed: ParsedArgs, targetRef = parsed.positional[0], viewportValue = parsed.viewport): Promise<MeasureSnapCapture> {
  if (parsed.positional.length > 1) {
    throw new Error('measure snap accepts at most one positional URL or snapshot reference');
  }
  if (parsed.settleTimeout !== undefined && (!Number.isFinite(parsed.settleTimeout) || parsed.settleTimeout <= 0)) {
    throw new Error('--settle-timeout must be a positive number of milliseconds');
  }
  const viewport = viewportValue ? parseViewport(viewportValue) : undefined;

  let base: SnapRef | undefined;
  let baseUrl: string | null = null;
  if (targetRef && !isUrlRef(targetRef)) {
    base = await resolveSnapRef(targetRef);
    baseUrl = readMeta<SnapshotMetaForBase>(base).url ?? null;
  }

  const active = getActiveSession();
  const snapId = generateSnapId();
  let snapDir: string | undefined;
  let allocatedRoot: string | undefined;

  // A positional URL is an explicit alternate target, matching --url's
  // existing connection semantics. A base snapshot uses the active tab when
  // available; otherwise its recorded URL identifies the tab to re-capture.
  const connectionArgs: ParsedArgs = targetRef && isUrlRef(targetRef)
    ? { ...parsed, url: targetRef, target: undefined, viewport: viewport?.label }
    : !parsed.target && !active?.targetId && baseUrl
      ? { ...parsed, url: baseUrl, viewport: viewport?.label }
      : { ...parsed, viewport: viewport?.label };

  try {
    let artifacts: readonly string[] = [];
    await withConnection(connectionArgs, async (client, tab) => {
      await withAppliedViewport(client, viewport, async () => {
        const oneshot = active ? undefined : createOneshotSession('measure');
        const destination = active ? path.join(active.dir, 'measure', 'snaps') : oneshot!.artifactsDir;
        snapDir = path.join(destination, snapId);
        allocatedRoot = active ? snapDir : oneshot!.dir;
        const result = await captureSnapshotSubstrate({
          target: { client, tabId: tab.id },
          url: tab.url || baseUrl,
          path: snapDir,
          snapId,
          settleTimeout: parsed.settleTimeout ?? DEFAULT_SETTLE_TIMEOUT_MS,
          freezeAnimations: parsed.freezeAnimations,
          captureUnsettled: parsed.captureUnsettled,
          pixels: parsed.pixels,
          state: parsed.state ?? [],
          viewport: viewport?.label ?? null,
        });
        artifacts = result.artifacts;
      });
    }, { settle: 0 });

    if (!snapDir) throw new Error('measure snap did not allocate an artifact directory');
    return { id: snapId, dir: snapDir, artifacts, ...(base ? { base } : {}) };
  } catch (err) {
    if (allocatedRoot) removeArtifactTree(allocatedRoot);
    throw err;
  }
}

function buildSnapshotResult(captured: MeasureSnapCapture): RenderableResult {
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
  const artifacts = artifactEntries(captured.dir, captured.artifacts);
  const capturedFullSubstrate = fs.existsSync(path.join(captured.dir, 'geometry.json'));

  return {
    tag: 'snapshot',
    attestation: {
      kind: 'snapshot',
      id: captured.id,
      path: captured.dir,
      note: settledNote(meta.settled, capturedFullSubstrate, meta.settleMs, meta.settleTimeoutMs, meta.unstableRegionCount),
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
    summary: meta.settled || capturedFullSubstrate
      ? text`Snapshot substrate captured. Sensitive control and token-like values are represented as redacted state, geometry, and length facts; raw values are not emitted.`
      : text`The evidence snapshot is not queryable because the settledness requirement was not met.`,
    artifacts: formatArtifactList(artifacts),
    followUp: meta.settled || capturedFullSubstrate
      ? fact`Query snapshot ${captured.id} with \`capture measure check ${captured.id}\`, \`capture measure census --snap ${captured.id} --axis color\`, or \`capture measure map focus ${captured.id}\`.`
      : fact`Re-run with \`--freeze-animations\`, a longer \`--settle-timeout\`, or \`--capture-unsettled\` to choose a queryable capture.`,
  };
}

interface SnapErrorDetails {
  readonly status: string;
  readonly message: string;
  readonly resolution?: ArtifactResolutionError;
}

function safeErrorDetail(value: unknown): string {
  return sanitizeString(value instanceof Error ? value.message : String(value));
}

export function classifySnapError(err: unknown): SnapErrorDetails {
  if (err instanceof ArtifactResolutionError) {
    return { status: 'snapshot_ref_unavailable', message: safeErrorDetail(err), resolution: err };
  }
  const message = safeErrorDetail(err);
  if (message.startsWith('--viewport cannot ')) {
    return { status: 'viewport_unavailable', message };
  }
  if (message.startsWith('measure snap accepts') || message.startsWith('--settle-timeout') || message.startsWith('--viewport')) {
    return { status: 'invalid_input', message };
  }
  if (message.includes('No tab found') || message.includes('Use --target') || message.includes('Tab has no WebSocket debugger URL')) {
    return { status: 'target_unavailable', message };
  }
  if (message.includes('WebSocket') || message.includes('CDP') || message.includes('timeout')) {
    return { status: 'transport_unavailable', message };
  }
  if (message.includes('artifact') || message.includes('capture root')) {
    return { status: 'artifact_unavailable', message };
  }
  return { status: 'capture_failed', message };
}

function cleanupCaptures(captures: readonly MeasureSnapCapture[]): void {
  const roots = new Set<string>();
  for (const capture of captures) {
    const oneShotRoot = path.resolve(capture.dir, '..', '..', '..');
    roots.add(path.basename(oneShotRoot).startsWith('oneshot-') ? oneShotRoot : capture.dir);
  }
  for (const root of roots) removeArtifactTree(root);
}

function errorSections(details: SnapErrorDetails) {
  const sections = [fact`detail: ${details.message}`];
  if (details.resolution) {
    sections.push(
      fact`ref: ${sanitizeString(details.resolution.ref)}`,
      ...details.resolution.searched.map((searched) => fact`searched: ${sanitizeString(searched)}`),
      ...(details.resolution.creatingCommand ? [fact`creating-command: ${sanitizeString(details.resolution.creatingCommand)}`] : []),
    );
  }
  return sections;
}

export async function cmdMeasureSnap(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (rejectUnsupportedGate(parsed, 'measure snap')) return;

  const captures: MeasureSnapCapture[] = [];
  try {
    const viewportValues = parsed.viewports?.length ? parsed.viewports : [parsed.viewport];
    // Validate every repeat before allocating the first private artifact tree.
    const viewports = viewportValues.map((viewport) => viewport === undefined ? undefined : parseViewport(viewport));
    const results = [] as RenderableResult[];
    for (const viewport of viewports) {
      const capture = await captureMeasureSnap(parsed, parsed.positional[0], viewport?.label);
      captures.push(capture);
      results.push(buildSnapshotResult(capture));
    }
    if (parsed.json && results.length > 1) {
      process.stdout.write(`${JSON.stringify(results.map((result) => toJsonResult(result)), null, 2)}\n`);
      return;
    }
    if (!parsed.json && results.length > 1) {
      process.stdout.write(`${results.map((result) => renderResult(result)).join('\n')}\n`);
      return;
    }
    emitResult(results[0]!, { json: parsed.json });
  } catch (err) {
    cleanupCaptures(captures);
    const classified = classifySnapError(err);
    const result: RenderableResult = {
      tag: 'error',
      attrs: {
        command: 'measure snap',
        status: classified.status,
        ...(classified.resolution ? {
          recovery: 'artifact-resolution-error',
          ref: sanitizeString(classified.resolution.ref),
          searched: sanitizeString(classified.resolution.searched.join('\n')),
          'searched-paths': classified.resolution.searched.length,
          'creating-command': classified.resolution.creatingCommand ? sanitizeString(classified.resolution.creatingCommand) : undefined,
        } : {}),
      },
      summary: text`Snapshot capture did not complete.`,
      sections: errorSections(classified),
    };
    emitResult(result, { json: parsed.json });
    process.exitCode = 1;
  }
}
