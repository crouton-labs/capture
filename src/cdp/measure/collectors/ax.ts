/**
 * `ax.json` collector — the full accessibility tree (`Accessibility.
 * getFullAXTree()`) flattened into a per-node index: role, name,
 * description, ignored/ignoredReasons, a curated allowlist of ARIA
 * states, and the AX parent/child structure. `backendNodeId` (from
 * `backendDOMNodeId`, free on every AX node) is the cross-file join key
 * shared with `styles.json`/`media.json` per the U04 contract — no
 * coordination with those files is needed.
 *
 * "geometry ids ... when possible": U07's `geometry.json` is a
 * concurrently-written sibling collector (`Promise.all` in `snapshot.ts`,
 * no cross-collector read ordering) that this file must not depend on or
 * read at capture time. Read here as "attach a `rect` fact directly per AX
 * node via a best-effort `DOM.getBoxModel` lookup" rather than a join
 * against `geometry.json` — a deliberate, bounded reading documented in
 * the U08 build-plan report, not a defect.
 */

import { axisAlignedRectFromQuad, type Quad, type Rect } from '../../coordinates.js';
import { capArray, sanitizeString } from '../redaction.js';
import type { Collector } from '../types.js';

/** How many non-ignored AX nodes (with a `backendDOMNodeId`) get a follow-up `DOM.getBoxModel` rect lookup. */
const AX_MAX_RECT_LOOKUPS = 300;
/** Hard cap on AX nodes written to `ax.json` — the AX tree is page-controlled and otherwise unbounded; a generous bound keeps the artifact size sane. Nodes beyond this are dropped (in document order) and counted in `truncated`. */
const AX_MAX_NODES = 5000;

/** Curated allowlist of AX properties surfaced as `states` — the common interactive/structural states, not the full CDP property list. */
const STATE_ALLOWLIST = [
  'checked',
  'expanded',
  'disabled',
  'invalid',
  'pressed',
  'selected',
  'required',
  'readonly',
  'multiselectable',
  'busy',
  'hidden',
  'modal',
] as const;

// ============================================================================
// Raw CDP shapes (modeled locally — no CDP protocol package is imported)
// ============================================================================

interface AXPropertyValue {
  type: string;
  value?: unknown;
}

interface AXProperty {
  name: string;
  value: AXPropertyValue;
}

interface AXNode {
  nodeId: string;
  ignored: boolean;
  ignoredReasons?: AXProperty[];
  role?: AXPropertyValue;
  name?: AXPropertyValue;
  description?: AXPropertyValue;
  properties?: AXProperty[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

// ============================================================================
// Output shape
// ============================================================================

export interface AxNodeRecord {
  id: string;
  axId: string;
  role: unknown;
  axName?: string;
  description?: string;
  ignored: boolean;
  ignoredReasons: string[];
  backendNodeId?: number;
  parentAxId?: string;
  childAxIds: string[];
  states: Record<string, unknown>;
  /** Present only when the per-node `DOM.getBoxModel` lookup was attempted (node is eligible: not ignored, has a `backendDOMNodeId`, and wasn't skipped by {@link AxReport.rectLookupsTruncated}) AND succeeded with a real content quad. Absent for an ineligible/skipped node (never attempted) and for an attempted-but-failed node (see {@link rectUnavailable}) -- both of those also omit `rect`, but only the latter carries a failure marker. */
  rect?: Rect;
  /**
   * `true` when this node's `DOM.getBoxModel` rect lookup was ATTEMPTED and
   * FAILED (threw, or returned no/malformed `model.content`) -- distinct
   * from a node whose lookup was never attempted at all (ignored, no
   * `backendDOMNodeId`, or skipped by {@link AxReport.rectLookupsTruncated}),
   * which also omits `rect` but carries no failure marker (I-5: a genuine
   * "not attempted"/scope omission must not look identical to a genuine
   * read failure). See {@link AxRectUnavailableReason} for which failure.
   * Absent (not `false`) when the lookup wasn't attempted or succeeded.
   */
  rectUnavailable?: true;
  /** Present only when {@link rectUnavailable} is `true`. */
  rectUnavailableReason?: AxRectUnavailableReason;
}

/**
 * Fixed, factual reason a single AX node's per-node `DOM.getBoxModel` rect
 * lookup did not complete -- never a raw exception message. Present only on
 * {@link AxNodeRecord.rectUnavailable}.
 *
 * - `box-model-read-threw`: `DOM.getBoxModel` itself threw (protocol error,
 *   detached/invalid backend node reference, ...) -- a genuine read
 *   failure, NOT proof the node has no box. Empirically, a genuinely
 *   non-rendered element (e.g. `display:none`) is excluded from the AX tree
 *   entirely (or arrives `ignored`) and so is never in the eligible set this
 *   function attempts at all; a REAL zero-size rendered box (e.g.
 *   `width:0;height:0;overflow:hidden`) resolves `DOM.getBoxModel`
 *   successfully with a degenerate (zero-area) content quad rather than
 *   throwing. A throw on an eligible node is therefore a read failure to
 *   report, not a silent "no box" to infer.
 * - `box-model-no-content`: `DOM.getBoxModel` resolved without throwing but
 *   the response carried no `model.content` field, `content` was not an
 *   array of exactly 8 entries, or one of those 8 entries was not a finite
 *   number (e.g. `NaN`/non-numeric) -- any malformed response, distinct
 *   from a clean 8-finite-number quad (which is honestly represented as a
 *   real, if possibly degenerate/zero-area, `rect`). A partially-numeric or
 *   `NaN`-bearing quad is never silently coerced through
 *   `axisAlignedRectFromQuad` -- that would emit a `NaN` rect that
 *   serializes as `null` fields with no failure marker at all.
 */
export type AxRectUnavailableReason = 'box-model-read-threw' | 'box-model-no-content';

/** Fixed, factual reason `Accessibility.getFullAXTree` could not be read (never a raw exception message, which is unbounded/page-influenced) — present only when {@link AxReport.available} is `false`. */
export type AxUnavailableReason = 'axtree-unavailable' | 'axtree-returned-no-nodes';

export interface AxReport {
  nodes: AxNodeRecord[];
  /** Present only when the tree exceeded {@link AX_MAX_NODES} — the count of AX nodes dropped past the cap. */
  truncated?: number;
  /** Present only when the eligible (non-ignored, with a `backendDOMNodeId`) node set exceeded {@link AX_MAX_RECT_LOOKUPS} — the count of nodes whose `rect` lookup was skipped by the cap, so their `rect` is absent by cap rather than by measurement (e.g. non-rendered). */
  rectLookupsTruncated?: number;
  /** Explicit scope fact (D5): `Accessibility.getFullAXTree` is top-document only, so omission of iframe AX nodes is a stated scope boundary, never a negative fact. */
  coverage: { scope: 'top-document' };
  /** `false` when `Accessibility.getFullAXTree` itself failed (threw, or returned no `nodes` field) — `nodes: []` is then "could not collect", not "genuinely empty tree" (I-5). Always `true` on a normal run, including one where the page genuinely has no AX nodes. */
  available: boolean;
  /** Present only when `available` is `false`. */
  unavailableReason?: AxUnavailableReason;
}

// ============================================================================
// Helpers
// ============================================================================

/** Sanitizes an optional page-controlled AX string (name/description) through the shared redactor/capper, or returns `undefined` when absent. */
function sanitizeOptional(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return sanitizeString(value);
}

function deriveStates(properties: AXProperty[] | undefined): Record<string, unknown> {
  const states: Record<string, unknown> = {};
  if (!properties) return states;
  for (const prop of properties) {
    if ((STATE_ALLOWLIST as readonly string[]).includes(prop.name)) {
      states[prop.name] = prop.value?.value;
    }
  }
  return states;
}

// ============================================================================
// Collector
// ============================================================================

export const collectAx: Collector = async (ctx) => {
  const { client } = ctx;

  // I-5: a missing `nodes` field (the read failed) and a genuinely empty tree both look like `[]`
  // unless the failure is distinguished explicitly — `available:false` is the honest signal a
  // downstream reader needs to tell "could not collect" from "the page really has zero AX nodes".
  let allAxNodes: AXNode[];
  let available = true;
  let unavailableReason: AxUnavailableReason | undefined;
  try {
    const treeResponse = (await client.send('Accessibility.getFullAXTree')) as { nodes?: AXNode[] };
    if (treeResponse.nodes === undefined) {
      allAxNodes = [];
      available = false;
      unavailableReason = 'axtree-returned-no-nodes';
    } else {
      allAxNodes = treeResponse.nodes;
    }
  } catch {
    allAxNodes = [];
    available = false;
    unavailableReason = 'axtree-unavailable';
  }
  const axNodes = allAxNodes.slice(0, AX_MAX_NODES);
  const truncated = allAxNodes.length > AX_MAX_NODES ? allAxNodes.length - AX_MAX_NODES : undefined;

  const {
    rects: rectByNodeId,
    failures: rectFailureByNodeId,
    truncated: rectLookupsTruncated,
  } = await resolveRects(client, axNodes);

  const nodes: AxNodeRecord[] = axNodes.map((node, index) => {
    const nameValue = node.name?.value;
    const descriptionValue = node.description?.value;
    const rectFailureReason = node.backendDOMNodeId !== undefined ? rectFailureByNodeId.get(node.backendDOMNodeId) : undefined;
    return {
      id: `ax-${index}`,
      axId: node.nodeId,
      role: node.role?.value ?? null,
      axName: sanitizeOptional(nameValue === undefined || nameValue === null ? undefined : String(nameValue)),
      description: sanitizeOptional(descriptionValue === undefined || descriptionValue === null ? undefined : String(descriptionValue)),
      ignored: node.ignored,
      ignoredReasons: (node.ignoredReasons ?? []).map((r) => r.name),
      backendNodeId: node.backendDOMNodeId,
      parentAxId: node.parentId,
      childAxIds: node.childIds ?? [],
      states: deriveStates(node.properties),
      rect: node.backendDOMNodeId !== undefined ? rectByNodeId.get(node.backendDOMNodeId) : undefined,
      ...(rectFailureReason !== undefined ? { rectUnavailable: true as const, rectUnavailableReason: rectFailureReason } : {}),
    };
  });

  ctx.write.json('ax.json', {
    nodes,
    truncated,
    rectLookupsTruncated: rectLookupsTruncated > 0 ? rectLookupsTruncated : undefined,
    coverage: { scope: 'top-document' },
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
  } satisfies AxReport);
};

/**
 * Best-effort `rect` lookup for up to {@link AX_MAX_RECT_LOOKUPS} non-ignored
 * AX nodes with a `backendDOMNodeId`, in tree order. A genuine per-node read
 * FAILURE (the `DOM.getBoxModel` call throws, or resolves with no/malformed
 * `model.content`) is reported back in `failures` (I-5 — see
 * {@link AxRectUnavailableReason}), never silently folded into "no rect";
 * only a node this function never attempts at all (filtered out of
 * `eligible`, or skipped by the cap) legitimately omits both `rect` and a
 * failure marker. Nodes skipped by the cap are counted in the returned
 * `truncated` (a cap that can drop real data emits a fact, via the shared
 * {@link capArray} authority).
 */
async function resolveRects(
  client: Parameters<Collector>[0]['client'],
  axNodes: readonly AXNode[],
): Promise<{ rects: Map<number, Rect>; failures: Map<number, AxRectUnavailableReason>; truncated: number }> {
  const eligible = axNodes.filter((node) => !node.ignored && node.backendDOMNodeId !== undefined);
  const { items: capped, truncated } = capArray(eligible, AX_MAX_RECT_LOOKUPS);

  const rects = new Map<number, Rect>();
  const failures = new Map<number, AxRectUnavailableReason>();
  for (const node of capped) {
    const backendNodeId = node.backendDOMNodeId as number;
    try {
      const boxResponse = (await client.send('DOM.getBoxModel', { backendNodeId })) as {
        model?: { content: number[] };
      };
      const content = boxResponse.model?.content;
      if (!Array.isArray(content) || content.length !== 8 || !content.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        failures.set(backendNodeId, 'box-model-no-content');
        continue;
      }
      rects.set(backendNodeId, axisAlignedRectFromQuad(content as Quad));
    } catch {
      // A genuine read failure (protocol error, detached/invalid node) — NOT proof of "no box"; see
      // AxRectUnavailableReason's `box-model-read-threw` doc for why a real non-rendered element never
      // reaches this catch. Mark it explicitly rather than silently omitting the rect.
      failures.set(backendNodeId, 'box-model-read-threw');
    }
  }

  return { rects, failures, truncated };
}
