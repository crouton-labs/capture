import WebSocket from 'ws';

export class CDPClient {
  private ws: WebSocket;
  private messageId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private pendingTimeouts = new Map<number, NodeJS.Timeout>();
  private eventHandlers = new Map<string, Array<(params: unknown) => void>>();
  private ready: Promise<void>;

  constructor(wsUrl: string, connectTimeout = 5000) {
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`WebSocket connection timeout (${connectTimeout}ms)`));
      }, connectTimeout);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    this.ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.id !== undefined) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          const timer = this.pendingTimeouts.get(msg.id);
          if (timer) {
            clearTimeout(timer);
            this.pendingTimeouts.delete(msg.id);
          }
          if (msg.error) {
            pending.reject(new Error(msg.error.message));
          } else {
            pending.resolve(msg.result);
          }
        }
      } else if (msg.method) {
        const handlers = this.eventHandlers.get(msg.method);
        handlers?.forEach((h) => h(msg.params));
      }
    });
  }

  async waitReady(): Promise<void> {
    await this.ready;
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
    timeout = 60000,
    sessionId?: string,
  ): Promise<unknown> {
    await this.ready;
    const id = ++this.messageId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          this.pendingTimeouts.delete(id);
          reject(new Error(`CDP request timeout (${timeout}ms): ${method}`));
        }
      }, timeout);
      this.pendingTimeouts.set(id, timer);
    });
  }

  on(event: string, handler: (params: unknown) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  /** Fires when the underlying websocket goes away (browser closed, crashed, CDP endpoint dropped). */
  onDisconnect(handler: () => void): void {
    this.ws.on('close', handler);
  }

  close(): void {
    // Clear all pending timeouts to allow process to exit
    for (const timer of this.pendingTimeouts.values()) {
      clearTimeout(timer);
    }
    this.pendingTimeouts.clear();
    this.ws.close();
  }
}
