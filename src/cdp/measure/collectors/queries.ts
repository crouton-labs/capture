/**
 * `queries.json` collector — active media queries, container queries, and
 * the environment facts (viewport, DPR, color scheme, ...) they resolved
 * against. Page-level facts only: one `Runtime.evaluate` round trip that
 * walks `document.styleSheets` in-page. No DOM domain calls, no per-element
 * `backendNodeId` correlation — that machinery (`resolveNodeIds` in
 * `./styles.js`) exists for `styles.ts`/`media.ts`'s per-element records,
 * which this file doesn't produce.
 */

import { capArray, sanitizeString } from '../redaction.js';
import type { Collector } from '../types.js';

const MAX_MEDIA_QUERIES = 50;
const MAX_CONTAINER_QUERIES = 30;
const MAX_AFFECTED_SELECTORS = 20;

// ============================================================================
// Output shape
// ============================================================================

export interface QueryEnvironment {
  width: number;
  height: number;
  dpr: number;
  colorScheme: 'dark' | 'light';
  pointer: 'coarse' | 'fine' | 'none';
  hover: 'hover' | 'none';
  reducedMotion: 'reduce' | 'no-preference';
  forcedColors: 'active' | 'none';
}

export interface MediaQueryRecord {
  query?: string;
  /** Absent (not `false`) when {@link matchUnavailable} is `true` — a thrown `matchMedia(mq).matches` read must not read as "genuinely non-matching" (MARK #29). */
  matched?: boolean;
  /** MARK #29 (I-4/I-5): `true` when the in-page `window.matchMedia(mq).matches` call threw for this query — {@link matched} is then withheld rather than defaulted to `false`. Absent (not `false`) on a successful read. */
  matchUnavailable?: true;
  affectedSelectors?: string[];
  /** Present only when this record's `affectedSelectors` exceeded {@link MAX_AFFECTED_SELECTORS} — the set was truncated, not exhaustively empty of more matches. */
  affectedSelectorsTruncated?: boolean;
  /** Present instead of the fields above when a cross-origin stylesheet's rules were unreadable. */
  error?: string;
}

export interface ContainerQueryRecord {
  containerName: string | null;
  /** The querying container's selector, or `null` when no matching descendant/ancestor container could be resolved — OR when {@link resolutionUnavailable} is `true` (a read failure, not a genuine "no container"; check {@link resolutionUnavailable} before reading this `null` as "no matching container"). */
  containerSelector: string | null;
  containerSize: { width: number; height: number } | null;
  query: string;
  /** `null` means either the condition text didn't parse under the supported `(min|max)-(width|height)` grammar (an explicit "unknown", not a guess) OR {@link resolutionUnavailable} is `true` — check {@link resolutionUnavailable} to tell the two apart. */
  matched: boolean | null;
  affectedSelectors: string[];
  /** Present only when this record's `affectedSelectors` exceeded {@link MAX_AFFECTED_SELECTORS}. */
  affectedSelectorsTruncated?: boolean;
  /** MARK #28 (I-4/I-5): `true` when the in-page container-resolution walk (`document.querySelector` on the first affected selector, then the ancestor `getComputedStyle`/container-name walk) threw for this rule — {@link containerSelector}/{@link containerSize}/{@link matched} staying `null` is then "could not resolve", distinguishable from a genuine "no matching container" or "condition didn't parse". Absent (not `false`) on a successful resolution attempt (including one that legitimately found no container). */
  resolutionUnavailable?: true;
  /** Fixed, factual reason paired with {@link resolutionUnavailable}. */
  resolutionUnavailableReason?: 'container-resolution-threw';
}

export interface QueriesReport {
  environment: QueryEnvironment;
  mediaQueries: MediaQueryRecord[];
  /** True when the page had more media-query rules (including unreadable cross-origin sheets) than {@link MAX_MEDIA_QUERIES} — `mediaQueries` was truncated, not an exhaustive count. */
  mediaQueriesTruncated: boolean;
  containerQueries: ContainerQueryRecord[];
  /** True when the page had more `@container` rules than {@link MAX_CONTAINER_QUERIES}. */
  containerQueriesTruncated: boolean;
  /** MARK #30 (I-5): count of rules/subtrees the in-page walk (`walkRules`) skipped because inspecting them threw — present (and > 0) only when at least one occurred. Distinct from {@link mediaQueriesTruncated}/{@link containerQueriesTruncated} (those describe the KEPT-set cap on rules that WERE read); this describes rules that were never successfully read at all, so `mediaQueries`/`containerQueries` may be missing entries no cap fact accounts for. */
  ruleWalkErrors?: number;
  /** Explicit scope fact (D5): the walk enumerates `document.styleSheets` of the top document only — cross-origin sheets are already surfaced as an `error` record, and iframe stylesheets are out of scope, a stated boundary rather than a negative fact. */
  coverage: { scope: 'top-document' };
  /** `false` when the `QUERIES_SCRIPT` `Runtime.evaluate` itself failed (threw, or returned no `value`) — the default-environment/empty-arrays shape below is then "could not collect", not "genuinely queryless page" (I-5). Always `true` on a normal run, including one where the page genuinely has no media/container queries. */
  available: boolean;
  /** Present only when `available` is `false`. */
  unavailableReason?: QueriesUnavailableReason;
}

/** Fixed, factual reason `QUERIES_SCRIPT`'s `Runtime.evaluate` could not be read (never a raw exception message, which is unbounded/page-influenced) — present only when {@link QueriesReport.available} is `false`. `queries-facts-malformed` (Layer 2, I-5) covers the eval succeeding with a present but structurally malformed top-level value (e.g. missing `environment`/`mediaQueries`/`containerQueries`) — distinct from a missing value entirely. */
export type QueriesUnavailableReason = 'queries-evaluate-returned-no-value' | 'queries-evaluate-threw' | 'queries-facts-malformed';

// ============================================================================
// In-page script
// ============================================================================

const QUERIES_SCRIPT = `/* __captureQueriesInventory */
(function() {
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
  function collectSelectors(cssRules) {
    var out = [];
    var seen = {};
    if (!cssRules) return { selectors: out, truncated: false };
    for (var i = 0; i < cssRules.length; i++) {
      var sel = cssRules[i].selectorText;
      if (sel && !seen[sel]) {
        seen[sel] = true;
        out.push(sel);
      }
    }
    var truncated = out.length > ${MAX_AFFECTED_SELECTORS};
    return { selectors: truncated ? out.slice(0, ${MAX_AFFECTED_SELECTORS}) : out, truncated: truncated };
  }
  function evaluateContainerQuery(text, size) {
    var re = /\\((min|max)-(width|height):\\s*([\\d.]+)px\\)/g;
    var m;
    var found = false;
    var ok = true;
    while ((m = re.exec(text)) !== null) {
      found = true;
      var kind = m[1], axis = m[2], val = parseFloat(m[3]);
      var actual = axis === 'width' ? size.width : size.height;
      if (kind === 'min' && !(actual >= val)) ok = false;
      if (kind === 'max' && !(actual <= val)) ok = false;
    }
    if (!found) return null;
    var stripped = text
      .replace(/\\((min|max)-(width|height):\\s*[\\d.]+px\\)/g, '')
      .replace(/\\band\\b/g, '')
      .replace(/\\s+/g, '');
    if (stripped.length > 0) return null;
    return ok;
  }
  function conditionOnly(query, containerName) {
    // rule.conditionText for a NAMED @container rule includes the name as a leading token
    // ("outer (min-width: 10px)"), which evaluateContainerQuery's emptiness check can't parse —
    // strip exactly that leading name token (plain string slicing, not a regex built from
    // page-controlled text) before evaluating; unnamed rules pass query through untouched.
    if (!containerName) return query;
    var trimmed = query.replace(/^\s+/, '');
    if (trimmed.slice(0, containerName.length) !== containerName) return query;
    return trimmed.slice(containerName.length).replace(/^\s+/, '');
  }
  function describeContainerRule(rule) {
    var containerName = rule.containerName || null;
    var query = rule.conditionText || '';
    var selectorResult = collectSelectors(rule.cssRules);
    var selectors = selectorResult.selectors;
    var containerSelector = null;
    var containerSize = null;
    var matched = null;
    var resolutionUnavailable = false;
    var firstSelector = selectors.length ? selectors[0] : null;
    if (firstSelector) {
      try {
        var el = document.querySelector(firstSelector);
        // Walk ANCESTORS, not the affected element itself — an element matched by a container-query rule is
        // the thing being sized/styled, not (necessarily) the container doing the querying; starting from
        // the element itself would misreport its own containment as its query container when it happens to be one.
        var node = el ? el.parentElement : null;
        var depth2 = 0;
        var container = null;
        while (node && depth2 < 20) {
          var nodeStyle = getComputedStyle(node);
          var ct = nodeStyle.containerType;
          var isContainer = ct && ct !== 'normal';
          if (isContainer) {
            // Unnamed rule: the nearest ancestor container of any name satisfies the query. Named rule:
            // only an ancestor whose own (possibly space-separated) container-name list contains the
            // queried name does — a nearer, differently-named container is not a match and the walk
            // continues past it toward the actual named ancestor.
            if (!containerName) {
              container = node;
              break;
            }
            var names = (nodeStyle.containerName || '').split(/\s+/).filter(Boolean);
            if (names.indexOf(containerName) !== -1) {
              container = node;
              break;
            }
          }
          node = node.parentElement;
          depth2++;
        }
        if (container) {
          containerSelector = cssPathFromBody(container);
          containerSize = { width: container.clientWidth, height: container.clientHeight };
          matched = evaluateContainerQuery(conditionOnly(query, containerName), containerSize);
        }
      } catch (e) {
        // MARK #28 (I-4/I-5): the resolution attempt itself threw (querySelector/ancestor walk/
        // getComputedStyle on some node) -- containerSelector/containerSize/matched staying null must
        // be distinguishable from "resolution ran cleanly and legitimately found no container" or
        // "condition text didn't parse" (both already honest null cases via evaluateContainerQuery).
        containerSelector = null;
        containerSize = null;
        matched = null;
        resolutionUnavailable = true;
      }
    }
    return {
      containerName: containerName,
      containerSelector: containerSelector,
      containerSize: containerSize,
      query: query,
      matched: matched,
      affectedSelectors: selectors,
      affectedSelectorsTruncated: selectorResult.truncated,
      resolutionUnavailable: resolutionUnavailable,
      resolutionUnavailableReason: resolutionUnavailable ? 'container-resolution-threw' : undefined,
    };
  }
  function walkRules(rules, depth, mediaOut, containerOut, counts) {
    if (!rules || depth > 5) return;
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      try {
        if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
          counts.media++;
          if (mediaOut.length < ${MAX_MEDIA_QUERIES}) {
            var mq = rule.media.mediaText;
            // MARK #29 (I-4/I-5): a thrown matchMedia(...).matches read must not read as "genuinely
            // non-matching" -- withhold matched and flag matchUnavailable instead of defaulting to false.
            var matched;
            var matchUnavailable = false;
            try { matched = window.matchMedia(mq).matches; } catch (e) { matchUnavailable = true; }
            var mqSelectors = collectSelectors(rule.cssRules);
            mediaOut.push({
              query: mq,
              matched: matchUnavailable ? undefined : matched,
              matchUnavailable: matchUnavailable ? true : undefined,
              affectedSelectors: mqSelectors.selectors,
              affectedSelectorsTruncated: mqSelectors.truncated,
            });
          }
          walkRules(rule.cssRules, depth + 1, mediaOut, containerOut, counts);
        } else if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
          counts.container++;
          if (containerOut.length < ${MAX_CONTAINER_QUERIES}) {
            containerOut.push(describeContainerRule(rule));
          }
          walkRules(rule.cssRules, depth + 1, mediaOut, containerOut, counts);
        } else if (rule.cssRules) {
          walkRules(rule.cssRules, depth + 1, mediaOut, containerOut, counts);
        }
      } catch (e) {
        // MARK #30 (I-5): a rule/subtree read threw while walking -- it is dropped from mediaOut/
        // containerOut with NO other trace unless counted here; surface the drop count so it isn't
        // silently invisible (distinct from mediaQueriesTruncated/containerQueriesTruncated, which
        // describe the KEPT-set cap on rules that WERE read successfully).
        counts.ruleWalkErrors++;
      }
    }
  }

  var mediaQueries = [];
  var containerQueries = [];
  var counts = { media: 0, container: 0, ruleWalkErrors: 0 };
  for (var s = 0; s < document.styleSheets.length; s++) {
    var rules;
    try {
      rules = document.styleSheets[s].cssRules;
    } catch (e) {
      counts.media++;
      if (mediaQueries.length < ${MAX_MEDIA_QUERIES}) mediaQueries.push({ error: 'cross-origin' });
      continue;
    }
    walkRules(rules, 0, mediaQueries, containerQueries, counts);
  }
  var mediaQueriesTruncated = counts.media > ${MAX_MEDIA_QUERIES};
  var containerQueriesTruncated = counts.container > ${MAX_CONTAINER_QUERIES};

  var environment = {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    pointer: matchMedia('(pointer: coarse)').matches ? 'coarse' : (matchMedia('(pointer: fine)').matches ? 'fine' : 'none'),
    hover: matchMedia('(hover: hover)').matches ? 'hover' : 'none',
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference',
    forcedColors: matchMedia('(forced-colors: active)').matches ? 'active' : 'none',
  };

  return {
    environment: environment,
    mediaQueries: mediaQueries,
    mediaQueriesTruncated: mediaQueriesTruncated,
    containerQueries: containerQueries,
    containerQueriesTruncated: containerQueriesTruncated,
    ruleWalkErrors: counts.ruleWalkErrors,
  };
})();`;

// ============================================================================
// Node-side normalization — the SINGLE sanitize authority for every
// page-controlled query/selector string. The in-page walk does NO capping;
// each string is redacted THEN capped here via the shared `sanitizeString`
// (redact-before-cap, so a boundary-straddling secret is never sliced into
// a non-matchable partial before redaction runs).
// ============================================================================

/** Sanitizes a page-controlled string (media/container query text, selector, container name) through the shared redactor/capper, or returns `undefined` for a non-string. Page-authored query/selector text can carry secret-shaped substrings, so this is the required path over a bare length cap. */
function sanitizeStr(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return sanitizeString(value);
}

/**
 * Sanitizes a page-controlled selector array and reports whether the shared
 * `capArray` cap dropped anything, ORed with the in-page walk's own
 * `truncated` flag — a defensive re-cap (the in-page script already bounds
 * the array to {@link MAX_AFFECTED_SELECTORS}) rather than the primary
 * source of the fact.
 */
function sanitizeSelectors(value: unknown, pageTruncated: boolean): { selectors: string[]; truncated: boolean } {
  const arr = Array.isArray(value) ? value : [];
  const { items, truncated } = capArray(arr, MAX_AFFECTED_SELECTORS);
  return { selectors: items.map((v) => sanitizeStr(v) ?? ''), truncated: pageTruncated || truncated > 0 };
}

type NormalizedQueriesFacts = Omit<QueriesReport, 'available' | 'unavailableReason'>;

function normalizeReport(raw: Partial<QueriesReport> | undefined): NormalizedQueriesFacts {
  const environment = (raw?.environment ?? {}) as Partial<QueryEnvironment>;
  const rawMediaQueries = Array.isArray(raw?.mediaQueries) ? raw!.mediaQueries : [];
  const rawContainerQueries = Array.isArray(raw?.containerQueries) ? raw!.containerQueries : [];
  const { items: mediaQueries, truncated: mediaQueriesCapped } = capArray(rawMediaQueries, MAX_MEDIA_QUERIES);
  const { items: containerQueries, truncated: containerQueriesCapped } = capArray(rawContainerQueries, MAX_CONTAINER_QUERIES);

  return {
    environment: {
      width: typeof environment.width === 'number' ? environment.width : 0,
      height: typeof environment.height === 'number' ? environment.height : 0,
      dpr: typeof environment.dpr === 'number' ? environment.dpr : 1,
      colorScheme: environment.colorScheme === 'dark' ? 'dark' : 'light',
      pointer: environment.pointer === 'coarse' || environment.pointer === 'fine' ? environment.pointer : 'none',
      hover: environment.hover === 'hover' ? 'hover' : 'none',
      reducedMotion: environment.reducedMotion === 'reduce' ? 'reduce' : 'no-preference',
      forcedColors: environment.forcedColors === 'active' ? 'active' : 'none',
    },
    mediaQueries: mediaQueries.map((mq) => {
      const m = mq as MediaQueryRecord;
      if (typeof m.error === 'string') return { error: sanitizeStr(m.error) };
      const selectors = sanitizeSelectors(m.affectedSelectors, m.affectedSelectorsTruncated === true);
      // MARK #29: a query whose in-page matchMedia(...).matches read threw carries
      // matchUnavailable:true -- matched must be withheld (undefined), never coerced to `false`
      // ("genuinely non-matching") by the `m.matched === true` comparison that ran on every record before.
      const matchUnavailable = m.matchUnavailable === true;
      return {
        query: sanitizeStr(m.query),
        matched: matchUnavailable ? undefined : m.matched === true,
        matchUnavailable: matchUnavailable || undefined,
        affectedSelectors: selectors.selectors,
        affectedSelectorsTruncated: selectors.truncated || undefined,
      };
    }),
    mediaQueriesTruncated: raw?.mediaQueriesTruncated === true || mediaQueriesCapped > 0,
    containerQueries: containerQueries.map((cq) => {
      const c = cq as ContainerQueryRecord;
      const selectors = sanitizeSelectors(c.affectedSelectors, c.affectedSelectorsTruncated === true);
      // MARK #28: a rule whose in-page container-resolution walk threw carries
      // resolutionUnavailable:true -- containerSelector/containerSize/matched stay null (as they
      // already do on a genuine "no container"/"unsupported condition"), but this marker is what
      // lets a downstream reader tell the two apart.
      const resolutionUnavailable = c.resolutionUnavailable === true;
      return {
        containerName: sanitizeStr(c.containerName) ?? null,
        containerSelector: sanitizeStr(c.containerSelector) ?? null,
        containerSize:
          c.containerSize && typeof c.containerSize.width === 'number' && typeof c.containerSize.height === 'number'
            ? { width: c.containerSize.width, height: c.containerSize.height }
            : null,
        query: sanitizeStr(c.query) ?? '',
        matched: c.matched === null || c.matched === undefined ? null : c.matched === true,
        affectedSelectors: selectors.selectors,
        affectedSelectorsTruncated: selectors.truncated || undefined,
        resolutionUnavailable: resolutionUnavailable || undefined,
        resolutionUnavailableReason: resolutionUnavailable ? 'container-resolution-threw' : undefined,
      };
    }),
    containerQueriesTruncated: raw?.containerQueriesTruncated === true || containerQueriesCapped > 0,
    // MARK #30: a positive in-page ruleWalkErrors count means one or more rules/subtrees threw
    // while being walked and were dropped with no OTHER trace -- surface it, not silently absent.
    ruleWalkErrors: typeof raw?.ruleWalkErrors === 'number' && raw.ruleWalkErrors > 0 ? raw.ruleWalkErrors : undefined,
    coverage: { scope: 'top-document' },
  };
}

// ============================================================================
// Collector
// ============================================================================

/**
 * Whole-file sweep (Layer 2, I-5): `QUERIES_SCRIPT` always returns this exact top-level shape on a
 * successful, non-throwing run -- unconditionally, from a single object literal at the end of its
 * IIFE. `normalizeReport` previously read each of these fields off `raw` with `?? <default>`
 * (`raw?.environment ?? {}`, `Array.isArray(raw?.mediaQueries) ? ... : []`), silently absorbing a
 * malformed top-level value (an unlikely but possible corrupted/truncated CDP payload) into a
 * benign-looking empty/default report indistinguishable from "genuinely queryless page" -- exactly
 * the class flagged for sibling collectors' `walkValue?.records ?? []` / `meta.elementsTruncated ?? 0`
 * reads. Validate the immediate top-level shape here so a malformed (but present) value is reported
 * `available:false` rather than silently defaulted; `normalizeReport` keeps its per-field `??`
 * defaults ONLY as the best-effort echo written under that explicit malformed marker.
 */
function isWellFormedQueriesFacts(raw: Partial<QueriesReport>): boolean {
  const env = raw.environment as Partial<QueryEnvironment> | undefined;
  const envWellFormed =
    typeof env === 'object' &&
    env !== null &&
    typeof env.width === 'number' &&
    typeof env.height === 'number' &&
    typeof env.dpr === 'number' &&
    typeof env.colorScheme === 'string' &&
    typeof env.pointer === 'string' &&
    typeof env.hover === 'string' &&
    typeof env.reducedMotion === 'string' &&
    typeof env.forcedColors === 'string';
  return (
    envWellFormed &&
    Array.isArray(raw.mediaQueries) &&
    Array.isArray(raw.containerQueries) &&
    typeof raw.mediaQueriesTruncated === 'boolean' &&
    typeof raw.containerQueriesTruncated === 'boolean' &&
    // review-flagged gap: QUERIES_SCRIPT always returns `ruleWalkErrors` as a number -- a malformed
    // value here must not silently coerce to `undefined` ("zero errors") under available:true.
    typeof raw.ruleWalkErrors === 'number'
  );
}

export const collectQueries: Collector = async (ctx) => {
  // I-5: a failed/no-value evaluate is currently coerced by `normalizeReport` into a default
  // environment (0x0, dpr 1) plus empty arrays — indistinguishable from a genuinely queryless
  // page unless the failure itself is surfaced as an explicit report-level fact.
  let rawValue: Partial<QueriesReport> | undefined;
  let available = true;
  let unavailableReason: QueriesUnavailableReason | undefined;
  try {
    const response = (await ctx.client.send('Runtime.evaluate', {
      expression: QUERIES_SCRIPT,
      returnByValue: true,
    })) as { result?: { value?: Partial<QueriesReport> } };
    rawValue = response.result?.value;
    if (rawValue === undefined) {
      available = false;
      unavailableReason = 'queries-evaluate-returned-no-value';
    } else if (!isWellFormedQueriesFacts(rawValue)) {
      available = false;
      unavailableReason = 'queries-facts-malformed';
    }
  } catch {
    available = false;
    unavailableReason = 'queries-evaluate-threw';
  }

  const facts = normalizeReport(rawValue);
  ctx.write.json('queries.json', {
    ...facts,
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
  } satisfies QueriesReport);
};
