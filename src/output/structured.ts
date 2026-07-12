/**
 * Unreachable structured-output owner for the hard cut. Leaves give this
 * module one semantic projection builder and two canonical encoders; this
 * module alone decides which optional records are admitted.
 */
import { MAX_BOUNDED_BYTES, utf8ByteLength } from '../contracts/primitives.js';

export type OutputEncoding = 'prose' | 'json';

export interface CollectionOmittedBy {
  readonly count_limit: number;
  readonly byte_budget: number;
}

export interface DisplayedCollection<T> {
  readonly retained_total: number;
  readonly displayed: number;
  readonly omitted: number;
  readonly limit: number;
  readonly omitted_by: CollectionOmittedBy;
  readonly records: readonly T[];
}

export interface ProjectionCandidate<T> {
  /** Stable ID used by both encoders and later artifact lookup. */
  readonly id: string;
  /** Canonical per-collection display order, independent of admission priority. */
  readonly displayOrder: number;
  readonly record: T;
}

export interface ProjectionCollection<T> {
  readonly name: string;
  readonly retainedTotal: number;
  readonly limit: number;
  /** Eligible candidates in this collection's canonical record order. */
  readonly candidates: readonly ProjectionCandidate<T>[];
}

export type DisplayedCollections<T> = Readonly<Record<string, DisplayedCollection<T>>>;

export interface CanonicalStructuredEncoders<S> {
  readonly prose: (semantic: S) => string;
  readonly json: (semantic: S) => string;
}

export interface AllocateStructuredProjection<S, T> {
  readonly collections: readonly ProjectionCollection<T>[];
  /**
   * Every eligible candidate exactly once, in the leaf's declared global
   * consideration order. This represents priority groups and cross-collection
   * round robin without letting the allocator invent command semantics.
   */
  readonly candidateOrder: readonly { readonly collection: string; readonly candidate: ProjectionCandidate<T> }[];
  /** Builds the one semantic input shared by the two encoders. */
  readonly build: (collections: DisplayedCollections<T>) => S;
  readonly encoders: CanonicalStructuredEncoders<S>;
  readonly maxBytes?: number;
}

export interface AllocatedStructuredProjection<S, T> {
  readonly semantic: S;
  readonly collections: DisplayedCollections<T>;
  readonly prose: string;
  readonly json: string;
  readonly bytes: Readonly<Record<OutputEncoding, number>>;
}

interface MutableCollection<T> {
  readonly definition: ProjectionCollection<T>;
  readonly eligible: readonly ProjectionCandidate<T>[];
  readonly displayed: ProjectionCandidate<T>[];
  byteBudget: number;
}

function assertSafeUint(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a nonnegative safe integer`);
}

function verifyDefinitions<T>(collections: readonly ProjectionCollection<T>[]): void {
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const collection of collections) {
    if (!collection.name) throw new Error('collection name must not be empty');
    if (names.has(collection.name)) throw new Error(`duplicate collection name: ${collection.name}`);
    names.add(collection.name);
    assertSafeUint(collection.retainedTotal, `${collection.name}.retainedTotal`);
    assertSafeUint(collection.limit, `${collection.name}.limit`);
    if (collection.candidates.length > collection.retainedTotal) throw new Error(`${collection.name} has more candidates than retainedTotal`);
    const eligible = Math.min(collection.retainedTotal, collection.limit);
    if (collection.candidates.length !== eligible) throw new Error(`${collection.name} candidates must contain exactly min(retainedTotal, limit) records`);
    const displayOrders = new Set<number>();
    for (const candidate of collection.candidates) {
      if (!candidate.id) throw new Error(`${collection.name} candidate has empty stable id`);
      assertSafeUint(candidate.displayOrder, `${collection.name}.${candidate.id}.displayOrder`);
      if (displayOrders.has(candidate.displayOrder)) throw new Error(`${collection.name} repeats displayOrder ${candidate.displayOrder}`);
      displayOrders.add(candidate.displayOrder);
      if (ids.has(candidate.id)) throw new Error(`duplicate stable candidate id: ${candidate.id}`);
      ids.add(candidate.id);
    }
  }
}

function displayedCollections<T>(states: readonly MutableCollection<T>[]): DisplayedCollections<T> {
  return Object.fromEntries(states.map((state) => {
    const { retainedTotal, limit, name } = state.definition;
    const displayed = state.displayed.length;
    const countLimit = Math.max(0, retainedTotal - limit);
    const omitted = retainedTotal - displayed;
    const byteBudget = Math.min(retainedTotal, limit) - displayed;
    if (byteBudget !== state.byteBudget) throw new Error(`allocator corruption for ${name}`);
    return [name, {
      retained_total: retainedTotal,
      displayed,
      omitted,
      limit,
      omitted_by: { count_limit: countLimit, byte_budget: byteBudget },
      records: [...state.displayed]
        .sort((left, right) => left.displayOrder - right.displayOrder)
        .map((candidate) => candidate.record),
    } satisfies DisplayedCollection<T>];
  }));
}

function encode<S, T>(states: readonly MutableCollection<T>, build: (collections: DisplayedCollections<T>) => S, encoders: CanonicalStructuredEncoders<S>): AllocatedStructuredProjection<S, T> {
  const collections = displayedCollections(states);
  const semantic = build(collections);
  const prose = encoders.prose(semantic);
  const json = encoders.json(semantic);
  return { semantic, collections, prose, json, bytes: { prose: utf8ByteLength(prose), json: utf8ByteLength(json) } };
}

function fits<S, T>(projection: AllocatedStructuredProjection<S, T>, maxBytes: number): boolean {
  return projection.bytes.prose <= maxBytes && projection.bytes.json <= maxBytes;
}

/**
 * Allocate whole records once for both encodings. A candidate is tested against
 * the projection with every not-yet-considered eligible record counted as a
 * byte-budget omission; this makes the final omission metadata part of every
 * admission decision. A record that does not fit never blocks later records.
 */
export function allocateStructuredProjection<S, T>(input: AllocateStructuredProjection<S, T>): AllocatedStructuredProjection<S, T> {
  const maxBytes = input.maxBytes ?? MAX_BOUNDED_BYTES;
  assertSafeUint(maxBytes, 'maxBytes');
  if (maxBytes > MAX_BOUNDED_BYTES) throw new Error(`maxBytes must not exceed ${MAX_BOUNDED_BYTES}`);
  verifyDefinitions(input.collections);
  const states = input.collections.map<MutableCollection<T>>((definition) => ({
    definition,
    eligible: definition.candidates,
    displayed: [],
    byteBudget: definition.candidates.length,
  }));
  const stateByName = new Map(states.map((state) => [state.definition.name, state]));
  const expectedCandidates = new Map(states.flatMap((state) => state.eligible.map((candidate) => [candidate.id, { state, candidate }] as const)));
  const orderedIds = new Set<string>();
  for (const entry of input.candidateOrder) {
    const expected = expectedCandidates.get(entry.candidate.id);
    if (!expected || expected.state !== stateByName.get(entry.collection) || expected.candidate !== entry.candidate) {
      throw new Error(`candidateOrder contains an unknown or mismatched candidate: ${entry.candidate.id}`);
    }
    if (orderedIds.has(entry.candidate.id)) throw new Error(`candidateOrder repeats candidate: ${entry.candidate.id}`);
    orderedIds.add(entry.candidate.id);
  }
  if (orderedIds.size !== expectedCandidates.size) throw new Error('candidateOrder must contain every eligible candidate exactly once');

  for (const { collection, candidate } of input.candidateOrder) {
    const state = stateByName.get(collection)!;
    state.displayed.push(candidate);
    state.byteBudget--;
    if (!fits(encode(states, input.build, input.encoders), maxBytes)) {
      state.displayed.pop();
      state.byteBudget++;
    }
  }

  let projection = encode(states, input.build, input.encoders);
  // Decimal omission metadata can grow after later candidates are rejected.
  // Remove whole records (never encoded prefixes) until the final semantic
  // projection itself satisfies both independent caps.
  while (!fits(projection, maxBytes)) {
    const state = [...states].reverse().find((candidate) => candidate.displayed.length > 0);
    if (!state) throw new Error(`mandatory structured projection exceeds ${maxBytes} bytes`);
    state.displayed.pop();
    state.byteBudget++;
    projection = encode(states, input.build, input.encoders);
  }
  return projection;
}

/** Cap a UTF-8 string at a code-point boundary and report exact byte omission arithmetic. */
export function capUtf8(value: string, maxBytes: number): { readonly value: string; readonly bytes_omitted: number } {
  assertSafeUint(maxBytes, 'maxBytes');
  const sourceBytes = utf8ByteLength(value);
  if (sourceBytes <= maxBytes) return { value, bytes_omitted: 0 };
  let end = 0;
  let bytes = 0;
  for (const codePoint of value) {
    const next = utf8ByteLength(codePoint);
    if (bytes + next > maxBytes) break;
    bytes += next;
    end += codePoint.length;
  }
  return { value: value.slice(0, end), bytes_omitted: sourceBytes - bytes };
}

/** Exact scalar and collection exhaustion calculation shared by both encoders. */
export function projectionExhaustive<T>(collections: DisplayedCollections<T>, scalarBytesOmittedTotal: number): boolean {
  assertSafeUint(scalarBytesOmittedTotal, 'scalarBytesOmittedTotal');
  return scalarBytesOmittedTotal === 0 && Object.values(collections).every((collection) => collection.omitted === 0);
}
