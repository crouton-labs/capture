/**
 * Live target resolution + input dispatch — the one substrate every live
 * driving verb (`page click|type|scroll`, `motion rec --do`) drives through.
 *
 * Targeting speaks the shared selector-input grammar
 * (`src/output/selector.ts`'s `parseSelectorInput`) and resolves it against
 * the LIVE page (not collector-stored records), per prefix:
 *
 *   bare string    live CSS query — `DOM.getDocument` + `DOM.querySelectorAll`
 *   backend:<id>   identity — the canonical retry key in every resolution failure
 *   ax:<name>      case-insensitive SUBSTRING over live `Accessibility.getFullAXTree` names
 *   axid:<id>      AX node id from the same live fetch
 *   text:<needle>  not accepted by driving verbs — typed rejection naming the accepted prefixes
 *
 * Cardinality contract: driving requires EXACTLY ONE match. Zero or many
 * matches return a {@link ResolutionFailure} carrying the candidate list
 * (role, name, `backendNodeId`) as the recovery payload. This module renders
 * nothing — command leaves own all output; returned facts carry the resolved
 * identity (`backendNodeId`, role, name) and the dispatched coordinates.
 *
 * Uses getFullAXTree instead of queryAXTree because queryAXTree hangs on
 * complex pages (7000+ AX nodes) when given the DOM root nodeId.
 */

import { readFullAXTree, type FullAXNode } from './cdp/a11y.js';
import { parseSelectorInput, type SelectorInputKind } from './output/selector.js';

/**
 * The minimal CDP surface this module drives. `CDPClient` and
 * `RecorderHeldClient` satisfy it structurally; `motion rec --do` adapts
 * `RecorderSession.handleCdp` onto it.
 */
export interface LiveClient {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /**
   * Optional marked dispatch — transports that record labeled input
   * landmarks (the recorder bridge's `mark` mechanism) expose it so a
   * mutating call that is not auto-markable (`Runtime.callFunctionOn` in
   * {@link scrollResolved}) can carry its landmark. When absent, a marked
   * call degrades to a plain `send` (nothing is recording landmarks).
   */
  sendMarked?(method: string, params: Record<string, unknown>, mark: string): Promise<unknown>;
  /**
   * Optional recorder hook — suppresses the landmark on the next focus
   * click's initiating edge so a routed `type --into` lands one landmark on
   * its actual text insertion (see `RecorderHeldClient`).
   */
  suppressNextFocusClickMark?(): void;
}

/** Prefixes the live driving verbs accept (`text:` is query-leaf-only). */
export const ACCEPTED_LIVE_PREFIXES = ['css', 'ax:', 'axid:', 'backend:'] as const;

/** How many candidates a zero/many-match failure carries at most. */
const CANDIDATE_LIMIT = 10;

export type LiveTargetKind = Exclude<SelectorInputKind, 'text'>;

export interface ResolvedTarget {
  readonly ok: true;
  /** Which grammar prefix resolved it. */
  readonly kind: LiveTargetKind;
  readonly backendNodeId: number;
  readonly role: string | null;
  readonly name: string | null;
}

/** One zero/many-match recovery candidate — `backendNodeId` is the retry key. */
export interface TargetCandidate {
  readonly backendNodeId: number;
  readonly role: string | null;
  readonly name: string | null;
}

export type ResolutionFailure =
  | {
      readonly ok: false;
      readonly code: 'unsupported-prefix';
      readonly input: string;
      readonly acceptedPrefixes: typeof ACCEPTED_LIVE_PREFIXES;
    }
  | {
      readonly ok: false;
      readonly code: 'no-match' | 'ambiguous';
      readonly input: string;
      readonly kind: LiveTargetKind;
      /** Total live matches (`candidates` is capped at {@link CANDIDATE_LIMIT}). */
      readonly matchCount: number;
      readonly candidates: readonly TargetCandidate[];
    };

/** Facts of a dispatched click: resolved identity + click-center coordinates. */
export interface ClickDispatch {
  readonly backendNodeId: number;
  readonly role: string | null;
  readonly name: string | null;
  readonly x: number;
  readonly y: number;
}

/** Facts of a dispatched scroll: resolved identity + where the container landed. */
export interface ScrollDispatch {
  readonly backendNodeId: number;
  readonly role: string | null;
  readonly name: string | null;
  /** The requested destination: `top`, `bottom`, or a pixel offset. */
  readonly to: string;
  /** The container's `scrollTop` after the dispatch. */
  readonly scrollTop: number;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

// Accessible-name whitespace is presentation-insignificant: browsers may
// preserve label indentation or a trailing space that users never see.
function normalizeAccessibleName(name: string): string {
  return name.replace(/\s+/gu, ' ').trim().toLowerCase();
}

/**
 * Resolves a unified-grammar target string against the live page. Exactly
 * one match resolves; zero/many matches and `text:` targets return a typed
 * {@link ResolutionFailure} for the calling leaf to render.
 */
export async function resolveLiveTarget(
  client: LiveClient,
  input: string,
): Promise<ResolvedTarget | ResolutionFailure> {
  const parsed = parseSelectorInput(input);
  switch (parsed.kind) {
    case 'text':
      return { ok: false, code: 'unsupported-prefix', input, acceptedPrefixes: ACCEPTED_LIVE_PREFIXES };
    case 'backend': {
      const id = parseBackendNodeId(parsed.value);
      if (id === null || !(await isLiveBackendNode(client, id))) {
        return { ok: false, code: 'no-match', input, kind: 'backend', matchCount: 0, candidates: [] };
      }
      const { role, name } = await axIdentityFor(client, id);
      return { ok: true, kind: 'backend', backendNodeId: id, role, name };
    }
    case 'ax': {
      const nodes = await readFullAXTree(client);
      const needle = normalizeAccessibleName(parsed.value);
      const matches = nodes.filter(
        (n) =>
          n.backendDOMNodeId !== undefined &&
          n.name?.value !== undefined &&
          normalizeAccessibleName(n.name.value).includes(needle),
      );
      return settleAxMatches('ax', input, matches);
    }
    case 'axid': {
      const nodes = await readFullAXTree(client);
      const matches = nodes.filter((n) => n.nodeId === parsed.value && n.backendDOMNodeId !== undefined);
      return settleAxMatches('axid', input, matches);
    }
    case 'css':
      return resolveLiveCss(client, input, parsed.value);
  }
}

function settleAxMatches(
  kind: LiveTargetKind,
  input: string,
  matches: FullAXNode[],
): ResolvedTarget | ResolutionFailure {
  if (matches.length === 1) {
    const m = matches[0];
    return {
      ok: true,
      kind,
      backendNodeId: m.backendDOMNodeId!,
      role: m.role?.value ?? null,
      name: m.name?.value ?? null,
    };
  }
  return {
    ok: false,
    code: matches.length === 0 ? 'no-match' : 'ambiguous',
    input,
    kind,
    matchCount: matches.length,
    candidates: matches.slice(0, CANDIDATE_LIMIT).map((m) => ({
      backendNodeId: m.backendDOMNodeId!,
      role: m.role?.value ?? null,
      name: m.name?.value ?? null,
    })),
  };
}

async function resolveLiveCss(
  client: LiveClient,
  input: string,
  selector: string,
): Promise<ResolvedTarget | ResolutionFailure> {
  await client.send('DOM.enable');
  const { root } = (await client.send('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } };
  const { nodeIds } = (await client.send('DOM.querySelectorAll', {
    nodeId: root.nodeId,
    selector,
  })) as { nodeIds: number[] };

  if (nodeIds.length === 1) {
    const backendNodeId = await backendNodeIdFor(client, nodeIds[0]);
    const { role, name } = await axIdentityFor(client, backendNodeId);
    return { ok: true, kind: 'css', backendNodeId, role, name };
  }

  const candidates = await Promise.all(
    nodeIds.slice(0, CANDIDATE_LIMIT).map(async (nodeId): Promise<TargetCandidate> => {
      const backendNodeId = await backendNodeIdFor(client, nodeId);
      const { role, name } = await axIdentityFor(client, backendNodeId);
      return { backendNodeId, role, name };
    }),
  );
  return {
    ok: false,
    code: nodeIds.length === 0 ? 'no-match' : 'ambiguous',
    input,
    kind: 'css',
    matchCount: nodeIds.length,
    candidates,
  };
}

async function backendNodeIdFor(client: LiveClient, nodeId: number): Promise<number> {
  const { node } = (await client.send('DOM.describeNode', { nodeId })) as { node: { backendNodeId: number } };
  return node.backendNodeId;
}

function parseBackendNodeId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function isLiveBackendNode(client: LiveClient, backendNodeId: number): Promise<boolean> {
  try {
    const response = await client.send('DOM.describeNode', { backendNodeId, depth: 0 });
    if (response === null || typeof response !== 'object' || Array.isArray(response)) return false;
    const node = (response as { node?: unknown }).node;
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return false;
    return (node as { backendNodeId?: unknown }).backendNodeId === backendNodeId;
  } catch {
    return false;
  }
}

/**
 * Best-effort AX role/name for a live backend node id via a one-shot
 * `Accessibility.getPartialAXTree`. A node with no AX presence still resolves
 * with null enrichment.
 */
async function axIdentityFor(
  client: LiveClient,
  backendNodeId: number,
): Promise<{ role: string | null; name: string | null }> {
  try {
    const { nodes } = (await client.send('Accessibility.getPartialAXTree', {
      backendNodeId,
      fetchRelatives: false,
    })) as { nodes?: FullAXNode[] };
    const node = nodes?.find((n) => n.backendDOMNodeId === backendNodeId) ?? nodes?.[0];
    return { role: node?.role?.value ?? null, name: node?.name?.value ?? null };
  } catch {
    return { role: null, name: null };
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Clicks a resolved target: scroll into view → box model → center-point
 * `Input.dispatchMouseEvent` press/release pair.
 */
export async function clickResolved(client: LiveClient, resolved: ResolvedTarget): Promise<ClickDispatch> {
  const { backendNodeId } = resolved;

  await client.send('DOM.scrollIntoViewIfNeeded', { backendNodeId });

  const { model } = (await client.send('DOM.getBoxModel', { backendNodeId })) as {
    model: { content: number[] };
  };

  // Content quad is [x1,y1, x2,y2, x3,y3, x4,y4] — calculate center
  const quad = model.content;
  const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
  const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;

  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });

  return {
    backendNodeId,
    role: resolved.role,
    name: resolved.name,
    x: Math.round(x),
    y: Math.round(y),
  };
}

/** Types text into the currently focused element via CDP `Input.insertText`. */
export async function typeText(client: LiveClient, text: string): Promise<void> {
  await client.send('Input.insertText', { text });
}

/**
 * Clicks a resolved field to focus it, then types text into it. The focus
 * click's landmark is suppressed (a recorder-routed `type` has one
 * command-level landmark: its insertion — the focus click is a
 * prerequisite, not a second action).
 */
export async function focusAndType(
  client: LiveClient,
  resolved: ResolvedTarget,
  text: string,
): Promise<ClickDispatch> {
  client.suppressNextFocusClickMark?.();
  const dispatch = await clickResolved(client, resolved);
  // Small delay for focus to settle
  await new Promise((r) => setTimeout(r, 100));
  await typeText(client, text);
  return dispatch;
}

/**
 * Scrolls a resolved container to `top`, `bottom`, or a pixel offset by
 * assigning its `scrollTop` — `DOM.resolveNode` + `Runtime.callFunctionOn`
 * with the destination passed as data, never concatenated as code. When the
 * caller supplies `opts.mark` and the transport records landmarks
 * ({@link LiveClient.sendMarked}), the one mutating call carries the label —
 * the recorder landmark behavior `motion rec --do scroll:` shares.
 */
export async function scrollResolved(
  client: LiveClient,
  resolved: ResolvedTarget,
  to: string,
  opts: { mark?: string } = {},
): Promise<ScrollDispatch> {
  if (to !== 'top' && to !== 'bottom' && !Number.isFinite(Number(to))) {
    throw new Error(`Invalid scroll destination "${to}" — expected top, bottom, or a pixel offset.`);
  }

  const { backendNodeId } = resolved;
  const { object } = (await client.send('DOM.resolveNode', { backendNodeId })) as {
    object?: { objectId?: string };
  };
  const objectId = object?.objectId;
  if (!objectId) {
    throw new Error(`Could not resolve backend node ${backendNodeId} to a live object for scrolling.`);
  }

  const params: Record<string, unknown> = {
    objectId,
    functionDeclaration:
      'function(to) { const n = to === "top" ? 0 : to === "bottom" ? this.scrollHeight : Number(to); this.scrollTop = n; return this.scrollTop; }',
    arguments: [{ value: to }],
    returnByValue: true,
  };
  const result = (
    opts.mark !== undefined && client.sendMarked
      ? await client.sendMarked('Runtime.callFunctionOn', params, opts.mark)
      : await client.send('Runtime.callFunctionOn', params)
  ) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } } | undefined;

  if (result?.exceptionDetails) {
    throw new Error(`Scroll dispatch threw in-page: ${result.exceptionDetails.text ?? 'unknown error'}.`);
  }
  const scrollTop = result?.result?.value;
  if (typeof scrollTop !== 'number') {
    throw new Error('Scroll did not return a valid scrollTop payload.');
  }

  return { backendNodeId, role: resolved.role, name: resolved.name, to, scrollTop };
}
