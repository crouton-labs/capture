/**
 * Client side of the bridge protocol \u2014 used by `capture cdp --browser` to
 * relay one request to an already-running bridge server over its socket.
 */

import * as net from 'net';
import { type BridgeRequest, type BridgeResponse } from './protocol.js';

let reqCounter = 0;

export function sendBridgeRequest(
  socketPath: string,
  req: Omit<BridgeRequest, 'reqId'>,
): Promise<BridgeResponse> {
  const wireTimeoutMs = (req.timeoutMs ?? 10000) + 5000;
  return new Promise((resolve, reject) => {
    const reqId = ++reqCounter;
    const socket = net.createConnection(socketPath);
    let buffer = '';

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Bridge request timed out after ${wireTimeoutMs}ms (socket: ${socketPath})`));
    }, wireTimeoutMs);

    socket.on('connect', () => {
      socket.write(JSON.stringify({ ...req, reqId } satisfies BridgeRequest) + '\n');
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const idx = buffer.indexOf('\n');
      if (idx < 0) return;
      clearTimeout(timer);
      const line = buffer.slice(0, idx);
      socket.end();
      try {
        resolve(JSON.parse(line) as BridgeResponse);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
