/**
 * Shared cascade/winning-declaration + generated-source-header provenance
 * engine, used by both `styles.ts` (per-element computed-style provenance)
 * and `layers.ts` (layer-triggering-property provenance) — ONE
 * implementation of "which declaration wins a property, by what
 * specificity/importance, from where in the authored/generated source"
 * instead of two parallel ones. Each caller supplies its own `nodeId` +
 * `CSS.getMatchedStylesForNode` response, its own computed-value map, and
 * its own property list; this module owns only the cascade math and the
 * source resolution.
 *
 * **Judgment call (inherited from the styles collector's original v1
 * design):** the cascade/specificity model is a simplified v1 for a
 * measurement tool — no `@layer`, no full `:not()`/`:is()` specificity
 * nuance, no cross-origin/user-agent importance ordering beyond a
 * two-tier important/non-important split. Good enough to report "which
 * rule won and why" for the overwhelming majority of real pages; not a
 * spec-perfect cascade resolver. A selector using `:where()` (spec:
 * always zero specificity) or `:is()`/`:matches()` (spec: the specificity
 * of its most specific argument) is scored by this module as an ordinary
 * pseudo-class token instead — every candidate whose matching selector
 * contains either construct is flagged via `winnerApproximate` /
 * `winnerApproximateReason:'selector-specificity-where-is-present'` (the
 * v1 winner is still reported, never silently re-picked).
 *
 * ## Stylesheet header capture — {@link captureStyleSheetHeaders}
 * `CSS.styleSheetAdded` only fires for a stylesheet at the moment CDP's
 * CSS domain transitions from disabled to enabled (proven empirically:
 * re-invoking `CSS.enable` while the domain is ALREADY enabled is a
 * no-op that redelivers nothing — only a `CSS.disable` + `CSS.enable`
 * pair forces Chrome to resend every currently-known stylesheet's
 * header). Both `styles.ts` and `layers.ts` run in the same `baseline`
 * `Promise.all` (see `snapshot.ts`), and `enableDomainsForSnap` already
 * enabled CSS once before either collector starts — so a caller-owned
 * listener registered only after that point would otherwise never see
 * the headers for stylesheets already parsed at that time. Each caller
 * runs `captureStyleSheetHeaders` independently, as the very first thing
 * it does (before any other CSS-domain call), and awaits it before
 * issuing any of its own `CSS.*` calls. Because listener registration is
 * synchronous (before any `await`), and JS never yields to socket I/O
 * mid-way through `Promise.all`'s synchronous dispatch of every baseline
 * collector, both this file's and the other collector's listeners are
 * always attached before either's disable/enable pair reaches Chrome —
 * so neither can miss the other's redelivery burst, and once both
 * callers' own `captureStyleSheetHeaders` calls resolve, the CSS domain
 * is stably enabled for the rest of the snapshot (neither file disables
 * it again).
 */

import { resolveAuthoredSourceLocation, type ResolvedSourceLocation } from '../../source-map.js';
import { sanitizeString } from '../redaction.js';
import type { CDPClient } from '../../client.js';

// ============================================================================
// Output shape
// ============================================================================

export interface Specificity {
  a: number;
  b: number;
  c: number;
}

export interface CSSRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface WinningDeclaration {
  property: string;
  /** The COMPUTED style value (`getComputedStyle`) for this property — not the raw declaration text, which can differ (custom properties, relative units, shorthands). */
  value: string | null;
  /** The raw winning declaration's own value text, as authored/serialized by CDP — `undefined` for the no-declaration case. */
  declaredValue?: string;
  /** `'inline'` for the `style` attribute, a selector string for a rule, or `null` when nothing declares this property. */
  selector: string | null;
  /** `"a-b-c"` display form, `null` for inline wins or the no-declaration case. */
  specificity: string | null;
  important?: boolean;
  sourceStyleSheetId?: string;
  /** The real stylesheet `sourceURL` from a `CSS.styleSheetAdded` header, when one was observed for `sourceStyleSheetId` — the human-meaningful counterpart to the opaque id. */
  sourceStyleSheetUrl?: string;
  range?: CSSRange;
  authored?: { file: string; line: number; column: number };
  /** The generated (post-build) CSS location, set for BOTH authored and generated results — the source-map fallback fact preserved even when no map resolves. */
  generated?: { sourceURL: string; line: number; column: number };
  mediaQuery?: string;
  containerQuery?: string;
  /** Present (and `null`) only when no candidate declares this property at all — an explicit "no declaration" fact, not an omission. */
  source?: null;
  /**
   * `true` when the candidate set for this property contains a rule this simplified cascade
   * engine cannot correctly order or place: a cascade `@layer`, an `@scope`, an unresolved
   * `revert`/`revert-layer` keyword, a matching selector using `:where()`/`:is()` (whose real
   * specificity this module's simplified {@link computeSpecificity} does not model), or a
   * declaration whose authored source position could not be traced at all (never the whole-rule
   * or `0:0` fallback pretending to be exact) — the reported `selector`/`declaredValue`/`range`
   * is the simplified model's best guess, NOT a guaranteed spec-accurate winner. Absent (not
   * `false`) when every candidate was fully resolvable, matching every other honesty flag in
   * this module.
   */
  winnerApproximate?: boolean;
  /** Why `winnerApproximate` is set — `'cascade-layers-present'`, `'cascade-scope-present'`, `'revert-keyword-present'`, `'selector-specificity-where-is-present'`, or `'source-range-unresolved'`. */
  winnerApproximateReason?: string;
  /**
   * `true` (I-4/I-5/I-10) when authored/generated source resolution was ATTEMPTED for this
   * declaration (a real property/rule range and `styleSheetId` existed to seed the lookup) but
   * {@link resolveAuthoredSourceLocation} REJECTED — e.g. a malformed source-map `mappings`
   * string throws synchronously inside the VLQ decoder — rather than resolving normally. This is
   * DISTINCT from a genuine no-authored-source case: `resolveAuthoredSourceLocation` itself
   * degrades a missing/unparseable/unfetchable source map to an honest `GeneratedLocation`
   * (never a rejection) for the ordinary minified/no-source-map-production case, so `authored`
   * absent with this flag ALSO absent still honestly means "no authored source (minified/prod)".
   * `authored` absent WITH this flag set means the opposite: resolution could not complete at
   * all, so whether an authored source exists is genuinely unknown — a failed read, not a
   * negative observation. `generated` is still populated from the already-known ref position
   * (the queried generated location, not something the failed resolution had to compute) so the
   * generated fallback fact is preserved even when resolution itself could not run.
   */
  sourceResolutionUnavailable?: boolean;
  /** The caught error's message, or `'source-resolution-failed'` when the caught value carries none. */
  sourceResolutionUnavailableReason?: string;
}

// ============================================================================
// computeSpecificity — a simplified {a,b,c} selector specificity tuple
// ============================================================================

/**
 * Computes a simplified `{a,b,c}` (id / class-attr-pseudoclass / type-pseudoelement)
 * specificity tuple for a CSS selector string. Strips recognized tokens in
 * cascade-relevant order so overlapping character classes (e.g. `:hover`
 * vs `::before`) aren't double-counted. Does not model `@layer`, full
 * `:not()`/`:is()` specificity delegation, or `:where()` (zero-specificity)
 * — a documented v1 simplification, not a spec-perfect implementation.
 */
export function computeSpecificity(selectorText: string): Specificity {
  let s = selectorText;
  let a = 0;
  let b = 0;
  let c = 0;

  const idMatches = s.match(/#[\w-]+/g);
  a += idMatches ? idMatches.length : 0;
  s = s.replace(/#[\w-]+/g, ' ');

  const attrMatches = s.match(/\[[^\]]*\]/g);
  b += attrMatches ? attrMatches.length : 0;
  s = s.replace(/\[[^\]]*\]/g, ' ');

  const classMatches = s.match(/\.[\w-]+/g);
  b += classMatches ? classMatches.length : 0;
  s = s.replace(/\.[\w-]+/g, ' ');

  const pseudoElementMatches = s.match(/::[\w-]+|:(?:before|after|first-line|first-letter)\b/g);
  c += pseudoElementMatches ? pseudoElementMatches.length : 0;
  s = s.replace(/::[\w-]+|:(?:before|after|first-line|first-letter)\b/g, ' ');

  const pseudoClassMatches = s.match(/:[\w-]+(\([^)]*\))?/g);
  b += pseudoClassMatches ? pseudoClassMatches.length : 0;
  s = s.replace(/:[\w-]+(\([^)]*\))?/g, ' ');

  const identMatches = s.match(/[a-zA-Z][a-zA-Z0-9-]*/g);
  c += identMatches ? identMatches.length : 0;

  return { a, b, c };
}

function compareSpecificity(x: Specificity, y: Specificity): number {
  return x.a - y.a || x.b - y.b || x.c - y.c;
}

// ============================================================================
// resolveNodeIds — shared backend-node-id correlation (used by media.ts too)
// ============================================================================

/**
 * Resolves each `path` (a `cssPathFromBody`-style `tag:nth-of-type(n) > ...`
 * string rooted at `body`) to its CDP `nodeId` (needed for
 * `CSS.getMatchedStylesForNode`) and `backendNodeId` (the stable cross-file
 * join key), via `DOM.querySelector` + `DOM.describeNode`. Sequential,
 * best-effort per path — a failed lookup pushes `undefined` rather than
 * aborting the batch; one bad path never drops the rest.
 */
export async function resolveNodeIds(
  client: CDPClient,
  documentNodeId: number,
  paths: readonly string[],
): Promise<Array<{ nodeId?: number; backendNodeId?: number } | undefined>> {
  const results: Array<{ nodeId?: number; backendNodeId?: number } | undefined> = [];

  for (const path of paths) {
    try {
      const queryResult = (await client.send('DOM.querySelector', {
        nodeId: documentNodeId,
        selector: `body > ${path}`,
      })) as { nodeId?: number };
      const nodeId = queryResult.nodeId;
      if (!nodeId) {
        results.push(undefined);
        continue;
      }
      try {
        const described = (await client.send('DOM.describeNode', { nodeId })) as {
          node?: { backendNodeId?: number };
        };
        results.push({ nodeId, backendNodeId: described.node?.backendNodeId });
      } catch {
        results.push({ nodeId });
      }
    } catch {
      results.push(undefined);
    }
  }

  return results;
}

// ============================================================================
// Raw CDP response shapes (modeled locally; no CDP protocol package)
// ============================================================================

export interface CDPCSSProperty {
  name: string;
  value: string;
  important?: boolean;
  implicit?: boolean;
  range?: CSSRange;
  /**
   * Present ONLY on a real, literally-authored SHORTHAND declaration (e.g. `margin`) — the
   * individual longhand properties (and their parsed values) it expands to. Real CDP
   * responses give each of these longhand names NO `range` of its own (the longhand text
   * never literally appears in source — only the shorthand's own `range`, on THIS entry,
   * is a real authored position) — see {@link buildRangeByProperty}.
   */
  longhandProperties?: Array<{ name: string; value: string }>;
}

export interface CDPSelectorItem {
  text: string;
  range?: CSSRange;
}

export interface CDPCSSRule {
  styleSheetId?: string;
  selectorList: { selectors: CDPSelectorItem[]; text: string };
  origin: string;
  style: { cssProperties: CDPCSSProperty[]; styleSheetId?: string; range?: CSSRange };
  media?: Array<{ text: string }>;
  containerQueries?: Array<{ text: string }>;
  /** Non-empty when the rule is nested inside one or more `@layer` blocks — a cascade-layer construct this simplified engine does not order (see {@link detectUnresolvedCascadeConstruct}). */
  layers?: Array<{ text: string }>;
  /** Non-empty when the rule is nested inside an `@scope` block — a construct this simplified engine does not order (see {@link detectUnresolvedCascadeConstruct}). */
  scopes?: Array<{ text: string }>;
}

export interface CDPMatchedStylesResponse {
  inlineStyle?: { cssProperties: CDPCSSProperty[] };
  matchedCSSRules?: Array<{ rule: CDPCSSRule; matchingSelectors: number[] }>;
}

// ============================================================================
// Cascade winner selection
// ============================================================================

interface Candidate {
  value: string;
  important: boolean;
  selectorText: string;
  specificity: Specificity;
  isInline: boolean;
  rule?: CDPCSSRule;
  range?: CSSRange;
  /**
   * Set when this candidate is only reportable approximately: its rule uses a construct
   * {@link detectUnresolvedCascadeConstruct} identifies as unorderable, its matching selector
   * uses a specificity construct {@link detectSelectorSpecificityApproximation} identifies as
   * unscoreable, or its authored source position could not be traced at all (see `range`'s
   * doc on {@link buildCandidates} — the whole-rule/`0:0` fallback is never reported as exact).
   */
  approximateReason?: string;
}

/**
 * Identifies the ONE class of matched-rule construct this simplified cascade engine cannot
 * correctly order: cascade `@layer`s (layer declaration order, not specificity/source-order,
 * decides the winner across layers), `@scope` (proximity, not specificity/source-order, can
 * decide the winner), and the `revert`/`revert-layer` keywords (which resolve to a DIFFERENT
 * cascade origin/layer entirely, not to "this candidate's value"). Returns the honest reason
 * string for {@link WinningDeclaration.winnerApproximate}, or `undefined` when the candidate is
 * fully within this engine's supported model — recognizing exactly what can be parsed exactly
 * and flagging the rest, never silently guessing (no lenient fallback path).
 */
function detectUnresolvedCascadeConstruct(rule: CDPCSSRule, declaredValue: string): string | undefined {
  if (rule.layers && rule.layers.length > 0) return 'cascade-layers-present';
  if (rule.scopes && rule.scopes.length > 0) return 'cascade-scope-present';
  const normalized = declaredValue.trim().toLowerCase();
  if (normalized === 'revert' || normalized === 'revert-layer') return 'revert-keyword-present';
  return undefined;
}

/**
 * Identifies the other class of construct this simplified {@link computeSpecificity} cannot
 * score correctly: `:where()` (spec: always zero specificity, regardless of its argument) and
 * `:is()`/`:matches()` (spec: the specificity of its most specific argument) — this module's
 * specificity model treats every pseudo-class token, including these, as a flat `b += 1`
 * contribution, so a selector using either can be scored higher OR lower than its real spec
 * specificity, and the winner picked among competing candidates may not be the true spec
 * winner. Returns the honest reason string for {@link WinningDeclaration.winnerApproximate}
 * (the v1 winner is still reported — this flags it, it never re-picks), or `undefined` when
 * the selector uses neither construct.
 */
function detectSelectorSpecificityApproximation(selectorText: string): string | undefined {
  return /:(?:where|is|matches)\(/i.test(selectorText) ? 'selector-specificity-where-is-present' : undefined;
}

/**
 * Maps each property name declared (directly or via a shorthand) in `rule` to the source
 * `range` of the declaration that actually sets it: its own literal `range` when directly
 * authored (`color: red;`), or the enclosing SHORTHAND's `range` when the property is only
 * ever expressed through that shorthand's {@link CDPCSSProperty.longhandProperties} (e.g.
 * `margin-top` from `margin: 10px 20px;`, which itself carries no `range` of its own — the
 * literal `margin-top` text never appears in source). Real CDP responses additionally append,
 * after every rule's literally-authored declarations, a flattened restatement of every
 * resolved longhand value with NO `range` of its own — a convenience duplicate, not a new
 * source location, so it is never itself a map source; iterating `cssProperties` in CDP's own
 * delivery order and overwriting on each RANGED match keeps this map's value the LAST
 * (cascade-winning) authored source for that property name, matching the same "later
 * declaration wins" source-order semantics {@link pickWinner} already applies to candidate
 * selection.
 */
function buildRangeByProperty(rule: CDPCSSRule): Map<string, CSSRange> {
  const rangeByProperty = new Map<string, CSSRange>();
  for (const p of rule.style.cssProperties) {
    if (!p.range) continue;
    rangeByProperty.set(p.name, p.range);
    if (p.longhandProperties) {
      for (const longhand of p.longhandProperties) rangeByProperty.set(longhand.name, p.range);
    }
  }
  return rangeByProperty;
}

/**
 * A rule's selector list can have multiple selectors (`.card, #hero`), and CDP reports every selector
 * in the list that matches the node via `matchingSelectors` (indices), not just the primary one. Use
 * the matching selector with the HIGHEST specificity — a rule wins its cascade slot by its best-matching
 * selector, not its first-listed one. Ties keep the first-encountered match (deterministic).
 */
function pickHighestSpecificitySelectorText(rule: CDPCSSRule, matchingSelectors: number[] | undefined): string {
  if (!matchingSelectors || matchingSelectors.length === 0) return rule.selectorList.text;
  let bestText: string | undefined;
  let bestSpecificity: Specificity | undefined;
  for (const idx of matchingSelectors) {
    const sel = rule.selectorList.selectors[idx];
    if (!sel) continue;
    const specificity = computeSpecificity(sel.text);
    if (!bestSpecificity || compareSpecificity(specificity, bestSpecificity) > 0) {
      bestSpecificity = specificity;
      bestText = sel.text;
    }
  }
  return bestText ?? rule.selectorList.text;
}

function buildCandidates(property: string, matched: CDPMatchedStylesResponse): Candidate[] {
  const candidates: Candidate[] = [];

  for (const entry of matched.matchedCSSRules ?? []) {
    const rule = entry.rule;
    if (rule.origin !== 'regular') continue;
    // CSS importance is resolved BEFORE source order: a rule can declare the same property more than
    // once with different importance (e.g. `color: red !important; color: blue;`), and the `!important`
    // one must win regardless of position. So push every non-implicit same-property declaration as its
    // own candidate, in source order, and let pickWinner's importance partition + source-order tiebreak
    // decide — do NOT collapse to a single "last declaration" here, which would discard importance info.
    const selectorText = pickHighestSpecificitySelectorText(rule, entry.matchingSelectors);
    const specificity = computeSpecificity(selectorText);
    const rangeByProperty = buildRangeByProperty(rule);
    for (const p of rule.style.cssProperties) {
      if (p.name !== property || p.implicit === true) continue;
      // `p.range` covers a literally-authored entry (direct declaration OR a shorthand
      // itself); `rangeByProperty` backfills the accurate authored source for CDP's
      // range-less restatement/synthesized-longhand entries. When NEITHER traces the property's
      // real position, `rule.style.range` is a last-resort SUBSTITUTE (the whole rule's span
      // standing in for one property's position) — that substitution is flagged approximate,
      // never reported as exact. A property with no range anywhere (not even a rule-level one)
      // stays honestly absent instead — an acknowledged gap, not a fabricated claim.
      const resolvedRange = p.range ?? rangeByProperty.get(p.name);
      const usedRuleRangeFallback = resolvedRange === undefined && rule.style.range !== undefined;
      candidates.push({
        value: p.value,
        important: p.important === true,
        selectorText,
        specificity,
        isInline: false,
        rule,
        range: resolvedRange ?? rule.style.range,
        approximateReason:
          detectUnresolvedCascadeConstruct(rule, p.value) ??
          detectSelectorSpecificityApproximation(selectorText) ??
          (usedRuleRangeFallback ? 'source-range-unresolved' : undefined),
      });
    }
  }

  for (const p of matched.inlineStyle?.cssProperties ?? []) {
    if (p.name !== property || p.implicit === true) continue;
    candidates.push({
      value: p.value,
      important: p.important === true,
      selectorText: 'inline',
      specificity: { a: 0, b: 0, c: 0 },
      isInline: true,
      range: p.range,
    });
  }

  return candidates;
}

/**
 * Picks the winning candidate: important declarations beat non-important
 * ones outright (a two-tier split, not a full important-origin ordering).
 * Within WHICHEVER pool is in play (important or non-important), an
 * inline `style` declaration always wins — the spec treats the style
 * attribute as a higher cascade tier than any selector-based rule, at
 * the SAME importance level, so inline `!important` beats stylesheet
 * `!important` too, not just inline-vs-non-important. Otherwise the
 * highest `{a,b,c}` specificity wins, ties broken by later position in
 * the candidate list (a document-order proxy for "declared later wins").
 */
function pickWinner(candidates: Candidate[]): Candidate | undefined {
  if (candidates.length === 0) return undefined;

  const importantPool = candidates.filter((c) => c.important);
  const nonImportantPool = candidates.filter((c) => !c.important);
  const pool = importantPool.length > 0 ? importantPool : nonImportantPool;

  for (let i = pool.length - 1; i >= 0; i--) {
    if (pool[i].isInline) return pool[i];
  }

  let best: Candidate | undefined;
  for (const candidate of pool) {
    if (!best || compareSpecificity(candidate.specificity, best.specificity) >= 0) {
      best = candidate;
    }
  }
  return best;
}

function noDeclarationRecord(property: string, value: string | null): WinningDeclaration {
  return { property, value, selector: null, specificity: null, source: null };
}

/**
 * Resolves the winning declaration (+ authored/generated source, via
 * source-map fallback) for each property in `properties`, given one
 * `CSS.getMatchedStylesForNode` response covering all of them. Shared by
 * `styles.ts` (a bounded per-element property set) and `layers.ts` (the
 * fixed layer-affecting property set).
 */
export async function buildWinningDeclarations(
  client: CDPClient,
  matched: CDPMatchedStylesResponse,
  computed: Record<string, string | null>,
  sourceCache: Map<string, Promise<ResolvedSourceLocation>>,
  styleSheetUrls: Map<string, string>,
  properties: readonly string[],
): Promise<WinningDeclaration[]> {
  const declarations: WinningDeclaration[] = [];

  for (const property of properties) {
    const candidates = buildCandidates(property, matched);
    const winner = pickWinner(candidates);
    if (!winner) {
      declarations.push(noDeclarationRecord(property, computed[property] ?? null));
      continue;
    }

    const specificityStr = winner.isInline ? null : `${winner.specificity.a}-${winner.specificity.b}-${winner.specificity.c}`;

    // Honesty check (I-4/I-10): if ANY candidate in play for this property — not just the
    // reported winner — uses a construct outside the simplified model (a cascade/scope/revert
    // construct, a `:where()`/`:is()` selector this specificity model can't score, or a
    // declaration whose authored source position couldn't be traced), the winner itself may be
    // wrong or its `range` approximate (e.g. a lower-specificity candidate in a higher-priority
    // `@layer` is the REAL winner in real Chrome; see the adversarial cascade-layers fixture
    // this flag exists for). Flag rather than silently claim exactness.
    const winnerApproximateReason = candidates.map((c) => c.approximateReason).find((reason) => reason !== undefined);

    // Raw sourceURL is used ONLY as an input to source-map resolution below (it must stay
    // byte-exact for relative sourceMappingURL joining). The EMITTED field is sanitized
    // through the shared authority — provenance URLs are page-controlled strings (D1).
    const rawSourceStyleSheetUrl = winner.rule?.styleSheetId ? styleSheetUrls.get(winner.rule.styleSheetId) : undefined;
    const sourceStyleSheetUrl = rawSourceStyleSheetUrl !== undefined ? sanitizeString(rawSourceStyleSheetUrl) : undefined;

    let authored: { file: string; line: number; column: number } | undefined;
    let generated: { sourceURL: string; line: number; column: number } | undefined;
    let sourceResolutionUnavailable: boolean | undefined;
    let sourceResolutionUnavailableReason: string | undefined;
    // Source resolution requires a REAL property/rule range to seed the lookup — without one
    // there is no authored/generated position to resolve, only a fabricated 0:0 substitute. When
    // `winner.range` is undefined (no declaration range and no `rule.style.range` fallback
    // either), leave `authored`/`generated` honestly undefined rather than defaulting line/column
    // to 0 and reporting a fake location (I-4: honest absence must hold for `authored`/
    // `generated`, not just `range`).
    if (!winner.isInline && winner.rule?.styleSheetId && winner.range) {
      const line = winner.range.startLine;
      const column = winner.range.startColumn;
      const styleSheetId = winner.rule.styleSheetId;
      const key = `${styleSheetId}:${line}:${column}`;
      try {
        let pending = sourceCache.get(key);
        if (!pending) {
          pending = resolveAuthoredSourceLocation(client, {
            styleSheetId,
            sourceURL: rawSourceStyleSheetUrl,
            line,
            column,
          });
          sourceCache.set(key, pending);
        }
        const location = await pending;
        // `generated` is set for BOTH branches: when a source map resolves, `authored` is the
        // mapped location and `generated` is the pre-map (post-build) location it came from; when
        // no map resolves, `generated` alone carries the real generated URL/line/column — the
        // fallback fact that must never be discarded.
        if (location.kind === 'authored') {
          authored = { file: sanitizeString(location.file), line: location.line, column: location.column };
          generated = {
            sourceURL: sanitizeString(location.generated.sourceURL),
            line: location.generated.line,
            column: location.generated.column,
          };
        } else {
          generated = { sourceURL: sanitizeString(location.sourceURL), line: location.line, column: location.column };
        }
      } catch (err) {
        // Source-map resolution never aborts the WHOLE snapshot for this property, but a REJECTED
        // resolution (e.g. a malformed VLQ `mappings` string throwing inside the decoder) must not
        // be silently indistinguishable from `resolveAuthoredSourceLocation`'s own honest "no
        // authored source" outcome (a genuine minified/no-source-map production build, which it
        // reports as a normal `GeneratedLocation`, never a rejection) — I-4/I-10. Mark the failure
        // explicitly, and preserve the generated (pre-map) fallback fact from the already-known
        // query position — that position was never in question, only the map lookup on top of it.
        sourceResolutionUnavailable = true;
        sourceResolutionUnavailableReason = err instanceof Error ? err.message : 'source-resolution-failed';
        generated = { sourceURL: sanitizeString(rawSourceStyleSheetUrl ?? styleSheetId), line, column };
      }
    }

    declarations.push({
      property,
      value: computed[property] ?? null,
      declaredValue: sanitizeString(winner.value),
      selector: winner.isInline ? 'inline' : sanitizeString(winner.selectorText),
      specificity: specificityStr,
      important: winner.important,
      sourceStyleSheetId: winner.rule?.styleSheetId,
      sourceStyleSheetUrl,
      range: winner.range,
      authored,
      generated,
      mediaQuery: winner.rule?.media?.length ? sanitizeString(winner.rule.media.map((m) => m.text).join(' ; ')) : undefined,
      containerQuery: winner.rule?.containerQueries?.length
        ? sanitizeString(winner.rule.containerQueries.map((cq) => cq.text).join(' ; '))
        : undefined,
      winnerApproximate: winnerApproximateReason !== undefined ? true : undefined,
      winnerApproximateReason,
      sourceResolutionUnavailable,
      sourceResolutionUnavailableReason,
    });
  }

  return declarations;
}

// ============================================================================
// captureStyleSheetHeaders — real stylesheet URL/id correlation
// ============================================================================

/** CDP `CSS.styleSheetAdded` header shape (only the two fields this module reads). */
interface StyleSheetHeader {
  readonly styleSheetId?: string;
  readonly sourceURL?: string;
}

/**
 * Registers a `CSS.styleSheetAdded` listener FIRST, then forces Chrome to
 * redeliver a header for every currently-known stylesheet by cycling
 * `CSS.disable` + `CSS.enable` (see this module's doc comment for why a
 * bare re-`enable` is insufficient and why the disable/enable pair is
 * safe here), and returns the populated `styleSheetId -> sourceURL` map
 * plus a `stop()` that removes the listener (any stylesheets added
 * *during* the rest of collection still update the map live, until
 * `stop()` is called), plus an explicit `available`/`reason` fact (I-5):
 * when the client can't deliver events at all, or the disable/enable
 * cycle itself throws, `available` is `false` with a `reason` — an empty
 * `urls` map is still returned (an aborted collector is worse than a
 * degraded one), but callers must propagate the unavailable fact rather
 * than let a resulting missing `sourceStyleSheetUrl`/source read as
 * "genuinely no source" when it is really "couldn't check".
 */
export async function captureStyleSheetHeaders(
  client: CDPClient,
): Promise<{ urls: Map<string, string>; stop: () => void; available: boolean; reason?: string }> {
  const urls = new Map<string, string>();
  if (typeof client.on !== 'function') {
    return { urls, stop: () => {}, available: false, reason: 'client-lacks-event-support' };
  }

  const handler = (params: unknown): void => {
    const header = (params as { header?: StyleSheetHeader } | undefined)?.header;
    if (header?.styleSheetId && typeof header.sourceURL === 'string' && header.sourceURL.length > 0) {
      urls.set(header.styleSheetId, header.sourceURL);
    }
  };
  client.on('CSS.styleSheetAdded', handler);

  const removable = client as unknown as {
    off?: (event: string, handler: (params: unknown) => void) => void;
    removeListener?: (event: string, handler: (params: unknown) => void) => void;
  };
  const stop = (): void => {
    if (typeof removable.off === 'function') removable.off('CSS.styleSheetAdded', handler);
    else if (typeof removable.removeListener === 'function') removable.removeListener('CSS.styleSheetAdded', handler);
  };

  try {
    await client.send('CSS.disable');
    await client.send('CSS.enable');
  } catch {
    // Proceed with whatever headers (if any) were captured before the failure, but flag it —
    // an empty `urls` map from here is otherwise indistinguishable from "no stylesheets exist".
    return { urls, stop, available: false, reason: 'stylesheet-header-redelivery-failed' };
  }

  return { urls, stop, available: true };
}
