import * as net from 'node:net';

let requestId = 0;
export interface HostResponse { reqId: number; ok: boolean; type: string; error?: string; [key: string]: unknown; }

export function sendHostRequest(socketPath: string, request: Record<string, unknown>, timeoutMs = 15_000): Promise<HostResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    let received = 0;
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`collector host request timed out after ${timeoutMs}ms`)); }, timeoutMs);
    socket.once('connect', () => socket.write(JSON.stringify({ ...request, reqId: ++requestId }) + '\n'));
    socket.on('data', chunk => {
      received += chunk.length;
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      clearTimeout(timer);
      socket.end();
      try { resolve(JSON.parse(buffer.slice(0, newline)) as HostResponse); } catch (error) { reject(error); }
    });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
    // A close before a newline-terminated response means the host went away mid-reply; no response can still arrive.
    socket.once('close', () => {
      clearTimeout(timer);
      reject(new Error(`collector host closed the connection before a complete response (${received} bytes received, request "${String(request.type)}")`));
    });
  });
}
