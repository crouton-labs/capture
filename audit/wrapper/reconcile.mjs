import { readFile } from 'node:fs/promises';
import { assertTranscriptIntegrity } from './wrapper.mjs';

export const CDP_ACCOUNTING_RULE = 'A CDP connection is accounted when its [acceptedAt, closedAt] interval overlaps a wrapped invocation [startedAt, endedAt] interval with 2 seconds of grace on either side.';
const GRACE_MS = 2_000;

function parseNdjson(text, source) {
  return text.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${source}:${index + 1} is not valid JSON: ${error.message}`);
    }
  });
}

function timestamp(value, field, record) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${field} is not an ISO timestamp for ${record.connId === undefined ? 'an invocation' : `connection ${record.connId}`}`);
  }
  return milliseconds;
}

function overlapsInvocation(connection, invocation) {
  const acceptedAt = timestamp(connection.acceptedAt, 'acceptedAt', connection);
  const closedAt = timestamp(connection.closedAt, 'closedAt', connection);
  const startedAt = timestamp(invocation.startedAt, 'startedAt', invocation) - GRACE_MS;
  const endedAt = timestamp(invocation.endedAt, 'endedAt', invocation) + GRACE_MS;
  return acceptedAt <= endedAt && closedAt >= startedAt;
}

export async function reconcile(transcriptPath, connectionsPath) {
  assertTranscriptIntegrity(transcriptPath);
  const [transcript, connections] = await Promise.all([
    readFile(transcriptPath, 'utf8'),
    readFile(connectionsPath, 'utf8'),
  ]);
  const invocations = parseNdjson(transcript, transcriptPath);
  const entries = parseNdjson(connections, connectionsPath);
  const accounted = [];
  const unaccounted = [];

  for (const connection of entries) {
    if (invocations.some((invocation) => overlapsInvocation(connection, invocation))) {
      accounted.push(connection);
    } else {
      unaccounted.push(connection);
    }
  }

  return { accounted, unaccounted, rule: CDP_ACCOUNTING_RULE };
}

export default reconcile;
