export interface InkRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface InkStyles {
  readonly 'box-shadow'?: string | null;
  readonly 'outline-width'?: string | null;
  readonly 'outline-style'?: string | null;
  readonly 'outline-offset'?: string | null;
  readonly filter?: string | null;
  readonly transform?: string | null;
}

export interface InkEdges {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface InkContributor {
  readonly source: 'box-shadow' | 'outline' | 'filter:drop-shadow';
  readonly index?: number;
  readonly edges: InkEdges;
  /** A blur has no finite specified painted edge; its radius is a nominal AABB convention. */
  readonly nominal?: true;
}

export interface InkResult {
  /** `null` when a needed computed-style value was not captured or a paint-growing filter could not be resolved. */
  readonly inkBox: InkRect | null;
  readonly contributors: readonly InkContributor[];
  readonly missingStyles: readonly string[];
  readonly unresolved: readonly string[];
  /** True when an included blur uses the parser's nominal blur-radius extent. */
  readonly nominal: boolean;
}

const REQUIRED_STYLES = ['box-shadow', 'outline-width', 'outline-style', 'outline-offset', 'filter', 'transform'] as const;

function zeroEdges(): InkEdges {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

function splitTopLevel(value: string, delimiter: ',' | ' '): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === '(') depth += 1;
    else if (char === ')' && depth > 0) depth -= 1;
    else if (depth === 0 && (delimiter === ',' ? char === ',' : /\s/.test(char))) {
      const part = value.slice(start, index).trim();
      if (part) parts.push(part);
      start = index + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function px(value: string): number | undefined {
  const match = /^(-?(?:\d+|\d*\.\d+))px$/.exec(value) ?? (/^-?(?:\d+|\d*\.\d+)$/.test(value) ? [value, value] : undefined);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function edgesForShadow(offsetX: number, offsetY: number, blur: number, spread: number): InkEdges {
  // CSS computes these values to px. Blur's painted boundary is not a hard CSS edge;
  // its radius is the recorded geometric extent used for this conservative ink AABB.
  const growth = Math.max(0, blur + spread);
  return {
    left: Math.max(0, growth - offsetX),
    right: Math.max(0, growth + offsetX),
    top: Math.max(0, growth - offsetY),
    bottom: Math.max(0, growth + offsetY),
  };
}

function parseShadow(value: string, source: InkContributor['source'], index: number, allowSpread: boolean): InkContributor | undefined {
  const tokens = splitTopLevel(value, ' ').filter((token) => token.toLowerCase() !== 'inset');
  const lengths = tokens.map(px).filter((length): length is number => length !== undefined);
  if (lengths.length < 2 || lengths.length > (allowSpread ? 4 : 3)) return undefined;
  const [offsetX, offsetY, blur = 0, spread = 0] = lengths;
  return { source, index, edges: edgesForShadow(offsetX!, offsetY!, blur, allowSpread ? spread : 0), ...(blur > 0 ? { nominal: true as const } : {}) };
}

function dropShadowArguments(filter: string): string[] {
  const out: string[] = [];
  const lower = filter.toLowerCase();
  let cursor = 0;
  while (cursor < lower.length) {
    const start = lower.indexOf('drop-shadow(', cursor);
    if (start < 0) break;
    let depth = 1;
    let end = start + 'drop-shadow('.length;
    while (end < filter.length && depth > 0) {
      if (filter[end] === '(') depth += 1;
      else if (filter[end] === ')') depth -= 1;
      end += 1;
    }
    if (depth === 0) out.push(filter.slice(start + 'drop-shadow('.length, end - 1));
    cursor = end;
  }
  return out;
}

function containsUnresolvedPaintFilter(filter: string): boolean {
  const remainder = filter.replace(/drop-shadow\((?:[^()]|\([^()]*\))*\)/gi, '').trim();
  return /(?:\bblur\(|\burl\()/i.test(remainder);
}

function combineEdges(contributors: readonly InkContributor[]): InkEdges {
  return contributors.reduce<InkEdges>((extent, contributor) => ({
    top: Math.max(extent.top, contributor.edges.top),
    right: Math.max(extent.right, contributor.edges.right),
    bottom: Math.max(extent.bottom, contributor.edges.bottom),
    left: Math.max(extent.left, contributor.edges.left),
  }), zeroEdges());
}

/** Derives an axis-aligned ink box from a recorded border box and computed-style table without a browser. */
export function deriveInkBox(rect: InkRect, styles: InkStyles): InkResult {
  const missingStyles = REQUIRED_STYLES.filter((property) => styles[property] === undefined || styles[property] === null);
  if (missingStyles.length) return { inkBox: null, contributors: [], missingStyles, unresolved: [], nominal: false };
  if (styles.transform !== 'none') return { inkBox: null, contributors: [], missingStyles: [], unresolved: ['transform'], nominal: false };

  const contributors: InkContributor[] = [];
  const unresolved: string[] = [];
  const boxShadow = styles['box-shadow']!.trim();
  if (boxShadow && boxShadow !== 'none') {
    splitTopLevel(boxShadow, ',').forEach((shadow, index) => {
      if (/\binset\b/i.test(shadow)) return;
      const contributor = parseShadow(shadow, 'box-shadow', index + 1, true);
      if (contributor) contributors.push(contributor);
      else unresolved.push(`box-shadow ${index + 1}`);
    });
  }

  if (styles['outline-style'] !== 'none') {
    const width = px(styles['outline-width']!.trim());
    const offset = px(styles['outline-offset']!.trim());
    if (width === undefined || offset === undefined) unresolved.push('outline');
    else {
      const extent = Math.max(0, width + offset);
      contributors.push({ source: 'outline', edges: { top: extent, right: extent, bottom: extent, left: extent } });
    }
  }

  const filter = styles.filter!.trim();
  if (filter && filter !== 'none') {
    dropShadowArguments(filter).forEach((shadow, index) => {
      const contributor = parseShadow(shadow, 'filter:drop-shadow', index + 1, false);
      if (contributor) contributors.push(contributor);
      else unresolved.push(`filter drop-shadow ${index + 1}`);
    });
    if (containsUnresolvedPaintFilter(filter)) unresolved.push('filter');
  }

  if (unresolved.length) return { inkBox: null, contributors, missingStyles: [], unresolved, nominal: contributors.some((contributor) => contributor.nominal) };
  const extent = combineEdges(contributors);
  return {
    inkBox: {
      x: rect.x - extent.left,
      y: rect.y - extent.top,
      width: rect.width + extent.left + extent.right,
      height: rect.height + extent.top + extent.bottom,
    },
    contributors,
    missingStyles: [],
    unresolved: [],
    nominal: contributors.some((contributor) => contributor.nominal),
  };
}
