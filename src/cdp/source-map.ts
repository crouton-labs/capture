/**
 * Source provenance helper: resolves a generated CSS/JS location (as reported by
 * `CSS.getMatchedStylesForNode`'s stylesheet ranges, or any other generated-source location)
 * to an authored file/line/column via the standard source-map-v3 `mappings` VLQ format, when
 * the generated source carries a `sourceMappingURL`. Degrades to the generated source URL when
 * no source map is present, fails to fetch, or fails to parse — this module never throws for
 * "no source map available"; it throws only for a malformed CDP response.
 *
 * No `source-map` npm dependency is added (this unit does not own `package.json`); the VLQ
 * decoder below is a self-contained implementation of the standard algorithm.
 *
 * Selector/specificity fields that round out full provenance (used by `styles.json`) are the
 * caller's (U08 styles collector's) responsibility — this module resolves source *location*
 * only.
 */

import type { CDPClient } from './client.js';

/** Where a generated location came from and which position in it to resolve. */
export interface GeneratedSourceRef {
  /** A CDP stylesheet id — when present, the generated text is read via `CSS.getStyleSheetText`. */
  styleSheetId?: string;
  /**
   * Absolute URL of the generated source. Used as the fetch target when `styleSheetId` is
   * absent, as the base URL for resolving a relative `sourceMappingURL`, and as the reported
   * generated-source URL either way.
   */
  sourceURL?: string;
  /** 0-indexed line in the generated source. */
  line: number;
  /** 0-indexed column in the generated source. */
  column: number;
}

export interface GeneratedLocation {
  kind: 'generated';
  sourceURL: string;
  line: number;
  column: number;
}

export interface AuthoredLocation {
  kind: 'authored';
  generated: { sourceURL: string; line: number; column: number };
  /** Authored source file path/URL as recorded in the source map's `sources` (joined with `sourceRoot` when present). */
  file: string;
  /** 1-indexed authored line. */
  line: number;
  /** 0-indexed authored column. */
  column: number;
  /** Inlined authored source text, when the source map carries `sourcesContent` for this source. */
  sourceContent?: string;
}

export type ResolvedSourceLocation = AuthoredLocation | GeneratedLocation;

/**
 * Resolves `ref` to an authored file/line/column when a `sourceMappingURL` is present and
 * resolvable, otherwise returns the generated source location unchanged.
 */
export async function resolveAuthoredSourceLocation(
  client: CDPClient,
  ref: GeneratedSourceRef,
): Promise<ResolvedSourceLocation> {
  const { text, sourceURL } = await fetchGeneratedText(client, ref);
  const generated: GeneratedLocation = { kind: 'generated', sourceURL, line: ref.line, column: ref.column };

  if (!text) return generated;

  const mappingURL = extractSourceMappingURL(text);
  if (!mappingURL) return generated;

  const rawMap = await loadSourceMap(mappingURL, sourceURL);
  if (!rawMap) return generated;

  const authored = mapGeneratedPosition(rawMap, ref.line, ref.column);
  if (!authored) return generated;

  return {
    kind: 'authored',
    generated: { sourceURL, line: ref.line, column: ref.column },
    file: authored.file,
    line: authored.line,
    column: authored.column,
    sourceContent: authored.sourceContent,
  };
}

async function fetchGeneratedText(
  client: CDPClient,
  ref: GeneratedSourceRef,
): Promise<{ text: string | null; sourceURL: string }> {
  if (ref.styleSheetId) {
    try {
      const result = (await client.send('CSS.getStyleSheetText', {
        styleSheetId: ref.styleSheetId,
      })) as { text: string };
      return { text: result.text, sourceURL: ref.sourceURL ?? ref.styleSheetId };
    } catch {
      // Stylesheet text unavailable (e.g. a stale styleSheetId) — fall through to a direct fetch.
    }
  }

  if (ref.sourceURL) {
    try {
      const text = await fetchText(ref.sourceURL);
      return { text, sourceURL: ref.sourceURL };
    } catch {
      return { text: null, sourceURL: ref.sourceURL };
    }
  }

  return { text: null, sourceURL: '' };
}

const SOURCE_MAPPING_URL_RE = /\/\*[#@]\s*sourceMappingURL=([^\s*]+)\s*\*\/|\/\/[#@]\s*sourceMappingURL=([^\s]+)/g;

/** Finds the `sourceMappingURL` comment in generated CSS/JS text. When more than one is present, the last wins (spec convention). */
export function extractSourceMappingURL(text: string): string | null {
  SOURCE_MAPPING_URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = SOURCE_MAPPING_URL_RE.exec(text)) !== null) {
    last = match[1] ?? match[2] ?? last;
  }
  return last;
}

export interface RawSourceMap {
  version: number;
  sources: string[];
  sourcesContent?: (string | null)[];
  names?: string[];
  mappings: string;
  sourceRoot?: string;
  file?: string;
}

async function loadSourceMap(mappingURL: string, baseURL: string): Promise<RawSourceMap | null> {
  if (mappingURL.startsWith('data:')) {
    return parseDataURISourceMap(mappingURL);
  }

  try {
    const resolved = baseURL ? new URL(mappingURL, baseURL).toString() : mappingURL;
    const text = await fetchText(resolved);
    return JSON.parse(text) as RawSourceMap;
  } catch {
    return null;
  }
}

function parseDataURISourceMap(dataURI: string): RawSourceMap | null {
  const commaIndex = dataURI.indexOf(',');
  if (commaIndex === -1) return null;
  const meta = dataURI.slice('data:'.length, commaIndex);
  const payload = dataURI.slice(commaIndex + 1);
  try {
    const json = meta.includes(';base64') ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload);
    return JSON.parse(json) as RawSourceMap;
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetching ${url} returned HTTP ${response.status}`);
  }
  return response.text();
}

export interface AuthoredPosition {
  file: string;
  /** 1-indexed authored line. */
  line: number;
  /** 0-indexed authored column. */
  column: number;
  sourceContent?: string;
}

/**
 * Maps a 0-indexed (generatedLine, generatedColumn) position through a parsed source-map-v3
 * `mappings` string to the nearest preceding authored position on that generated line. Pure —
 * no I/O, no CDP — so it is directly testable against a fixture map.
 */
export function mapGeneratedPosition(
  rawMap: RawSourceMap,
  generatedLine: number,
  generatedColumn: number,
): AuthoredPosition | null {
  const entries = decodeMappings(rawMap.mappings).filter(
    (entry) => entry.generatedLine === generatedLine && entry.sourceIndex !== undefined,
  );
  if (entries.length === 0) return null;

  let best: MappingEntry | undefined;
  for (const entry of entries) {
    if (entry.generatedColumn <= generatedColumn && (!best || entry.generatedColumn > best.generatedColumn)) {
      best = entry;
    }
  }
  best = best ?? entries[0];

  const sourceIndex = best.sourceIndex as number;
  const sourcePath = rawMap.sources[sourceIndex];
  if (sourcePath === undefined) return null;

  const file = rawMap.sourceRoot ? joinSourceRoot(rawMap.sourceRoot, sourcePath) : sourcePath;
  const sourceContent = rawMap.sourcesContent?.[sourceIndex] ?? undefined;

  return {
    file,
    line: (best.sourceLine ?? 0) + 1,
    column: best.sourceColumn ?? 0,
    sourceContent,
  };
}

function joinSourceRoot(root: string, source: string): string {
  if (source.startsWith('/') || /^[a-z]+:\/\//i.test(source)) return source;
  return root.endsWith('/') ? `${root}${source}` : `${root}/${source}`;
}

interface MappingEntry {
  generatedLine: number;
  generatedColumn: number;
  sourceIndex?: number;
  sourceLine?: number;
  sourceColumn?: number;
  nameIndex?: number;
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Map<string, number>(Array.from(BASE64_CHARS).map((char, index) => [char, index]));

const VLQ_BASE_SHIFT = 5;
const VLQ_BASE = 1 << VLQ_BASE_SHIFT;
const VLQ_BASE_MASK = VLQ_BASE - 1;
const VLQ_CONTINUATION_BIT = VLQ_BASE;

/** Decodes every VLQ-encoded number concatenated in one comma-delimited mapping segment. */
function decodeVLQSegment(segment: string): number[] {
  const values: number[] = [];
  let shift = 0;
  let result = 0;

  for (const char of segment) {
    const digit = BASE64_LOOKUP.get(char);
    if (digit === undefined) {
      throw new Error(`Invalid base64 VLQ character in source map mappings: ${JSON.stringify(char)}`);
    }
    const continuation = digit & VLQ_CONTINUATION_BIT;
    const bits = digit & VLQ_BASE_MASK;
    result += bits << shift;
    if (continuation) {
      shift += VLQ_BASE_SHIFT;
    } else {
      const negate = result & 1;
      result >>= 1;
      values.push(negate ? -result : result);
      result = 0;
      shift = 0;
    }
  }

  return values;
}

/** Decodes a full source-map-v3 `mappings` string into per-generated-position entries with sources/names deltas resolved. */
function decodeMappings(mappings: string): MappingEntry[] {
  const entries: MappingEntry[] = [];
  const lines = mappings.split(';');

  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let nameIndex = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineText = lines[lineIndex];
    if (lineText === '') continue;

    let generatedColumn = 0;
    for (const segment of lineText.split(',')) {
      if (segment === '') continue;
      const fields = decodeVLQSegment(segment);
      generatedColumn += fields[0];

      const entry: MappingEntry = { generatedLine: lineIndex, generatedColumn };
      if (fields.length > 1) {
        sourceIndex += fields[1];
        sourceLine += fields[2];
        sourceColumn += fields[3];
        entry.sourceIndex = sourceIndex;
        entry.sourceLine = sourceLine;
        entry.sourceColumn = sourceColumn;
        if (fields.length > 4) {
          nameIndex += fields[4];
          entry.nameIndex = nameIndex;
        }
      }
      entries.push(entry);
    }
  }

  return entries;
}
