/**
 * The bridge server: holds ONE browser-level CDP connection open for the
 * lifetime of a held session and exposes it to (many, sequential) `capture
 * cdp --browser` invocations over a Unix socket.
 *
 * Why this exists: `Browser.grantPermissions`, `ServiceWorker.enable`, and
 * other browser-scoped CDP state are per-CLIENT and revert the instant the
 * granting websocket disconnects. `capture` normally opens/closes a fresh
 * websocket per command, so that state was gone by the next command. Running
 * this as a long-lived detached process is what keeps ONE websocket (and
 * therefore that state) alive across many separate `capture` invocations.
 */

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { getBrowserClient } from '../targets.js';
import { type CDPClient } from '../client.js';
import { type BridgeRequest, type BridgeResponse } from './protocol.js';

interface EventWaiter {
  resolve: (v: unknown) => void;
}

class EventBroker {
  private queues = new Map<string, unknown[]>();
  private waiters = new Map<string, EventWaiter[]>();
  private listening = new Set<string>();

  constructor(private client: CDPClient) {}

  private ensureListening(eventName: string): void {
    if (this.listening.has(eventName)) return;
    this.listening.add(eventName);
    this.client.on(eventName, (params) => {
      const waiters = this.waiters.get(eventName);
      if (waiters && waiters.length > 0) {
        waiters.shift()!.resolve(params);
        return;
      }
      const q = this.queues.get(eventName) ?? [];
      q.push(params);
      // Cap the buffer so an event nobody ever asks for can't leak memory.
      if (q.length > 50) q.shift();
      this.queues.set(eventName, q);
    });
  }

  wait(eventName: string, timeoutMs: number): Promise<unknown> {
    this.ensureListening(eventName);
    const q = this.queues.get(eventName);
    if (q && q.length > 0) {
      return Promise.resolve(q.shift());
    }
    return new Promise((resolve, reject) => {
      const list = this.waiters.get(eventName) ?? [];
      const entry: EventWaiter = {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
      };
      const timer = setTimeout(() => {
        const current = this.waiters.get(eventName);
        if (current) {
          const idx = current.indexOf(entry);
          if (idx >= 0) current.splice(idx, 1);
        }
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for event "${eventName}"`));
      }, timeoutMs);
      list.push(entry);
      this.waiters.set(eventName, list);
    });
  }
}

export async function runBridgeServer(socketPath: string, port?: number): Promise<void> {
  const { client } = await getBrowserClient(await resolvePort(port));
  const events = new EventBroker(client);

  // Cache flattened Target.attachToTarget sessions so repeated requests
  // against the same target (e.g. ServiceWorker.enable then
  // ServiceWorker.deliverPushMessage) reuse one attach instead of piling up.
  const targetSessions = new Map<string, string>();
  async function attach(targetId: string): Promise<string> {
    const cached = targetSessions.get(targetId);
    if (cached) return cached;
    const result = (await client.send('Target.attachToTarget', { targetId, flatten: true })) as {
      sessionId: string;
    };
    targetSessions.set(targetId, result.sessionId);
    return result.sessionId;
  }

  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // No stale socket to remove.
  }

  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim()) void handleLine(line, socket);
      }
    });
  });

  async function handleLine(line: string, socket: net.Socket): Promise<void> {
    let req: BridgeRequest;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }
    let resp: BridgeResponse;
    try {
      const sessionId = req.targetId ? await attach(req.targetId) : undefined;
      const eventPromise = req.waitEvent ? events.wait(req.waitEvent, req.timeoutMs ?? 10000) : undefined;
      const result = req.method ? await client.send(req.method, req.params ?? {}, 60000, sessionId) : undefined;
      const event = eventPromise ? await eventPromise : undefined;
      resp = { reqId: req.reqId, ok: true, result, event };
    } catch (err) {
      resp = { reqId: req.reqId, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    socket.write(JSON.stringify(resp) + '\n');
  }

  const cleanup = (): void => {
    try {
      server.close();
    } catch {
      // Already closed.
    }
    try {
      client.close();
    } catch {
      // Already closed.
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // Already gone.
    }
  };
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  client.onDisconnect(() => {
    // The browser (or its CDP endpoint) went away — nothing left to bridge.
    cleanup();
    process.exit(0);
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(socketPath, () => resolve());
  });
  // Intentionally does not resolve further work here: the open server and
  // the live websocket keep the event loop (and this detached process) alive
  // until `stopBridge()` sends SIGTERM.
}

async function resolvePort(port?: number): Promise<number> {
  if (port) return port;
  const { detectCdpPort } = await import('../detect.js');
  return detectCdpPort();
}
