import {
  annotateUnstableFacts,
  readFocus,
  readGeometry,
  readMeta,
  unstableRegionsFor,
  type Rect,
  type SnapRef,
} from '../../output/artifact.js';
import {
  data,
  fact,
  formatCoordinate,
  line,
  lineList,
  text,
  type FactLine,
  type RenderableResult,
} from '../../output/render.js';

interface FocusRect {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly w?: number;
  readonly h?: number;
}

interface FocusStop {
  readonly step?: number;
  readonly id?: string | null;
  readonly backendNodeId?: number | null;
  readonly selector?: string | null;
  readonly role?: string | null;
  readonly name?: string | null;
  readonly rect?: FocusRect | null;
  readonly scrollBefore?: { readonly x?: number; readonly y?: number };
  readonly scrollAfter?: { readonly x?: number; readonly y?: number };
  readonly scrollJump?: boolean;
  readonly focusVisibleStyle?: { readonly outline?: string | null; readonly boxShadow?: string | null } | null;
}

interface UnreachedFocusable {
  readonly id?: string;
  readonly backendNodeId?: number | null;
  readonly selector?: string | null;
  readonly rect?: FocusRect | null;
  readonly visible?: boolean;
}

interface FocusArtifact {
  readonly available?: boolean;
  readonly unavailableReason?: string;
  readonly forward?: readonly FocusStop[];
  readonly forwardTruncated?: boolean;
  readonly reverse?: readonly FocusStop[];
  readonly reverseTruncated?: boolean;
  readonly unreachedFocusable?: readonly UnreachedFocusable[];
  readonly clickableUnfocusable?: readonly UnreachedFocusable[];
  readonly candidateCount?: number;
  readonly scope?: { readonly root?: string; readonly shadowDom?: string; readonly iframesPresent?: number; readonly shadowHostsPresent?: number };
}

interface SnapshotMeta {
  readonly settled?: boolean;
  readonly settleMs?: number;
}

interface FocusFact {
  readonly elementId?: string;
  readonly rect?: Rect;
}

function rectOf(rect: FocusRect | null | undefined): Rect | undefined {
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return undefined;
  const w = rect.w ?? rect.width;
  const h = rect.h ?? rect.height;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return undefined;
  return { x: rect.x, y: rect.y, w, h };
}

function identity(stop: FocusStop | UnreachedFocusable, geometryIdsByBackendNode: ReadonlyMap<number, string>): string | undefined {
  if (typeof stop.backendNodeId === 'number') return geometryIdsByBackendNode.get(stop.backendNodeId) ?? String(stop.backendNodeId);
  return typeof stop.id === 'string' ? stop.id : undefined;
}

function caveatSuffix(caveats: ReturnType<typeof annotateUnstableFacts<FocusFact>>[number]['caveats']): FactLine | undefined {
  if (caveats.length === 0) return undefined;
  return line(
    text` · nondeterminism caveat: `,
    data(caveats.map((c) => c.selector ?? c.regionId).join(', ')),
    text` is an unstable captured region`,
  );
}

function stopLine(direction: 'forward' | 'reverse', stop: FocusStop, caveats: ReturnType<typeof annotateUnstableFacts<FocusFact>>[number]['caveats']): FactLine {
  const parts: FactLine[] = [
    fact`${direction} step ${stop.step ?? 0}: `,
    text`selector=`, data(stop.selector ?? '(unresolved)'),
  ];
  if (stop.role !== null && stop.role !== undefined) parts.push(line(text` role=`, data(stop.role)));
  if (stop.name !== null && stop.name !== undefined) parts.push(line(text` name=`, data(stop.name)));
  const rect = rectOf(stop.rect);
  if (rect) parts.push(line(text` rect `, formatCoordinate(rect)));
  if (stop.scrollBefore && stop.scrollAfter) {
    parts.push(fact` scroll x=${stop.scrollBefore.x ?? 0},y=${stop.scrollBefore.y ?? 0} → x=${stop.scrollAfter.x ?? 0},y=${stop.scrollAfter.y ?? 0}`);
  }
  if (stop.scrollJump) parts.push(text` scroll-jump=true`);
  if (stop.focusVisibleStyle) {
    parts.push(line(text` focus-visible outline=`, data(stop.focusVisibleStyle.outline ?? '(unavailable)')));
    if (stop.focusVisibleStyle.boxShadow) parts.push(line(text` box-shadow=`, data(stop.focusVisibleStyle.boxShadow)));
  }
  const caveat = caveatSuffix(caveats);
  if (caveat) parts.push(caveat);
  return line(...parts);
}

function unreachedLine(item: UnreachedFocusable, caveats: ReturnType<typeof annotateUnstableFacts<FocusFact>>[number]['caveats']): FactLine {
  const parts: FactLine[] = [text`unreached focusable: selector=`, data(item.selector ?? '(unresolved)')];
  const rect = rectOf(item.rect);
  if (rect) parts.push(line(text` rect `, formatCoordinate(rect)));
  if (item.visible !== undefined) parts.push(fact` visible=${String(item.visible)}`);
  const caveat = caveatSuffix(caveats);
  if (caveat) parts.push(caveat);
  return line(...parts);
}

/** Builds the read-only `measure map focus` report from an existing snapshot. */
export function mapFocus(ref: SnapRef): RenderableResult {
  const focus = readFocus<FocusArtifact>(ref);
  const meta = readMeta<SnapshotMeta>(ref);
  const regions = unstableRegionsFor(ref);
  const geometry = readGeometry<{ elements?: Array<{ id?: string; backendNodeId?: number }> }>(ref);
  const geometryIdsByBackendNode = new Map<number, string>();
  for (const element of geometry.elements ?? []) {
    if (typeof element.backendNodeId === 'number' && typeof element.id === 'string') {
      geometryIdsByBackendNode.set(element.backendNodeId, element.id);
    }
  }
  const forward = focus.forward ?? [];
  const reverse = focus.reverse ?? [];
  const unreached = focus.unreachedFocusable ?? [];

  const annotate = <T extends FocusStop | UnreachedFocusable>(items: readonly T[]) => annotateUnstableFacts<FocusFact>(
    items.map((item) => ({ elementId: identity(item, geometryIdsByBackendNode), rect: rectOf(item.rect) })),
    regions,
  );
  const annotatedForward = annotate(forward);
  const annotatedReverse = annotate(reverse);
  const annotatedUnreached = annotate(unreached);

  const sections: FactLine[] = [];
  if (focus.available === false) {
    sections.push(fact`Focus traversal was unavailable during snapshot capture: ${focus.unavailableReason ?? 'capture did not return a completed traversal'}.`);
  } else {
    sections.push(lineList(annotatedForward.map((entry, index) => stopLine('forward', forward[index]!, entry.caveats))));
    sections.push(lineList(annotatedReverse.map((entry, index) => stopLine('reverse', reverse[index]!, entry.caveats))));
    if (focus.forwardTruncated || focus.reverseTruncated) {
      sections.push(fact`Traversal recording cap reached: forward=${String(Boolean(focus.forwardTruncated))}, reverse=${String(Boolean(focus.reverseTruncated))}.`);
    }
  }
  if (annotatedUnreached.length) sections.push(lineList(annotatedUnreached.map((entry, index) => unreachedLine(unreached[index]!, entry.caveats))));
  if (focus.scope) {
    sections.push(fact`Traversal scope: root=${focus.scope.root ?? 'unavailable'}, shadow-dom=${focus.scope.shadowDom ?? 'unavailable'}, iframes-present=${focus.scope.iframesPresent ?? 0}, shadow-hosts-present=${focus.scope.shadowHostsPresent ?? 0}.`);
  }

  return {
    tag: 'focus-map',
    attestation: {
      kind: 'snapshot',
      id: ref.id,
      path: ref.dir,
      note: meta.settled === false
        ? text`Snapshot was captured with unsettled regions; only facts intersecting those regions carry nondeterminism caveats.`
        : fact`Snapshot settled${meta.settleMs === undefined ? '' : ` after ${meta.settleMs}ms`}.`,
    },
    attrs: {
      forward: forward.length,
      reverse: reverse.length,
      'unreached-focusable': unreached.length,
      settled: meta.settled ?? false,
    },
    summary: fact`Keyboard traversal facts: ${forward.length} forward stop(s), ${reverse.length} reverse stop(s), and ${unreached.length} unreached focusable element(s) from ${focus.candidateCount ?? 0} captured candidate(s).`,
    sections,
    followUp: fact`Read another snapshot map with \`capture measure map scroll ${ref.id}\` or \`capture measure map layers ${ref.id}\`.`,
  };
}
