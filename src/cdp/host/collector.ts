import type { CDPClient } from '../client.js';
import type { PidBirth } from '../../session/artifacts.js';

export type CdpClaim = 'tracing' | 'fetch-interception' | 'heap-sampling' | 'heap-snapshot' | 'screencast';
export type CollectorKind = 'motion' | 'trace' | 'heap' | 'intercept';
export type Completion = 'complete' | 'partial' | 'orphaned';
export type ResolvedCompletion = Completion | 'truncated';

export interface ChunkWriter {
  write(chunk: Buffer | string): void;
  commit(): number;
  discard(): void;
}

export interface CollectorContext {
  readonly client: CDPClient;
  readonly dir: string;
  readonly id: string;
  readonly targetId: string;
  readonly config: unknown;
  appendRecord(file: string, record: unknown): void;
  openChunkFile(file: string): ChunkWriter;
  noteLoss(reason: string, detail?: Record<string, unknown>): void;
}

export interface DispatchNotice { method: string; params: Record<string, unknown>; annotation?: string; atPerformanceNowMs: number; }
export interface DispatchOutcome { ok: boolean; error?: string; atPerformanceNowMs: number; }
export interface DrainCause { trigger: 'explicit' | 'session-stop' | 'transport-lost'; clientUsable: boolean; }
export interface DrainOutcome<Summary = unknown> { summary: Summary; files: readonly { name: string; bytes: number }[]; }

/** A start failure that leaves a collector artifact tree as the recovery record. */
export class RetainedCollectorStartFailure extends Error {
  constructor(message: string, readonly startError: unknown, readonly cleanupError: unknown) {
    super(message);
    this.name = 'RetainedCollectorStartFailure';
  }
}

export interface Collector<Summary = unknown> {
  readonly kind: CollectorKind;
  readonly claims: readonly CdpClaim[];
  start(ctx: CollectorContext): Promise<void>;
  closeAdmission(): void;
  drain(cause: DrainCause): Promise<DrainOutcome<Summary>>;
  onDispatch?(notice: DispatchNotice): ((outcome: DispatchOutcome) => void) | void;
  control?(message: unknown): Promise<unknown>;
  abandon(): void;
}

export interface ClaimReservation {
  token: string;
  claims: readonly CdpClaim[];
  /** Blocks every collector admission on this host while a destructive tab operation runs. */
  exclusive?: boolean;
  holderLabel: string;
  pid: number;
  birth: PidBirth;
  reservedAt: string;
}

export type TeardownOutcome =
  | { status: 'drained'; id: string; kind: CollectorKind; completion: Completion; dir: string }
  | { status: 'reaped'; id: string; kind: CollectorKind; dir: string }
  | { status: 'terminal'; id: string; kind: CollectorKind; dir: string; error: string };

export interface CollectorKindEntry {
  readonly kind: CollectorKind;
  readonly idSegments: readonly string[];
  readonly idPrefix: string;
  readonly label: string;
  parseConfig(raw: unknown): unknown;
  create(config: unknown): Collector;
  reconstruct(dir: string): DrainOutcome;
}
