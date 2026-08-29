import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Collector, type CollectorContext, type DrainCause, type DrainOutcome, type ChunkWriter } from '../collector.js';

interface HeapSnapshotChunk { chunk?: unknown; }

/** Streams Chrome's V8 snapshot artifact; analysis belongs to the heap command readers. */
export class HeapCollector implements Collector<{ chunks: number; bytes: number; garbageCollected: boolean }> {
  readonly kind = 'heap' as const;
  readonly claims = ['heap-snapshot'] as const;
  private ctx?: CollectorContext;
  private writer?: ChunkWriter;
  private accepting = false;
  private chunks = 0;
  private garbageCollected = false;
  private enabled = false;
  private readonly onChunk = (params: unknown): void => {
    if (!this.accepting) return;
    const chunk = (params as HeapSnapshotChunk | undefined)?.chunk;
    if (typeof chunk !== 'string') {
      this.ctx?.noteLoss('invalid_heap_snapshot_chunk');
      return;
    }
    this.writer!.write(chunk);
    this.chunks += 1;
  };

  async start(ctx: CollectorContext): Promise<void> {
    this.ctx = ctx;
    this.writer = ctx.openChunkFile('snapshot.heapsnapshot');
    this.accepting = true;
    ctx.client.on('HeapProfiler.addHeapSnapshotChunk', this.onChunk);
    try {
      await ctx.client.send('HeapProfiler.enable');
      this.enabled = true;
      await ctx.client.send('HeapProfiler.collectGarbage');
      this.garbageCollected = true;
      await ctx.client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    } catch (error) {
      this.accepting = false;
      ctx.client.off('HeapProfiler.addHeapSnapshotChunk', this.onChunk);
      this.writer.discard();
      if (this.enabled) {
        try { await ctx.client.send('HeapProfiler.disable'); } catch {}
      }
      throw error;
    }
  }

  closeAdmission(): void {
    this.accepting = false;
  }

  async drain(cause: DrainCause): Promise<DrainOutcome<{ chunks: number; bytes: number; garbageCollected: boolean }>> {
    this.closeAdmission();
    this.ctx!.client.off('HeapProfiler.addHeapSnapshotChunk', this.onChunk);
    if (!cause.clientUsable) {
      this.writer!.discard();
      this.ctx!.noteLoss('transport_lost');
      return { summary: { chunks: this.chunks, bytes: 0, garbageCollected: this.garbageCollected }, files: [] };
    }
    if (this.enabled) await this.ctx!.client.send('HeapProfiler.disable');
    const bytes = this.writer!.commit();
    return { summary: { chunks: this.chunks, bytes, garbageCollected: this.garbageCollected }, files: [{ name: 'snapshot.heapsnapshot', bytes }] };
  }

  abandon(): void {
    this.accepting = false;
    this.ctx?.client.off('HeapProfiler.addHeapSnapshotChunk', this.onChunk);
    try { this.writer?.discard(); } catch {}
  }
}

export function reconstructHeapSnapshot(dir: string): DrainOutcome<{ bytes: number }> {
  const snapshot = path.join(dir, 'snapshot.heapsnapshot');
  if (!fs.existsSync(snapshot)) return { summary: { bytes: 0 }, files: [] };
  const bytes = fs.statSync(snapshot).size;
  return { summary: { bytes }, files: [{ name: 'snapshot.heapsnapshot', bytes }] };
}
