/**
 * Google Sheets Library
 *
 * Browser-executable Google Sheets operations via internal Drive v2 APIs.
 */

import type {
  GetContextOutput,
  CreateSheetInput,
  CreateSheetOutput,
  AddSheetInput,
  AddSheetOutput,
  DeleteSheetInput,
  DeleteSheetOutput,
  RenameSheetInput,
  RenameSheetOutput,
  MoveSheetInput,
  MoveSheetOutput,
  DuplicateSheetInput,
  DuplicateSheetOutput,
  GetCurrentSheetOutput,
  WriteCellInput,
  WriteCellOutput,
  WriteRangeInput,
  WriteRangeOutput,
  ReadRangeInput,
  ReadRangeOutput,
  ReadSheetInput,
  ReadSheetOutput,
  FormatRangeInput,
  FormatRangeOutput,
  InsertRowsInput,
  InsertRowsOutput,
  InsertColumnsInput,
  InsertColumnsOutput,
  DeleteRowsInput,
  DeleteRowsOutput,
  DeleteColumnsInput,
  DeleteColumnsOutput,
  ResizeRowsInput,
  ResizeRowsOutput,
  ResizeColumnsInput,
  ResizeColumnsOutput,
  SetRowsVisibilityInput,
  SetRowsVisibilityOutput,
  SetColumnsVisibilityInput,
  SetColumnsVisibilityOutput,
  FreezeRowsInput,
  FreezeRowsOutput,
  ClearRangeInput,
  ClearRangeOutput,
  MergeCellsInput,
  MergeCellsOutput,
  UnmergeCellsInput,
  UnmergeCellsOutput,
  SetCellNoteInput,
  SetCellNoteOutput,
  SetHyperlinkInput,
  SetHyperlinkOutput,
  FindAndReplaceInput,
  FindAndReplaceOutput,
  CreateBasicFilterInput,
  CreateBasicFilterOutput,
  RemoveBasicFilterInput,
  RemoveBasicFilterOutput,
  BatchUpdateInput,
  BatchUpdateOutput,
} from './schemas';
import {
  WRITE_VALUE_OP,
  FORMAT_CELL_OP,
  LEGACY_STRING_VALUE_OP,
  VALUE_TYPE,
  RENAME_SHEET_OP,
  SET_SHEET_PROPERTIES_OP,
  MOVE_SHEET_OP,
  DELETE_SHEET_OP,
  BATCH_WRAPPER_OP,
  ADD_SHEET_SUB_OP,
  ADD_SHEET_SELECT_SUB_OP,
  FORMAT_CATEGORY,
  FORMAT_FLAG,
  HORIZONTAL_ALIGN,
  INSERT_DIMENSION_OP,
  DELETE_DIMENSION_OP,
  DIMENSION_PROPERTIES_OP,
  MERGE_CELLS_OP,
  UNMERGE_CELLS_OP,
  HYPERLINK_VALUE_OP,
  CREATE_FILTER_OP,
  ASSOCIATE_FILTER_OP,
  DELETE_FILTER_OP,
  DIMENSION,
  SHEET_PROPERTY_FIELD,
  DIMENSION_FIELD,
  CELL_NOTE_FLAG,
  SAVE_QUERY_CONSTANTS,
} from './constants';
import { buildFormulaWriteCommand } from './formula';
import { Validation, ContractDrift, NotFound, UpstreamError, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Internal Helpers
// ============================================================================

const V2_BASE = 'https://clients6.google.com';

const API_KEY = 'AIzaSyD_InbmSFufIEps5UAt2NmB_3LvBH3Sz_8';

function getAuthHeader(): string {
  if (
    typeof gapi === 'undefined' ||
    !gapi.auth?.getAuthHeaderValueForFirstParty
  ) {
    throw new UpstreamError(
      `gapi.auth not available. Ensure Google Sheets page is fully loaded. URL: ${window.location.href}`,
    );
  }
  return gapi.auth.getAuthHeaderValueForFirstParty();
}

function getAccountFromUrl(): number {
  const pathMatch = window.location.pathname.match(/\/u\/(\d+)/);
  if (pathMatch) return parseInt(pathMatch[1], 10);

  const authUser = new URL(window.location.href).searchParams.get('authuser');
  if (authUser && /^\d+$/.test(authUser)) return parseInt(authUser, 10);

  throw new Validation(
    `Account number not found in URL. URL: ${window.location.href}. Navigate to docs.google.com/spreadsheets/ (which redirects to /u/{N}/) or open a sheet with ?authuser={N}.`,
  );
}

async function driveGet<T>(
  path: string,
  account: number,
  params: Record<string, string> = {},
): Promise<T> {
  const authHeader = getAuthHeader();
  const searchParams = new URLSearchParams({ ...params, key: API_KEY });
  const url = `${V2_BASE}${path}?${searchParams.toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      authorization: authHeader,
      'x-goog-authuser': String(account),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    throwForStatus(res.status, text);
  }
  return res.json() as Promise<T>;
}

async function drivePost<T>(
  path: string,
  account: number,
  body: Record<string, unknown>,
  params: Record<string, string> = {},
): Promise<T> {
  const authHeader = getAuthHeader();
  const searchParams = new URLSearchParams({ ...params, key: API_KEY });
  const url = `${V2_BASE}${path}?${searchParams.toString()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: authHeader,
      'x-goog-authuser': String(account),
      'content-type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    throwForStatus(res.status, text);
  }
  return res.json() as Promise<T>;
}

// ============================================================================
// Sheet session cache (for /save endpoint)
// ============================================================================

interface SheetMeta {
  title: string;
  gid: number;
  index: number;
}

interface SheetSession {
  sid: string;
  token: string;
  ouid: string;
  rev: number;
  reqId: number;
  sheets: SheetMeta[];
  title: string;
}

const sheetSessions = new Map<string, SheetSession>();

async function loadSession(spreadsheetId: string): Promise<SheetSession> {
  // Guard B: bypass any HTTP/browser cache that might return a pre-mutation snapshot.
  const res = await fetch(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?_=${Date.now()}`,
    { credentials: 'include', cache: 'no-store' },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    throwForStatus(res.status, text);
  }
  const html = await res.text();

  const sid = html.match(/"sid":"([a-f0-9]+)"/)?.[1];
  const token = html.match(/"token":"(AOq[^"]+)"/)?.[1];
  const ouid = html.match(/"ouid":"(\d+)"/)?.[1];
  const revStr =
    html.match(/"revision":(\d+)/)?.[1] ?? html.match(/"rev":(\d+)/)?.[1];

  const missing = [
    !sid && 'sid',
    !token && 'token',
    !ouid && 'ouid',
    !revStr && 'rev',
  ].filter(Boolean);
  if (missing.length) {
    throw new ContractDrift(
      `Could not extract session fields (${missing.join(', ')}) from sheet page. Re-capture HAR via proofs: writeCell.`,
    );
  }

  const sheets: SheetMeta[] = [];
  const seenGids = new Set<number>();
  const addSheetMeta = (title: string, index: number, gid: number): void => {
    if (seenGids.has(gid)) return;
    seenGids.add(gid);
    sheets.push({ title, index, gid });
  };

  // Current format (observed 2026-04): tab metadata lives in opcode-tagged
  // entries inside the bootstrap blob. The outer JSON-inside-JSON literal looks
  // like: [21350203,"[INDEX,0,\"GID\",[{\"1\":[[0,0,\"TITLE\", ...
  const patternTopsnapshot =
    /\[21350203,"\[(\d+),0,\\"(\d+)\\",\[\{\\"1\\":\[\[0,0,\\"((?:[^"\\]|\\.)*?)\\"/g;
  let m: RegExpExecArray | null;
  while ((m = patternTopsnapshot.exec(html)) !== null) {
    addSheetMeta(
      JSON.parse(`"${m[3]}"`),
      parseInt(m[1], 10),
      parseInt(m[2], 10),
    );
  }

  // Legacy format fallback: older HTML variants exposed a "sheets":[...] array
  // with {title, index, sheetId} objects. Kept so accounts still on the old
  // rollout keep working.
  const sheetsArrayMatch = html.match(
    /"sheets":\s*\[[\s\S]{0,200000}?\](?=\s*[,}])/,
  );
  const parseScope = sheetsArrayMatch?.[0] ?? html;

  if (sheets.length === 0) {
    const patternTitleFirst =
      /"title":"((?:[^"\\]|\\.)*)","index":(\d+)[^}]*?"sheetId":(\d+)/g;
    while ((m = patternTitleFirst.exec(parseScope)) !== null) {
      addSheetMeta(
        JSON.parse(`"${m[1]}"`),
        parseInt(m[2], 10),
        parseInt(m[3], 10),
      );
    }
  }

  if (sheets.length === 0) {
    const patternSheetIdFirst =
      /"sheetId":(\d+)[^}]*?"title":"((?:[^"\\]|\\.)*)"[^}]*?"index":(\d+)/g;
    while ((m = patternSheetIdFirst.exec(parseScope)) !== null) {
      addSheetMeta(
        JSON.parse(`"${m[2]}"`),
        parseInt(m[3], 10),
        parseInt(m[1], 10),
      );
    }
  }

  // Collect gid references from the HTML body (URLs, anchors, etc.) — used by
  // both the zero-match fallback and the suspicious-result guard below.
  const referencedNonZeroGids = new Set<number>();
  for (const gm of html.matchAll(/[?&#]gid=(\d+)/g)) {
    const g = parseInt(gm[1], 10);
    if (Number.isFinite(g) && g !== 0) referencedNonZeroGids.add(g);
  }

  // Guard A: zero matches. Safe fallback only when the HTML references no
  // non-zero gids (i.e. this is a single-tab spreadsheet). Otherwise we'd be
  // silently routing writes to gid 0 while real tabs are invisible — throw.
  if (sheets.length === 0) {
    if (referencedNonZeroGids.size === 0) {
      sheets.push({ title: 'Sheet1', index: 0, gid: 0 });
    } else {
      const hasSheetIdKey = html.includes('"sheetId"');
      const hasSheet1Literal = html.includes('"Sheet1"');
      const sheetsBlock = html.match(/"sheets?":\s*\[[\s\S]{0,600}/)?.[0];
      const titleHits = (html.match(/"title":"[^"]{0,40}"/g) ?? []).slice(0, 8);
      throw new ContractDrift(
        `No sheet tabs parsed from /edit HTML for ${spreadsheetId}, but the ` +
          `HTML references other gids (${[...referencedNonZeroGids].slice(0, 10).join(',')}). ` +
          `Falling back to Sheet1/gid 0 would silently misroute writes. ` +
          `htmlLen=${html.length} hasSheetId=${hasSheetIdKey} hasSheet1Literal=${hasSheet1Literal}. ` +
          `scopedBlockFound=${!!sheetsArrayMatch}. ` +
          `titleHits=${JSON.stringify(titleHits)}. ` +
          `sheetsBlock=${sheetsBlock ? sheetsBlock.slice(0, 500) : 'NONE'}.`,
      );
    }
  }

  // Guard B': the parse returned only the new-spreadsheet default (Sheet1/gid 0),
  // but the HTML references other gids via URLs/anchors. That's stale HTML or a
  // matched template blob — fail loudly rather than silently routing writes to
  // gid 0.
  if (
    sheets.length === 1 &&
    sheets[0].title === 'Sheet1' &&
    sheets[0].gid === 0 &&
    referencedNonZeroGids.size > 0
  ) {
    throw new ContractDrift(
      `Sheet list parsed as only Sheet1/gid 0, but /edit HTML references other gids: ` +
        `${[...referencedNonZeroGids].slice(0, 10).join(',')}. ` +
        `Google served stale or template HTML for ${spreadsheetId}.`,
    );
  }

  // Normalize: regex indexes may have gaps if a template blob leaked through;
  // order by index, then reassign contiguous 0..n-1.
  sheets.sort((a, b) => a.index - b.index);
  sheets.forEach((s, i) => {
    s.index = i;
  });

  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const rawTitle = titleMatch?.[1]?.trim() ?? '';
  const title =
    rawTitle.replace(/\s*-\s*Google\s*Sheets\s*$/, '').trim() || 'Untitled';

  const session: SheetSession = {
    sid: sid as string,
    token: token as string,
    ouid: ouid as string,
    rev: parseInt(revStr as string, 10),
    reqId: 1,
    sheets,
    title,
  };
  sheetSessions.set(spreadsheetId, session);
  return session;
}

async function getSession(
  spreadsheetId: string,
  forceRefresh = false,
): Promise<SheetSession> {
  if (!forceRefresh) {
    const cached = sheetSessions.get(spreadsheetId);
    if (cached) return cached;
  }
  return loadSession(spreadsheetId);
}

// ============================================================================
// A1 notation parsing
// ============================================================================

function columnLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function indexToColumnLetters(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface ParsedCell {
  sheetName: string | null;
  row: number;
  col: number;
}

function parseA1(cell: string): ParsedCell {
  let sheetName: string | null = null;
  let ref = cell;
  const bangIdx = cell.lastIndexOf('!');
  if (bangIdx > -1) {
    sheetName = cell.substring(0, bangIdx);
    if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
      sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
    }
    ref = cell.substring(bangIdx + 1);
  }
  const match = ref.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) {
    throw new Validation(
      `Invalid A1 notation: "${cell}". Expected single cell like "A1" or "Sheet1!B5".`,
    );
  }
  return {
    sheetName,
    col: columnLettersToIndex(match[1]),
    row: parseInt(match[2], 10) - 1,
  };
}

function resolveSheet(
  session: SheetSession,
  sheetName: string | null,
): SheetMeta {
  if (!sheetName) return session.sheets[0];
  const found = session.sheets.find((s) => s.title === sheetName);
  if (!found) {
    throw new NotFound(
      `Sheet "${sheetName}" not found. Available: ${session.sheets.map((s) => s.title).join(', ')}`,
    );
  }
  return found;
}

// ============================================================================
// Sheet values fetch (parse cell bootstrap out of /edit HTML — same
// session-cookie auth surface as loadSession and the /save endpoint)
// ============================================================================

interface SheetValues {
  values: Array<Array<string | number | boolean>>;
  rowCount: number;
  columnCount: number;
}

function extractCellValue(cellData: unknown): string | number | boolean | null {
  if (!Array.isArray(cellData) || cellData.length === 0) return null;
  const cell = cellData[0];
  if (!cell || typeof cell !== 'object') return null;
  const valueField = (cell as Record<string, unknown>)['3'];
  if (valueField === undefined) return null;
  if (Array.isArray(valueField)) {
    const first = valueField[0];
    if (
      first &&
      typeof first === 'object' &&
      '3' in (first as Record<string, unknown>)
    ) {
      const v = (first as Record<string, unknown>)['3'];
      if (
        typeof v === 'number' ||
        typeof v === 'boolean' ||
        typeof v === 'string'
      ) {
        return v;
      }
    }
    if (valueField.length === 2 && typeof valueField[1] === 'string') {
      return valueField[1];
    }
  }
  return null;
}

function parseBootstrapCells(
  html: string,
  gid: number,
): {
  grid: Array<Array<string | number | boolean | null>>;
  startRow: number;
  startCol: number;
} {
  const targetGid = String(gid);
  const re = /\[25813757,"(\[(?:[^"\\]|\\.)*?\])"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    let data: unknown;
    try {
      const jsonStr = JSON.parse(`"${match[1]}"`) as string;
      data = JSON.parse(jsonStr);
    } catch {
      continue;
    }
    if (!Array.isArray(data) || data.length < 3) continue;
    const range = data[0];
    if (!Array.isArray(range) || range.length < 5) continue;
    if (range[0] !== targetGid) continue;
    const startRow = Number(range[1]);
    const endRow = Number(range[2]);
    const startCol = Number(range[3]);
    const endCol = Number(range[4]);
    const rows = endRow - startRow;
    const cols = endCol - startCol;
    const grid: Array<Array<string | number | boolean | null>> = [];
    for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill(null));

    // Two forms seen in /edit bootstraps:
    //   Coordinate: [range, styles, [[r,c,cellData], ...]]  (length 3)
    //   Matrix:     [range, styles, null, [cellData, ...]]  row-major, length >= 4
    if (data.length === 3 && Array.isArray(data[2])) {
      for (const entry of data[2] as unknown[]) {
        if (!Array.isArray(entry) || entry.length < 3) continue;
        const r = Number(entry[0]) - startRow;
        const c = Number(entry[1]) - startCol;
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        grid[r][c] = extractCellValue(entry[2]);
      }
    } else if (data.length >= 4 && Array.isArray(data[3])) {
      const cells = data[3] as unknown[];
      for (let i = 0; i < cells.length && i < rows * cols; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        grid[r][c] = extractCellValue(cells[i]);
      }
    } else {
      continue;
    }
    return { grid, startRow, startCol };
  }
  // Empty tab: bootstrap omits opcode 25813757 when the tab has no cell data
  // yet. Return an empty grid; callers slice/iterate to nothing.
  return { grid: [], startRow: 0, startCol: 0 };
}

async function fetchSheetValues(
  spreadsheetId: string,
  gid: number,
  opts: {
    cellRange?: string;
    renderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE';
  } = {},
): Promise<SheetValues> {
  const { cellRange, renderOption = 'FORMATTED_VALUE' } = opts;
  const res = await fetch(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}&_=${Date.now()}`,
    { credentials: 'include', cache: 'no-store' },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    throwForStatus(res.status, text);
  }
  const html = await res.text();
  const { grid, startRow, startCol } = parseBootstrapCells(html, gid);

  let slice = grid;
  if (cellRange) {
    const parsed = parseA1Range(cellRange);
    const r0 = Math.max(0, parsed.startRow - startRow);
    const r1 = Math.min(grid.length, parsed.endRow - startRow);
    const c0 = Math.max(0, parsed.startCol - startCol);
    const c1 = parsed.endCol - startCol;
    slice = grid.slice(r0, r1).map((row) => row.slice(c0, c1));
  }

  const asString = renderOption === 'FORMATTED_VALUE';
  const values: Array<Array<string | number | boolean>> = slice.map((row) =>
    row.map((v) => {
      if (v === null) return '';
      return asString ? String(v) : v;
    }),
  );
  const rowCount = values.length;
  const columnCount = values.reduce((max, row) => Math.max(max, row.length), 0);
  return { values, rowCount, columnCount };
}

// ============================================================================
// Exported Functions
// ============================================================================

export async function getContext(): Promise<GetContextOutput> {
  if (
    !window.location.hostname.includes('docs.google.com') ||
    !window.location.pathname.includes('/spreadsheets')
  ) {
    throw new Validation(
      `Not on Google Sheets. Current URL: ${window.location.href}. Navigate to docs.google.com/spreadsheets/ first.`,
    );
  }

  const account = getAccountFromUrl();

  const data = await driveGet<{
    user?: { emailAddress?: string; displayName?: string };
  }>('/drive/v2internal/about', account, {
    fields: 'user(emailAddress,displayName)',
  });

  if (!data.user?.emailAddress) {
    throw new ContractDrift(
      `Could not retrieve user info. Auth may have failed. URL: ${window.location.href}`,
    );
  }

  return {
    account,
    email: data.user.emailAddress,
    displayName: data.user.displayName ?? data.user.emailAddress,
  };
}

export async function getCurrentSheet(): Promise<GetCurrentSheetOutput> {
  const match = window.location.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) {
    throw new Validation(
      `No sheet open. Current URL: ${window.location.href}. Open a sheet at /spreadsheets/d/{id}/edit first, or use google-drive.listFiles to find one.`,
    );
  }
  const spreadsheetId = match[1];
  const rawTitle = document.title;
  const title = rawTitle.replace(/ - Google Sheets$/, '').trim() || rawTitle;
  return {
    spreadsheetId,
    title,
    url: window.location.href,
  };
}

export async function createSheet(
  params: CreateSheetInput,
): Promise<CreateSheetOutput> {
  const { account, title, parentFolderId } = params;

  const body: Record<string, unknown> = {
    title,
    mimeType: 'application/vnd.google-apps.spreadsheet',
  };
  if (parentFolderId) {
    body.parents = [{ id: parentFolderId }];
  }

  const data = await drivePost<{
    id: string;
    title: string;
    createdDate?: string;
  }>('/drive/v2internal/files', account, body, {
    fields: 'id,title,createdDate',
    supportsTeamDrives: 'true',
  });

  return {
    spreadsheetId: data.id,
    title: data.title,
    url: `https://docs.google.com/spreadsheets/d/${data.id}/edit`,
    createdDate: data.createdDate ?? '',
  };
}

type SaveCommand = [number, string] | [number, SaveCommand[]];

// Numeric values (and things that should store as numbers: percent, currency,
// dates as serials) go through WRITE_VALUE_OP with value type 3. This is the
// opcode the Sheets UI uses for all value writes — see HAR capture notes in
// constants.ts.
function buildNumericWriteCommand(
  gid: number,
  row: number,
  col: number,
  value: number,
): SaveCommand {
  const innerCommand = JSON.stringify([
    [String(gid), row, row + 1, col, col + 1],
    [],
    null,
    [[null, 1, [VALUE_TYPE.NUMBER, null, value]]],
  ]);
  return [WRITE_VALUE_OP, innerCommand];
}

// Legacy text path: stores the raw value as text in the cell.
function buildStringWriteCommand(
  gid: number,
  row: number,
  col: number,
  value: string | number | boolean,
): SaveCommand {
  const innerCommand = JSON.stringify([
    [String(gid), row, row + 1, col, col + 1],
    [
      LEGACY_STRING_VALUE_OP,
      3,
      [VALUE_TYPE.STRING, String(value)],
      null,
      null,
      0,
    ],
    [
      null,
      [[null, 513, [0], null, null, null, null, null, null, null, null, 0]],
    ],
  ]);
  return [FORMAT_CELL_OP, innerCommand];
}

interface NumericFormat {
  pattern: string;
  category: number;
}

interface ClassifiedWrite {
  numeric: number | null;
  format: NumericFormat | null;
}

function isoDateToSerial(year: number, month: number, day: number): number {
  const epoch = Date.UTC(1899, 11, 30);
  const target = Date.UTC(year, month - 1, day);
  return Math.round((target - epoch) / 86400000);
}

function classifyWriteValue(value: string | number | boolean): ClassifiedWrite {
  if (typeof value === 'number') {
    return { numeric: value, format: null };
  }
  if (typeof value !== 'string' || value.length === 0) {
    return { numeric: null, format: null };
  }
  if (value.startsWith('=')) {
    return { numeric: null, format: null };
  }

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateMatch) {
    const serial = isoDateToSerial(
      parseInt(dateMatch[1], 10),
      parseInt(dateMatch[2], 10),
      parseInt(dateMatch[3], 10),
    );
    return {
      numeric: serial,
      format: { pattern: 'yyyy-mm-dd', category: FORMAT_CATEGORY.DATE },
    };
  }

  const percentMatch = /^(-?\d+(?:\.\d+)?)%$/.exec(value);
  if (percentMatch) {
    return {
      numeric: parseFloat(percentMatch[1]) / 100,
      format: { pattern: '0.00%', category: FORMAT_CATEGORY.NUMBER },
    };
  }

  const currencyMatch = /^([$€£¥])\s?(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?)$/.exec(
    value,
  );
  if (currencyMatch) {
    return {
      numeric: parseFloat(currencyMatch[2].replace(/,/g, '')),
      format: {
        pattern: `${currencyMatch[1]}#,##0.00`,
        category: FORMAT_CATEGORY.NUMBER,
      },
    };
  }

  if (/^-?\d+$/.test(value)) {
    return { numeric: parseInt(value, 10), format: null };
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return { numeric: parseFloat(value), format: null };
  }

  return { numeric: null, format: null };
}

function buildWriteCommandsForValue(
  gid: number,
  row: number,
  col: number,
  value: string | number | boolean,
): SaveCommand[] {
  if (typeof value === 'string' && value.startsWith('=') && value.length > 1) {
    return [buildFormulaWriteCommand(gid, row, col, value)];
  }
  const classified = classifyWriteValue(value);
  if (classified.numeric === null) {
    return [buildStringWriteCommand(gid, row, col, value)];
  }
  const commands: SaveCommand[] = [
    buildNumericWriteCommand(gid, row, col, classified.numeric),
  ];
  if (classified.format !== null) {
    const { commands: formatCmds } = buildFormatCommands(
      gid,
      row,
      row + 1,
      col,
      col + 1,
      {
        numberFormat: classified.format.pattern,
        numberFormatCategory: classified.format.category,
      },
    );
    commands.push(...formatCmds);
  }
  return commands;
}

function generateGid(): number {
  return Math.floor(Math.random() * 2 ** 30) + 1;
}

function hexToRgbInt(hex: string): number {
  const cleaned = hex.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    throw new Validation(
      `Invalid hex color: "${hex}". Expected "#RRGGBB" (e.g., "#FF0000").`,
    );
  }
  return parseInt(cleaned, 16);
}

interface ParsedRange {
  sheetName: string | null;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

function parseA1Range(rangeStr: string): ParsedRange {
  let sheetName: string | null = null;
  let body = rangeStr;
  const bangIdx = rangeStr.lastIndexOf('!');
  if (bangIdx > -1) {
    sheetName = rangeStr.substring(0, bangIdx);
    if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
      sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
    }
    body = rangeStr.substring(bangIdx + 1);
  }
  const match = body.match(/^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/);
  if (!match) {
    throw new Validation(
      `Invalid A1 range: "${rangeStr}". Expected "A1" or "A1:C3" (optionally with sheet prefix).`,
    );
  }
  const startCol = columnLettersToIndex(match[1]);
  const startRow = parseInt(match[2], 10) - 1;
  const endCol = match[3] ? columnLettersToIndex(match[3]) : startCol;
  const endRow = match[4] ? parseInt(match[4], 10) - 1 : startRow;
  return {
    sheetName,
    startRow,
    endRow: endRow + 1,
    startCol,
    endCol: endCol + 1,
  };
}

function stripXssiPrefix(body: string): string {
  return body.startsWith(")]}'") ? body.slice(4).replace(/^\s+/, '') : body;
}

function absorbSaveResponse(session: SheetSession, bodyText: string): void {
  session.reqId += 1;

  const stripped = stripXssiPrefix(bodyText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return;
  }

  const asObject = parsed as {
    revisionRanges?: Array<[number, number]>;
    metadata?: { serverRevision?: number };
    sid?: string;
    token?: string;
  };

  const lastRange =
    asObject.revisionRanges?.[asObject.revisionRanges.length - 1];
  if (lastRange && typeof lastRange[1] === 'number') {
    session.rev = lastRange[1];
  } else if (typeof asObject.metadata?.serverRevision === 'number') {
    session.rev = asObject.metadata.serverRevision;
  } else {
    session.rev += 1;
  }

  if (typeof asObject.sid === 'string') session.sid = asObject.sid;
  if (typeof asObject.token === 'string') session.token = asObject.token;
}

function isRevMismatchError(status: number, body: string): boolean {
  if (status !== 400 && status !== 409) return false;
  const lower = body.toLowerCase();
  return (
    lower.includes('rev') || lower.includes('"di"') || lower.includes('"er"')
  );
}

async function postCommandBundle(
  spreadsheetId: string,
  buildCommands: (session: SheetSession) => SaveCommand[],
  errorLabel: string,
): Promise<SheetSession> {
  let session = await getSession(spreadsheetId);

  const postOnce = async (s: SheetSession): Promise<Response> => {
    const bundles = JSON.stringify([
      { commands: buildCommands(s), sid: s.sid, reqId: s.reqId },
    ]);
    const qs = new URLSearchParams({
      id: spreadsheetId,
      sid: s.sid,
      token: s.token,
      ouid: s.ouid,
    });
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/save?${qs.toString()}&${SAVE_QUERY_CONSTANTS}`;
    const form = new FormData();
    form.set('rev', String(s.rev));
    form.set('bundles', bundles);
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-same-domain': '1' },
      body: form,
    });
  };

  let res = await postOnce(session);

  if (!res.ok) {
    const peek = await res
      .clone()
      .text()
      .catch(() => '');
    if (isRevMismatchError(res.status, peek)) {
      session = await getSession(spreadsheetId, true);
      res = await postOnce(session);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    throwForStatus(res.status, text);
  }

  absorbSaveResponse(session, await res.text());
  return session;
}

export async function writeCell(
  params: WriteCellInput,
): Promise<WriteCellOutput> {
  const { spreadsheetId, cell, value } = params;
  const { sheetName, row, col } = parseA1(cell);

  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, sheetName);
    return buildWriteCommandsForValue(sheet.gid, row, col, value);
  };

  const session = await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `Range: ${cell}`,
  );
  const sheet = resolveSheet(session, sheetName);
  const a1Cell = `${indexToColumnLetters(col)}${row + 1}`;
  return {
    spreadsheetId,
    updatedRange: `${sheet.title}!${a1Cell}`,
    updatedCells: 1,
  };
}

export async function writeRange(
  params: WriteRangeInput,
): Promise<WriteRangeOutput> {
  const { spreadsheetId, range, values } = params;

  if (!Array.isArray(values) || values.length === 0 || values[0].length === 0) {
    throw new Validation(`writeRange: values must be a non-empty 2D array.`);
  }
  const rows = values.length;
  const cols = values[0].length;
  for (const row of values) {
    if (row.length !== cols) {
      throw new Validation(
        `writeRange: values must be rectangular. Expected ${cols} cols, got ${row.length}.`,
      );
    }
  }

  let sheetName: string | null = null;
  let rangeBody = range;
  const bangIdx = range.lastIndexOf('!');
  if (bangIdx > -1) {
    sheetName = range.substring(0, bangIdx);
    if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
      sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
    }
    rangeBody = range.substring(bangIdx + 1);
  }
  const match = rangeBody.match(/^([A-Za-z]+)(\d+)(?::[A-Za-z]+\d+)?$/);
  if (!match) {
    throw new Validation(
      `Invalid A1 range: "${range}". Expected "A1" or "A1:C3" (with optional sheet prefix).`,
    );
  }
  const startCol = columnLettersToIndex(match[1]);
  const startRow = parseInt(match[2], 10) - 1;

  let updatedCells = 0;
  for (const rowValues of values) {
    for (const v of rowValues) {
      if (v !== null && v !== undefined) updatedCells++;
    }
  }

  const endCol = startCol + cols - 1;
  const endRow = startRow + rows;
  const updatedA1 = `${indexToColumnLetters(startCol)}${startRow + 1}:${indexToColumnLetters(endCol)}${endRow}`;

  if (updatedCells === 0) {
    const session = await getSession(spreadsheetId);
    const sheet = resolveSheet(session, sheetName);
    return {
      spreadsheetId,
      updatedRange: `${sheet.title}!${updatedA1}`,
      updatedCells: 0,
    };
  }

  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, sheetName);
    const commands: SaveCommand[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = values[r][c];
        if (v === null || v === undefined) continue;
        commands.push(
          ...buildWriteCommandsForValue(
            sheet.gid,
            startRow + r,
            startCol + c,
            v,
          ),
        );
      }
    }
    return commands;
  };

  const session = await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `Range: ${range} (${rows}x${cols})`,
  );
  const sheet = resolveSheet(session, sheetName);
  return {
    spreadsheetId,
    updatedRange: `${sheet.title}!${updatedA1}`,
    updatedCells,
  };
}

export async function readRange(
  params: ReadRangeInput,
): Promise<ReadRangeOutput> {
  const { spreadsheetId, range, renderOption } = params;

  let sheetName: string | null = null;
  let cellRange = range;
  const bangIdx = range.lastIndexOf('!');
  if (bangIdx > -1) {
    sheetName = range.substring(0, bangIdx);
    if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
      sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
    }
    cellRange = range.substring(bangIdx + 1);
  } else if (!/^[A-Za-z]+\d*(:[A-Za-z]+\d*)?$/.test(range)) {
    sheetName = range;
    cellRange = '';
  }

  const session = await getSession(spreadsheetId);
  const sheet = resolveSheet(session, sheetName);

  const data = await fetchSheetValues(spreadsheetId, sheet.gid, {
    cellRange: cellRange || undefined,
    renderOption: renderOption ?? 'FORMATTED_VALUE',
  });

  const resolvedRange = cellRange ? `${sheet.title}!${cellRange}` : sheet.title;
  return { range: resolvedRange, values: data.values };
}

export async function readSheet(
  params: ReadSheetInput,
): Promise<ReadSheetOutput> {
  const { spreadsheetId, sheetName, maxRows } = params;
  const rowLimit = maxRows ?? 50;

  const session = await getSession(spreadsheetId);
  const targetSheets = sheetName
    ? [resolveSheet(session, sheetName)]
    : session.sheets;

  const tabs = await Promise.all(
    targetSheets.map(async (meta) => {
      const data = await fetchSheetValues(spreadsheetId, meta.gid);
      const truncated = data.rowCount > rowLimit;
      return {
        name: meta.title,
        gid: meta.gid,
        rowCount: data.rowCount,
        columnCount: data.columnCount,
        values: truncated ? data.values.slice(0, rowLimit) : data.values,
        truncated,
      };
    }),
  );

  return {
    spreadsheetId,
    title: session.title,
    tabs,
  };
}

function buildAddSheetCommand(
  title: string,
  gid: number,
  rowCount: number,
  columnCount: number,
): SaveCommand {
  const addPayload = JSON.stringify([
    2,
    0,
    String(gid),
    [
      [
        [0, 0, title],
        [2, 0, null, null, 0],
        [3, 0, null, null, null, 0],
        [4, 0, null, null, null, null, 0],
        [5, 0, null, null, null, null, null, 0],
        [6, 0, null, null, null, null, null, null, 0],
      ],
    ],
    rowCount,
    columnCount,
  ]);
  const selectPayload = JSON.stringify([[[[4, 0, null, null, 3]]]]);
  return [
    BATCH_WRAPPER_OP,
    [
      [ADD_SHEET_SUB_OP, addPayload],
      [ADD_SHEET_SELECT_SUB_OP, selectPayload],
    ],
  ];
}

function buildDeleteSheetCommand(gid: number): SaveCommand {
  return [DELETE_SHEET_OP, JSON.stringify([String(gid), 0])];
}

function buildRenameSheetCommand(gid: number, newTitle: string): SaveCommand {
  return [RENAME_SHEET_OP, JSON.stringify([String(gid), [[[0, 0, newTitle]]]])];
}

function buildMoveSheetCommand(srcIndex: number, toIndex: number): SaveCommand {
  const dstIndex = toIndex > srcIndex ? toIndex + 1 : toIndex;
  return [MOVE_SHEET_OP, JSON.stringify([srcIndex, dstIndex])];
}

interface FormatSpec {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontFamily?: string;
  fontSize?: number;
  textColor?: string;
  backgroundColor?: string;
  horizontalAlign?: 'LEFT' | 'CENTER' | 'RIGHT';
  numberFormat?: string;
  numberFormatCategory?: number;
}

function detectFormatCategory(pattern: string): number {
  if (
    /y{2,4}|d{1,2}[/-]|[/-]d{1,2}|m{3,}|[/-]m{1,2}[/-]|h{1,2}:|:s{1,2}|am\/pm|\bAM\/PM\b/i.test(
      pattern,
    )
  ) {
    return FORMAT_CATEGORY.DATE;
  }
  return FORMAT_CATEGORY.NUMBER;
}

function buildFormatCommands(
  gid: number,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
  spec: FormatSpec,
): { commands: SaveCommand[]; applied: string[] } {
  const commands: SaveCommand[] = [];
  const applied: string[] = [];
  const range: [string, number, number, number, number] = [
    String(gid),
    startRow,
    endRow,
    startCol,
    endCol,
  ];
  const noValue = [null, 2, null, null, null, 0];

  const pushSimpleFlag = (
    flag: number,
    valueAtPosition: number,
    value: unknown,
  ): void => {
    const directive: unknown[] = [null, flag];
    for (let i = 2; i < valueAtPosition; i++) directive.push(null);
    directive.push(value);
    commands.push([
      FORMAT_CELL_OP,
      JSON.stringify([range, noValue, [null, [directive]]]),
    ]);
  };

  if (spec.bold !== undefined) {
    pushSimpleFlag(FORMAT_FLAG.BOLD, 16, spec.bold ? 1 : 0);
    applied.push('bold');
  }
  if (spec.italic !== undefined) {
    pushSimpleFlag(FORMAT_FLAG.ITALIC, 17, spec.italic ? 1 : 0);
    applied.push('italic');
  }
  if (spec.underline !== undefined) {
    const directive: unknown[] = [null, FORMAT_FLAG.UNDERLINE];
    for (let i = 2; i < 18; i++) directive.push(null);
    directive.push(0);
    directive.push(null);
    directive.push(spec.underline ? 1 : 0);
    commands.push([
      FORMAT_CELL_OP,
      JSON.stringify([range, noValue, [null, [directive]]]),
    ]);
    applied.push('underline');
  }
  if (spec.fontFamily !== undefined) {
    pushSimpleFlag(FORMAT_FLAG.FONT_FAMILY, 14, spec.fontFamily);
    applied.push('fontFamily');
  }
  if (spec.fontSize !== undefined) {
    const directive: unknown[] = [null, FORMAT_FLAG.FONT_SIZE];
    for (let i = 2; i < 15; i++) directive.push(null);
    directive.push(spec.fontSize);
    commands.push([
      FORMAT_CELL_OP,
      JSON.stringify([range, noValue, [null, [directive]]]),
    ]);
    applied.push('fontSize');
  }
  if (spec.textColor !== undefined) {
    const directive: unknown[] = [null, FORMAT_FLAG.TEXT_COLOR];
    for (let i = 2; i < 13; i++) directive.push(null);
    directive.push([2, hexToRgbInt(spec.textColor)]);
    commands.push([
      FORMAT_CELL_OP,
      JSON.stringify([range, noValue, [null, [directive]]]),
    ]);
    applied.push('textColor');
  }
  if (spec.backgroundColor !== undefined) {
    commands.push([
      FORMAT_CELL_OP,
      JSON.stringify([
        range,
        noValue,
        [
          null,
          [
            [
              FORMAT_FLAG.BACKGROUND_COLOR,
              2,
              null,
              [2, hexToRgbInt(spec.backgroundColor)],
            ],
          ],
        ],
      ]),
    ]);
    applied.push('backgroundColor');
  }
  if (spec.horizontalAlign !== undefined) {
    pushSimpleFlag(
      FORMAT_FLAG.HORIZONTAL_ALIGN,
      8,
      HORIZONTAL_ALIGN[spec.horizontalAlign],
    );
    applied.push('horizontalAlign');
  }
  if (spec.numberFormat !== undefined) {
    const category =
      spec.numberFormatCategory ?? detectFormatCategory(spec.numberFormat);
    commands.push([
      FORMAT_CELL_OP,
      JSON.stringify([
        range,
        [32, 2, null, null, null, 0],
        [
          null,
          [[null, FORMAT_FLAG.NUMBER_FORMAT, [category, spec.numberFormat, 1]]],
        ],
      ]),
    ]);
    applied.push('numberFormat');
  }

  return { commands, applied };
}

export async function addSheet(params: AddSheetInput): Promise<AddSheetOutput> {
  const { spreadsheetId, title, rowCount = 1000, columnCount = 26 } = params;
  const gid = generateGid();

  const buildCommands = (session: SheetSession): SaveCommand[] => {
    if (session.sheets.some((s) => s.title === title)) {
      throw new Validation(
        `Tab titled "${title}" already exists. Existing tabs: ${session.sheets.map((s) => s.title).join(', ')}`,
      );
    }
    return [buildAddSheetCommand(title, gid, rowCount, columnCount)];
  };

  const session = await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `addSheet title=${title}`,
  );

  const index = session.sheets.length;
  session.sheets.push({ title, gid, index });

  return { spreadsheetId, title, gid, index };
}

export async function deleteSheet(
  params: DeleteSheetInput,
): Promise<DeleteSheetOutput> {
  const { spreadsheetId, sheetName } = params;

  let deletedGid = 0;
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    if (session.sheets.length <= 1) {
      throw new Validation(
        `Cannot delete the only remaining tab. Spreadsheets must have at least one tab.`,
      );
    }
    const sheet = resolveSheet(session, sheetName);
    deletedGid = sheet.gid;
    return [buildDeleteSheetCommand(sheet.gid)];
  };

  const session = await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `deleteSheet name=${sheetName}`,
  );

  const removeAt = session.sheets.findIndex((s) => s.gid === deletedGid);
  if (removeAt >= 0) {
    session.sheets.splice(removeAt, 1);
    session.sheets.forEach((s, i) => {
      s.index = i;
    });
  }

  return { spreadsheetId, deletedSheetName: sheetName, deletedGid };
}

export async function renameSheet(
  params: RenameSheetInput,
): Promise<RenameSheetOutput> {
  const { spreadsheetId, sheetName, newTitle } = params;

  let gid = 0;
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    if (
      session.sheets.some((s) => s.title === newTitle && s.title !== sheetName)
    ) {
      throw new Validation(
        `Tab titled "${newTitle}" already exists. Pick a different title.`,
      );
    }
    const sheet = resolveSheet(session, sheetName);
    gid = sheet.gid;
    return [buildRenameSheetCommand(sheet.gid, newTitle)];
  };

  const session = await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `renameSheet ${sheetName} -> ${newTitle}`,
  );

  const renamed = session.sheets.find((s) => s.gid === gid);
  if (renamed) renamed.title = newTitle;

  return { spreadsheetId, oldTitle: sheetName, newTitle, gid };
}

export async function moveSheet(
  params: MoveSheetInput,
): Promise<MoveSheetOutput> {
  const { spreadsheetId, sheetName, toIndex } = params;

  let fromIndex = 0;
  let clampedTo = toIndex;
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, sheetName);
    fromIndex = sheet.index;
    clampedTo = Math.max(0, Math.min(toIndex, session.sheets.length - 1));
    if (clampedTo === fromIndex) return [];
    return [buildMoveSheetCommand(fromIndex, clampedTo)];
  };

  if (fromIndex !== clampedTo) {
    const session = await postCommandBundle(
      spreadsheetId,
      buildCommands,
      `moveSheet ${sheetName} -> ${toIndex}`,
    );
    const at = session.sheets.findIndex((s) => s.title === sheetName);
    if (at >= 0) {
      const [moved] = session.sheets.splice(at, 1);
      session.sheets.splice(clampedTo, 0, moved);
      session.sheets.forEach((s, i) => {
        s.index = i;
      });
    }
  } else {
    // Still need to resolve current index for the return value.
    const session = await getSession(spreadsheetId);
    const sheet = resolveSheet(session, sheetName);
    fromIndex = sheet.index;
    clampedTo = fromIndex;
  }

  return {
    spreadsheetId,
    sheetName,
    fromIndex,
    toIndex: clampedTo,
  };
}

export async function duplicateSheet(
  params: DuplicateSheetInput,
): Promise<DuplicateSheetOutput> {
  const { spreadsheetId, sheetName } = params;
  const newTitle = params.newTitle ?? `Copy of ${sheetName}`;
  const newGid = generateGid();

  const session = await getSession(spreadsheetId);
  const sourceSheet = resolveSheet(session, sheetName);

  if (session.sheets.some((s) => s.title === newTitle)) {
    throw new Validation(
      `Tab titled "${newTitle}" already exists. Pass a different newTitle.`,
    );
  }

  const data = await fetchSheetValues(spreadsheetId, sourceSheet.gid, {
    renderOption: 'UNFORMATTED_VALUE',
  });
  const rowCount = Math.max(data.rowCount, 1000);
  const columnCount = Math.max(data.columnCount, 26);

  let copiedCells = 0;
  const buildCommands = (_session: SheetSession): SaveCommand[] => {
    const commands: SaveCommand[] = [
      buildAddSheetCommand(newTitle, newGid, rowCount, columnCount),
    ];
    for (let r = 0; r < data.values.length; r++) {
      const row = data.values[r];
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        if (v === '' || v === null || v === undefined) continue;
        commands.push(...buildWriteCommandsForValue(newGid, r, c, v));
        copiedCells++;
      }
    }
    return commands;
  };

  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `duplicateSheet ${sheetName} -> ${newTitle}`,
  );

  const newIndex = session.sheets.length;
  session.sheets.push({ title: newTitle, gid: newGid, index: newIndex });

  return {
    spreadsheetId,
    sourceSheetName: sheetName,
    newSheetName: newTitle,
    newGid,
    newIndex,
    copiedCells,
  };
}

export async function formatRange(
  params: FormatRangeInput,
): Promise<FormatRangeOutput> {
  const { spreadsheetId, range } = params;
  const parsed = parseA1Range(range);

  const spec: FormatSpec = {
    bold: params.bold,
    italic: params.italic,
    underline: params.underline,
    fontFamily: params.fontFamily,
    fontSize: params.fontSize,
    textColor: params.textColor,
    backgroundColor: params.backgroundColor,
    horizontalAlign: params.horizontalAlign,
    numberFormat: params.numberFormat,
  };

  let applied: string[] = [];
  let resolvedRange = '';

  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, parsed.sheetName);
    const built = buildFormatCommands(
      sheet.gid,
      parsed.startRow,
      parsed.endRow,
      parsed.startCol,
      parsed.endCol,
      spec,
    );
    applied = built.applied;
    resolvedRange = `${sheet.title}!${indexToColumnLetters(parsed.startCol)}${parsed.startRow + 1}:${indexToColumnLetters(parsed.endCol - 1)}${parsed.endRow}`;
    if (built.commands.length === 0) {
      throw new Validation(
        `formatRange: no format properties specified. Pass at least one of bold, italic, underline, fontFamily, fontSize, textColor, backgroundColor, horizontalAlign, numberFormat.`,
      );
    }
    return built.commands;
  };

  await postCommandBundle(spreadsheetId, buildCommands, `formatRange ${range}`);

  return {
    spreadsheetId,
    updatedRange: resolvedRange,
    appliedProperties: applied,
  };
}

// ============================================================================
// Priority 2 & 3 builders
// ============================================================================

function buildInsertDimensionCommand(
  gid: number,
  startIndex: number,
  count: number,
  dimension: 0 | 1,
): SaveCommand {
  return [
    INSERT_DIMENSION_OP,
    JSON.stringify([String(gid), startIndex, count, dimension, 0]),
  ];
}

function buildDeleteDimensionCommand(
  gid: number,
  startIndex: number,
  count: number,
  dimension: 0 | 1,
): SaveCommand {
  return [
    DELETE_DIMENSION_OP,
    JSON.stringify([String(gid), startIndex, count, dimension]),
  ];
}

function buildResizeDimensionCommand(
  gid: number,
  startIndex: number,
  count: number,
  dimension: 0 | 1,
  pixelSize: number,
): SaveCommand {
  return [
    DIMENSION_PROPERTIES_OP,
    JSON.stringify([
      String(gid),
      dimension,
      [[startIndex, startIndex + count]],
      [[[DIMENSION_FIELD.SIZE, 0, pixelSize]]],
    ]),
  ];
}

function buildVisibilityDimensionCommand(
  gid: number,
  startIndex: number,
  count: number,
  dimension: 0 | 1,
  hidden: boolean,
): SaveCommand {
  return [
    DIMENSION_PROPERTIES_OP,
    JSON.stringify([
      String(gid),
      dimension,
      [[startIndex, startIndex + count]],
      [[[DIMENSION_FIELD.HIDDEN, 0, null, hidden ? 1 : 0]]],
    ]),
  ];
}

function buildFreezeRowsCommand(gid: number, count: number): SaveCommand {
  return [
    SET_SHEET_PROPERTIES_OP,
    JSON.stringify([
      String(gid),
      [[[SHEET_PROPERTY_FIELD.FROZEN_ROWS, 0, null, null, null, null, count]]],
    ]),
  ];
}

function buildClearRangeCommand(
  gid: number,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
): SaveCommand {
  return [
    FORMAT_CELL_OP,
    JSON.stringify([
      [String(gid), startRow, endRow, startCol, endCol],
      [2],
      [],
    ]),
  ];
}

function buildMergeCellsCommand(
  gid: number,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
): SaveCommand {
  return [
    MERGE_CELLS_OP,
    JSON.stringify([[String(gid), startRow, endRow, startCol, endCol]]),
  ];
}

function buildUnmergeCellsCommand(
  gid: number,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
): SaveCommand {
  return [
    UNMERGE_CELLS_OP,
    JSON.stringify([[String(gid), startRow, endRow, startCol, endCol]]),
  ];
}

function buildSetCellNoteCommand(
  gid: number,
  row: number,
  col: number,
  note: string,
): SaveCommand {
  const range = [String(gid), row, row + 1, col, col + 1];
  const valueCmd: unknown[] = [null, CELL_NOTE_FLAG];
  for (let i = 2; i < 19; i++) valueCmd.push(null);
  valueCmd.push(note);
  return [FORMAT_CELL_OP, JSON.stringify([range, valueCmd, []])];
}

function buildSetHyperlinkCommand(
  gid: number,
  row: number,
  col: number,
  url: string,
  displayText: string,
): SaveCommand {
  const range = [String(gid), row, row + 1, col, col + 1];
  const valueCmd: unknown[] = [
    HYPERLINK_VALUE_OP,
    131075,
    [VALUE_TYPE.STRING, displayText],
    null,
    null,
    0,
  ];
  for (let i = 6; i < 23; i++) valueCmd.push(null);
  valueCmd.push(url);

  const directive: unknown[] = [264192, 1049089, [0]];
  for (let i = 3; i < 12; i++) directive.push(null);
  directive.push(0);
  for (let i = 13; i < 23; i++) directive.push(null);
  directive.push(1);

  return [
    FORMAT_CELL_OP,
    JSON.stringify([range, valueCmd, [null, [directive]]]),
  ];
}

function buildCreateBasicFilterCommand(
  gid: number,
  filterId: number,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
): SaveCommand {
  const range = [String(gid), startRow, endRow, startCol, endCol];
  return [
    BATCH_WRAPPER_OP,
    [
      [
        CREATE_FILTER_OP,
        JSON.stringify([String(filterId), range, 4, [null, 2, null, []]]),
      ],
      [
        ASSOCIATE_FILTER_OP,
        JSON.stringify([String(gid), [null, 2, null, String(filterId)]]),
      ],
    ],
  ];
}

function buildRemoveBasicFilterCommand(
  gid: number,
  filterId: number,
): SaveCommand {
  return [
    BATCH_WRAPPER_OP,
    [
      [ASSOCIATE_FILTER_OP, JSON.stringify([String(gid), [2]])],
      [DELETE_FILTER_OP, JSON.stringify([String(filterId), 4])],
    ],
  ];
}

// ============================================================================
// Priority 2 & 3 exported functions
// ============================================================================

export async function insertRows(
  params: InsertRowsInput,
): Promise<InsertRowsOutput> {
  const { spreadsheetId, sheetName, startIndex } = params;
  const count = params.count ?? 1;
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, sheetName);
    return [
      buildInsertDimensionCommand(sheet.gid, startIndex, count, DIMENSION.ROW),
    ];
  };
  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `insertRows ${sheetName} at ${startIndex} x${count}`,
  );
  return { spreadsheetId, sheetName, insertedAt: startIndex, count };
}

export async function insertColumns(
  params: InsertColumnsInput,
): Promise<InsertColumnsOutput> {
  const { spreadsheetId, sheetName, startIndex } = params;
  const count = params.count ?? 1;
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, sheetName);
    return [
      buildInsertDimensionCommand(
        sheet.gid,
        startIndex,
        count,
        DIMENSION.COLUMN,
      ),
    ];
  };
  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `insertColumns ${sheetName} at ${startIndex} x${count}`,
  );
  return { spreadsheetId, sheetName, insertedAt: startIndex, count };
}

export async function deleteRows(
  params: DeleteRowsInput,
): Promise<DeleteRowsOutput> {
  const { spreadsheetId, sheetName, startIndex } = params;
  const count = params.count ?? 1;
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, sheetName);
    return [
      buildDeleteDimensionCommand(sheet.gid, startIndex, count, DIMENSION.ROW),
    ];
  };
  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `deleteRows ${sheetName} at ${startIndex} x${count}`,
  );
  return { spreadsheetId, sheetName, deletedAt: startIndex, count };
}

export async function deleteColumns(
  params: DeleteColumnsInput,
): Promise<DeleteColumnsOutput> {
  const { spreadsheetId, sheetName, startIndex } = params;
  const count = params.count ?? 1;
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, sheetName);
    return [
      buildDeleteDimensionCommand(
        sheet.gid,
        startIndex,
        count,
        DIMENSION.COLUMN,
      ),
    ];
  };
  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `deleteColumns ${sheetName} at ${startIndex} x${count}`,
  );
  return { spreadsheetId, sheetName, deletedAt: startIndex, count };
}

export async function resizeRows(
  params: ResizeRowsInput,
): Promise<ResizeRowsOutput> {
  const { spreadsheetId, sheetName, startIndex, pixelHeight } = params;
  const count = params.count ?? 1;
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, sheetName);
    return [
      buildResizeDimensionCommand(
        sheet.gid,
        startIndex,
        count,
        DIMENSION.ROW,
        pixelHeight,
      ),
    ];
  };
  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `resizeRows ${sheetName} at ${startIndex} x${count} -> ${pixelHeight}px`,
  );
  return { spreadsheetId, sheetName, resizedRows: count, pixelHeight };
}

export async function resizeColumns(
  params: ResizeColumnsInput,
): Promise<ResizeColumnsOutput> {
  const { spreadsheetId, sheetName, startIndex, pixelWidth } = params;
  const count = params.count ?? 1;
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, sheetName);
    return [
      buildResizeDimensionCommand(
        sheet.gid,
        startIndex,
        count,
        DIMENSION.COLUMN,
        pixelWidth,
      ),
    ];
  };
  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `resizeColumns ${sheetName} at ${startIndex} x${count} -> ${pixelWidth}px`,
  );
  return { spreadsheetId, sheetName, resizedColumns: count, pixelWidth };
}

export async function setRowsVisibility(
  params: SetRowsVisibilityInput,
): Promise<SetRowsVisibilityOutput> {
  const { spreadsheetId, sheetName, startIndex, hidden } = params;
  const count = params.count ?? 1;
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, sheetName);
    return [
      buildVisibilityDimensionCommand(
        sheet.gid,
        startIndex,
        count,
        DIMENSION.ROW,
        hidden,
      ),
    ];
  };
  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `setRowsVisibility ${sheetName} at ${startIndex} x${count} hidden=${hidden}`,
  );
  return {
    spreadsheetId,
    sheetName,
    hidden,
    rangeStart: startIndex,
    rangeEnd: startIndex + count,
  };
}

export async function setColumnsVisibility(
  params: SetColumnsVisibilityInput,
): Promise<SetColumnsVisibilityOutput> {
  const { spreadsheetId, sheetName, startIndex, hidden } = params;
  const count = params.count ?? 1;
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, sheetName);
    return [
      buildVisibilityDimensionCommand(
        sheet.gid,
        startIndex,
        count,
        DIMENSION.COLUMN,
        hidden,
      ),
    ];
  };
  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `setColumnsVisibility ${sheetName} at ${startIndex} x${count} hidden=${hidden}`,
  );
  return {
    spreadsheetId,
    sheetName,
    hidden,
    rangeStart: startIndex,
    rangeEnd: startIndex + count,
  };
}

export async function freezeRows(
  params: FreezeRowsInput,
): Promise<FreezeRowsOutput> {
  const { spreadsheetId, sheetName, count } = params;
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, sheetName);
    return [buildFreezeRowsCommand(sheet.gid, count)];
  };
  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `freezeRows ${sheetName} count=${count}`,
  );
  return { spreadsheetId, sheetName, frozenRows: count };
}

export async function clearRange(
  params: ClearRangeInput,
): Promise<ClearRangeOutput> {
  const { spreadsheetId, range } = params;
  const parsed = parseA1Range(range);
  let resolvedRange = '';
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, parsed.sheetName);
    resolvedRange = `${sheet.title}!${indexToColumnLetters(parsed.startCol)}${parsed.startRow + 1}:${indexToColumnLetters(parsed.endCol - 1)}${parsed.endRow}`;
    return [
      buildClearRangeCommand(
        sheet.gid,
        parsed.startRow,
        parsed.endRow,
        parsed.startCol,
        parsed.endCol,
      ),
    ];
  };
  await postCommandBundle(spreadsheetId, buildCommands, `clearRange ${range}`);
  return { spreadsheetId, clearedRange: resolvedRange };
}

export async function mergeCells(
  params: MergeCellsInput,
): Promise<MergeCellsOutput> {
  const { spreadsheetId, range } = params;
  const parsed = parseA1Range(range);
  let resolvedRange = '';
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, parsed.sheetName);
    resolvedRange = `${sheet.title}!${indexToColumnLetters(parsed.startCol)}${parsed.startRow + 1}:${indexToColumnLetters(parsed.endCol - 1)}${parsed.endRow}`;
    return [
      buildMergeCellsCommand(
        sheet.gid,
        parsed.startRow,
        parsed.endRow,
        parsed.startCol,
        parsed.endCol,
      ),
    ];
  };
  await postCommandBundle(spreadsheetId, buildCommands, `mergeCells ${range}`);
  return { spreadsheetId, mergedRange: resolvedRange };
}

export async function unmergeCells(
  params: UnmergeCellsInput,
): Promise<UnmergeCellsOutput> {
  const { spreadsheetId, range } = params;
  const parsed = parseA1Range(range);
  let resolvedRange = '';
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, parsed.sheetName);
    resolvedRange = `${sheet.title}!${indexToColumnLetters(parsed.startCol)}${parsed.startRow + 1}:${indexToColumnLetters(parsed.endCol - 1)}${parsed.endRow}`;
    return [
      buildUnmergeCellsCommand(
        sheet.gid,
        parsed.startRow,
        parsed.endRow,
        parsed.startCol,
        parsed.endCol,
      ),
    ];
  };
  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `unmergeCells ${range}`,
  );
  return { spreadsheetId, unmergedRange: resolvedRange };
}

export async function setCellNote(
  params: SetCellNoteInput,
): Promise<SetCellNoteOutput> {
  const { spreadsheetId, cell, note } = params;
  const parsed = parseA1(cell);
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, parsed.sheetName);
    return [buildSetCellNoteCommand(sheet.gid, parsed.row, parsed.col, note)];
  };
  await postCommandBundle(spreadsheetId, buildCommands, `setCellNote ${cell}`);
  return { spreadsheetId, cell, note };
}

export async function setHyperlink(
  params: SetHyperlinkInput,
): Promise<SetHyperlinkOutput> {
  const { spreadsheetId, cell, url } = params;
  const displayText = params.displayText ?? url;
  const parsed = parseA1(cell);
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, parsed.sheetName);
    return [
      buildSetHyperlinkCommand(
        sheet.gid,
        parsed.row,
        parsed.col,
        url,
        displayText,
      ),
    ];
  };
  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `setHyperlink ${cell} -> ${url}`,
  );
  return { spreadsheetId, cell, url, displayText };
}

export async function findAndReplace(
  params: FindAndReplaceInput,
): Promise<FindAndReplaceOutput> {
  const {
    spreadsheetId,
    find,
    replace,
    sheetName,
    matchCase,
    matchEntireCell,
  } = params;
  if (find.length === 0) {
    throw new Validation(`findAndReplace: 'find' must be a non-empty string.`);
  }

  const session = await getSession(spreadsheetId);
  const targets = sheetName
    ? [resolveSheet(session, sheetName)]
    : session.sheets;

  const escapeRegExp = (s: string): string =>
    s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const needle = matchCase ? find : find.toLowerCase();
  const writes: Array<{
    gid: number;
    row: number;
    col: number;
    value: string | number | boolean;
  }> = [];

  for (const sheet of targets) {
    const data = await fetchSheetValues(spreadsheetId, sheet.gid, {
      renderOption: 'UNFORMATTED_VALUE',
    });
    for (let r = 0; r < data.values.length; r++) {
      const row = data.values[r];
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        if (v === null || v === undefined || v === '') continue;
        const originalStr = String(v);
        const haystack = matchCase ? originalStr : originalStr.toLowerCase();

        let newStr: string | null = null;
        if (matchEntireCell) {
          if (haystack === needle) newStr = replace;
        } else {
          if (!haystack.includes(needle)) continue;
          const re = new RegExp(escapeRegExp(find), matchCase ? 'g' : 'gi');
          newStr = originalStr.replace(re, replace);
        }
        if (newStr === null || newStr === originalStr) continue;

        let coerced: string | number | boolean = newStr;
        if (typeof v === 'number') {
          const asNum = Number(newStr);
          if (!Number.isNaN(asNum) && newStr.trim() !== '') coerced = asNum;
        } else if (typeof v === 'boolean') {
          if (newStr.toLowerCase() === 'true') coerced = true;
          else if (newStr.toLowerCase() === 'false') coerced = false;
        }
        writes.push({ gid: sheet.gid, row: r, col: c, value: coerced });
      }
    }
  }

  if (writes.length > 0) {
    await postCommandBundle(
      spreadsheetId,
      () =>
        writes.flatMap((w) =>
          buildWriteCommandsForValue(w.gid, w.row, w.col, w.value),
        ),
      `findAndReplace "${find}"->"${replace}" (${writes.length} cells)`,
    );
  }

  return { spreadsheetId, replacements: writes.length };
}

export async function createBasicFilter(
  params: CreateBasicFilterInput,
): Promise<CreateBasicFilterOutput> {
  const { spreadsheetId, range } = params;
  const parsed = parseA1Range(range);
  const filterId = generateGid();
  let resolvedRange = '';
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, parsed.sheetName);
    resolvedRange = `${sheet.title}!${indexToColumnLetters(parsed.startCol)}${parsed.startRow + 1}:${indexToColumnLetters(parsed.endCol - 1)}${parsed.endRow}`;
    return [
      buildCreateBasicFilterCommand(
        sheet.gid,
        filterId,
        parsed.startRow,
        parsed.endRow,
        parsed.startCol,
        parsed.endCol,
      ),
    ];
  };
  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `createBasicFilter ${range}`,
  );
  return { spreadsheetId, filterId, range: resolvedRange };
}

export async function removeBasicFilter(
  params: RemoveBasicFilterInput,
): Promise<RemoveBasicFilterOutput> {
  const { spreadsheetId, sheetName, filterId } = params;
  const buildCommands = (session: SheetSession): SaveCommand[] => {
    const sheet = resolveSheet(session, sheetName);
    return [buildRemoveBasicFilterCommand(sheet.gid, filterId)];
  };
  await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `removeBasicFilter ${sheetName} filterId=${filterId}`,
  );
  return { spreadsheetId, sheetName, removedFilterId: filterId };
}

export async function batchUpdate(
  params: BatchUpdateInput,
): Promise<BatchUpdateOutput> {
  const { spreadsheetId, commands } = params;

  type PlannedMutation =
    | { kind: 'add'; title: string; gid: number }
    | { kind: 'delete'; gid: number }
    | { kind: 'rename'; gid: number; newTitle: string }
    | { kind: 'move'; gid: number; toIndex: number };
  let planned: PlannedMutation[] = [];

  const buildCommands = (session: SheetSession): SaveCommand[] => {
    planned = [];
    const saveCommands: SaveCommand[] = [];
    for (const cmd of commands) {
      switch (cmd.op) {
        case 'writeCell': {
          const { sheetName, row, col } = parseA1(cmd.cell);
          const sheet = resolveSheet(session, sheetName);
          saveCommands.push(
            ...buildWriteCommandsForValue(sheet.gid, row, col, cmd.value),
          );
          break;
        }
        case 'addSheet': {
          if (session.sheets.some((s) => s.title === cmd.title)) {
            throw new Validation(
              `Tab titled "${cmd.title}" already exists in batchUpdate.`,
            );
          }
          const newGid = generateGid();
          saveCommands.push(
            buildAddSheetCommand(
              cmd.title,
              newGid,
              cmd.rowCount ?? 1000,
              cmd.columnCount ?? 26,
            ),
          );
          planned.push({ kind: 'add', title: cmd.title, gid: newGid });
          break;
        }
        case 'deleteSheet': {
          const sheet = resolveSheet(session, cmd.sheetName);
          saveCommands.push(buildDeleteSheetCommand(sheet.gid));
          planned.push({ kind: 'delete', gid: sheet.gid });
          break;
        }
        case 'renameSheet': {
          const sheet = resolveSheet(session, cmd.sheetName);
          saveCommands.push(buildRenameSheetCommand(sheet.gid, cmd.newTitle));
          planned.push({
            kind: 'rename',
            gid: sheet.gid,
            newTitle: cmd.newTitle,
          });
          break;
        }
        case 'moveSheet': {
          const sheet = resolveSheet(session, cmd.sheetName);
          const clampedTo = Math.max(
            0,
            Math.min(cmd.toIndex, session.sheets.length - 1),
          );
          if (clampedTo !== sheet.index) {
            saveCommands.push(buildMoveSheetCommand(sheet.index, clampedTo));
            planned.push({ kind: 'move', gid: sheet.gid, toIndex: clampedTo });
          }
          break;
        }
        case 'formatRange': {
          const parsed = parseA1Range(cmd.range);
          const sheet = resolveSheet(session, parsed.sheetName);
          const built = buildFormatCommands(
            sheet.gid,
            parsed.startRow,
            parsed.endRow,
            parsed.startCol,
            parsed.endCol,
            {
              bold: cmd.bold,
              italic: cmd.italic,
              underline: cmd.underline,
              fontFamily: cmd.fontFamily,
              fontSize: cmd.fontSize,
              textColor: cmd.textColor,
              backgroundColor: cmd.backgroundColor,
              horizontalAlign: cmd.horizontalAlign,
              numberFormat: cmd.numberFormat,
            },
          );
          saveCommands.push(...built.commands);
          break;
        }
        case 'insertRows': {
          const sheet = resolveSheet(session, cmd.sheetName);
          saveCommands.push(
            buildInsertDimensionCommand(
              sheet.gid,
              cmd.startIndex,
              cmd.count ?? 1,
              DIMENSION.ROW,
            ),
          );
          break;
        }
        case 'insertColumns': {
          const sheet = resolveSheet(session, cmd.sheetName);
          saveCommands.push(
            buildInsertDimensionCommand(
              sheet.gid,
              cmd.startIndex,
              cmd.count ?? 1,
              DIMENSION.COLUMN,
            ),
          );
          break;
        }
        case 'deleteRows': {
          const sheet = resolveSheet(session, cmd.sheetName);
          saveCommands.push(
            buildDeleteDimensionCommand(
              sheet.gid,
              cmd.startIndex,
              cmd.count ?? 1,
              DIMENSION.ROW,
            ),
          );
          break;
        }
        case 'deleteColumns': {
          const sheet = resolveSheet(session, cmd.sheetName);
          saveCommands.push(
            buildDeleteDimensionCommand(
              sheet.gid,
              cmd.startIndex,
              cmd.count ?? 1,
              DIMENSION.COLUMN,
            ),
          );
          break;
        }
        case 'resizeRows': {
          const sheet = resolveSheet(session, cmd.sheetName);
          saveCommands.push(
            buildResizeDimensionCommand(
              sheet.gid,
              cmd.startIndex,
              cmd.count ?? 1,
              DIMENSION.ROW,
              cmd.pixelHeight,
            ),
          );
          break;
        }
        case 'resizeColumns': {
          const sheet = resolveSheet(session, cmd.sheetName);
          saveCommands.push(
            buildResizeDimensionCommand(
              sheet.gid,
              cmd.startIndex,
              cmd.count ?? 1,
              DIMENSION.COLUMN,
              cmd.pixelWidth,
            ),
          );
          break;
        }
        case 'setRowsVisibility': {
          const sheet = resolveSheet(session, cmd.sheetName);
          saveCommands.push(
            buildVisibilityDimensionCommand(
              sheet.gid,
              cmd.startIndex,
              cmd.count ?? 1,
              DIMENSION.ROW,
              cmd.hidden,
            ),
          );
          break;
        }
        case 'setColumnsVisibility': {
          const sheet = resolveSheet(session, cmd.sheetName);
          saveCommands.push(
            buildVisibilityDimensionCommand(
              sheet.gid,
              cmd.startIndex,
              cmd.count ?? 1,
              DIMENSION.COLUMN,
              cmd.hidden,
            ),
          );
          break;
        }
        case 'freezeRows': {
          const sheet = resolveSheet(session, cmd.sheetName);
          saveCommands.push(buildFreezeRowsCommand(sheet.gid, cmd.count));
          break;
        }
        case 'clearRange': {
          const parsed = parseA1Range(cmd.range);
          const sheet = resolveSheet(session, parsed.sheetName);
          saveCommands.push(
            buildClearRangeCommand(
              sheet.gid,
              parsed.startRow,
              parsed.endRow,
              parsed.startCol,
              parsed.endCol,
            ),
          );
          break;
        }
        case 'mergeCells': {
          const parsed = parseA1Range(cmd.range);
          const sheet = resolveSheet(session, parsed.sheetName);
          saveCommands.push(
            buildMergeCellsCommand(
              sheet.gid,
              parsed.startRow,
              parsed.endRow,
              parsed.startCol,
              parsed.endCol,
            ),
          );
          break;
        }
        case 'unmergeCells': {
          const parsed = parseA1Range(cmd.range);
          const sheet = resolveSheet(session, parsed.sheetName);
          saveCommands.push(
            buildUnmergeCellsCommand(
              sheet.gid,
              parsed.startRow,
              parsed.endRow,
              parsed.startCol,
              parsed.endCol,
            ),
          );
          break;
        }
        case 'setCellNote': {
          const parsed = parseA1(cmd.cell);
          const sheet = resolveSheet(session, parsed.sheetName);
          saveCommands.push(
            buildSetCellNoteCommand(
              sheet.gid,
              parsed.row,
              parsed.col,
              cmd.note,
            ),
          );
          break;
        }
        case 'setHyperlink': {
          const parsed = parseA1(cmd.cell);
          const sheet = resolveSheet(session, parsed.sheetName);
          saveCommands.push(
            buildSetHyperlinkCommand(
              sheet.gid,
              parsed.row,
              parsed.col,
              cmd.url,
              cmd.displayText ?? cmd.url,
            ),
          );
          break;
        }
      }
    }
    return saveCommands;
  };

  const session = await postCommandBundle(
    spreadsheetId,
    buildCommands,
    `batchUpdate (${commands.length} commands)`,
  );

  const reindex = (): void => {
    session.sheets.forEach((s, i) => {
      s.index = i;
    });
  };
  for (const m of planned) {
    switch (m.kind) {
      case 'add':
        session.sheets.push({
          title: m.title,
          gid: m.gid,
          index: session.sheets.length,
        });
        break;
      case 'delete': {
        const at = session.sheets.findIndex((s) => s.gid === m.gid);
        if (at >= 0) {
          session.sheets.splice(at, 1);
          reindex();
        }
        break;
      }
      case 'rename': {
        const s = session.sheets.find((x) => x.gid === m.gid);
        if (s) s.title = m.newTitle;
        break;
      }
      case 'move': {
        const at = session.sheets.findIndex((s) => s.gid === m.gid);
        if (at >= 0) {
          const [moved] = session.sheets.splice(at, 1);
          session.sheets.splice(m.toIndex, 0, moved);
          reindex();
        }
        break;
      }
    }
  }

  return {
    spreadsheetId,
    appliedCommands: commands.length,
    revision: session.rev,
  };
}

// ============================================================================
// Window type augmentation
// ============================================================================

declare global {
  var gapi: {
    auth: {
      getAuthHeaderValueForFirstParty: () => string;
    };
  };
}
