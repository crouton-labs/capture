import {
  annotateUnstableFacts,
  artifactExists,
  readAx,
  readFocus,
  readForms,
  readGeometry,
  readMeta,
  readQueries,
  readScroll,
  readStates,
  readStyles,
  readText,
  unstableRegionsFor,
  type AnnotatedFact,
  type Rect,
  type SnapRef,
} from '../../output/artifact.js';
import { resolveSelectorInput, selectorHints, type ElementRecord } from '../../output/selector.js';
import { fact, line, text, type FactLine } from '../../output/render.js';

export interface ExplainDetailOptions {
  readonly size?: boolean;
  readonly text?: boolean;
  readonly form?: boolean;
}

interface ArtifactElement extends ElementRecord {
  readonly backendNodeId?: number | null;
  readonly geometryId?: string;
  readonly rect?: RectLike | null;
}

interface RectLike {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly w?: number;
  readonly h?: number;
}

interface GeometryElement extends ArtifactElement {
  readonly tag?: string;
  readonly domPath?: string;
  readonly zIndex?: string;
  readonly boxModel?: Record<string, unknown> | null;
  readonly stackingContext?: { readonly creates?: boolean; readonly reasons?: readonly string[] };
  readonly clipping?: { readonly clippedBy?: string; readonly clippedFraction?: number } | null;
  readonly visibility?: { readonly visible?: boolean; readonly opacity?: number };
  readonly layout?: Record<string, unknown>;
}

interface StyleElement extends ArtifactElement {
  readonly computed?: Record<string, string | null>;
  readonly winningDeclarations?: readonly WinningDeclaration[];
  readonly provenanceUnavailable?: boolean;
}

interface WinningDeclaration {
  readonly property?: string;
  readonly value?: string | null;
  readonly declaredValue?: string;
  readonly selector?: string | null;
  readonly specificity?: string | null;
  readonly important?: boolean;
  readonly authored?: { readonly file?: string; readonly line?: number; readonly column?: number };
  readonly generated?: { readonly sourceURL?: string; readonly line?: number; readonly column?: number };
  readonly sourceStyleSheetUrl?: string;
  readonly mediaQuery?: string;
  readonly containerQuery?: string;
  readonly winnerApproximate?: boolean;
  readonly winnerApproximateReason?: string;
}

interface ExplainFact {
  readonly line: FactLine;
  readonly elementId?: string;
  readonly rect?: Rect;
}

export interface ExplainSection {
  readonly kind: 'element' | 'cascade' | 'stacking-clipping' | 'focus-scroll' | 'queries-states' | 'size' | 'text' | 'form';
  readonly facts: readonly AnnotatedFact<ExplainFact>[];
}

export interface ExplainSuccess {
  readonly kind: 'explanation';
  readonly ref: SnapRef;
  readonly requestedSelector: string;
  readonly element: GeometryElement;
  readonly matchCount: number;
  readonly meta: { readonly settled?: boolean; readonly settleMs?: number };
  readonly sections: readonly ExplainSection[];
}

export interface MissingSelectorRecovery {
  readonly css: readonly string[];
  readonly backend: readonly string[];
  readonly axid: readonly string[];
  readonly ax: readonly string[];
  readonly text: readonly string[];
}

export interface ExplainMissingSelector {
  readonly kind: 'missing-selector';
  readonly ref: SnapRef;
  readonly selector: string;
  readonly meta: { readonly settled?: boolean; readonly settleMs?: number };
  readonly available: MissingSelectorRecovery;
}

export type ExplainSnapshotResult = ExplainSuccess | ExplainMissingSelector;

type RawSection = { kind: ExplainSection['kind']; facts: ExplainFact[] };

function rectOf(rect: RectLike | null | undefined): Rect | undefined {
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return undefined;
  const w = rect.w ?? rect.width;
  const h = rect.h ?? rect.height;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return undefined;
  return { x: rect.x, y: rect.y, w: w!, h: h! };
}

function factFor(element: GeometryElement, rendered: FactLine): ExplainFact {
  return { line: rendered, elementId: element.id, rect: rectOf(element.rect) };
}

function joinToGeometry<T extends ArtifactElement>(records: readonly T[], geometry: GeometryElement): T[] {
  if (typeof geometry.backendNodeId === 'number') {
    const byBackend = records.filter((record) => record.backendNodeId === geometry.backendNodeId);
    if (byBackend.length) return byBackend;
  }
  return records.filter((record) => record.id === geometry.id || record.geometryId === geometry.id);
}

function enrichGeometry(
  geometry: readonly GeometryElement[],
  axNodes: readonly ArtifactElement[],
  textElements: readonly ArtifactElement[],
): ElementRecord[] {
  return geometry.map((element) => {
    const ax = joinToGeometry(axNodes, element)[0];
    const textRecord = joinToGeometry(textElements, element)[0];
    return {
      ...element,
      axId: ax?.axId,
      axName: ax?.axName,
      text: element.text ?? textRecord?.text,
    };
  });
}

function readOptional<T>(ref: SnapRef, filename: string, reader: (snap: SnapRef) => T, fallback: T): T {
  return artifactExists(ref, filename) ? reader(ref) : fallback;
}

function recoveryForms(elements: readonly ElementRecord[]): MissingSelectorRecovery {
  const hints = selectorHints(elements, 8);
  const unique = (values: readonly (string | undefined)[]): string[] => [...new Set(values.filter((value): value is string => Boolean(value)))].slice(0, 8);
  return {
    css: hints.selectors,
    backend: unique(elements.map((element) => typeof element.backendNodeId === 'number' ? `backend:${element.backendNodeId}` : undefined)),
    axid: unique(elements.map((element) => element.axId ? `axid:${element.axId}` : undefined)),
    ax: unique(hints.axNames.map((name) => `ax:${name}`)),
    text: unique(hints.texts.map((value) => `text:${value}`)),
  };
}

function sourceDescription(declaration: WinningDeclaration): string | undefined {
  if (declaration.authored?.file) {
    return `${declaration.authored.file}:${declaration.authored.line ?? 0}:${declaration.authored.column ?? 0} (authored)`;
  }
  if (declaration.generated?.sourceURL) {
    return `${declaration.generated.sourceURL}:${declaration.generated.line ?? 0}:${declaration.generated.column ?? 0} (generated)`;
  }
  if (declaration.sourceStyleSheetUrl) return `${declaration.sourceStyleSheetUrl} (generated source)`;
  return undefined;
}

function ancestorElements(all: readonly GeometryElement[], target: GeometryElement): GeometryElement[] {
  if (!target.domPath) return [];
  return all
    .filter((candidate) => candidate.id !== target.id && candidate.domPath && target.domPath!.startsWith(`${candidate.domPath}/`))
    .sort((a, b) => (a.domPath?.split('/').length ?? 0) - (b.domPath?.split('/').length ?? 0));
}

function elementSection(target: GeometryElement, matchCount: number): RawSection {
  const rect = rectOf(target.rect);
  const facts: ExplainFact[] = [];
  if (rect) {
    facts.push(factFor(target, fact`Element ${target.selector ?? target.id}: rect x=${rect.x} y=${rect.y} w=${rect.w} h=${rect.h}; visible=${String(target.visibility?.visible ?? 'unknown')}; opacity=${target.visibility?.opacity ?? 'unknown'}.`));
  } else {
    facts.push(factFor(target, fact`Element ${target.selector ?? target.id}: no resolved geometry rect was recorded.`));
  }
  if (matchCount > 1) facts.push(factFor(target, fact`Selector matched ${matchCount} geometry records; this explanation uses the first record in snapshot order.`));
  return { kind: 'element', facts };
}

function cascadeSection(target: GeometryElement, styles: readonly StyleElement[]): RawSection {
  const facts: ExplainFact[] = [];
  const matches = joinToGeometry(styles, target);
  if (!matches.length) {
    facts.push(factFor(target, text`No style record joined to this geometry record by backend node id or geometry element id.`));
    return { kind: 'cascade', facts };
  }
  for (const style of matches) {
    if (style.provenanceUnavailable) facts.push(factFor(target, text`Winning-declaration provenance was unavailable for this style record.`));
    for (const declaration of style.winningDeclarations ?? []) {
      const property = declaration.property ?? '(unknown property)';
      const value = declaration.value ?? '(no computed value)';
      const selector = declaration.selector ?? '(no author declaration)';
      const specificity = declaration.specificity ?? (declaration.selector === 'inline' ? 'inline' : 'none');
      const source = sourceDescription(declaration);
      const important = declaration.important ? ' !important' : '';
      facts.push(factFor(target, source
        ? fact`Style winner ${property}=${value}${important}: selector ${selector}; specificity ${specificity}; source ${source}.`
        : fact`Style winner ${property}=${value}${important}: selector ${selector}; specificity ${specificity}; selector-only provenance.`));
      if (declaration.winnerApproximate) {
        facts.push(factFor(target, fact`Style winner ${property} has approximate cascade ordering: ${declaration.winnerApproximateReason ?? 'simplified cascade model'}.`));
      }
    }
  }
  if (!facts.length) facts.push(factFor(target, text`The joined style record contains no recorded winning declarations.`));
  return { kind: 'cascade', facts };
}

function stackingClippingSection(target: GeometryElement, geometry: readonly GeometryElement[]): RawSection {
  const facts: ExplainFact[] = [];
  const ancestors = ancestorElements(geometry, target);
  const stacking = ancestors.filter((element) => element.stackingContext?.creates);
  const root = ancestors[0];
  if (root) facts.push(factFor(root, fact`Stacking climb root: ${root.selector ?? root.tag ?? root.id}; z-index=${root.zIndex ?? 'auto'}.`));
  for (const ancestor of stacking) {
    facts.push(factFor(ancestor, fact`Stacking ancestor ${ancestor.selector ?? ancestor.id}: z-index=${ancestor.zIndex ?? 'auto'}; creates context from ${(ancestor.stackingContext?.reasons ?? []).join(', ') || 'recorded context trigger'}.`));
  }
  facts.push(factFor(target, fact`Target stacking record: z-index=${target.zIndex ?? 'auto'}; creates-context=${String(Boolean(target.stackingContext?.creates))}; reasons=${(target.stackingContext?.reasons ?? []).join(', ') || 'none recorded'}.`));

  const clippingAncestors = ancestors.filter((element) => {
    const layout = element.layout ?? {};
    return [layout.overflowX, layout.overflowY].some((value) => typeof value === 'string' && /hidden|auto|scroll|clip/.test(value));
  });
  for (const ancestor of clippingAncestors) {
    const layout = ancestor.layout ?? {};
    const active = target.clipping?.clippedBy === ancestor.selector;
    facts.push(factFor(ancestor, fact`Clipping ancestor ${ancestor.selector ?? ancestor.id}: overflow-x=${String(layout.overflowX ?? 'unknown')}; overflow-y=${String(layout.overflowY ?? 'unknown')}; clips-target=${String(active)}${active && target.clipping?.clippedFraction !== undefined ? `; visible-fraction=${target.clipping.clippedFraction}` : ''}.`));
  }
  if (target.clipping?.clippedBy && !clippingAncestors.some((ancestor) => ancestor.selector === target.clipping?.clippedBy)) {
    facts.push(factFor(target, fact`Recorded clipping source ${target.clipping.clippedBy}; visible-fraction=${target.clipping.clippedFraction ?? 'unknown'}.`));
  } else if (!target.clipping) {
    facts.push(factFor(target, text`No clipping source was recorded for the target.`));
  }
  return { kind: 'stacking-clipping', facts };
}

function sameTarget(record: ArtifactElement, target: GeometryElement): boolean {
  if (typeof target.backendNodeId === 'number' && record.backendNodeId === target.backendNodeId) return true;
  return record.id === target.id || record.geometryId === target.id;
}

function focusScrollSection(target: GeometryElement, focus: Record<string, unknown>, scroll: Record<string, unknown>): RawSection {
  const facts: ExplainFact[] = [];
  const focusStops = [...(Array.isArray(focus.forward) ? focus.forward : []), ...(Array.isArray(focus.reverse) ? focus.reverse : [])]
    .filter((entry): entry is ArtifactElement & Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .filter((entry) => sameTarget(entry, target));
  if (focus.available === false) {
    facts.push(factFor(target, fact`Focus traversal context was unavailable: ${String(focus.unavailableReason ?? 'unavailable reason not recorded')}.`));
  } else if (focusStops.length) {
    for (const stop of focusStops) {
      facts.push(factFor(target, fact`Focus context: step=${String(stop.step ?? 'unknown')}; selector=${String(stop.selector ?? target.selector ?? target.id)}; scroll-jump=${String(stop.scrollJump ?? false)}; focus-visible-outline=${String((stop.focusVisibleStyle as Record<string, unknown> | undefined)?.outline ?? 'none recorded')}.`));
    }
  } else {
    facts.push(factFor(target, fact`Focus context: target was not present in the ${Number(focus.candidateCount ?? 0)}-candidate captured traversal.`));
  }

  const containers = (Array.isArray(scroll.containers) ? scroll.containers : [])
    .filter((entry): entry is ArtifactElement & Record<string, unknown> => Boolean(entry && typeof entry === 'object'));
  const related = containers.filter((container) => {
    if (sameTarget(container, target)) return true;
    const descendants = [
      ...(Array.isArray(container.snapDescendants) ? container.snapDescendants : []),
      ...(Array.isArray(container.stickyFixedDescendants) ? container.stickyFixedDescendants : []),
      ...(Array.isArray(container.samples) ? container.samples.flatMap((sample) => sample && typeof sample === 'object' && Array.isArray((sample as Record<string, unknown>).visibleChildren) ? (sample as Record<string, unknown>).visibleChildren as unknown[] : []) : []),
    ];
    return descendants.some((entry) => Boolean(entry && typeof entry === 'object' && sameTarget(entry as ArtifactElement, target)));
  });
  if (scroll.available === false) {
    facts.push(factFor(target, fact`Scroll topology context was unavailable: ${String(scroll.reason ?? 'unavailable reason not recorded')}.`));
  } else if (related.length) {
    for (const container of related) {
      facts.push(factFor(target, fact`Scroll context: container=${String(container.selector ?? '(root)')}; offsets left=${Number(container.scrollLeft ?? 0)} top=${Number(container.scrollTop ?? 0)}; maxima left=${Number(container.maxScrollLeft ?? 0)} top=${Number(container.maxScrollTop ?? 0)}; nested ancestry=${Array.isArray(container.nestedAncestry) ? container.nestedAncestry.join(' > ') || 'none' : 'not recorded'}.`));
    }
  } else {
    facts.push(factFor(target, fact`Scroll context: no target relation was recorded among ${containers.length} captured container record(s).`));
  }
  return { kind: 'focus-scroll', facts };
}

function queriesStatesSection(target: GeometryElement, queries: Record<string, unknown>, states: Record<string, unknown> | undefined, declarations: readonly StyleElement[]): RawSection {
  const facts: ExplainFact[] = [];
  const queryContexts = joinToGeometry(declarations, target).flatMap((style) => style.winningDeclarations ?? []).flatMap((declaration) => [
    declaration.mediaQuery ? `media ${declaration.mediaQuery}` : undefined,
    declaration.containerQuery ? `container ${declaration.containerQuery}` : undefined,
  ].filter((value): value is string => Boolean(value)));
  const selector = target.selector;
  const activeMedia = (Array.isArray(queries.mediaQueries) ? queries.mediaQueries : []).filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const query = entry as Record<string, unknown>;
    return query.matched === true && (!selector || !Array.isArray(query.affectedSelectors) || query.affectedSelectors.includes(selector));
  }) as Array<Record<string, unknown>>;
  const activeContainers = (Array.isArray(queries.containerQueries) ? queries.containerQueries : []).filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const query = entry as Record<string, unknown>;
    return query.matched === true && (!selector || !Array.isArray(query.affectedSelectors) || query.affectedSelectors.includes(selector));
  }) as Array<Record<string, unknown>>;
  if (queries.available === false) {
    facts.push(factFor(target, fact`Active query context was unavailable: ${String(queries.unavailableReason ?? 'unavailable reason not recorded')}.`));
  } else {
    const environment = queries.environment && typeof queries.environment === 'object' ? queries.environment as Record<string, unknown> : {};
    facts.push(factFor(target, fact`Query environment: width=${Number(environment.width ?? 0)}; height=${Number(environment.height ?? 0)}; dpr=${Number(environment.dpr ?? 0)}; color-scheme=${String(environment.colorScheme ?? 'unknown')}; pointer=${String(environment.pointer ?? 'unknown')}; hover=${String(environment.hover ?? 'unknown')}; reduced-motion=${String(environment.reducedMotion ?? 'unknown')}; forced-colors=${String(environment.forcedColors ?? 'unknown')}.`));
    for (const query of activeMedia) facts.push(factFor(target, fact`Active media query ${String(query.query ?? '(condition unavailable)')}.`));
    for (const query of activeContainers) facts.push(factFor(target, fact`Active container query ${String(query.query ?? '(condition unavailable)')}; container=${String(query.containerSelector ?? '(unresolved)')}; size=${JSON.stringify(query.containerSize ?? null)}.`));
    for (const context of [...new Set(queryContexts)]) facts.push(factFor(target, fact`Winning declaration query context: ${context}.`));
    if (!activeMedia.length && !activeContainers.length && !queryContexts.length) facts.push(factFor(target, text`No active query context was recorded for the target's winning declarations.`));
  }

  if (states) {
    const requested = Array.isArray(states.requested) ? states.requested.map(String) : [];
    const records = (Array.isArray(states.elements) ? states.elements : [])
      .filter((entry): entry is ArtifactElement & Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
      .filter((entry) => sameTarget(entry, target));
    facts.push(factFor(target, fact`State matrix context: requested=${requested.join(', ') || 'none'}; matching records=${records.length}.`));
    for (const record of records) {
      const changes = record.style && typeof record.style === 'object' && Array.isArray((record.style as Record<string, unknown>).changed)
        ? ((record.style as Record<string, unknown>).changed as unknown[]).map(String).join(', ')
        : 'none recorded';
      facts.push(factFor(target, fact`State ${String(record.state ?? 'unknown')}: supported=${String(record.supported ?? false)}; style changes=${changes}; geometry-changed=${String((record.geometry as Record<string, unknown> | undefined)?.changed ?? false)}; hittest-changed=${String((record.hittest as Record<string, unknown> | undefined)?.changed ?? false)}.`));
    }
  }
  return { kind: 'queries-states', facts };
}

function sizeSection(target: GeometryElement): RawSection {
  const facts: ExplainFact[] = [];
  const layout = target.layout ?? {};
  const box = target.boxModel ?? {};
  facts.push(factFor(target, fact`Box model: measured width=${String(box.width ?? 'unavailable')}; height=${String(box.height ?? 'unavailable')}; content=${JSON.stringify(box.content ?? null)}; padding=${JSON.stringify(box.padding ?? null)}; border=${JSON.stringify(box.border ?? null)}; margin=${JSON.stringify(box.margin ?? null)}.`));
  facts.push(factFor(target, fact`Layout: display=${String(layout.display ?? 'unknown')}; position=${String(layout.position ?? 'unknown')}; box-sizing=${String(layout.boxSizing ?? 'unknown')}; client=${Number(layout.clientWidth ?? 0)}×${Number(layout.clientHeight ?? 0)}; scroll=${Number(layout.scrollWidth ?? 0)}×${Number(layout.scrollHeight ?? 0)}; overflow contribution x=${String(layout.contributesOverflowX ?? false)} y=${String(layout.contributesOverflowY ?? false)}.`));
  facts.push(factFor(target, fact`Constraints: min-width=${String(layout.minWidth ?? 'unknown')}; max-width=${String(layout.maxWidth ?? 'unknown')}; min-height=${String(layout.minHeight ?? 'unknown')}; max-height=${String(layout.maxHeight ?? 'unknown')}; aspect-ratio=${String(layout.aspectRatio ?? 'unknown')}.`));
  if (layout.flex && typeof layout.flex === 'object') {
    const flex = layout.flex as Record<string, unknown>;
    facts.push(factFor(target, fact`Flex allocation: grow=${Number(flex.grow ?? 0)}; shrink=${Number(flex.shrink ?? 0)}; basis=${String(flex.basis ?? 'unknown')}; align-self=${String(flex.alignSelf ?? 'unknown')}; order=${Number(flex.order ?? 0)}; container=${JSON.stringify(flex.container ?? {})}.`));
  } else facts.push(factFor(target, text`Flex allocation: target is not recorded as a flex item.`));
  if (layout.grid && typeof layout.grid === 'object') {
    const grid = layout.grid as Record<string, unknown>;
    facts.push(factFor(target, fact`Grid allocation: column=${String(grid.columnStart ?? 'auto')} / ${String(grid.columnEnd ?? 'auto')}; row=${String(grid.rowStart ?? 'auto')} / ${String(grid.rowEnd ?? 'auto')}; container=${JSON.stringify(grid.container ?? {})}.`));
  } else facts.push(factFor(target, text`Grid allocation: target is not recorded as a grid item.`));
  return { kind: 'size', facts };
}

function textSection(target: GeometryElement, report: Record<string, unknown>): RawSection {
  const facts: ExplainFact[] = [];
  const records = (Array.isArray(report.elements) ? report.elements : [])
    .filter((entry): entry is ArtifactElement & Record<string, unknown> => Boolean(entry && typeof entry === 'object'));
  const matches = joinToGeometry(records, target);
  if (!matches.length) {
    facts.push(factFor(target, text`No text-layout record joined to this geometry record by backend node id or geometry element id.`));
    return { kind: 'text', facts };
  }
  for (const record of matches) {
    const font = record.font && typeof record.font === 'object' ? record.font as Record<string, unknown> : {};
    facts.push(factFor(target, fact`Text metrics: chars=${Number(record.textLength ?? (typeof record.text === 'string' ? record.text.length : 0))}; lines=${Number(record.lineCount ?? (Array.isArray(record.lines) ? record.lines.length : 0))}; truncated=${String(record.truncated ?? false)}; truncation-style=${String(record.truncationStyle ?? 'none')}; scroll-width=${Number(record.scrollWidth ?? 0)}; client-width=${Number(record.clientWidth ?? 0)}.`));
    facts.push(factFor(target, fact`Font metrics: family=${String(font.family ?? 'unknown')}; size=${String(font.size ?? 'unknown')}; weight=${String(font.weight ?? 'unknown')}; line-height=${String(font.lineHeight ?? 'unknown')}; writing-mode=${String(record.writingMode ?? 'unknown')}; direction=${String(record.direction ?? 'unknown')}; fallback-used=${String(record.fallbackUsed ?? 'unknown')}.`));
    for (const lineRecord of Array.isArray(record.lines) ? record.lines : []) {
      if (!lineRecord || typeof lineRecord !== 'object') continue;
      const row = lineRecord as Record<string, unknown>;
      const rect = row.rect && typeof row.rect === 'object' ? row.rect as Record<string, unknown> : {};
      facts.push(factFor(target, fact`Text line ${Number(row.index ?? 0)}: rect x=${Number(rect.x ?? 0)} y=${Number(rect.y ?? 0)} w=${Number(rect.width ?? rect.w ?? 0)} h=${Number(rect.height ?? rect.h ?? 0)}; baseline=${String(row.baseline ?? 'unavailable')}; baseline-approximate=${String(row.baselineApproximate ?? false)}; wrap-after-char=${row.wrapAfterCharUnavailable ? 'unavailable' : String(row.wrapAfterChar ?? 'none')}.`));
    }
    const platformFonts = Array.isArray(record.platformFonts) ? record.platformFonts : [];
    facts.push(factFor(target, fact`Platform fonts: available=${String(record.platformFontsAvailable ?? false)}; families=${platformFonts.map((entry) => entry && typeof entry === 'object' ? String((entry as Record<string, unknown>).familyName ?? 'unknown') : 'unknown').join(', ') || 'none recorded'}.`));
  }
  return { kind: 'text', facts };
}

function formSection(target: GeometryElement, report: Record<string, unknown>): RawSection {
  const facts: ExplainFact[] = [];
  const records = (Array.isArray(report.controls) ? report.controls : [])
    .filter((entry): entry is ArtifactElement & Record<string, unknown> => Boolean(entry && typeof entry === 'object'));
  const matches = joinToGeometry(records, target);
  if (!matches.length) {
    facts.push(factFor(target, text`No form-control record joined to this geometry record by backend node id or geometry element id.`));
    return { kind: 'form', facts };
  }
  for (const control of matches) {
    const rect = rectOf(control.rect as RectLike | undefined);
    const dimensions = control.dimensions && typeof control.dimensions === 'object' ? control.dimensions as Record<string, unknown> : {};
    const scroll = control.scroll && typeof control.scroll === 'object' ? control.scroll as Record<string, unknown> : {};
    const autofill = control.autofill && typeof control.autofill === 'object' ? control.autofill as Record<string, unknown> : {};
    facts.push(factFor(target, fact`Form control: type=${String(control.type ?? 'unknown')}; rect=${rect ? `x=${rect.x} y=${rect.y} w=${rect.w} h=${rect.h}` : 'unavailable'}; client=${Number(dimensions.clientWidth ?? 0)}×${Number(dimensions.clientHeight ?? 0)}; scroll-size=${Number(dimensions.scrollWidth ?? 0)}×${Number(dimensions.scrollHeight ?? 0)}.`));
    facts.push(factFor(target, fact`Form value measurement: length=${Number(control.valueLength ?? 0)}; redacted=${String(control.redacted ?? false)}; redaction-reason=${String(control.redactionReason ?? 'none')}; value and visible substring withheld.`));
    facts.push(factFor(target, fact`Selection/caret: start=${String(control.selectionStart ?? 'none')}; end=${String(control.selectionEnd ?? 'none')}; caret=${JSON.stringify(control.caretRect ?? null)}; selection-rects=${Array.isArray(control.selectionRects) ? control.selectionRects.length : 0}; internal-scroll left=${Number(scroll.left ?? 0)} top=${Number(scroll.top ?? 0)}.`));
    facts.push(factFor(target, fact`Autofill/native parts: autofilled=${String(autofill.isAutofilled ?? false)}; native-part-dimensions=${JSON.stringify(control.nativePartDimensions ?? {})}.`));
    if (control.validity && typeof control.validity === 'object') {
      const validity = control.validity as Record<string, unknown>;
      facts.push(factFor(target, fact`Validity state: valid=${String(validity.valid ?? 'unknown')}; value-missing=${String(validity.valueMissing ?? false)}; type-mismatch=${String(validity.typeMismatch ?? false)}; pattern-mismatch=${String(validity.patternMismatch ?? false)}; custom-error=${String(validity.customError ?? false)}; message withheld.`));
    }
  }
  return { kind: 'form', facts };
}

/** Pure read over one resolved snapshot: no browser driving and no artifact writes. */
export function explainSnapshot(ref: SnapRef, selector: string, detailOpts: ExplainDetailOptions = {}): ExplainSnapshotResult {
  const geometryReport = readGeometry<{ elements?: GeometryElement[] }>(ref);
  const stylesReport = readStyles<{ elements?: StyleElement[] }>(ref);
  const meta = readMeta<{ settled?: boolean; settleMs?: number }>(ref);
  const geometry = geometryReport.elements ?? [];
  const styles = stylesReport.elements ?? [];

  const selectorKind = selector.startsWith('ax:') || selector.startsWith('axid:') ? 'ax' : selector.startsWith('text:') ? 'text' : 'base';
  let axNodes: ArtifactElement[] = [];
  let textElements: ArtifactElement[] = [];
  if (selectorKind === 'ax' && artifactExists(ref, 'ax.json')) axNodes = readAx<{ nodes?: ArtifactElement[] }>(ref).nodes ?? [];
  if ((selectorKind === 'text' || detailOpts.text) && artifactExists(ref, 'text.json')) textElements = readText<{ elements?: ArtifactElement[] }>(ref).elements ?? [];

  let selectable = enrichGeometry(geometry, axNodes, textElements);
  let matches = resolveSelectorInput(selectable, selector);
  if (!matches.length) {
    if (!axNodes.length && artifactExists(ref, 'ax.json')) axNodes = readAx<{ nodes?: ArtifactElement[] }>(ref).nodes ?? [];
    if (!textElements.length && artifactExists(ref, 'text.json')) textElements = readText<{ elements?: ArtifactElement[] }>(ref).elements ?? [];
    selectable = enrichGeometry(geometry, axNodes, textElements);
    matches = resolveSelectorInput(selectable, selector);
  }
  if (!matches.length) {
    return { kind: 'missing-selector', ref, selector, meta, available: recoveryForms(selectable) };
  }

  const selectedId = matches[0]!.id;
  const target = geometry.find((element) => element.id === selectedId)!;
  const focus = readOptional(ref, 'focus.json', readFocus<Record<string, unknown>>, { available: false, unavailableReason: 'focus.json not present', forward: [], reverse: [], candidateCount: 0 });
  const scroll = readOptional(ref, 'scroll.json', readScroll<Record<string, unknown>>, { available: false, reason: 'scroll.json not present', containers: [] });
  const queries = readOptional(ref, 'queries.json', readQueries<Record<string, unknown>>, { available: false, unavailableReason: 'queries.json not present', environment: {}, mediaQueries: [], containerQueries: [] });
  const states = artifactExists(ref, 'states.json') ? readStates<Record<string, unknown>>(ref) : undefined;

  const rawSections: RawSection[] = [
    elementSection(target, matches.length),
    cascadeSection(target, styles),
    stackingClippingSection(target, geometry),
    focusScrollSection(target, focus, scroll),
    queriesStatesSection(target, queries, states, styles),
  ];
  if (detailOpts.size) rawSections.push(sizeSection(target));
  if (detailOpts.text) rawSections.push(textSection(target, readText<Record<string, unknown>>(ref)));
  if (detailOpts.form) rawSections.push(formSection(target, readForms<Record<string, unknown>>(ref)));

  const regions = unstableRegionsFor(ref);
  const sections = rawSections
    .filter((section) => section.facts.length > 0)
    .map((section): ExplainSection => ({
      kind: section.kind,
      facts: annotateUnstableFacts(section.facts, regions),
    }));

  return { kind: 'explanation', ref, requestedSelector: selector, element: target, matchCount: matches.length, meta, sections };
}
