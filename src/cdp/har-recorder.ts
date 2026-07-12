import { type HAREntry } from '../har-manager.js';
import { type CDPClient } from './client.js';

interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  timestamp: number;
}

interface NetworkResponse {
  requestId: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
  timestamp: number;
}

interface WebSocketConnection {
  requestId: string;
  url: string;
  wallTime?: number;
  monotonicTime?: number;
  requestHeaders: Record<string, string>;
  status?: number;
  responseHeaders: Record<string, string>;
  messages: Array<{ type: 'send' | 'receive'; time: number; opcode: number; data: string }>;
  droppedFrames: number;
}

// HAREntry imported from ../har-manager.ts

const SKIP_EXTENSIONS =
  /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|eot|css|mp4|webm|mp3)(\?|$)/i;
const SKIP_DOMAINS =
  /(google-analytics|googletagmanager|doubleclick|facebook\.com\/tr|px\.ads|analytics|tracking|beacon|telemetry)/i;
const MAX_BODY_SIZE = 256 * 1024; // 256KB per response body in HAR
const MAX_WS_FRAMES = 200; // per socket; further frames are counted, not stored
const MAX_WS_FRAME_SIZE = 4 * 1024; // 4KB per frame payload in HAR

function truncateWebSocketData(data: string): string {
  const size = Buffer.byteLength(data, 'utf8');
  if (size <= MAX_WS_FRAME_SIZE) return data;
  let end = Math.min(data.length, MAX_WS_FRAME_SIZE);
  while (end > 0 && Buffer.byteLength(data.slice(0, end), 'utf8') > MAX_WS_FRAME_SIZE) end--;
  return data.slice(0, end) + `…[truncated: ${size} bytes]`;
}

function shouldRecordRequest(url: string): boolean {
  if (SKIP_EXTENSIONS.test(url)) return false;
  if (SKIP_DOMAINS.test(url)) return false;
  return true;
}

export class HARRecorder {
  private requests = new Map<string, NetworkRequest>();
  private responses = new Map<string, NetworkResponse>();
  private webSockets = new Map<string, WebSocketConnection>();

  constructor(private client: CDPClient) {}

  get responseCount(): number {
    return this.responses.size;
  }

  async start(): Promise<void> {
    await this.client.send('Network.enable');

    this.client.on('Network.requestWillBeSent', (params: unknown) => {
      const p = params as {
        requestId: string;
        request: {
          url: string;
          method: string;
          headers: Record<string, string>;
          postData?: string;
        };
        timestamp: number;
      };
      if (!shouldRecordRequest(p.request.url)) return;
      this.requests.set(p.requestId, {
        requestId: p.requestId,
        url: p.request.url,
        method: p.request.method,
        headers: p.request.headers,
        postData: p.request.postData,
        timestamp: p.timestamp,
      });
    });

    this.client.on('Network.responseReceived', (params: unknown) => {
      const p = params as {
        requestId: string;
        response: {
          url: string;
          status: number;
          headers: Record<string, string>;
        };
        timestamp: number;
      };
      if (!this.requests.has(p.requestId)) return;
      this.responses.set(p.requestId, {
        requestId: p.requestId,
        url: p.response.url,
        status: p.response.status,
        headers: p.response.headers,
        timestamp: p.timestamp,
      });
    });

    // WebSocket lifecycle. Only sockets OPENED while this recorder is
    // attached are visible — CDP does not replay creation events for
    // pre-existing sockets.
    this.client.on('Network.webSocketCreated', (params: unknown) => {
      const p = params as { requestId: string; url: string };
      if (!shouldRecordRequest(p.url)) return;
      this.webSockets.set(p.requestId, {
        requestId: p.requestId,
        url: p.url,
        requestHeaders: {},
        responseHeaders: {},
        messages: [],
        droppedFrames: 0,
      });
    });

    this.client.on('Network.webSocketWillSendHandshakeRequest', (params: unknown) => {
      const p = params as {
        requestId: string;
        timestamp: number;
        wallTime: number;
        request: { headers: Record<string, string> };
      };
      const ws = this.webSockets.get(p.requestId);
      if (!ws) return;
      ws.wallTime = p.wallTime;
      ws.monotonicTime = p.timestamp;
      ws.requestHeaders = p.request.headers;
    });

    this.client.on('Network.webSocketHandshakeResponseReceived', (params: unknown) => {
      const p = params as {
        requestId: string;
        response: { status: number; headers: Record<string, string> };
      };
      const ws = this.webSockets.get(p.requestId);
      if (!ws) return;
      ws.status = p.response.status;
      ws.responseHeaders = p.response.headers;
    });

    const recordFrame = (type: 'send' | 'receive') => (params: unknown) => {
      const p = params as {
        requestId: string;
        timestamp: number;
        response: { opcode: number; payloadData: string };
      };
      const ws = this.webSockets.get(p.requestId);
      if (!ws) return;
      if (ws.messages.length >= MAX_WS_FRAMES) {
        ws.droppedFrames++;
        return;
      }
      const time = ws.wallTime !== undefined && ws.monotonicTime !== undefined
        ? ws.wallTime + (p.timestamp - ws.monotonicTime)
        : p.timestamp;
      ws.messages.push({
        type,
        time,
        opcode: p.response.opcode,
        data: truncateWebSocketData(p.response.payloadData),
      });
    };
    this.client.on('Network.webSocketFrameSent', recordFrame('send'));
    this.client.on('Network.webSocketFrameReceived', recordFrame('receive'));
  }

  private buildWebSocketEntries(): HAREntry[] {
    return Array.from(this.webSockets.values()).map((ws) => {
      const messages = ws.droppedFrames > 0
        ? [...ws.messages, {
            type: 'receive' as const,
            time: 0,
            opcode: 1,
            data: `[${ws.droppedFrames} further frames not recorded — per-socket cap of ${MAX_WS_FRAMES}]`,
          }]
        : ws.messages;
      return {
        startedDateTime: new Date(ws.wallTime ? ws.wallTime * 1000 : Date.now()).toISOString(),
        request: {
          method: 'GET',
          url: ws.url,
          headers: Object.entries(ws.requestHeaders).map(([name, value]) => ({ name, value })),
        },
        response: {
          status: ws.status ?? 0,
          headers: Object.entries(ws.responseHeaders).map(([name, value]) => ({ name, value })),
          content: {},
        },
        _resourceType: 'websocket',
        _webSocketMessages: messages,
      };
    });
  }

  private buildHar(): { log: { entries: HAREntry[] } } {
    return {
      log: {
        entries: Array.from(this.responses.values()).map((resp) => {
          const req = this.requests.get(resp.requestId);
          return {
            startedDateTime: new Date(resp.timestamp * 1000).toISOString(),
            request: {
              method: req?.method ?? 'GET',
              url: resp.url,
              headers: Object.entries(req?.headers ?? {}).map(
                ([name, value]) => ({ name, value }),
              ),
              postData: req?.postData ? { text: req.postData } : undefined,
            },
            response: {
              status: resp.status,
              headers: Object.entries(resp.headers).map(([name, value]) => ({
                name,
                value,
              })),
              content: { text: resp.body },
            },
          };
        }).concat(this.buildWebSocketEntries()),
      },
    };
  }

  async finish(): Promise<{ log: { entries: HAREntry[] } }> {
    // Fetch response bodies in parallel — sequential fetches with 5s timeouts
    // were causing ~50s hangs when many responses had evicted bodies
    await Promise.allSettled(
      Array.from(this.responses.entries()).map(async ([reqId, resp]) => {
        const bodyResult = (await this.client.send('Network.getResponseBody', {
          requestId: reqId,
        }, 5000)) as {
          body: string;
          base64Encoded: boolean;
        };
        const decoded = bodyResult.base64Encoded
          ? Buffer.from(bodyResult.body, 'base64').toString()
          : bodyResult.body;
        resp.body = decoded.length > MAX_BODY_SIZE
          ? decoded.slice(0, MAX_BODY_SIZE) + `\n[truncated: ${decoded.length} bytes]`
          : decoded;
      }),
    );

    return this.buildHar();
  }

  finishPartial(): { log: { entries: HAREntry[] } } {
    return this.buildHar();
  }
}
