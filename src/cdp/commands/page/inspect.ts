import { type CDPClient } from '../../client.js';
import { withConnection } from '../../connection.js';
import { type ParsedArgs } from '../../types.js';
import { invalidInput } from '../../../errors.js';
import { resolveLiveTarget, type LiveClient, type ResolutionFailure } from '../../../interact.js';
import { emitResolutionError } from './click.js';
import { emitResult, fact, lineList, type FactLine } from '../../../output/render.js';

const DEFAULT_LIMIT = 100;

const INSPECT_USAGE = `<command name="inspect" description="factual live-tab inventories">
<model>Each leaf reads the current selected tab without a page-observable write. List leaves filter before --limit and mirror only their bounded final records.</model>
<subcommand name="listeners" description="registered event listeners" whenToUse="Use to read listeners on window, document, or one live-resolved target."/>
<subcommand name="cardinality" description="DOM and document counts" whenToUse="Use to read Chrome's current DOM/document cardinality counters."/>
<subcommand name="frames" description="attached and observed-detached frame identities" whenToUse="Use to read the current frame tree and frame lifecycle events observed during a bounded window."/>
<subcommand name="resources" description="Resource Timing entries" whenToUse="Use to read the current page's Performance Resource Timing view."/>
</command>`;

const LISTENERS_USAGE = `capture page inspect listeners [--scope <window|document|target> --selector <target>] [--event <type>] [--limit <n>] — list registered listeners on one live identity

input:
  --scope <kind>       listener owner: window (default), document, or target; target requires --selector
  --selector <target>  target-scope identity using the live page grammar: bare CSS selector (or exact accessible name when CSS finds none), ax:<name>, axid:<id>, backend:<id>
  --event <type>       exact event-type filter; applies before --limit
  --limit <n>          maximum listener records rendered and mirrored (positive integer, default ${DEFAULT_LIMIT}); the summary retains the filtered count
  --target <tabId> | --url <pattern> | --port <n>  tab targeting; defaults to the active session tab
output:
  <listeners identity=… count=… displayed=…> — listener event type, capture/passive/once registration facts, handler description, and script URL/line/column provenance when CDP supplies it
effects:
  read-only CDP collection: enables Debugger to map listener script ids to the script URLs Chrome reports, then reads DOMDebugger listener registrations; no page-observable write`;

const CARDINALITY_USAGE = `capture page inspect cardinality — read bounded current DOM/document counts

input:
  --target <tabId> | --url <pattern> | --port <n>  tab targeting; defaults to the active session tab
output:
  <cardinality documents=… nodes=… listeners=… elements=… frames=…> — Chrome Memory.getDOMCounters values, the current document element count, and the Performance metric frame count with collection-method provenance
effects:
  read-only CDP collection through Memory.getDOMCounters, Runtime.evaluate, and Performance.getMetrics; no page-observable write`;

const FRAMES_USAGE = `capture page inspect frames [--duration <seconds>] — read attached frame identities and lifecycle events observed in a bounded window

input:
  --duration <seconds>  observation window after the current frame-tree read (default 0; maximum 60); frame attach, navigate, and detach events received in this window are recorded
  --limit <n>           maximum attached/detached frame records rendered and mirrored (positive integer, default ${DEFAULT_LIMIT}); the summary retains attached and detached totals
  --target <tabId> | --url <pattern> | --port <n>  tab targeting; defaults to the active session tab
output:
  <frames attached=… detached=… displayed=… requested-ms=… observed-ms=…> — current attached frame ids, parent ids, and URLs plus identities and URL facts for frames observed detaching during this command's collection window; attached/detached records are bounded by --limit
effects:
  read-only CDP collection: enables Page, reads Page.getFrameTree, and observes Page frame lifecycle events for the bounded window; no page-observable write`;

const RESOURCES_USAGE = `capture page inspect resources [--name <text>] [--limit <n>] — list the current page Resource Timing entries

input:
  --name <text>        case-insensitive substring filter over entry name URLs; applies before --limit
  --limit <n>          maximum entries rendered and mirrored (positive integer, default ${DEFAULT_LIMIT}); the summary retains the filtered count
  --target <tabId> | --url <pattern> | --port <n>  tab targeting; defaults to the active session tab
output:
  <resources count=… displayed=…> — Resource Timing name, initiator type, timing offsets/duration, transfer/body sizes, protocol, and collection provenance
effects:
  read-only Runtime evaluation of performance.getEntriesByType('resource'); no page-observable write`;

interface ScriptParsed { scriptId?: unknown; url?: unknown; }
interface ListenerRaw {
  type?: unknown;
  useCapture?: unknown;
  passive?: unknown;
  once?: unknown;
  scriptId?: unknown;
  lineNumber?: unknown;
  columnNumber?: unknown;
  handler?: { description?: unknown; className?: unknown };
}
interface ListenerRecord {
  readonly event: string;
  readonly capture: boolean;
  readonly passive: boolean;
  readonly once: boolean;
  readonly handler?: string;
  readonly scriptId?: string;
  readonly scriptUrl?: string;
  readonly line?: number;
  readonly column?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function countLimit(parsed: ParsedArgs): number {
  const limit = parsed.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1) throw invalidInput(`received: --limit ${String(parsed.limit)}; expected: a positive safe integer.`, 'invalid_flag');
  return limit;
}

async function listenerObjectId(client: LiveClient, parsed: ParsedArgs): Promise<{ identity: string; objectId: string } | { failure: ResolutionFailure }> {
  const scope = parsed.scope ?? 'window';
  if (scope === 'target') {
    const resolved = await resolveLiveTarget(client, parsed.selector!);
    if (!resolved.ok) return { failure: resolved };
    const response = asRecord(await client.send('DOM.resolveNode', { backendNodeId: resolved.backendNodeId }));
    const object = asRecord(response.object);
    const objectId = typeof object.objectId === 'string' ? object.objectId : undefined;
    if (!objectId) throw new Error('DOM.resolveNode returned no object id for the live listener target.');
    return { identity: `backend:${resolved.backendNodeId}`, objectId };
  }
  const expression = scope === 'window' ? 'window' : 'document';
  const response = asRecord(await client.send('Runtime.evaluate', { expression, returnByValue: false }));
  const result = asRecord(response.result);
  const objectId = typeof result.objectId === 'string' ? result.objectId : undefined;
  if (!objectId) throw new Error(`Runtime.evaluate returned no object id for ${scope}.`);
  return { identity: scope, objectId };
}

async function cmdListeners(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) return void console.log(LISTENERS_USAGE);
  const limit = countLimit(parsed);
  const outcome = await withConnection(parsed, async (client) => {
    const scriptUrls = new Map<string, string>();
    const parsedHandler = (params: unknown) => {
      const event = params as ScriptParsed;
      if (typeof event.scriptId === 'string' && typeof event.url === 'string') scriptUrls.set(event.scriptId, event.url);
    };
    client.on('Debugger.scriptParsed', parsedHandler);
    try {
      await client.send('Debugger.enable');
      const target = await listenerObjectId(client as unknown as LiveClient, parsed);
      if ('failure' in target) return target;
      try {
        const response = asRecord(await client.send('DOMDebugger.getEventListeners', { objectId: target.objectId, depth: 1, pierce: true }));
        const listeners = Array.isArray(response.listeners) ? response.listeners as ListenerRaw[] : [];
        const records = listeners.flatMap((listener): ListenerRecord[] => {
          if (typeof listener.type !== 'string') return [];
          if (parsed.event !== undefined && listener.type !== parsed.event) return [];
          const scriptId = typeof listener.scriptId === 'string' ? listener.scriptId : undefined;
          return [{
            event: listener.type,
            capture: listener.useCapture === true,
            passive: listener.passive === true,
            once: listener.once === true,
            handler: typeof listener.handler?.description === 'string' ? listener.handler.description : typeof listener.handler?.className === 'string' ? listener.handler.className : undefined,
            scriptId,
            scriptUrl: scriptId === undefined ? undefined : scriptUrls.get(scriptId),
            line: typeof listener.lineNumber === 'number' ? listener.lineNumber : undefined,
            column: typeof listener.columnNumber === 'number' ? listener.columnNumber : undefined,
          }];
        });
        return { identity: target.identity, records };
      } finally {
        await client.send('Runtime.releaseObject', { objectId: target.objectId });
      }
    } finally {
      client.off('Debugger.scriptParsed', parsedHandler);
    }
  }, { settle: 0 });

  if ('failure' in outcome) return emitResolutionError(parsed, 'page inspect listeners', outcome.failure);
  const shown = outcome.records.slice(0, limit);
  const rows: FactLine[] = shown.map(record => fact`${record.event} capture=${String(record.capture)} passive=${String(record.passive)} once=${String(record.once)}${record.handler === undefined ? '' : ` handler=${record.handler}`}${record.scriptUrl === undefined ? record.scriptId === undefined ? '' : ` script-id=${record.scriptId}` : ` script=${record.scriptUrl}:${record.line ?? 0}:${record.column ?? 0}`}`);
  const sections: FactLine[] = rows.length === 0 ? [] : [lineList(rows)];
  if (shown.length < outcome.records.length) sections.push(fact`listeners-truncated: listing capped at ${shown.length} of ${outcome.records.length} filtered listeners (--limit).`);
  emitResult({
    tag: 'listeners',
    attrs: { identity: outcome.identity, count: outcome.records.length, displayed: shown.length, event: parsed.event },
    summary: fact`${outcome.records.length} registered listener(s) collected from ${outcome.identity}; Debugger.scriptParsed maps script ids to URLs when Chrome supplied those events.`,
    sections,
    jsonSections: { listeners: shown },
  }, { json: parsed.json });
}

async function cmdCardinality(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) return void console.log(CARDINALITY_USAGE);
  const result = await withConnection(parsed, async (client) => {
    const counters = asRecord(await client.send('Memory.getDOMCounters'));
    const document = asRecord(await client.send('Runtime.evaluate', { expression: 'document.querySelectorAll("*").length', returnByValue: true }));
    await client.send('Performance.enable');
    const metricResult = asRecord(await client.send('Performance.getMetrics'));
    const metricItems = Array.isArray(metricResult.metrics) ? metricResult.metrics.map(asRecord) : [];
    const metric = (name: string): number | undefined => {
      const found = metricItems.find(item => item.name === name);
      return typeof found?.value === 'number' ? found.value : undefined;
    };
    return {
      documents: typeof counters.documents === 'number' ? counters.documents : undefined,
      nodes: typeof counters.nodes === 'number' ? counters.nodes : undefined,
      listeners: typeof counters.jsEventListeners === 'number' ? counters.jsEventListeners : undefined,
      elements: typeof asRecord(document.result).value === 'number' ? asRecord(document.result).value as number : undefined,
      frames: metric('Frames'),
    };
  }, { settle: 0 });
  emitResult({
    tag: 'cardinality',
    attrs: result,
    summary: fact`Counts collected now: documents/nodes/listeners from Memory.getDOMCounters; elements from document.querySelectorAll("*").length; frames from Performance.getMetrics.`,
    jsonSections: { collection: { documents: 'Memory.getDOMCounters', nodes: 'Memory.getDOMCounters', listeners: 'Memory.getDOMCounters', elements: 'Runtime.evaluate document.querySelectorAll("*").length', frames: 'Performance.getMetrics Frames' } },
  }, { json: parsed.json });
}

interface FrameRecord { id: string; parentId?: string; url?: string; }
interface DetachedFrameRecord extends FrameRecord { reason?: string; }
function flattenFrameTree(frameTree: unknown, out: FrameRecord[]): void {
  const tree = asRecord(frameTree);
  const frame = asRecord(tree.frame);
  if (typeof frame.id === 'string') out.push({ id: frame.id, parentId: typeof frame.parentId === 'string' ? frame.parentId : undefined, url: typeof frame.url === 'string' ? frame.url : undefined });
  if (Array.isArray(tree.childFrames)) for (const child of tree.childFrames) flattenFrameTree(child, out);
}
function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

async function cmdFrames(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) return void console.log(FRAMES_USAGE);
  const requestedMs = parsed.duration ?? 0;
  const limit = countLimit(parsed);
  const result = await withConnection(parsed, async (client) => {
    const known = new Map<string, FrameRecord>();
    const detached: DetachedFrameRecord[] = [];
    const attachedHandler = (params: unknown) => {
      const event = asRecord(params);
      if (typeof event.frameId === 'string') known.set(event.frameId, { id: event.frameId, parentId: typeof event.parentFrameId === 'string' ? event.parentFrameId : undefined });
    };
    const navigatedHandler = (params: unknown) => {
      const frame = asRecord(asRecord(params).frame);
      if (typeof frame.id === 'string') known.set(frame.id, { id: frame.id, parentId: typeof frame.parentId === 'string' ? frame.parentId : undefined, url: typeof frame.url === 'string' ? frame.url : undefined });
    };
    const detachedHandler = (params: unknown) => {
      const event = asRecord(params);
      if (typeof event.frameId !== 'string') return;
      const prior = known.get(event.frameId) ?? { id: event.frameId };
      detached.push({ ...prior, reason: typeof event.reason === 'string' ? event.reason : undefined });
      known.delete(event.frameId);
    };
    client.on('Page.frameAttached', attachedHandler);
    client.on('Page.frameNavigated', navigatedHandler);
    client.on('Page.frameDetached', detachedHandler);
    try {
      await client.send('Page.enable');
      const tree = asRecord(await client.send('Page.getFrameTree'));
      const attached: FrameRecord[] = [];
      flattenFrameTree(tree.frameTree, attached);
      for (const frame of attached) known.set(frame.id, frame);
      const observationStarted = performance.now();
      if (requestedMs > 0) await sleep(requestedMs);
      const current: FrameRecord[] = [];
      flattenFrameTree(asRecord(await client.send('Page.getFrameTree')).frameTree, current);
      const observedMs = performance.now() - observationStarted;
      return { attached: current, detached, observedMs };
    } finally {
      client.off('Page.frameAttached', attachedHandler);
      client.off('Page.frameNavigated', navigatedHandler);
      client.off('Page.frameDetached', detachedHandler);
    }
  }, { settle: 0 });
  const records = [
    ...result.attached.map(frame => ({ state: 'attached' as const, ...frame })),
    ...result.detached.map(frame => ({ state: 'detached' as const, ...frame })),
  ];
  const shown = records.slice(0, limit);
  const rows = shown.map(frame => frame.state === 'attached'
    ? fact`attached frame:${frame.id}${frame.parentId === undefined ? '' : ` parent:${frame.parentId}`}${frame.url === undefined ? '' : ` url=${frame.url}`}`
    : fact`detached frame:${frame.id}${frame.parentId === undefined ? '' : ` parent:${frame.parentId}`}${frame.url === undefined ? '' : ` url=${frame.url}`}${frame.reason === undefined ? '' : ` reason=${frame.reason}`}`);
  const sections: FactLine[] = rows.length ? [lineList(rows)] : [];
  if (shown.length < records.length) sections.push(fact`frames-truncated: listing capped at ${shown.length} of ${records.length} attached/detached frame records (--limit).`);
  emitResult({
    tag: 'frames',
    attrs: { attached: result.attached.length, detached: result.detached.length, displayed: shown.length, 'requested-ms': requestedMs, 'observed-ms': result.observedMs },
    summary: fact`${result.attached.length} frame(s) are attached in the final Page.getFrameTree; ${result.detached.length} detach event(s) were recorded after Page.enable during a requested ${requestedMs}ms window measured as ${result.observedMs.toFixed(1)}ms.`,
    sections,
    jsonSections: { frames: shown, collection: { requestedMs, observedMs: result.observedMs } },
  }, { json: parsed.json });
}

interface ResourceRecord {
  readonly name: string;
  readonly initiatorType?: string;
  readonly startTime?: number;
  readonly duration?: number;
  readonly responseEnd?: number;
  readonly transferSize?: number;
  readonly encodedBodySize?: number;
  readonly decodedBodySize?: number;
  readonly nextHopProtocol?: string;
  readonly renderBlockingStatus?: string;
}

async function cmdResources(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) return void console.log(RESOURCES_USAGE);
  const limit = countLimit(parsed);
  const records = await withConnection(parsed, async (client) => {
    const response = asRecord(await client.send('Runtime.evaluate', {
      expression: 'performance.getEntriesByType("resource").map(({name,initiatorType,startTime,duration,responseEnd,transferSize,encodedBodySize,decodedBodySize,nextHopProtocol,renderBlockingStatus})=>({name,initiatorType,startTime,duration,responseEnd,transferSize,encodedBodySize,decodedBodySize,nextHopProtocol,renderBlockingStatus}))',
      returnByValue: true,
    }));
    const value = asRecord(response.result).value;
    if (!Array.isArray(value)) throw new Error('performance.getEntriesByType("resource") did not return an array.');
    return value.flatMap((entry): ResourceRecord[] => {
      const record = asRecord(entry);
      if (typeof record.name !== 'string') return [];
      return [{
        name: record.name,
        initiatorType: typeof record.initiatorType === 'string' ? record.initiatorType : undefined,
        startTime: typeof record.startTime === 'number' ? record.startTime : undefined,
        duration: typeof record.duration === 'number' ? record.duration : undefined,
        responseEnd: typeof record.responseEnd === 'number' ? record.responseEnd : undefined,
        transferSize: typeof record.transferSize === 'number' ? record.transferSize : undefined,
        encodedBodySize: typeof record.encodedBodySize === 'number' ? record.encodedBodySize : undefined,
        decodedBodySize: typeof record.decodedBodySize === 'number' ? record.decodedBodySize : undefined,
        nextHopProtocol: typeof record.nextHopProtocol === 'string' ? record.nextHopProtocol : undefined,
        renderBlockingStatus: typeof record.renderBlockingStatus === 'string' ? record.renderBlockingStatus : undefined,
      }];
    });
  }, { settle: 0 });
  const filtered = parsed.name === undefined ? records : records.filter(record => record.name.toLowerCase().includes(parsed.name!.toLowerCase()));
  const shown = filtered.slice(0, limit);
  const sections: FactLine[] = shown.length === 0 ? [] : [lineList(shown.map(record => fact`${record.name} initiator=${record.initiatorType ?? '(unknown)'} start=${record.startTime ?? '(unknown)'}ms duration=${record.duration ?? '(unknown)'}ms response-end=${record.responseEnd ?? '(unknown)'}ms transfer=${record.transferSize ?? '(unknown)'}B encoded=${record.encodedBodySize ?? '(unknown)'}B decoded=${record.decodedBodySize ?? '(unknown)'}B protocol=${record.nextHopProtocol ?? '(unknown)'} render-blocking=${record.renderBlockingStatus ?? '(unknown)'}`))];
  if (shown.length < filtered.length) sections.push(fact`resources-truncated: listing capped at ${shown.length} of ${filtered.length} filtered entries (--limit).`);
  emitResult({
    tag: 'resources',
    attrs: { count: filtered.length, displayed: shown.length, 'name-filter': parsed.name },
    summary: fact`${filtered.length} current Performance Resource Timing entr${filtered.length === 1 ? 'y' : 'ies'} collected at command time.`,
    sections,
    jsonSections: { entries: shown, collection: 'performance.getEntriesByType("resource")' },
  }, { json: parsed.json });
}

export async function inspectMain(parsed: ParsedArgs, _args: string[]): Promise<void> {
  const leaf = parsed.positional[0];
  const rest = { ...parsed, positional: parsed.positional.slice(1) };
  switch (leaf) {
    case 'listeners': return cmdListeners(rest);
    case 'cardinality': return cmdCardinality(rest);
    case 'frames': return cmdFrames(rest);
    case 'resources': return cmdResources(rest);
    case undefined:
      console.log(INSPECT_USAGE);
      return;
    default:
      throw invalidInput(`Unknown page inspect leaf: ${leaf}.`, 'unknown_command');
  }
}
