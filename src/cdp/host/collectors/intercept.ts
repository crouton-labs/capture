import * as path from 'node:path';
import { assertUnderCaptureRoot, readPrivateFile, writePrivateFile } from '../../../session/artifacts.js';
import type { Collector, CollectorContext, DrainCause, DrainOutcome } from '../collector.js';

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const RESOURCE_TYPES = new Set(['Document', 'Stylesheet', 'Image', 'Media', 'Font', 'Script', 'TextTrack', 'XHR', 'Fetch', 'Prefetch', 'EventSource', 'WebSocket', 'Manifest', 'SignedExchange', 'Ping', 'CSPViolationReport', 'Preflight', 'Other']);
const FAIL_REASONS = new Set(['Failed', 'Aborted', 'TimedOut', 'AccessDenied', 'ConnectionClosed', 'ConnectionReset', 'ConnectionRefused', 'ConnectionAborted', 'ConnectionFailed', 'NameNotResolved', 'InternetDisconnected', 'AddressUnreachable', 'BlockedByClient', 'BlockedByResponse']);

type Headers = Record<string, string>;
type Action =
  | { kind: 'fulfill'; status: number; headers: Headers; body: string }
  | { kind: 'fail'; reason: string }
  | { kind: 'modify'; url?: string; method?: string; headers?: Headers; postData?: string }
  | { kind: 'passthrough' };

interface Rule { url: string; methods?: readonly string[]; resourceTypes?: readonly string[]; action: Action; }
export interface MockCollectorConfig { rulesPath: string; rules: readonly Rule[]; source: Buffer; }

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function stringRecord(value: unknown, label: string): Headers {
  const source = record(value, label);
  const out: Headers = {};
  for (const [key, item] of Object.entries(source)) {
    if (!key || typeof item !== 'string') throw new Error(`${label}.${key || '(empty)'} must be a string`);
    out[key] = item;
  }
  return out;
}

function body(value: Record<string, unknown>, label: string): string {
  const plain = value.body;
  const encoded = value.bodyBase64;
  if (plain !== undefined && encoded !== undefined) throw new Error(`${label} accepts body or bodyBase64, not both`);
  if (plain !== undefined) {
    if (typeof plain !== 'string') throw new Error(`${label}.body must be a string`);
    if (Buffer.byteLength(plain) > MAX_BODY_BYTES) throw new Error(`${label}.body exceeds ${MAX_BODY_BYTES} bytes`);
    return Buffer.from(plain).toString('base64');
  }
  if (encoded !== undefined) {
    if (typeof encoded !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error(`${label}.bodyBase64 must be valid base64`);
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length > MAX_BODY_BYTES) throw new Error(`${label}.bodyBase64 exceeds ${MAX_BODY_BYTES} bytes`);
    return encoded;
  }
  return '';
}

function parseAction(value: Record<string, unknown>, index: number): Action {
  const names = ['fulfill', 'fail', 'modify', 'passthrough'].filter(name => value[name] !== undefined);
  if (names.length !== 1) throw new Error(`rules[${index}] must contain exactly one action: fulfill, fail, modify, or passthrough`);
  const action = names[0];
  const config = record(value[action], `rules[${index}].${action}`);
  if (action === 'fulfill') {
    const allowed = new Set(['status', 'headers', 'body', 'bodyBase64']);
    if (Object.keys(config).some(key => !allowed.has(key))) throw new Error(`rules[${index}].fulfill has an unsupported field`);
    const status = config.status ?? 200;
    if (!Number.isInteger(status) || (status as number) < 100 || (status as number) > 599) throw new Error(`rules[${index}].fulfill.status must be an HTTP status from 100 through 599`);
    return { kind: 'fulfill', status: status as number, headers: config.headers === undefined ? {} : stringRecord(config.headers, `rules[${index}].fulfill.headers`), body: body(config, `rules[${index}].fulfill`) };
  }
  if (action === 'fail') {
    if (Object.keys(config).some(key => key !== 'reason')) throw new Error(`rules[${index}].fail has an unsupported field`);
    if (typeof config.reason !== 'string' || !FAIL_REASONS.has(config.reason)) throw new Error(`rules[${index}].fail.reason must be a documented CDP network error reason`);
    return { kind: 'fail', reason: config.reason };
  }
  if (action === 'modify') {
    const allowed = new Set(['url', 'method', 'headers', 'postData']);
    if (Object.keys(config).some(key => !allowed.has(key))) throw new Error(`rules[${index}].modify has an unsupported field`);
    if (config.url !== undefined) validateUrlGlob(config.url, `rules[${index}].modify.url`);
    if (config.method !== undefined && (typeof config.method !== 'string' || !/^[A-Z]+$/.test(config.method))) throw new Error(`rules[${index}].modify.method must be an uppercase HTTP method`);
    if (config.postData !== undefined && typeof config.postData !== 'string') throw new Error(`rules[${index}].modify.postData must be a string`);
    if (config.postData !== undefined && Buffer.byteLength(config.postData as string) > MAX_BODY_BYTES) throw new Error(`rules[${index}].modify.postData exceeds ${MAX_BODY_BYTES} bytes`);
    if (config.url === undefined && config.method === undefined && config.headers === undefined && config.postData === undefined) throw new Error(`rules[${index}].modify needs url, method, headers, or postData`);
    return { kind: 'modify', ...(config.url === undefined ? {} : { url: config.url as string }), ...(config.method === undefined ? {} : { method: config.method as string }), ...(config.headers === undefined ? {} : { headers: stringRecord(config.headers, `rules[${index}].modify.headers`) }), ...(config.postData === undefined ? {} : { postData: Buffer.from(config.postData as string).toString('base64') }) };
  }
  if (Object.keys(config).length !== 0) throw new Error(`rules[${index}].passthrough must be an empty object`);
  return { kind: 'passthrough' };
}

function validateUrlGlob(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty full URL glob`);
  try { new URL(value.replaceAll('*', 'mock')); } catch { throw new Error(`${label} must be a parseable full URL glob`); }
}

function parseSet(value: unknown, label: string, allowed?: ReadonlySet<string>): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || !item)) throw new Error(`${label} must be a non-empty string array`);
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`);
  if (allowed && value.some(item => !allowed.has(item))) throw new Error(`${label} contains an unsupported value`);
  return value as string[];
}

export function parseMockRuleDocument(source: Buffer): readonly Rule[] {
  let parsed: unknown;
  try { parsed = JSON.parse(source.toString('utf8')); } catch { throw new Error('rules must be valid JSON'); }
  const document = record(parsed, 'rule document');
  if (Object.keys(document).some(key => key !== 'rules') || !Array.isArray(document.rules)) throw new Error('rule document must be an object with a rules array');
  return document.rules.map((item, index) => {
    const rule = record(item, `rules[${index}]`);
    const allowed = new Set(['url', 'methods', 'resourceTypes', 'fulfill', 'fail', 'modify', 'passthrough']);
    if (Object.keys(rule).some(key => !allowed.has(key))) throw new Error(`rules[${index}] has an unsupported field`);
    validateUrlGlob(rule.url, `rules[${index}].url`);
    const methods = parseSet(rule.methods, `rules[${index}].methods`);
    if (methods?.some(method => !/^[A-Z]+$/.test(method))) throw new Error(`rules[${index}].methods must contain uppercase HTTP methods`);
    return { url: rule.url, ...(methods ? { methods } : {}), ...(rule.resourceTypes === undefined ? {} : { resourceTypes: parseSet(rule.resourceTypes, `rules[${index}].resourceTypes`, RESOURCE_TYPES)! }), action: parseAction(rule, index) };
  });
}

export function parseMockCollectorConfig(raw: unknown): MockCollectorConfig {
  const config = record(raw, 'intercept config');
  if (Object.keys(config).some(key => key !== 'rulesPath') || typeof config.rulesPath !== 'string') throw new Error('intercept config requires a rulesPath');
  const rulesPath = assertUnderCaptureRoot(config.rulesPath);
  const source = readPrivateFile(rulesPath);
  return { rulesPath, source, rules: parseMockRuleDocument(source) };
}

function matches(pattern: string, url: string): boolean {
  const pieces = pattern.split('*').map(piece => piece.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'));
  return new RegExp(`^${pieces.join('.*')}$`).test(url);
}

function matchRule(rules: readonly Rule[], request: { url: string; method: string; resourceType?: string }): { rule: Rule; index: number } | null {
  for (const [index, rule] of rules.entries()) {
    if (!matches(rule.url, request.url)) continue;
    if (rule.methods && !rule.methods.includes(request.method)) continue;
    if (rule.resourceTypes && (!request.resourceType || !rule.resourceTypes.includes(request.resourceType))) continue;
    return { rule, index };
  }
  return null;
}

function headerEntries(headers: Headers): Array<{ name: string; value: string }> { return Object.entries(headers).map(([name, value]) => ({ name, value })); }

export class InterceptCollector implements Collector<{ rules: number; paused: number; matched: number; releasedUnmatched: number; ruleMatches: number[] }> {
  readonly kind = 'intercept' as const;
  readonly claims = ['fetch-interception'] as const;
  private context?: CollectorContext;
  private config?: MockCollectorConfig;
  private accepting = false;
  private drained?: Promise<DrainOutcome<{ rules: number; paused: number; matched: number; releasedUnmatched: number; ruleMatches: number[] }>>;
  private readonly paused = new Map<string, Promise<void>>();
  private pausedCount = 0;
  private matchedCount = 0;
  private releasedUnmatched = 0;
  private ruleMatches: number[] = [];
  private readonly onPaused = (value: unknown): void => {
    const paused = value as { requestId?: unknown };
    if (typeof paused.requestId !== 'string') return;
    const task = this.handlePaused(value).finally(() => { this.paused.delete(paused.requestId as string); });
    this.paused.set(paused.requestId, task);
  };

  constructor(config: MockCollectorConfig) { this.config = config; }

  async start(context: CollectorContext): Promise<void> {
    const config = this.config;
    if (!config) throw new Error('intercept collector has no rule configuration');
    this.context = context;
    this.ruleMatches = Array.from({ length: config.rules.length }, () => 0);
    writePrivateFile(path.join(context.dir, 'rules.json'), config.source);
    writePrivateFile(path.join(context.dir, 'interceptions.jsonl'), '');
    context.client.on('Fetch.requestPaused', this.onPaused);
    try {
      await context.client.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
      this.accepting = true;
    } catch (error) {
      context.client.off('Fetch.requestPaused', this.onPaused);
      throw error;
    }
  }

  closeAdmission(): void { this.accepting = false; }

  private async continueRequest(requestId: string): Promise<void> { await this.context!.client.send('Fetch.continueRequest', { requestId }); }

  private async handlePaused(value: unknown): Promise<void> {
    const context = this.context;
    const config = this.config;
    const paused = value as { requestId?: unknown; request?: { url?: unknown; method?: unknown }; resourceType?: unknown };
    if (!context || !config || typeof paused.requestId !== 'string' || typeof paused.request?.url !== 'string' || typeof paused.request.method !== 'string') return;
    const request = { url: paused.request.url, method: paused.request.method, resourceType: typeof paused.resourceType === 'string' ? paused.resourceType : undefined };
    this.pausedCount++;
    let index: number | null = null;
    let action = 'continue';
    try {
      if (!this.accepting) {
        this.releasedUnmatched++;
        action = 'teardown-continue';
        await this.continueRequest(paused.requestId);
      } else {
        const matched = matchRule(config.rules, request);
        if (!matched) await this.continueRequest(paused.requestId);
        else if (!this.accepting) {
          this.releasedUnmatched++;
          action = 'teardown-continue';
          await this.continueRequest(paused.requestId);
        } else {
          index = matched.index;
          action = matched.rule.action.kind;
          const ruleAction = matched.rule.action;
          if (ruleAction.kind === 'fulfill') await context.client.send('Fetch.fulfillRequest', { requestId: paused.requestId, responseCode: ruleAction.status, responseHeaders: headerEntries(ruleAction.headers), body: ruleAction.body });
          else if (ruleAction.kind === 'fail') await context.client.send('Fetch.failRequest', { requestId: paused.requestId, errorReason: ruleAction.reason });
          else if (ruleAction.kind === 'modify') await context.client.send('Fetch.continueRequest', { requestId: paused.requestId, ...(ruleAction.url === undefined ? {} : { url: ruleAction.url }), ...(ruleAction.method === undefined ? {} : { method: ruleAction.method }), ...(ruleAction.headers === undefined ? {} : { headers: headerEntries(ruleAction.headers) }), ...(ruleAction.postData === undefined ? {} : { postData: ruleAction.postData }) });
          else await this.continueRequest(paused.requestId);
          this.ruleMatches[index]++;
          this.matchedCount++;
        }
      }
      context.appendRecord('interceptions.jsonl', { at: new Date().toISOString(), url: request.url, method: request.method, resourceType: request.resourceType ?? null, rule: index, action });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.noteLoss('rule_evaluation_error', { error: message });
      try { await this.continueRequest(paused.requestId); } catch (releaseError) { context.noteLoss('rule_release_error', { error: releaseError instanceof Error ? releaseError.message : String(releaseError) }); }
      context.appendRecord('interceptions.jsonl', { at: new Date().toISOString(), url: request.url, method: request.method, resourceType: request.resourceType ?? null, rule: index, action: 'error', error: message });
    }
  }

  async drain(cause: DrainCause): Promise<DrainOutcome<{ rules: number; paused: number; matched: number; releasedUnmatched: number; ruleMatches: number[] }>> {
    return this.drained ??= this.drainOnce(cause);
  }

  private async drainOnce(cause: DrainCause): Promise<DrainOutcome<{ rules: number; paused: number; matched: number; releasedUnmatched: number; ruleMatches: number[] }>> {
    this.closeAdmission();
    const context = this.context;
    if (!context || !this.config) throw new Error('intercept collector was not started');
    if (!cause.clientUsable) context.noteLoss('transport_lost');
    if (cause.clientUsable) {
      // Fetch can still deliver pauses after closeAdmission() and before its
      // disable acknowledgement. Each takes the teardown-continue path; drain
      // both the pre-disable work and anything delivered before Fetch confirms
      // the domain is off, so meta.json cannot outrun its JSONL evidence.
      while (this.paused.size) await Promise.all([...this.paused.values()]);
      await context.client.send('Fetch.disable');
      while (this.paused.size) await Promise.all([...this.paused.values()]);
    }
    context.client.off('Fetch.requestPaused', this.onPaused);
    return { summary: { rules: this.config.rules.length, paused: this.pausedCount, matched: this.matchedCount, releasedUnmatched: this.releasedUnmatched, ruleMatches: this.ruleMatches }, files: [] };
  }

  abandon(): void {
    this.closeAdmission();
    for (const requestId of this.paused.keys()) void this.continueRequest(requestId).catch(() => undefined);
  }
}
