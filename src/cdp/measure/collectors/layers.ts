/**
 * `layers.json` collector — the compositor-layer map read during capture:
 * layers, bounds, compositing reasons, per-node (owning backend node)
 * membership, and — best-effort, "where available" — the WINNING
 * declaration (not merely a matching one) behind a layer-triggering style
 * property, with its declared value, specificity/importance, and
 * authored/generated source location. The cascade/specificity/source
 * resolution and the `CSS.styleSheetAdded` header-capture helper are
 * shared with `styles.ts` via `./style-provenance.js` — one implementation
 * of "which rule actually wins" for both collectors.
 *
 * Two independent facts describe availability and paint order, each with
 * an explicit `available` flag rather than a silent empty array:
 *
 * - `layerTree` — CDP's `LayerTree` domain is event-driven, not
 *   pull-based: there is no `LayerTree.getLayers` command. `LayerTree.enable`
 *   is idempotent (already called once by `enableDomainsForSnap`), so this
 *   collector's own enable is a bare RE-enable. Real Chrome's compositor
 *   delivers `LayerTree.layerTreeDidChange` when a frame is actually
 *   PRODUCED, not merely when the domain is (re-)enabled: verified on live
 *   Chrome 150, a bare re-enable redelivers the tree only ~1/5 of the time
 *   (the first-ever enable's delivery is consumed by nobody, since
 *   `enableDomainsForSnap` enabled before any listener attached), while
 *   forcing a frame via `Page.captureScreenshot` delivers it 5/5. So after
 *   re-enabling, this collector provokes delivery by forcing frames — a
 *   read-only `Page.captureScreenshot` paint (no page mutation) spammed a
 *   few times across the listener window, stopped the instant the event
 *   settles. The one-shot listener is removed (`client.off`) on BOTH the
 *   event and the timeout path so no retained closure leaks for the
 *   connection's lifetime. When the event never arrives (timeout — e.g. a
 *   non-compositing headless sandbox) or the client can't deliver events,
 *   `layerTree` is `{ available: false, reason }` and `layers` is empty — an
 *   explicit unavailability fact, never an ambiguous empty array.
 *
 * - `paintOrder` — the authoritative paint order comes from
 *   `DOMSnapshot.captureSnapshot({includePaintOrder:true})` (a pull-based
 *   command, no listener), reported as `backendNodeId`s in paint order.
 *   `layerPaintOrder` retains the LayerTree layer-id delivery order as a
 *   secondary fact. When DOMSnapshot is unavailable, `paintOrder` is
 *   `{ available: false, reason }`.
 *
 * - `membership` — per-layer, per-node membership: which painted nodes
 *   (by `backendNodeId`) composite into which layer, e.g. "owns 184 painted
 *   nodes" / "`.toast-container` paints into layer 2". CDP exposes no
 *   direct node→layer command; this is derived from two real facts the
 *   collector already reads — each layer's owning `backendNodeId` (from
 *   `LayerTree.layerTreeDidChange`) and the DOM ancestor chain for every
 *   painted node (from the SAME `DOMSnapshot.captureSnapshot` call used for
 *   `paintOrder`, whose `nodes.parentIndex` this collector also reads). A
 *   painted node belongs to the nearest ancestor (or itself) that owns a
 *   layer; a node with no such ancestor falls back to the topmost layer
 *   that owns no node (the root/document layer), matching how a
 *   non-self-painting DOM subtree inherits its nearest compositing
 *   ancestor's layer in real Chrome. When the same DOMSnapshot data backing
 *   `paintOrder` is unavailable, or there are no layers to assign into,
 *   `membership` is `{ available: false, reason }` and every layer's
 *   member fields are empty — never a silently fabricated mapping.
 *
 * Three PER-LAYER reads are individually best-effort and each carries its
 * own explicit `…Unavailable:true` marker (I-5) rather than silently
 * coercing a failed read into the same shape as a genuine observation:
 * `LayerTree.compositingReasons` failing (a throw, OR a malformed response where
 * NEITHER `compositingReasons` NOR `compositingReasonIds` resolves to an actual
 * array — absent, `null`, or any other non-array value)
 * serializes `compositingReasons: []` with `compositingReasonsUnavailable: true`,
 * DISTINCT from a genuinely reasonless layer's `compositingReasons: []` with no
 * marker (a response that DOES carry one of the two fields as a real array, even
 * an empty one); `DOM.describeNode` failing (a throw, OR a response with no `node` /
 * no `node.nodeName` — CDP documents `nodeName` as a required field of
 * `DOM.Node`, so its absence is always a malformed read, never a real node
 * with no name) serializes `selector: null` with `selectorUnavailable: true`;
 * and a `resolveStyleProvenance` failure (node-id push, `CSS.getMatchedStylesForNode`,
 * a `CSS.getComputedStyleForNode` read that throws or returns no `computedStyle`
 * array at all, or cascade resolution) serializes an absent `styleProvenance` with
 * `styleProvenanceUnavailable: true`, DISTINCT from a genuinely absent
 * `styleProvenance` when resolution succeeded but no author declaration won any
 * tracked property. All three markers are set only when the layer has an owning
 * `backendNodeId` (nothing to resolve otherwise) and are absent (not `false`) on
 * success, mirroring `styles.ts`'s `provenanceUnavailable` convention.
 *
 * Two further PER-LAYER fields, `drawsContent` and `paintCount`, are CDP-
 * documented REQUIRED fields of `LayerTree.Layer` — a `LayerTree.layerTreeDidChange`
 * event whose layer entry omits either, OR carries either as the WRONG runtime type
 * (checked via `typeof`, e.g. a malformed `null`), is a malformed delivery for that
 * layer, not a genuine `false`/`0` observation. Each carries its own
 * `drawsContentUnavailable:true` / `paintCountUnavailable:true` marker (I-5) when
 * the field was absent or mistyped, absent (not `false`) when the field was
 * genuinely present with the right type, independent of each other and of
 * the three markers above.
 */

import { capArray, sanitizeString } from '../redaction.js';
import type { ResolvedSourceLocation } from '../../source-map.js';
import type { CDPClient } from '../../client.js';
import type { Collector } from '../types.js';
import {
  buildWinningDeclarations,
  captureStyleSheetHeaders,
  type CDPMatchedStylesResponse,
  type WinningDeclaration,
} from './style-provenance.js';

const LAYER_EVENT_TIMEOUT_MS = 2000;
/** Cap on the number of compositor layers serialized; excess is reported as a factual `layersTruncated` count. */
const MAX_LAYERS = 500;
/** Cap on the number of paint-order backend node ids serialized; excess is reported as a factual `truncated` count on `paintOrder`. */
const MAX_PAINT_ORDER_NODES = 2000;
/** Cap on the number of member backend node ids serialized per layer; excess is reported as a factual `membersTruncated` count on that layer (the layer's `memberCount` itself stays uncapped). */
const MAX_LAYER_MEMBERS = 2000;

// Best-effort style provenance: CSS properties that can trigger compositing.
// For a layer's owning node, the FIRST of these (in this priority order)
// that has an author-declared winning rule is reported, via the shared
// winning-declaration engine (./style-provenance.js) — the same cascade/
// specificity/importance/source resolution `styles.ts` uses, not merely
// the last matching selector. Any failure is swallowed, since the
// acceptance bar for this field is "where available".
const LAYER_AFFECTING_PROPERTIES = [
  'transform',
  'will-change',
  'opacity',
  'filter',
  'position',
  'isolation',
  'contain',
  'backdrop-filter',
  'mix-blend-mode',
];

interface RawLayer {
  readonly layerId: string;
  readonly parentLayerId?: string;
  readonly backendNodeId?: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly paintCount?: number;
  readonly drawsContent?: boolean;
}

interface CompositingReasonsResult {
  readonly compositingReasons?: string[];
  readonly compositingReasonIds?: string[];
}

interface DescribedNode {
  readonly nodeName?: string;
  readonly attributes?: string[];
}

interface RawLayersResult {
  readonly layers: RawLayer[];
  readonly available: boolean;
  readonly reason?: string;
}

function selectorFromDescribedNode(node: DescribedNode | undefined): string | null {
  if (!node?.nodeName) return null;
  const tag = node.nodeName.toLowerCase();
  const attrs = node.attributes ?? [];
  let id = '';
  let className = '';
  for (let i = 0; i + 1 < attrs.length; i += 2) {
    if (attrs[i] === 'id' && attrs[i + 1]) id = `#${attrs[i + 1]}`;
    if (attrs[i] === 'class' && attrs[i + 1]) {
      className = `.${attrs[i + 1].trim().split(/\s+/).filter(Boolean).join('.')}`;
    }
  }
  return `${tag}${id}${className}`;
}

/** Removes a `LayerTree.layerTreeDidChange` handler from whatever removal API the client exposes (`off` on the real `CDPClient`, `off`/`removeListener` on an `EventEmitter` test double). A no-op when the client has no removal API — the settled guard still prevents a late event from doing anything. */
function removeLayerListener(client: CDPClient, handler: (params: unknown) => void): void {
  const removable = client as unknown as {
    off?: (event: string, handler: (params: unknown) => void) => void;
    removeListener?: (event: string, handler: (params: unknown) => void) => void;
  };
  if (typeof removable.off === 'function') removable.off('LayerTree.layerTreeDidChange', handler);
  else if (typeof removable.removeListener === 'function') removable.removeListener('LayerTree.layerTreeDidChange', handler);
}

/**
 * Waits for the next `LayerTree.layerTreeDidChange` event (or a timeout),
 * then re-enables the domain to (re-)trigger delivery. Returns an explicit
 * availability result: the delivered layers with `available:true`, or an
 * empty set with `available:false` + a `reason` when the client can't
 * deliver events at all, none arrives within the timeout, or the event
 * DOES arrive but with its `layers` field absent — CDP documents `layers`
 * as an OPTIONAL param, absent when the renderer isn't in layer-tree/
 * compositing mode; treating that absence as a genuine empty tree
 * (`available:true, layers:[]`) would coerce "we have no layer-tree data
 * right now" into the same shape as "we successfully queried and there are
 * zero compositor layers" (I-5) — so it gets its own reason, distinct from
 * both the timeout and a literal `layers:[]` the event actually delivered.
 * The one-shot listener is removed on all three settle paths.
 */
async function collectRawLayers(client: CDPClient): Promise<RawLayersResult> {
  if (typeof client.on !== 'function') {
    await client.send('LayerTree.enable');
    return { layers: [], available: false, reason: 'client-lacks-event-support' };
  }

  let settled = false;
  const eventPromise = new Promise<{ layers: RawLayer[] } | 'timeout' | 'missing-layers'>((resolve) => {
    const handler = (params: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeLayerListener(client, handler);
      const raw = (params as { layers?: RawLayer[] } | undefined)?.layers;
      resolve(Array.isArray(raw) ? { layers: raw } : 'missing-layers');
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      removeLayerListener(client, handler);
      resolve('timeout');
    }, LAYER_EVENT_TIMEOUT_MS);
    client.on('LayerTree.layerTreeDidChange', handler);
  });

  await client.send('LayerTree.enable');
  // `LayerTree.enable` is idempotent and `enableDomainsForSnap` already made
  // the first-ever enable call before this collector runs — so this is a bare
  // RE-enable, and real Chrome's compositor only (re)delivers
  // `layerTreeDidChange` when a frame is actually PRODUCED, not merely when
  // the domain is (re-)enabled. Verified on live Chrome 150: a bare re-enable
  // delivers the tree ~1/5 of the time (the first enable's delivery is
  // consumed by nobody, since `enableDomainsForSnap` enabled before any
  // listener was attached), whereas forcing a frame via `Page.captureScreenshot`
  // delivers it 5/5. So provoke delivery by forcing frames: a read-only paint
  // (`Page.captureScreenshot` mutates no page state), spammed a few times
  // across the listener window so at least one frame lands before the
  // timeout, and stopped the instant the event settles. Best-effort — if the
  // screenshots all fail (or the runtime genuinely never composites, e.g. a
  // non-compositing headless sandbox), the timeout path still yields an
  // honest `no-layertree-event-within-timeout` unavailability fact rather
  // than fabricated layer data.
  void (async () => {
    for (let i = 0; i < 8 && !settled; i++) {
      try {
        await client.send('Page.captureScreenshot', { format: 'png' });
      } catch {
        // best-effort frame production — a failed screenshot must never abort
        // the layer read; the event may still arrive, or the timeout path
        // reports the honest unavailable fact.
      }
      if (settled) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  })();

  const result = await eventPromise;
  if (result === 'timeout') return { layers: [], available: false, reason: 'no-layertree-event-within-timeout' };
  if (result === 'missing-layers') return { layers: [], available: false, reason: 'layertree-event-missing-layers' };
  return { layers: result.layers, available: true };
}

// ============================================================================
// DOMSnapshot — the authoritative paint-order AND per-node layer-membership
// source, both derived from the one `DOMSnapshot.captureSnapshot` call.
// ============================================================================

interface DOMSnapshotResult {
  readonly documents?: Array<{
    readonly nodes?: { readonly backendNodeId?: number[]; readonly parentIndex?: number[] };
    readonly layout?: { readonly nodeIndex?: number[]; readonly paintOrders?: number[] };
  }>;
}

export interface PaintOrderFact {
  readonly available: boolean;
  readonly reason?: string;
  /** `backendNodeId`s in ascending paint order (back-to-front), when available. */
  readonly backendNodeIds: readonly number[];
  /** Factual count of paint-order entries dropped by the {@link MAX_PAINT_ORDER_NODES} cap. */
  readonly truncated: number;
}

interface DomTreeSnapshot {
  readonly available: boolean;
  readonly reason?: string;
  /** Index into the arrays below → `backendNodeId` for every node in the captured document. */
  readonly backendNodeIds: readonly number[];
  /** Index into the arrays below → parent's index in the same arrays, or -1 for a node with no parent in this capture. */
  readonly parentIndex: readonly number[];
  /** For each painted (laid-out) node, its index into `backendNodeIds`/`parentIndex`, in capture order. */
  readonly nodeIndexOrder: readonly number[];
  /** Paint rank per entry in `nodeIndexOrder`, same length, same order. */
  readonly paintOrders: readonly number[];
}

const UNAVAILABLE_DOM_TREE_SNAPSHOT = { backendNodeIds: [], parentIndex: [], nodeIndexOrder: [], paintOrders: [] } as const;

/**
 * One `DOMSnapshot.captureSnapshot({includePaintOrder:true})` call backs both
 * `paintOrder` (via {@link derivePaintOrderFact}) and per-node layer
 * `membership` (via {@link computeLayerMembership}): each layout node carries
 * a `paintOrders` rank and maps back (via `layout.nodeIndex`) to a
 * `nodes.backendNodeId`, and `nodes.parentIndex` gives the DOM ancestor chain
 * membership walks. Best-effort: any failure (domain unavailable, missing
 * arrays) returns `available:false` with a `reason`, never a throw.
 */
async function collectDomTreeSnapshot(client: CDPClient): Promise<DomTreeSnapshot> {
  let snapshot: DOMSnapshotResult;
  try {
    snapshot = (await client.send('DOMSnapshot.captureSnapshot', {
      computedStyles: [],
      includePaintOrder: true,
    })) as DOMSnapshotResult;
  } catch {
    return { available: false, reason: 'domsnapshot-unavailable', ...UNAVAILABLE_DOM_TREE_SNAPSHOT };
  }

  const doc = snapshot.documents?.[0];
  const nodeIndexOrder = doc?.layout?.nodeIndex;
  const paintOrders = doc?.layout?.paintOrders;
  const backendNodeIds = doc?.nodes?.backendNodeId;
  const parentIndex = doc?.nodes?.parentIndex;
  if (!nodeIndexOrder || !paintOrders || !backendNodeIds || !parentIndex) {
    return { available: false, reason: 'domsnapshot-missing-paint-order', ...UNAVAILABLE_DOM_TREE_SNAPSHOT };
  }
  return { available: true, backendNodeIds, parentIndex, nodeIndexOrder, paintOrders };
}

/** Sorts the DOM-tree snapshot's painted nodes by ascending paint rank into the authoritative composited paint order. */
function derivePaintOrderFact(tree: DomTreeSnapshot): PaintOrderFact {
  if (!tree.available) return { available: false, reason: tree.reason, backendNodeIds: [], truncated: 0 };

  const pairs: Array<{ paint: number; id: number }> = [];
  for (let i = 0; i < tree.nodeIndexOrder.length && i < tree.paintOrders.length; i++) {
    const id = tree.backendNodeIds[tree.nodeIndexOrder[i]];
    const paint = tree.paintOrders[i];
    if (typeof id === 'number' && typeof paint === 'number') pairs.push({ paint, id });
  }
  pairs.sort((a, b) => a.paint - b.paint);

  const { items, truncated } = capArray(
    pairs.map((p) => p.id),
    MAX_PAINT_ORDER_NODES,
  );
  return { available: true, backendNodeIds: items, truncated };
}

export interface LayerMembershipFact {
  readonly available: boolean;
  readonly reason?: string;
  /** Painted nodes that could not be matched to any layer via DOM ancestry (no layer-owning ancestor and no root/document layer to fall back to) — a factual gap, never a silent drop. */
  readonly unassignedCount: number;
}

interface LayerMembershipResolution {
  readonly fact: LayerMembershipFact;
  /** `layerId` → the full (uncapped) set of member `backendNodeId`s, in first-seen paint order. Empty when `fact.available` is false. */
  readonly membersByLayerId: ReadonlyMap<string, readonly number[]>;
}

/**
 * Derives per-layer node membership from two real facts already read by
 * `collectLayers`: each layer's owning `backendNodeId` (from
 * `LayerTree.layerTreeDidChange`) and the DOM ancestor chain for every
 * painted node (from `tree.parentIndex`, the same DOMSnapshot call backing
 * `paintOrder`). A painted node's layer is the nearest ancestor-or-self that
 * owns a layer; failing that, the topmost layer that owns no node (the
 * root/document layer) — the same containment a non-self-painting DOM
 * subtree has in real Chrome. A node with neither is `unassignedCount`, not a
 * fabricated assignment. Requires both an available DOM-tree snapshot and at
 * least one layer to assign into; otherwise `available:false` with a reason.
 */
function computeLayerMembership(tree: DomTreeSnapshot, rawLayers: readonly RawLayer[]): LayerMembershipResolution {
  if (!tree.available) return { fact: { available: false, reason: tree.reason, unassignedCount: 0 }, membersByLayerId: new Map() };
  if (rawLayers.length === 0) return { fact: { available: false, reason: 'no-layers-to-assign-membership', unassignedCount: 0 }, membersByLayerId: new Map() };

  const indexByBackendNodeId = new Map<number, number>();
  tree.backendNodeIds.forEach((id, idx) => {
    if (typeof id === 'number') indexByBackendNodeId.set(id, idx);
  });

  const layerIdByOwnerIndex = new Map<number, string>();
  let fallbackLayerId: string | null = null;
  for (const layer of rawLayers) {
    if (layer.backendNodeId !== undefined) {
      const ownerIndex = indexByBackendNodeId.get(layer.backendNodeId);
      if (ownerIndex !== undefined) layerIdByOwnerIndex.set(ownerIndex, layer.layerId);
    } else if (fallbackLayerId === null) {
      // The first layer with no owning node is the root/document layer — the
      // catch-all for any painted node with no layer-owning ancestor.
      fallbackLayerId = layer.layerId;
    }
  }

  const resolvedByIndex = new Map<number, string | null>();
  function resolveLayerForIndex(nodeIndex: number, guard = 0): string | null {
    if (resolvedByIndex.has(nodeIndex)) return resolvedByIndex.get(nodeIndex) ?? null;
    const direct = layerIdByOwnerIndex.get(nodeIndex);
    if (direct !== undefined) {
      resolvedByIndex.set(nodeIndex, direct);
      return direct;
    }
    const parent = tree.parentIndex[nodeIndex];
    // `guard` bounds a malformed/cyclic parentIndex to the node count so a bad capture can't infinite-loop.
    if (parent === undefined || parent < 0 || parent === nodeIndex || guard >= tree.backendNodeIds.length) {
      resolvedByIndex.set(nodeIndex, fallbackLayerId);
      return fallbackLayerId;
    }
    const resolved = resolveLayerForIndex(parent, guard + 1);
    resolvedByIndex.set(nodeIndex, resolved);
    return resolved;
  }

  const membersByLayerId = new Map<string, number[]>();
  const seenPerLayer = new Map<string, Set<number>>();
  let unassignedCount = 0;
  for (const nodeIndex of tree.nodeIndexOrder) {
    const backendNodeId = tree.backendNodeIds[nodeIndex];
    if (typeof backendNodeId !== 'number') continue;
    const layerId = resolveLayerForIndex(nodeIndex);
    if (layerId === null) {
      unassignedCount++;
      continue;
    }
    let seen = seenPerLayer.get(layerId);
    if (!seen) {
      seen = new Set();
      seenPerLayer.set(layerId, seen);
    }
    if (seen.has(backendNodeId)) continue; // a node can have multiple layout/paint entries (e.g. fragmented text)
    seen.add(backendNodeId);
    const members = membersByLayerId.get(layerId) ?? [];
    members.push(backendNodeId);
    membersByLayerId.set(layerId, members);
  }

  return { fact: { available: true, unassignedCount }, membersByLayerId };
}

interface CDPComputedStyleResponse {
  readonly computedStyle?: Array<{ name: string; value: string }>;
}

/**
 * Fetches computed values (via `CSS.getComputedStyleForNode`, not a page-side
 * `Runtime.evaluate` — layers.ts issues no in-page script) for exactly
 * `properties`, defaulting each to `null`. Returns an explicit `available`
 * fact (I-5) alongside the map: `available:false` when the call throws OR
 * the response carries no `computedStyle` array at all — a genuine read
 * failure, DISTINCT from a successful response that simply has no entry for
 * a given tracked property (which stays `null` with `available:true`, a
 * genuine "this property has no computed value here" observation). Callers
 * must not treat `available:false` as "resolved, every property computed to
 * nothing" — propagate it instead.
 */
async function fetchComputedStyle(
  client: CDPClient,
  nodeId: number,
  properties: readonly string[],
): Promise<{ computed: Record<string, string | null>; available: boolean }> {
  const computed: Record<string, string | null> = {};
  for (const property of properties) computed[property] = null;
  try {
    const response = (await client.send('CSS.getComputedStyleForNode', { nodeId })) as CDPComputedStyleResponse;
    if (!Array.isArray(response.computedStyle)) return { computed, available: false };
    for (const entry of response.computedStyle) {
      if (Object.prototype.hasOwnProperty.call(computed, entry.name)) computed[entry.name] = entry.value;
    }
    return { computed, available: true };
  } catch {
    return { computed, available: false };
  }
}

/**
 * Resolves the winning declaration for `backendNodeId`'s owning node across
 * {@link LAYER_AFFECTING_PROPERTIES}, via the shared cascade/specificity/
 * source-resolution engine (`./style-provenance.js`) — the same one
 * `styles.ts` uses — and reports the FIRST property (in priority order)
 * that has an actual author-declared winner. A property with no author
 * declaration is not a layer "cause", so it is skipped in favor of the
 * next candidate rather than reported as a false no-declaration cause.
 *
 * `unavailable:true` (I-5) is DISTINCT from `declaration` simply being
 * `undefined`: `declaration:undefined, unavailable:false` is a genuine
 * "no layer-affecting author declaration found" observation (the node's
 * identity was resolved and its matched styles were successfully read —
 * there just wasn't a winning candidate for any tracked property);
 * `unavailable:true` means the node-id push, `CSS.getMatchedStylesForNode`,
 * the computed-style read (`CSS.getComputedStyleForNode` throwing or
 * returning no `computedStyle` array — see {@link fetchComputedStyle}), or
 * the cascade resolution itself failed, so no observation was made at all.
 * A failed computed-style read specifically must not read as "resolved, no
 * author declaration": the DECLARED winner from `CSS.getMatchedStylesForNode`
 * could still resolve on its own, but its rounded computed `value` would
 * then be silently wrong (always `null`) rather than honestly unavailable, so
 * the whole per-layer observation is marked unavailable instead of reporting
 * a half-true result. Mirrors `styles.ts`'s `provenanceUnavailable` marker
 * for the analogous per-element path.
 */
async function resolveStyleProvenance(
  client: CDPClient,
  backendNodeId: number,
  styleSheetUrls: Map<string, string>,
  sourceCache: Map<string, Promise<ResolvedSourceLocation>>,
): Promise<{ declaration?: WinningDeclaration; unavailable: boolean }> {
  try {
    const pushed = (await client.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [backendNodeId] })) as { nodeIds?: number[] };
    const nodeId = pushed.nodeIds?.[0];
    if (!nodeId) return { unavailable: true };

    const [matched, computedResult] = await Promise.all([
      client.send('CSS.getMatchedStylesForNode', { nodeId }) as Promise<CDPMatchedStylesResponse>,
      fetchComputedStyle(client, nodeId, LAYER_AFFECTING_PROPERTIES),
    ]);
    if (!computedResult.available) return { unavailable: true };

    const declarations = await buildWinningDeclarations(
      client,
      matched,
      computedResult.computed,
      sourceCache,
      styleSheetUrls,
      LAYER_AFFECTING_PROPERTIES,
    );
    return { declaration: declarations.find((d) => d.selector !== null), unavailable: false };
  } catch {
    return { unavailable: true };
  }
}

export interface LayerRecord {
  readonly id: string;
  readonly backendNodeId: number | null;
  readonly selector: string | null;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly layerPaintOrder: number;
  readonly parentLayerId: string | null;
  readonly drawsContent: boolean;
  /** `true` (I-5) when this `LayerTree.Layer` delivery omitted the (CDP-required) `drawsContent` field — `drawsContent` is then `false` because the field could not be read, not because the layer genuinely doesn't draw content. Absent (not `false`) when the field was present. */
  readonly drawsContentUnavailable?: true;
  readonly paintCount: number;
  /** `true` (I-5) when this `LayerTree.Layer` delivery omitted the (CDP-required) `paintCount` field — `paintCount` is then `0` because the field could not be read, not because the layer genuinely has zero paints. Absent (not `false`) when the field was present. */
  readonly paintCountUnavailable?: true;
  readonly compositingReasons: string[];
  /** `true` (I-5) when `LayerTree.compositingReasons` failed for this layer — `compositingReasons` is then `[]` because the read could not be made, not because the layer genuinely has no compositing reasons. Absent (not `false`) when the read succeeded, matching this file's other honesty markers. */
  readonly compositingReasonsUnavailable?: true;
  readonly styleProvenance?: WinningDeclaration;
  /** `true` (I-5) when this layer has an owning `backendNodeId` but style-provenance resolution failed (`DOM.pushNodesByBackendIdsToFrontend`, `CSS.getMatchedStylesForNode`, or cascade resolution itself failed) — DISTINCT from `styleProvenance` simply being absent because no author declaration won any tracked property while resolution succeeded. Mirrors `styles.ts`'s `provenanceUnavailable`. Absent (not `false`) when resolution was attempted and succeeded (with or without a winning declaration), and never set when the layer has no owning node at all (nothing to resolve). */
  readonly styleProvenanceUnavailable?: true;
  /** `true` (I-5) when this layer has an owning `backendNodeId` but `DOM.describeNode` failed — `selector` is then `null` because the read could not be made, not because the described node genuinely carried no name. Absent (not `false`) when the read succeeded, and never set when the layer has no owning node at all. */
  readonly selectorUnavailable?: true;
  /** Full (uncapped) count of painted nodes composited into this layer — "owns N painted nodes". `0` and unpopulated `memberBackendNodeIds` when the top-level `membership` fact is `available:false`. */
  readonly memberCount: number;
  /** Member `backendNodeId`s, capped at {@link MAX_LAYER_MEMBERS}; the join key back to `geometry.json`/other element-bearing artifacts. */
  readonly memberBackendNodeIds: readonly number[];
  /** Factual count of member ids dropped by the {@link MAX_LAYER_MEMBERS} cap — `memberCount` itself is never capped. */
  readonly membersTruncated: number;
}

export interface LayersReport {
  /** Explicit LayerTree availability fact — `available:false` + `reason` when the layer tree could not be read, never a silently empty `layers`. */
  readonly layerTree: { readonly available: boolean; readonly reason?: string };
  readonly layers: readonly LayerRecord[];
  /** Factual count of layers dropped by the {@link MAX_LAYERS} cap. */
  readonly layersTruncated: number;
  /** Authoritative paint order from `DOMSnapshot` (`backendNodeId`s, back-to-front), with its own availability fact. */
  readonly paintOrder: PaintOrderFact;
  /** Secondary paint-order proxy: LayerTree layer-id delivery order. */
  readonly layerPaintOrder: readonly string[];
  /** Per-node layer-membership availability fact — `available:false` + `reason` (never a silently empty per-layer member list) when it could not be derived; see each `LayerRecord`'s `memberBackendNodeIds`/`memberCount` for the per-layer facts. */
  readonly membership: LayerMembershipFact;
  /** Availability of the `CSS.styleSheetAdded` header capture `styleProvenance` resolution depends on (I-5) — `available:false` means any missing `sourceStyleSheetUrl`/`generated` source on a `styleProvenance` below is a capture failure, not "genuinely no source". */
  readonly styleSheetHeaders: { readonly available: boolean; readonly reason?: string };
}

export const collectLayers: Collector = async (ctx) => {
  const { client } = ctx;
  // Registers the CSS.styleSheetAdded listener and forces header redelivery
  // BEFORE anything else touches the CSS domain (see style-provenance.ts's
  // module doc) — run alongside the (CSS-domain-independent) raw layer tree
  // and paint order reads rather than serialized after them.
  const [
    { urls: styleSheetUrls, stop: stopTrackingStyleSheets, available: styleSheetHeadersAvailable, reason: styleSheetHeadersReason },
    rawResult,
    domTree,
  ] = await Promise.all([captureStyleSheetHeaders(client), collectRawLayers(client), collectDomTreeSnapshot(client)]);
  const sourceCache = new Map<string, Promise<ResolvedSourceLocation>>();
  const paintOrder = derivePaintOrderFact(domTree);
  const { fact: membership, membersByLayerId } = rawResult.available
    ? computeLayerMembership(domTree, rawResult.layers)
    : { fact: { available: false, reason: `layertree-unavailable: ${rawResult.reason}`, unassignedCount: 0 }, membersByLayerId: new Map<string, readonly number[]>() };

  try {
    const { items: rawLayers, truncated: layersTruncated } = capArray(rawResult.layers, MAX_LAYERS);

    const records: LayerRecord[] = await Promise.all(
      rawLayers.map(async (layer, index) => {
        // I-5: an explicit try/catch (not `.catch(() => ({}))`) so a failed read can be
        // distinguished from a genuinely reasonless layer — both would otherwise serialize as
        // the identical `compositingReasons: []` shape.
        let compositingReasons: string[] = [];
        let compositingReasonsUnavailable: true | undefined;
        try {
          const reasons = (await client.send('LayerTree.compositingReasons', { layerId: layer.layerId })) as CompositingReasonsResult;
          // A genuine field is an actual array (even empty). A field present but the WRONG type
          // (e.g. `null`, a string) is just as malformed as the field being absent entirely —
          // `Array.isArray`, not a `=== undefined` check, is what distinguishes "CDP sent us real
          // data" from "CDP sent us a field name with nothing real in it".
          const reasonsArray = Array.isArray(reasons.compositingReasons) ? reasons.compositingReasons : undefined;
          const reasonIdsArray = Array.isArray(reasons.compositingReasonIds) ? reasons.compositingReasonIds : undefined;
          if (reasonsArray === undefined && reasonIdsArray === undefined) {
            // Neither field resolved to a real array — CDP always returns at least one of the two as
            // an actual array (possibly empty) on a genuinely reasonless layer, so this is a read
            // failure, not a real observation, and must not silently coerce into the same `[]` shape.
            compositingReasonsUnavailable = true;
          } else {
            compositingReasons = reasonsArray?.length ? reasonsArray : (reasonIdsArray ?? []);
          }
        } catch {
          compositingReasonsUnavailable = true;
        }

        const members = membership.available ? (membersByLayerId.get(layer.layerId) ?? []) : [];
        const { items: memberBackendNodeIds, truncated: membersTruncated } = capArray(members, MAX_LAYER_MEMBERS);

        let selector: string | null = null;
        let selectorUnavailable: true | undefined;
        let styleProvenance: LayerRecord['styleProvenance'];
        let styleProvenanceUnavailable: true | undefined;
        if (layer.backendNodeId !== undefined) {
          try {
            const described = (await client.send('DOM.describeNode', { backendNodeId: layer.backendNodeId })) as { node?: DescribedNode };
            const raw = selectorFromDescribedNode(described.node);
            if (raw != null) {
              selector = sanitizeString(raw);
            } else {
              // `selectorFromDescribedNode` returns null ONLY when `node`/`node.nodeName` is absent —
              // CDP documents `nodeName` as a required field of `DOM.Node`, so a real described node
              // never lacks one. A null result here is always a malformed response, not a genuinely
              // nameless node, and must not silently coerce into the same `selector:null` shape a
              // failed read produces.
              selector = null;
              selectorUnavailable = true;
            }
          } catch {
            selector = null;
            selectorUnavailable = true;
          }
          const styleResult = await resolveStyleProvenance(client, layer.backendNodeId, styleSheetUrls, sourceCache);
          styleProvenance = styleResult.declaration;
          if (styleResult.unavailable) styleProvenanceUnavailable = true;
        }

        // I-5 / borderline guidance: `drawsContent`/`paintCount` are CDP-required `LayerTree.Layer`
        // fields — a runtime TYPE check (not `=== undefined`), because a malformed delivery can carry
        // the field as the wrong type (e.g. `null`) just as easily as omit it outright, and either
        // shape is equally a read failure, not a genuine `false`/`0` observation.
        const drawsContentPresent = typeof layer.drawsContent === 'boolean';
        const paintCountPresent = typeof layer.paintCount === 'number';

        return {
          id: layer.layerId,
          backendNodeId: layer.backendNodeId ?? null,
          selector,
          bounds: { x: layer.offsetX, y: layer.offsetY, width: layer.width, height: layer.height },
          layerPaintOrder: index,
          parentLayerId: layer.parentLayerId ?? null,
          drawsContent: drawsContentPresent ? layer.drawsContent! : false,
          paintCount: paintCountPresent ? layer.paintCount! : 0,
          compositingReasons,
          memberCount: members.length,
          memberBackendNodeIds,
          membersTruncated,
          ...(compositingReasonsUnavailable ? { compositingReasonsUnavailable } : {}),
          ...(styleProvenance ? { styleProvenance } : {}),
          ...(styleProvenanceUnavailable ? { styleProvenanceUnavailable } : {}),
          ...(selectorUnavailable ? { selectorUnavailable } : {}),
          ...(drawsContentPresent ? {} : { drawsContentUnavailable: true as const }),
          ...(paintCountPresent ? {} : { paintCountUnavailable: true as const }),
        };
      }),
    );

    const report: LayersReport = {
      layerTree: rawResult.available ? { available: true } : { available: false, reason: rawResult.reason },
      layers: records,
      layersTruncated,
      paintOrder,
      layerPaintOrder: records.map((r) => r.id),
      membership,
      styleSheetHeaders: styleSheetHeadersAvailable ? { available: true } : { available: false, reason: styleSheetHeadersReason },
    };

    ctx.write.json('layers.json', report);
  } finally {
    stopTrackingStyleSheets();
  }
};
