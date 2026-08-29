import { sendHostRequest } from './client.js';

const MARKABLE_EXACT_METHODS = new Set(['Input.insertText', 'Page.navigate']);

function isMarkableActionMethod(method: string, params: Record<string, unknown>): boolean {
  if (MARKABLE_EXACT_METHODS.has(method)) return true;
  if (method === 'Input.dispatchMouseEvent') return params.type === 'mousePressed';
  if (method === 'Input.dispatchKeyEvent') return params.type === 'keyDown' || params.type === 'rawKeyDown';
  if (method === 'Input.dispatchTouchEvent') return params.type === 'touchStart';
  return false;
}

export interface MotionHeldClientOptions {
  socketPath: string;
  nonce: string;
  actionLabel: string;
  timeoutMs?: number;
}

/** CDP-shaped client that routes a composed recording's commands through its session collector host. */
export class MotionHeldClient {
  private readonly defaultTimeoutMs: number;
  private suppressNextMousePressMark = false;

  constructor(private readonly options: MotionHeldClientOptions) {
    this.defaultTimeoutMs = options.timeoutMs ?? 60_000;
  }

  suppressNextFocusClickMark(): void { this.suppressNextMousePressMark = true; }

  async send(method: string, params: Record<string, unknown> = {}, timeoutMs?: number, _sessionId?: string): Promise<unknown> {
    return (await this.dispatch(method, params, undefined, timeoutMs)).result;
  }

  async sendMarked(method: string, params: Record<string, unknown>, mark: string): Promise<unknown> {
    return (await this.request(method, params, mark)).result;
  }

  async waitEvent(eventName: string, timeoutMs?: number): Promise<unknown> {
    const response = await sendHostRequest(this.options.socketPath, {
      type: 'cdp', nonce: this.options.nonce, waitEvent: eventName, timeoutMs: timeoutMs ?? this.defaultTimeoutMs,
    }, (timeoutMs ?? this.defaultTimeoutMs) + 5_000);
    if (!response.ok) throw new Error(`collector-host wait-event "${eventName}" failed: ${response.error}`);
    return response.event;
  }

  async dispatch(method: string, params: Record<string, unknown> = {}, waitEvent?: string, timeoutMs?: number): Promise<{ result: unknown; event?: unknown; waitOutcome?: 'observed' | 'bounded-timeout' }> {
    const suppressMousePress = method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed' && this.suppressNextMousePressMark;
    if (suppressMousePress) this.suppressNextMousePressMark = false;
    const annotation = !suppressMousePress && isMarkableActionMethod(method, params) ? this.options.actionLabel : undefined;
    return this.request(method, params, annotation, waitEvent, timeoutMs);
  }

  async flushHar(): Promise<void> {
    const response = await sendHostRequest(this.options.socketPath, { type: 'har-flush', nonce: this.options.nonce });
    if (!response.ok) throw new Error(`collector host HAR flush failed: ${response.error}`);
  }

  async collectStyleSheetHeaders(): Promise<Array<{ styleSheetId: string; sourceURL: string }>> {
    const result = await this.send('Capture.collectStyleSheetHeaders') as { headers?: unknown };
    if (!Array.isArray(result?.headers)) throw new Error('collector host stylesheet-header collection returned an invalid response');
    return result.headers.flatMap(header => {
      const value = header as { styleSheetId?: unknown; sourceURL?: unknown };
      return typeof value.styleSheetId === 'string' && typeof value.sourceURL === 'string' && value.sourceURL.length > 0
        ? [{ styleSheetId: value.styleSheetId, sourceURL: value.sourceURL }]
        : [];
    });
  }

  on(_event: string, _handler: (params: unknown) => void): void {}
  onDisconnect(_handler: () => void): void {}
  close(): void {}

  private async request(method: string, params: Record<string, unknown>, annotation?: string, waitEvent?: string, timeoutMs?: number): Promise<{ result: unknown; event?: unknown; waitOutcome?: 'observed' | 'bounded-timeout' }> {
    const response = await sendHostRequest(this.options.socketPath, {
      type: 'cdp', nonce: this.options.nonce, method, params, annotation, waitEvent, timeoutMs: timeoutMs ?? this.defaultTimeoutMs,
    }, (timeoutMs ?? this.defaultTimeoutMs) + 5_000);
    if (!response.ok) throw new Error(`collector-host CDP call "${method}"${waitEvent ? ` with wait-event "${waitEvent}"` : ''} failed: ${response.error}`);
    return { result: response.result, event: response.event, waitOutcome: response.waitOutcome as 'observed' | 'bounded-timeout' | undefined };
  }
}

export function isMotionHeldClient(client: unknown): client is MotionHeldClient { return client instanceof MotionHeldClient; }
