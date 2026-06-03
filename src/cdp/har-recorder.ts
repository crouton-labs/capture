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

// HAREntry imported from ../har-manager.ts

const SKIP_EXTENSIONS =
  /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|eot|css|mp4|webm|mp3)(\?|$)/i;
const SKIP_DOMAINS =
  /(google-analytics|googletagmanager|doubleclick|facebook\.com\/tr|px\.ads|analytics|tracking|beacon|telemetry)/i;
const MAX_BODY_SIZE = 256 * 1024; // 256KB per response body in HAR

function shouldRecordRequest(url: string): boolean {
  if (SKIP_EXTENSIONS.test(url)) return false;
  if (SKIP_DOMAINS.test(url)) return false;
  return true;
}

export class HARRecorder {
  private requests = new Map<string, NetworkRequest>();
  private responses = new Map<string, NetworkResponse>();

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
        }),
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
