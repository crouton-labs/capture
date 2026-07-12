import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type CursorClaims,
  type CursorLeaf,
  type ImmutableIndex,
  validateCursorClaims,
  validateCursorToken,
  validateImmutableIndex,
} from '../contracts/index.js';

/** A durable owner for immutable indexes. This service never chooses a session or artifact location. */
export interface CursorIndexStore<Row> {
  put(index: ImmutableIndex<Row>): void | Promise<void>;
  get(digest: string): ImmutableIndex<Row> | undefined | Promise<ImmutableIndex<Row> | undefined>;
}

/** Caller-owned identity for one cursorable read. `scope` must be explicit and nonempty. */
export interface CursorQueryIdentity {
  readonly scope: Record<string, unknown>;
  readonly query: Record<string, unknown>;
}

export interface CreateCursorPageInput<Row> extends CursorQueryIdentity {
  readonly leaf: CursorLeaf;
  readonly path: string;
  /** The declared source order. Rows are retained in exactly this order; the service never re-sorts them. */
  readonly order: string;
  readonly coverage: unknown;
  readonly rows: readonly Row[];
  readonly expiresAt: string;
  readonly limit?: number;
}

export interface ContinueCursorPageInput extends CursorQueryIdentity {
  readonly cursor: string;
  /** A continuation's limit is fixed by its signed first-page limit. */
  readonly limit?: number;
}

/** Bounded public page; the retained index and its undisplayed rows remain store-private. */
export interface CursorPage<Row> {
  readonly indexDigest: string;
  readonly expiresAt: string;
  readonly rows: readonly Row[];
  readonly limit: number;
  readonly total: number;
  readonly nextCursor: string | null;
}

export type CursorServiceErrorCode =
  | 'cursor_invalid'
  | 'cursor_expired'
  | 'cursor_scope_mismatch'
  | 'cursor_query_mismatch'
  | 'cursor_limit_invalid'
  | 'cursor_index_unavailable'
  | 'cursor_index_invalid';

/** A typed public error; handlers map it to their stable error envelope. */
export class CursorServiceError extends Error {
  constructor(readonly code: CursorServiceErrorCode, message: string) {
    super(message);
    this.name = 'CursorServiceError';
  }
}

export interface CursorServiceOptions<Row> {
  readonly store: CursorIndexStore<Row>;
  /** HMAC key. It is caller configuration, never read from an ambient environment. */
  readonly secret: string | Uint8Array;
  /** Injectable only for deterministic tests; production callers pass no clock. */
  readonly now?: () => Date;
}

interface CursorPayload {
  readonly schemaVersion: 1;
  readonly indexDigest: string;
  readonly leaf: CursorLeaf;
  readonly filter: Record<string, unknown>;
  readonly nextExclusiveOrdinal: number;
  readonly pageSize: number;
  readonly expiresAt: string;
}

const TOKEN_PREFIX = 'c1';

/**
 * An isolated immutable-index paginator. It has no active-session, cwd, environment,
 * filesystem, or browser lookup: callers supply the durable index store and identity.
 */
export class CursorService<Row> {
  private readonly now: () => Date;

  constructor(private readonly options: CursorServiceOptions<Row>) {
    if ((typeof options.secret === 'string' && options.secret.length === 0) || (options.secret instanceof Uint8Array && options.secret.byteLength === 0)) {
      throw new Error('cursor service secret must not be empty');
    }
    this.now = options.now ?? (() => new Date());
  }

  async createPage(input: CreateCursorPageInput<Row>): Promise<CursorPage<Row>> {
    const limit = validateLimit(input.limit ?? DEFAULT_PAGE_SIZE);
    canonicalIdentity(input);
    const expiresAt = parseFutureExpiry(input.expiresAt, this.now());
    if (!input.path || !input.order) throw new CursorServiceError('cursor_index_invalid', 'cursor index requires nonempty path and order');

    // Canonical JSON both makes the digest deterministic and snapshots caller-owned rows.
    const rows = cloneJson(input.rows) as readonly Row[];
    const filter = cloneJson({ scope: input.scope, query: input.query }) as Record<string, unknown>;
    const draft = {
      schemaVersion: 1 as const,
      leaf: input.leaf,
      path: input.path,
      createdAt: this.now().toISOString(),
      expiresAt: expiresAt.toISOString(),
      filter,
      pageSize: limit,
      order: input.order,
      coverage: cloneJson(input.coverage),
      rows,
    };
    const index: ImmutableIndex<Row> = { ...draft, digest: digestIndex(draft) };
    assertIndex(index);
    // Identity was validated before the durable write and is represented in the signed/indexed filter.
    await this.options.store.put(index);
    return this.page(index, 0);
  }

  async continuePage(input: ContinueCursorPageInput): Promise<CursorPage<Row>> {
    // All untrusted token/identity/limit checks precede the store lookup.
    const claims = this.decode(input.cursor);
    const now = this.now();
    if (Date.parse(claims.expiresAt) <= now.getTime()) {
      throw new CursorServiceError('cursor_expired', 'cursor has expired');
    }
    const expected = canonicalIdentity(input);
    const actual = canonicalJson(claims.filter);
    if (canonicalJson((claims.filter as Record<string, unknown>).scope) !== canonicalJson(input.scope)) {
      throw new CursorServiceError('cursor_scope_mismatch', 'cursor scope does not match this read');
    }
    if (actual !== expected) {
      throw new CursorServiceError('cursor_query_mismatch', 'cursor query does not match this read');
    }
    if (input.limit !== undefined && input.limit !== claims.pageSize) {
      throw new CursorServiceError('cursor_limit_invalid', 'continuation limit must equal the signed cursor limit');
    }

    const index = await this.options.store.get(claims.indexDigest);
    if (!index) throw new CursorServiceError('cursor_index_unavailable', 'cursor index is unavailable');
    this.assertClaimsMatchIndex(claims, index);
    return this.page(index, claims.nextExclusiveOrdinal);
  }

  private page(index: ImmutableIndex<Row>, start: number): CursorPage<Row> {
    if (start > index.rows.length) {
      throw new CursorServiceError('cursor_index_invalid', 'cursor ordinal exceeds retained index rows');
    }
    const end = Math.min(start + index.pageSize, index.rows.length);
    const rows = index.rows.slice(start, end);
    const nextCursor = end < index.rows.length ? this.encode({
      schemaVersion: 1,
      indexDigest: index.digest,
      leaf: index.leaf,
      filter: index.filter,
      // This is the exclusive array offset: rows [0, offset) have already been returned.
      nextExclusiveOrdinal: end,
      pageSize: index.pageSize,
      expiresAt: index.expiresAt,
    }) : null;
    return { indexDigest: index.digest, expiresAt: index.expiresAt, rows, limit: index.pageSize, total: index.rows.length, nextCursor };
  }

  private encode(payload: CursorPayload): string {
    const encoded = Buffer.from(canonicalJson(payload), 'utf8').toString('base64url');
    const mac = this.mac(`${TOKEN_PREFIX}.${encoded}`);
    const token = `${TOKEN_PREFIX}.${encoded}.${mac}`;
    const result = validateCursorToken(token);
    if (!result.valid) throw new CursorServiceError('cursor_index_invalid', result.errors.join('; '));
    return token;
  }

  private decode(token: string): CursorClaims {
    const syntax = validateCursorToken(token);
    if (!syntax.valid) throw new CursorServiceError('cursor_invalid', syntax.errors.join('; '));
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
      throw new CursorServiceError('cursor_invalid', 'cursor has invalid encoding');
    }
    const expectedMac = this.mac(`${parts[0]}.${parts[1]}`);
    if (!constantTimeEqual(parts[2], expectedMac)) throw new CursorServiceError('cursor_invalid', 'cursor MAC is invalid');
    let payload: unknown;
    try {
      const bytes = Buffer.from(parts[1], 'base64url');
      if (bytes.toString('base64url') !== parts[1]) throw new Error('noncanonical base64url');
      payload = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new CursorServiceError('cursor_invalid', 'cursor payload is invalid');
    }
    const claims = { ...(payload as Record<string, unknown>), mac: parts[2] } as CursorClaims;
    const valid = validateCursorClaims(claims);
    if (!valid.valid) throw new CursorServiceError('cursor_invalid', valid.errors.join('; '));
    try {
      canonicalIdentityFilter(claims.filter);
    } catch {
      throw new CursorServiceError('cursor_invalid', 'cursor filter must contain an explicit scope and query');
    }
    return claims;
  }

  private assertClaimsMatchIndex(claims: CursorClaims, index: ImmutableIndex<Row>): void {
    try {
      assertIndex(index);
      const { digest: _digest, ...draft } = index;
      if (digestIndex(draft) !== index.digest) throw new Error('index digest does not match contents');
      if (index.digest !== claims.indexDigest || index.leaf !== claims.leaf || index.pageSize !== claims.pageSize || index.expiresAt !== claims.expiresAt || canonicalJson(index.filter) !== canonicalJson(claims.filter)) {
        throw new Error('index does not match cursor claims');
      }
    } catch (error) {
      throw new CursorServiceError('cursor_index_invalid', error instanceof Error ? error.message : 'cursor index is invalid');
    }
  }

  private mac(value: string): string {
    return createHmac('sha256', this.options.secret).update(value, 'utf8').digest('base64url');
  }
}

/** Minimal reusable in-memory store for tests and callers that own their own process lifetime. */
export class MemoryCursorIndexStore<Row> implements CursorIndexStore<Row> {
  private readonly indexes = new Map<string, ImmutableIndex<Row>>();
  put(index: ImmutableIndex<Row>): void { this.indexes.set(index.digest, index); }
  get(digest: string): ImmutableIndex<Row> | undefined { return this.indexes.get(digest); }
}

function validateLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new CursorServiceError('cursor_limit_invalid', `cursor limit must be an integer from 1 to ${MAX_PAGE_SIZE}`);
  }
  return limit;
}

function parseFutureExpiry(value: string, now: Date): Date {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= now.getTime()) {
    throw new CursorServiceError('cursor_index_invalid', 'cursor index expiry must be a valid future timestamp');
  }
  return new Date(timestamp);
}

function canonicalIdentity(identity: CursorQueryIdentity): string {
  try {
    return canonicalIdentityFilter({ scope: identity.scope, query: identity.query });
  } catch (error) {
    if (error instanceof CursorServiceError) throw error;
    throw new CursorServiceError('cursor_scope_mismatch', 'cursor scope and query must be JSON objects');
  }
}

function canonicalIdentityFilter(filter: Record<string, unknown>): string {
  if (Object.keys(filter).length !== 2 || !Object.prototype.hasOwnProperty.call(filter, 'scope') || !Object.prototype.hasOwnProperty.call(filter, 'query') || !isPlainRecord(filter.scope) || !isPlainRecord(filter.query) || Object.keys(filter.scope).length === 0) {
    throw new Error('invalid cursor identity filter');
  }
  return canonicalJson(filter);
}

function assertIndex(index: ImmutableIndex<unknown>): void {
  const valid = validateImmutableIndex(index);
  if (!valid.valid) throw new Error(valid.errors.join('; '));
  canonicalIdentityFilter(index.filter);
  canonicalJson(index.rows);
  if (!index.path || !index.order || !Number.isFinite(Date.parse(index.createdAt)) || !Number.isFinite(Date.parse(index.expiresAt))) {
    throw new Error('cursor index has invalid immutable metadata');
  }
}

function digestIndex(index: Omit<ImmutableIndex<unknown>, 'digest'>): string {
  return createHash('sha256').update(canonicalJson(index), 'utf8').digest('hex');
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(canonicalJson(value));
}

/** Deterministic JSON for query identity and immutable-index digests. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('cursor values must be finite JSON numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainRecord(value)) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new Error('cursor values must be JSON values');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
