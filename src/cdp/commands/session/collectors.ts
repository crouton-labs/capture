import * as path from 'node:path';
import { type ParsedArgs } from '../../types.js';
import { getActiveSession, readSessionState } from '../../../session-context.js';
import { CAPTURE_ROOT } from '../../../session/artifacts.js';
import { scanCollectorHost } from '../../host/handle.js';
import { emitResult, fact, lineList, type FactLine } from '../../../output/render.js';

const HELP = `capture session collectors — what is collecting in the active session right now

input:
  (none)   reads the active session's collector host; pass --session <id> to read a named live session
output: <collectors …> — one row per live collector with its kind, id, artifact directory, held claims, and start time, plus the host's process state; an absent host is a completed no-collector observation; --json mirrors
effects: read-only — reads the session's collector-host handle, never drives the browser`;

function error(parsed: ParsedArgs, code: string, message: string): void {
  emitResult({ tag: 'error', attrs: { command: 'session collectors', code }, summary: fact`${message}` }, { json: parsed.json });
  process.exitCode = 1;
}

export function cmdSessionCollectors(parsed: ParsedArgs): void {
  if (parsed.help) { console.log(HELP); return; }
  const session = parsed.session
    ? (() => {
      try { return readSessionState(path.join(CAPTURE_ROOT, parsed.session!)); }
      catch { return null; }
    })()
    : getActiveSession();
  if (!session) return error(parsed, 'no_session', parsed.session ? `No readable live session named "${parsed.session}".` : 'No active capture session.');

  const scanned = scanCollectorHost(session.dir);
  const rows: FactLine[] = [];
  if (scanned.classification === 'live' && scanned.handle) {
    for (const collector of scanned.handle.collectors) {
      rows.push(fact`${collector.kind} ${collector.id}: ${collector.dir}; claims ${collector.claims.join(', ') || 'none'}; started ${collector.startedAt}`);
    }
  }
  if (rows.length === 0) rows.push(fact`no live collector; host state ${scanned.classification}.`);

  emitResult({
    tag: 'collectors',
    attrs: {
      session: session.sessionId,
      host: scanned.classification,
      collectors: scanned.handle?.collectors.length ?? 0,
    },
    summary: lineList(rows),
    jsonSections: [{
      session: session.sessionId,
      host: scanned.classification,
      collectors: scanned.handle?.collectors ?? [],
      reservations: scanned.handle?.reservations ?? [],
    }],
  }, { json: parsed.json });
}
