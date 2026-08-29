import { performance } from 'node:perf_hooks';
import type { CDPClient } from '../../client.js';
import type { Collector, CollectorContext, DrainCause, DrainOutcome } from '../collector.js';

const TRACE_CATEGORIES = 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,loading,blink.user_timing';

interface TraceEventParams { value?: unknown; }

function eventArray(params: unknown): readonly object[] {
  const value = (params as TraceEventParams | null)?.value;
  return Array.isArray(value) ? value.filter((event): event is object => event !== null && typeof event === 'object') : [];
}

function navigationCount(events: readonly object[]): number {
  return events.filter((event) => (event as { name?: unknown }).name === 'navigationStart').length;
}

/** Streams Chrome's Trace event batches into one DevTools-openable trace.json. */
export class TraceCollector implements Collector<{ events: number; windowMs: number; navigations: number; categories: string }> {
  readonly kind = 'trace' as const;
  readonly claims = ['tracing'] as const;
  private context: CollectorContext | undefined;
  private writer: ReturnType<CollectorContext['openChunkFile']> | undefined;
  private eventHandler: ((params: unknown) => void) | undefined;
  private completeHandler: ((params: unknown) => void) | undefined;
  private complete: Promise<void> | undefined;
  private resolveComplete: (() => void) | undefined;
  private startedAt = 0;
  private events = 0;
  private navigations = 0;
  private first = true;
  private closed = false;
  private started = false;
  private drainPromise: Promise<DrainOutcome<{ events: number; windowMs: number; navigations: number; categories: string }>> | undefined;

  async start(ctx: CollectorContext): Promise<void> {
    this.context = ctx;
    this.writer = ctx.openChunkFile('trace.json');
    this.writer.write('{"traceEvents":[');
    this.eventHandler = (params) => {
      if (this.closed) return;
      const events = eventArray(params);
      for (const event of events) {
        this.writer!.write(`${this.first ? '' : ','}${JSON.stringify(event)}`);
        this.first = false;
      }
      this.events += events.length;
      this.navigations += navigationCount(events);
    };
    this.complete = new Promise(resolve => { this.resolveComplete = resolve; });
    this.completeHandler = () => this.resolveComplete?.();
    ctx.client.on('Tracing.dataCollected', this.eventHandler);
    ctx.client.on('Tracing.tracingComplete', this.completeHandler);
    try {
      await ctx.client.send('Tracing.start', { transferMode: 'ReportEvents', categories: TRACE_CATEGORIES });
      this.startedAt = performance.now();
      this.started = true;
    } catch (error) {
      ctx.client.off('Tracing.dataCollected', this.eventHandler);
      ctx.client.off('Tracing.tracingComplete', this.completeHandler);
      this.writer.discard();
      throw error;
    }
  }

  closeAdmission(): void {
    // A trace has no routed-work admission surface. Tracing.dataCollected must
    // remain subscribed until tracingComplete drains Chrome's final batches.
  }

  async drain(cause: DrainCause): Promise<DrainOutcome<{ events: number; windowMs: number; navigations: number; categories: string }>> {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.finish(cause);
    return this.drainPromise;
  }

  private async finish(cause: DrainCause): Promise<DrainOutcome<{ events: number; windowMs: number; navigations: number; categories: string }>> {
    const ctx = this.context!;
    if (this.started && cause.clientUsable) {
      try {
        await ctx.client.send('Tracing.end');
        await Promise.race([
          this.complete!,
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for Tracing.tracingComplete.')), 30_000)),
        ]);
      } catch (error) {
        ctx.noteLoss('trace_drain_incomplete', { error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!cause.clientUsable) ctx.noteLoss('transport_lost');
    this.closed = true;
    ctx.client.off('Tracing.dataCollected', this.eventHandler!);
    ctx.client.off('Tracing.tracingComplete', this.completeHandler!);
    this.writer!.write(']}');
    const bytes = this.writer!.commit();
    return {
      summary: { events: this.events, windowMs: this.startedAt ? performance.now() - this.startedAt : 0, navigations: this.navigations, categories: 'devtools-default' },
      files: [{ name: 'trace.json', bytes }],
    };
  }

  abandon(): void {
    this.closed = true;
    try { this.writer?.discard(); } catch {}
  }
}

export { TRACE_CATEGORIES };
