import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { CDPClient } from '../client.js';
import { appendNdjsonPrivate, ensurePrivateDir, openPrivateChunkWriter, readPrivateFile, removeArtifactTree, unlinkPrivateFile, writeJsonPrivate, type PidBirth } from '../../session/artifacts.js';
import { processPidBirthProvider, sameBirth } from '../../session/artifacts.js';
import { collectorKind } from './kinds.js';
import { RetainedCollectorStartFailure, type CdpClaim, type ClaimReservation, type Collector, type CollectorContext, type CollectorKind, type Completion, type DispatchNotice, type DrainCause, type DrainOutcome, type TeardownOutcome } from './collector.js';

export interface CollectorRow { id: string; kind: CollectorKind; dir: string; claims: readonly CdpClaim[]; startedAt: string; }
export interface HostSnapshot { collectors: readonly CollectorRow[]; reservations: readonly ClaimReservation[]; }
export interface HostIdentity { pid: number; birth: PidBirth; targetId: string; }

interface LiveCollector { row: CollectorRow; collector: Collector; startedAt: string; losses: Array<{ reason: string; detail?: Record<string, unknown> }>; stopping: boolean; }

export class CollectorHost {
  private readonly live = new Map<string, LiveCollector>();
  private readonly reservations = new Map<string, ClaimReservation>();
  private readonly starting = new Map<string, readonly CdpClaim[]>();
  private harClosing = false;
  private clientUsable = true;

  constructor(
    readonly client: CDPClient,
    readonly sessionDir: string,
    readonly identity: HostIdentity,
    private readonly publish: (snapshot: HostSnapshot) => void,
    private readonly onEmpty: () => void,
  ) {
    client.onDisconnect(() => { void this.transportLost(); });
  }

  snapshot(): HostSnapshot { return { collectors: [...this.live.values()].map(item => item.row), reservations: [...this.reservations.values()] }; }

  private changed(): void { this.publish(this.snapshot()); if (!this.live.size && !this.reservations.size) this.onEmpty(); }

  private releaseDeadReservations(): void {
    for (const [token, reservation] of this.reservations) {
      const observed = processPidBirthProvider.read(reservation.pid);
      if (observed.status === 'absent' || (observed.status === 'found' && !sameBirth(observed.identity, reservation.birth))) this.reservations.delete(token);
    }
  }

  private refuseClaims(claims: readonly CdpClaim[]): void {
    this.releaseDeadReservations();
    for (const claim of claims) {
      const collector = [...this.live.values()].find(value => value.row.claims.includes(claim));
      if (collector) throw new Error(`Claim "${claim}" is held by collector ${collector.row.id}.`);
      const reservation = [...this.reservations.values()].find(value => value.claims.includes(claim));
      if (reservation) throw new Error(`Claim "${claim}" is held by reservation ${reservation.holderLabel}.`);
      const starting = [...this.starting.entries()].find(([, held]) => held.includes(claim));
      if (starting) throw new Error(`Claim "${claim}" is held by collector ${starting[0]}.`);
    }
  }

  reserve(claims: readonly CdpClaim[], holderLabel: string, pid: number, birth: PidBirth): ClaimReservation {
    this.refuseClaims(claims);
    const reservation: ClaimReservation = { token: crypto.randomBytes(18).toString('hex'), claims: [...new Set(claims)], holderLabel, pid, birth, reservedAt: new Date().toISOString() };
    this.reservations.set(reservation.token, reservation);
    this.changed();
    return reservation;
  }

  releaseReservation(token: string): void { this.reservations.delete(token); this.changed(); }

  async start(kind: CollectorKind, rawConfig: unknown): Promise<CollectorRow> {
    const entry = collectorKind(kind);
    const config = entry.parseConfig(rawConfig);
    const collector = entry.create(config);
    this.refuseClaims(collector.claims);
    const id = `${entry.idPrefix}-${crypto.randomBytes(5).toString('hex')}`;
    this.starting.set(id, collector.claims);
    const dir = path.join(this.sessionDir, ...entry.idSegments, id);
    try {
      ensurePrivateDir(dir);
      const startedAt = new Date().toISOString();
      const row: CollectorRow = { id, kind, dir, claims: [...collector.claims], startedAt };
      const live: LiveCollector = { row, collector, startedAt, losses: [], stopping: false };
      const context: CollectorContext = {
        client: this.client,
        dir,
        id,
        targetId: this.identity.targetId,
        config,
        appendRecord: (file, record) => appendNdjsonPrivate(path.join(dir, file), record),
        openChunkFile: file => openPrivateChunkWriter(path.join(dir, file)),
        noteLoss: (reason, detail) => { live.losses.push({ reason, detail }); },
      };
      writeJsonPrivate(path.join(dir, 'collecting.json'), { kind, id, startedAt, hostPid: this.identity.pid, hostBirth: this.identity.birth });
      await collector.start(context);
      this.starting.delete(id);
      this.live.set(id, live);
      this.changed();
      return row;
    } catch (error) {
      this.starting.delete(id);
      if (!(error instanceof RetainedCollectorStartFailure)) removeArtifactTree(dir);
      this.changed();
      throw error;
    }
  }

  private cutoff(items: Iterable<LiveCollector>): LiveCollector[] {
    const selected = [...items].filter(item => !item.stopping);
    for (const item of selected) item.stopping = true;
    for (const item of selected) item.collector.closeAdmission();
    return selected;
  }

  private finalizedFiles(dir: string): Array<{ name: string; bytes: number }> {
    const files: Array<{ name: string; bytes: number }> = [];
    const walk = (relative: string): void => {
      for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
        const name = path.join(relative, entry.name);
        if (entry.isDirectory()) walk(name);
        else if (entry.isFile()) files.push({ name, bytes: readPrivateFile(path.join(dir, name)).length });
      }
    };
    walk('');
    return files;
  }

  private async drainOne(live: LiveCollector, cause: DrainCause): Promise<{ completion: Completion; outcome: DrainOutcome }> {
    const outcome = await live.collector.drain(cause);
    unlinkPrivateFile(path.join(live.row.dir, 'collecting.json'));
    const files = this.finalizedFiles(live.row.dir);
    const loss = live.losses[0];
    const completion: Completion = loss || !cause.clientUsable ? 'partial' : 'complete';
    const summary = outcome.summary && typeof outcome.summary === 'object' && !Array.isArray(outcome.summary) ? outcome.summary as Record<string, unknown> : { value: outcome.summary };
    writeJsonPrivate(path.join(live.row.dir, 'meta.json'), {
      id: live.row.id,
      kind: live.row.kind,
      completion,
      ...(completion === 'partial' ? { reason: loss?.reason ?? 'transport_lost' } : {}),
      startedAt: live.startedAt,
      endedAt: new Date().toISOString(),
      files,
      summary,
      ...summary,
    });
    this.live.delete(live.row.id);
    this.changed();
    return { completion, outcome: { ...outcome, files } };
  }

  async stop(id: string, trigger: DrainCause['trigger'] = 'explicit'): Promise<{ completion: Completion; summary: unknown; files: readonly { name: string; bytes: number }[] }> {
    const live = this.live.get(id);
    if (!live) throw new Error(`No live collector named ${id}.`);
    this.cutoff([live]);
    const drained = await this.drainOne(live, { trigger, clientUsable: this.clientUsable });
    return { completion: drained.completion, summary: drained.outcome.summary, files: drained.outcome.files };
  }

  async teardown(trigger: DrainCause['trigger'] = 'session-stop'): Promise<TeardownOutcome[]> {
    const stopping = this.cutoff(this.live.values());
    const outcomes: TeardownOutcome[] = [];
    for (const live of stopping) {
      try {
        const drained = await this.drainOne(live, { trigger, clientUsable: this.clientUsable });
        outcomes.push({ status: 'drained', id: live.row.id, kind: live.row.kind, completion: drained.completion, dir: live.row.dir });
      } catch (error) {
        outcomes.push({ status: 'terminal', id: live.row.id, kind: live.row.kind, dir: live.row.dir, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return outcomes;
  }

  private motionController(): Collector | undefined {
    return [...this.live.values()].find(live => live.row.kind === 'motion')?.collector;
  }

  async control(message: unknown): Promise<unknown> {
    if (!this.clientUsable) throw new Error('collector host CDP transport is unavailable');
    const controller = this.motionController();
    if (!controller?.control) throw new Error('no collector accepts this host control request');
    return controller.control(message);
  }

  async dispatch(method: string, params: Record<string, unknown> = {}, annotation?: string, waitEvent?: string, timeoutMs?: number): Promise<unknown> {
    if (!this.clientUsable) throw new Error('collector host CDP transport is unavailable');
    const controller = this.motionController();
    if (controller?.control) return controller.control({ type: 'cdp', method, params, annotation, waitEvent, timeoutMs });
    const notice: DispatchNotice = { method, params, annotation, atPerformanceNowMs: performance.now() };
    const callbacks = [...this.live.values()].flatMap(live => {
      try { const callback = live.collector.onDispatch?.(notice); return callback ? [callback] : []; } catch { return []; }
    });
    try {
      const result = await this.client.send(method, params);
      const outcome = { ok: true, atPerformanceNowMs: performance.now() };
      for (const callback of callbacks) callback(outcome);
      return result;
    } catch (error) {
      const outcome = { ok: false, error: error instanceof Error ? error.message : String(error), atPerformanceNowMs: performance.now() };
      for (const callback of callbacks) callback(outcome);
      throw error;
    }
  }

  private async transportLost(): Promise<void> {
    if (!this.clientUsable) return;
    this.clientUsable = false;
    await this.teardown('transport-lost');
  }

  abandon(): void { for (const live of this.live.values()) live.collector.abandon(); }
}
