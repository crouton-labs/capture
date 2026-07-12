/**
 * HAR recording store — the SESSION-INTERNAL lane only.
 *
 * A recording is created when a capture session starts, auto-appended by
 * `withConnection()` while the session is active, read back by
 * `session har`, and deleted when `session stop` bundles it into the
 * session's `har.json`. There is no standalone CLI surface over these ids —
 * HAR is session-owned (`capture session har`).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface HAREntry {
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    postData?: { text: string };
  };
  response: {
    status: number;
    headers: Array<{ name: string; value: string }>;
    content: { text?: string };
  };
  startedDateTime: string;
  /** Chrome DevTools HAR convention — 'websocket' for WebSocket connections. */
  _resourceType?: string;
  /** WebSocket frames (DevTools convention): send/receive + payload. */
  _webSocketMessages?: Array<{
    type: 'send' | 'receive';
    time: number;
    opcode: number;
    data: string;
  }>;
}

export type HarFile = { log: { entries: HAREntry[] } };

export const HAR_DIR = '/tmp/capture-har';

export function harFilePath(id: string): string {
  return path.join(HAR_DIR, `${id}.json`);
}

export function createHarRecording(): { id: string; path: string } {
  const id = Math.random().toString(36).slice(2, 8);
  const harPath = harFilePath(id);
  fs.mkdirSync(HAR_DIR, { recursive: true });
  fs.writeFileSync(harPath, JSON.stringify({ log: { entries: [] } }, null, 2));
  return { id, path: harPath };
}

export function readHarRecording(id: string): HarFile | null {
  try {
    return JSON.parse(fs.readFileSync(harFilePath(id), 'utf-8'));
  } catch {
    return null;
  }
}

export function appendToHarRecording(id: string, entries: HAREntry[]): void {
  const harPath = harFilePath(id);
  let har: HarFile;

  try {
    har = JSON.parse(fs.readFileSync(harPath, 'utf-8'));
  } catch {
    har = { log: { entries: [] } };
  }

  har.log.entries.push(...entries);
  fs.writeFileSync(harPath, JSON.stringify(har, null, 2));
}

export function deleteHarRecording(id: string): void {
  try {
    fs.unlinkSync(harFilePath(id));
  } catch {
    // best-effort — file may already be gone
  }
}
