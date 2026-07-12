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
import { getBrowserClient, findTabById } from '../targets.js';
import { type CDPClient } from '../client.js';
import { type BridgeRequest, type BridgeResponse } from './protocol.js';

interface EventWaiter {
  resolve: (value: unknown) => void;
}

export interface EventWait {
  /** Returns the event or throws its timeout. The broker observes timeouts internally until this is called, so a slow triggering method cannot create an unhandled rejection. */
  result(): Promise<unknown>;
  /** Removes and settles this waiter without affecting any other waiter. */
  cancel(): void;
}

type EventWaitOutcome =
  | { kind: 'event'; value: unknown }
  | { kind: 'timeout'; error: Error }
  | { kind: 'cancelled' };

/**
 * Observes future CDP events on one long-lived client. Waiters are scoped by
 * the event envelope's actual flattened session id (including `undefined`
 * for an unscoped event). An event is dropped when no exact-key waiter is
 * armed, and otherwise broadcasts to every waiter already armed for that
 * key. The broker never retains event history.
 */
export class EventBroker {
  private waiters = new Map<string, Map<string | undefined, Set<EventWaiter>>>();
  private listening = new Set<string>();

  constructor(private client: Pick<CDPClient, 'on'>) {}

  private ensureListening(eventName: string): void {
    if (this.listening.has(eventName)) return;
    this.listening.add(eventName);
    this.client.on(eventName, (params, actualSessionId) => {
      const bySession = this.waiters.get(eventName);
      const matching = bySession?.get(actualSessionId);
      if (!matching || matching.size === 0) return;

      // Remove the exact bucket before resolving its snapshot. A waiter armed
      // by a resolution continuation is therefore future-only and cannot
      // observe the event currently being broadcast.
      bySession!.delete(actualSessionId);
      if (bySession!.size === 0) this.waiters.delete(eventName);
      for (const waiter of matching) waiter.resolve(params);
    });
  }

  wait(eventName: string, sessionId: string | undefined, timeoutMs: number): EventWait {
    this.ensureListening(eventName);
    let bySession = this.waiters.get(eventName);
    if (!bySession) {
      bySession = new Map();
      this.waiters.set(eventName, bySession);
    }
    let matching = bySession.get(sessionId);
    if (!matching) {
      matching = new Set();
      bySession.set(sessionId, matching);
    }

    let settleOutcome!: (outcome: EventWaitOutcome) => void;
    const outcome = new Promise<EventWaitOutcome>((resolve) => {
      settleOutcome = resolve;
    });
    let settled = false;
    const removeOnlyThisWaiter = (): void => {
      const currentBySession = this.waiters.get(eventName);
      const current = currentBySession?.get(sessionId);
      if (!current) return;
      current.delete(waiter);
      if (current.size === 0) currentBySession!.delete(sessionId);
      if (currentBySession!.size === 0) this.waiters.delete(eventName);
    };
    const waiter: EventWaiter = {
      resolve: (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        settleOutcome({ kind: 'event', value });
      },
    };
    matching.add(waiter);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      removeOnlyThisWaiter();
      settleOutcome({
        kind: 'timeout',
        error: new Error(
          `Timed out after ${timeoutMs}ms waiting for event "${eventName}"` +
            (sessionId === undefined ? ' without a session' : ` in session "${sessionId}"`),
        ),
      });
    }, timeoutMs);

    return {
      result: async () => {
        const settledOutcome = await outcome;
        if (settledOutcome.kind === 'timeout') throw settledOutcome.error;
        return settledOutcome.kind === 'event' ? settledOutcome.value : undefined;
      },
      cancel: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        removeOnlyThisWaiter();
        settleOutcome({ kind: 'cancelled' });
      },
    };
  }
}

export async function handleBridgeRequest(
  req: BridgeRequest,
  client: Pick<CDPClient, 'send'>,
  events: EventBroker,
  attach: (targetId: string) => Promise<string>,
): Promise<BridgeResponse> {
  let eventWait: EventWait | undefined;
  try {
    const sessionId = req.targetId ? await attach(req.targetId) : undefined;
    eventWait = req.waitEvent
      ? events.wait(req.waitEvent, sessionId, req.timeoutMs ?? 10000)
      : undefined;
    const result = req.method
      ? await client.send(req.method, req.params ?? {}, 60000, sessionId)
      : undefined;
    const event = eventWait ? await eventWait.result() : undefined;
    return { reqId: req.reqId, ok: true, result, event };
  } catch (err) {
    eventWait?.cancel();
    return {
      reqId: req.reqId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runBridgeServer(socketPath: string, port?: number): Promise<void> {
  const resolvedPort = await resolvePort(port);
  const { client } = await getBrowserClient(resolvedPort);
  const events = new EventBroker(client);

  // Cache flattened Target.attachToTarget sessions so repeated requests
  // against the same target (e.g. ServiceWorker.enable then
  // ServiceWorker.deliverPushMessage) reuse one attach instead of piling up.
  const targetSessions = new Map<string, string>();
  async function attach(targetId: string): Promise<string> {
    const cached = targetSessions.get(targetId);
    if (cached) return cached;
    // Accept the same 8-char-prefix targeting every other capture command
    // promises (see the top-level --help TARGETING section) instead of
    // requiring the full 32-char target id here.
    const tab = await findTabById(resolvedPort, targetId);
    if (!tab) {
      throw new Error(`No target found for "${targetId}" on port ${resolvedPort}. Run "capture tab list" to see available tabs.`);
    }
    const result = (await client.send('Target.attachToTarget', { targetId: tab.id, flatten: true })) as {
      sessionId: string;
    };
    targetSessions.set(targetId, result.sessionId);
    return result.sessionId;
  }

  async function handleLine(line: string, socket: net.Socket): Promise<void> {
    let req: BridgeRequest;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }
    const resp = await handleBridgeRequest(req, client, events, attach);
    socket.write(JSON.stringify(resp) + '\n');
  }

  const server = await listenNdjsonSocket(socketPath, handleLine);

  const cleanup = (): void => {
    closeNdjsonSocket(server, socketPath);
    try {
      client.close();
    } catch {
      // Already closed.
    }
  };
  installProcessCleanup(cleanup, client);
  // Intentionally does not resolve further work here: the open server and
  // the live websocket keep the event loop (and this detached process) alive
  // until `stopBridge()` sends SIGTERM.
}

/**
 * Ensures `socketPath`'s parent directory exists and removes any stale
 * socket file left at that path (a previous bridge process that died
 * without cleaning up). Shared preparation step before binding a new
 * `net.Server` there.
 */
export function prepareSocketPath(socketPath: string): void {
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // No stale socket to remove.
  }
}

/**
 * Binds a Unix-domain `net.Server` at `socketPath` that frames each
 * connection's input as newline-delimited JSON, invoking `handleLine` once
 * per complete line. This is the wire framing every bridge mode (plain
 * browser-level bridge, recorder bridge) shares — "one request per
 * connection, one response, then the socket closes" is a convention the
 * caller's `handleLine` implements by writing exactly one response per
 * line and letting the client end the connection; the server itself is
 * agnostic to that convention and would happily frame a connection that
 * sends multiple lines.
 */
export async function listenNdjsonSocket(
  socketPath: string,
  handleLine: (line: string, socket: net.Socket) => void | Promise<void>,
): Promise<net.Server> {
  prepareSocketPath(socketPath);

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

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(socketPath, () => resolve());
  });
  return server;
}

/** Closes the socket server and best-effort unlinks the socket file. */
export function closeNdjsonSocket(server: net.Server, socketPath: string): void {
  try {
    server.close();
  } catch {
    // Already closed.
  }
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // Already gone.
  }
}

/**
 * Wires SIGTERM/SIGINT and the held client's disconnect into one `cleanup`
 * call followed by `process.exit(0)` — the shutdown sequence every
 * detached bridge process (plain or recorder) uses.
 */
export function installProcessCleanup(
  cleanup: () => void,
  client: Pick<CDPClient, 'onDisconnect'>,
): void {
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
}

async function resolvePort(port?: number): Promise<number> {
  if (port) return port;
  const { detectCdpPort } = await import('../detect.js');
  return detectCdpPort();
}
