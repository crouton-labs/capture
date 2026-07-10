/**
 * `styles.json` collector — computed style values plus winning-rule
 * provenance (which selector/rule wins a property, by what specificity,
 * from where in the authored source) for a bounded, document-order set of
 * elements.
 *
 * The cascade/specificity/source-resolution engine and the
 * `CSS.styleSheetAdded` header-capture helper live in `./style-provenance.js`
 * — shared with `layers.ts`'s layer-triggering-property provenance so both
 * collectors report identical winning-declaration semantics instead of two
 * parallel implementations. This file also exports {@link resolveNodeIds}
 * and {@link computeSpecificity} (re-exported from that shared module) —
 * the CDP `nodeId`+`backendNodeId` correlation helper built for this
 * file's `CSS.getMatchedStylesForNode` calls (which need a CDP `nodeId`,
 * not just a `backendNodeId`) and reused by `media.ts` for its own
 * per-element `backendNodeId` correlation. Both `styles.ts` and `media.ts`
 * independently issue their own `Runtime.evaluate`/`DOM.getDocument`
 * calls — they run concurrently in `snapshot.ts`'s `Promise.all`, so there
 * is no cross-collector call sharing beyond this shared, stateless logic.
 */

import type { ResolvedSourceLocation } from '../../source-map.js';
import { sanitizeString } from '../redaction.js';
import type { Collector } from '../types.js';
import {
  buildWinningDeclarations,
  captureStyleSheetHeaders,
  computeSpecificity,
  resolveNodeIds,
  type CDPMatchedStylesResponse,
  type WinningDeclaration,
} from './style-provenance.js';

export { computeSpecificity, resolveNodeIds };
export type { Specificity, CSSRange, WinningDeclaration } from './style-provenance.js';

const STYLES_MAX_ELEMENTS = 150;

/** Full computed-style snapshot tracked per element — broad, cheap (no CDP round trip; read via `getComputedStyle` in one `Runtime.evaluate`). */
const COMPUTED_PROPERTIES = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height',
  'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-radius',
  'box-sizing', 'z-index', 'opacity', 'visibility', 'overflow-x', 'overflow-y',
  'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height',
  'text-align', 'text-overflow', 'white-space',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'flex-grow', 'flex-shrink', 'flex-basis',
  'grid-template-columns', 'grid-template-rows',
  'transform', 'filter', 'cursor', 'pointer-events',
] as const;

/** The smaller subset tracked for winning-declaration provenance — bounded by the `CSS.getMatchedStylesForNode` round trip cost per element. */
const PROVENANCE_PROPERTIES = [
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'width', 'height', 'color', 'background-color', 'font-size', 'font-weight',
  'border-radius', 'z-index', 'display', 'position',
] as const;

// ============================================================================
// Output shape
// ============================================================================

export interface StylesElementRecord {
  id: string;
  selector?: string;
  /** `null` when this element's identity could not be resolved (see {@link identityUnresolved}) — never simply omitted (I-3). */
  backendNodeId: number | null;
  /** `true` when {@link backendNodeId} is `null` because this element's `cssPath` selector did not resolve to a CDP node — absent (not `false`) when resolved, matching hittest.ts's convention. */
  identityUnresolved?: true;
  computed: Record<string, string | null>;
  winningDeclarations: WinningDeclaration[];
  /** `true` when node correlation or `CSS.getMatchedStylesForNode` failed for this element — `winningDeclarations` is empty because provenance could not be inspected, not because no rule matched anything. This is DISTINCT from {@link identityUnresolved}: `provenanceUnavailable` means "couldn't inspect the winning CSS rule", not "couldn't resolve this element's identity" — an element can have a resolved `backendNodeId` and still have `provenanceUnavailable` (e.g. `CSS.getMatchedStylesForNode` itself failed). */
  provenanceUnavailable?: boolean;
}

/**
 * Explicit factual scope for `styles.json` (D5). The in-page enumeration is
 * `document.querySelectorAll('*')` on the top document — light-DOM only,
 * non-piercing (`pierce:false` in spirit): it walks neither nested iframe
 * documents nor shadow roots. Absent iframe/shadow styles are a stated scope
 * boundary, not a negative fact. Counts state exactly what was skipped.
 */
export interface StylesCoverage {
  scope: 'top-document';
  /** Count of `<iframe>` elements in the top document whose contents are NOT enumerated. */
  iframesNotWalked: number;
  /** Count of shadow-root hosts in the top document whose shadow trees are NOT enumerated. */
  shadowRootsNotWalked: number;
  /** Total elements that passed the tag/visible-rect filter — the uncapped candidate count, before {@link STYLES_MAX_ELEMENTS} applies. */
  totalCandidateElements: number;
  /** Elements actually emitted in `elements[]` — `<= totalCandidateElements`, and `<= STYLES_MAX_ELEMENTS`. */
  keptElements: number;
  /** `true` when {@link STYLES_MAX_ELEMENTS} dropped one or more candidate elements from enumeration — an explicit fact (I-5), never a silent cap. */
  elementsTruncated: boolean;
}

export interface StylesReport {
  elements: StylesElementRecord[];
  coverage: StylesCoverage;
  /** Availability of the `CSS.styleSheetAdded` header capture this snap's provenance resolution depends on (I-5) — `available:false` means any missing `sourceStyleSheetUrl`/`generated` source below is a capture failure, not "genuinely no source". */
  styleSheetHeaders: { available: boolean; reason?: string };
  /** Explicit identity-resolution availability fact (I-4), mirroring media.json: `available:false` means `backendNodeId` was never attempted for ANY element this run (`DOM.getDocument`/`resolveNodeIds` failed) — distinct from a per-element `backendNodeId` simply being `null` because that one element's selector didn't resolve while the system was healthy. */
  identity: { available: true } | { available: false; reason: string };
  /** `false` when the `STYLES_SCRIPT` inventory `Runtime.evaluate` itself failed (threw, or returned no `value`) — `elements: []` is then "could not collect", not "genuinely no styleable elements" (I-5). Always `true` on a normal run. */
  available: boolean;
  /** Present only when `available` is `false`. */
  unavailableReason?: StylesUnavailableReason;
}

/** Fixed, factual reason `STYLES_SCRIPT`'s `Runtime.evaluate` could not be read (never a raw exception message, which is unbounded/page-influenced) — present only when {@link StylesReport.available} is `false`. */
export type StylesUnavailableReason = 'styles-evaluate-returned-no-value' | 'styles-evaluate-threw';

// ============================================================================
// In-page script — cssPath + computed style facts, no DOM domain calls
// ============================================================================

// `html`/`body` are excluded: `cssPathFromBody` is rooted AT `document.body`, so it produces `''` for
// the body element itself and `body > html` for the (out-of-subtree) html element — neither is a valid
// `body > ...` selector for `resolveNodeIds` to query. Both are structural roots, not measurable subjects.
const EXCLUDED_TAGS = ['html', 'body', 'script', 'style', 'head', 'meta', 'link', 'title', 'template', 'noscript', 'br', 'wbr'];

interface StylesFact {
  cssPath: string;
  computed: Record<string, string | null>;
}

interface StylesInventory {
  elements: StylesFact[];
  /** Total elements passing the tag/visible-rect filter, counted even past the {@link STYLES_MAX_ELEMENTS} cap (I-5) — `elements.length` alone cannot distinguish "the page had exactly this many" from "the cap stopped counting". */
  total: number;
  iframesNotWalked: number;
  shadowRootsNotWalked: number;
}

const STYLES_SCRIPT = `/* __captureStylesInventory */
(function() {
  var EXCLUDED = ${JSON.stringify(EXCLUDED_TAGS)};
  var PROPS = ${JSON.stringify(COMPUTED_PROPERTIES)};
  var excludedSet = {};
  for (var e = 0; e < EXCLUDED.length; e++) excludedSet[EXCLUDED[e]] = true;

  function cssPathFromBody(el) {
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 40) {
      var parent = node.parentElement;
      if (!parent) { parts.unshift(node.tagName.toLowerCase()); break; }
      var same = Array.prototype.filter.call(parent.children, function(c) { return c.tagName === node.tagName; });
      var idx = same.indexOf(node) + 1;
      parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + idx + ')');
      node = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  var all = document.querySelectorAll('*');
  // Scope facts (D5): the enumeration is light-DOM only (querySelectorAll does not
  // pierce iframe documents or shadow roots), so count what is deliberately skipped.
  var iframesNotWalked = 0;
  var shadowRootsNotWalked = 0;
  for (var c = 0; c < all.length; c++) {
    if (all[c].tagName === 'IFRAME') iframesNotWalked++;
    if (all[c].shadowRoot) shadowRootsNotWalked++;
  }
  var out = [];
  var total = 0;
  // Scans the FULL element set (not stopping at the cap) so total is an honest count of every
  // candidate the cap dropped, not just an estimate (I-5) — the enumeration itself is cheap
  // relative to the getComputedStyle() calls this loop already skips once the cap is reached.
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var tag = el.tagName.toLowerCase();
    if (excludedSet[tag]) continue;
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) continue;
    total++;
    if (out.length >= ${STYLES_MAX_ELEMENTS}) continue;
    var cs;
    try { cs = getComputedStyle(el); } catch (err) { continue; }
    var computed = {};
    for (var p = 0; p < PROPS.length; p++) {
      try { computed[PROPS[p]] = cs.getPropertyValue(PROPS[p]); } catch (err2) { computed[PROPS[p]] = null; }
    }
    out.push({ cssPath: cssPathFromBody(el), computed: computed });
  }
  return { elements: out, total: total, iframesNotWalked: iframesNotWalked, shadowRootsNotWalked: shadowRootsNotWalked };
})();`;

function normalizeComputed(raw: Record<string, string | null> | undefined): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const prop of COMPUTED_PROPERTIES) {
    const value = raw?.[prop];
    out[prop] = typeof value === 'string' ? sanitizeString(value) : null;
  }
  return out;
}

/** Honest `{ backendNodeId, identityUnresolved }` pair for an element-bearing record — mirrors hittest.ts's `resolvedIdentity` helper (I-3/I-5, inlined locally per collector rather than imported/shared): a resolved identity carries just `backendNodeId`; an unresolved one carries `backendNodeId: null` + `identityUnresolved: true`, never a silently-omitted field. */
function resolvedIdentity(backendNodeId: number | undefined): { backendNodeId: number | null; identityUnresolved?: true } {
  return backendNodeId === undefined ? { backendNodeId: null, identityUnresolved: true } : { backendNodeId };
}

// ============================================================================
// Collector
// ============================================================================

export const collectStyles: Collector = async (ctx) => {
  const { client } = ctx;

  // Registers the CSS.styleSheetAdded listener and forces header redelivery
  // BEFORE anything else touches the CSS domain — see style-provenance.ts's
  // module doc for why this must run first and why it's safe alongside the
  // concurrently-running `layers` collector's own copy of the same step.
  const {
    urls: styleSheetUrls,
    stop: stopTrackingStyleSheets,
    available: styleSheetHeadersAvailable,
    reason: styleSheetHeadersReason,
  } = await captureStyleSheetHeaders(client);
  try {
    await collectStylesInner(ctx, styleSheetUrls, { available: styleSheetHeadersAvailable, reason: styleSheetHeadersReason });
  } finally {
    stopTrackingStyleSheets();
  }
};

async function collectStylesInner(
  ctx: Parameters<Collector>[0],
  styleSheetUrls: Map<string, string>,
  styleSheetHeaders: { available: boolean; reason?: string },
): Promise<void> {
  const { client } = ctx;

  // I-5: a missing `value` (the eval failed/returned nothing) is currently coerced into an empty
  // inventory, indistinguishable from a genuinely element-free page unless the failure itself is
  // surfaced as an explicit report-level fact.
  let inventory: StylesInventory;
  let available = true;
  let unavailableReason: StylesUnavailableReason | undefined;
  try {
    const evalResponse = (await client.send('Runtime.evaluate', {
      expression: STYLES_SCRIPT,
      returnByValue: true,
    })) as { result?: { value?: StylesInventory } };
    const value = evalResponse.result?.value;
    if (value === undefined) {
      inventory = { elements: [], total: 0, iframesNotWalked: 0, shadowRootsNotWalked: 0 };
      available = false;
      unavailableReason = 'styles-evaluate-returned-no-value';
    } else {
      inventory = value;
    }
  } catch {
    inventory = { elements: [], total: 0, iframesNotWalked: 0, shadowRootsNotWalked: 0 };
    available = false;
    unavailableReason = 'styles-evaluate-threw';
  }
  const facts = inventory.elements;

  // I-3/I-4: distinguishes a whole-run identity-resolution failure (DOM.getDocument/resolveNodeIds
  // never even ran) from a per-element miss (that one element's selector didn't resolve while the
  // system was healthy) — mirrors media.ts's `identity` fact exactly.
  let documentNodeId: number | undefined;
  let identity: StylesReport['identity'] = { available: true };
  try {
    const docResponse = (await client.send('DOM.getDocument', { depth: 0 })) as { root?: { nodeId: number } };
    documentNodeId = docResponse.root?.nodeId;
    if (documentNodeId === undefined) {
      identity = { available: false, reason: 'dom-getdocument-unavailable' };
    }
  } catch {
    documentNodeId = undefined;
    identity = { available: false, reason: 'dom-getdocument-unavailable' };
  }

  let resolved: Array<{ nodeId?: number; backendNodeId?: number } | undefined>;
  if (documentNodeId !== undefined) {
    try {
      resolved = await resolveNodeIds(client, documentNodeId, facts.map((f) => f.cssPath));
    } catch {
      resolved = facts.map(() => undefined);
      identity = { available: false, reason: 'resolve-node-ids-failed' };
    }
  } else {
    resolved = facts.map(() => undefined);
  }

  const sourceCache = new Map<string, Promise<ResolvedSourceLocation>>();

  const elements: StylesElementRecord[] = await Promise.all(
    facts.map(async (fact, index) => {
      const ref = resolved[index];
      const computed = normalizeComputed(fact.computed);

      // A `noDeclarationRecord` is reserved for a SUCCESSFUL matched-styles response that genuinely had
      // no candidate for a property — an honest "nothing declares this" fact. When provenance itself
      // couldn't be inspected (no CDP nodeId, or `CSS.getMatchedStylesForNode` failed), that's a different
      // fact — "unknown", not "none" — so `winningDeclarations` is left empty and `provenanceUnavailable`
      // is set, rather than conflating the two into misleading no-declaration records.
      let winningDeclarations: WinningDeclaration[];
      let provenanceUnavailable: boolean | undefined;
      if (ref?.nodeId !== undefined) {
        try {
          const matched = (await client.send('CSS.getMatchedStylesForNode', {
            nodeId: ref.nodeId,
          })) as CDPMatchedStylesResponse;
          winningDeclarations = await buildWinningDeclarations(
            client,
            matched,
            computed,
            sourceCache,
            styleSheetUrls,
            PROVENANCE_PROPERTIES,
          );
        } catch {
          winningDeclarations = [];
          provenanceUnavailable = true;
        }
      } else {
        winningDeclarations = [];
        provenanceUnavailable = true;
      }

      return {
        id: `s-${index}`,
        selector: sanitizeString(fact.cssPath),
        ...resolvedIdentity(ref?.backendNodeId),
        computed,
        winningDeclarations,
        provenanceUnavailable,
      };
    }),
  );

  ctx.write.json('styles.json', {
    elements,
    coverage: {
      scope: 'top-document',
      iframesNotWalked: inventory.iframesNotWalked,
      shadowRootsNotWalked: inventory.shadowRootsNotWalked,
      totalCandidateElements: inventory.total,
      keptElements: elements.length,
      elementsTruncated: inventory.total > elements.length,
    },
    styleSheetHeaders: styleSheetHeaders,
    identity,
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
  } satisfies StylesReport);
}
