import { mkdir, rm } from "node:fs/promises";

/** Removes every artifact from a prior dump before a new capture starts. */
export async function prepareDumpDirectory(directory) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}

export function unavailableBody(response) {
  return response.timing.responseReceived.source === "Network.requestWillBeSent.redirectResponse"
    ? { kind: "unavailable", reason: "Chrome exposes redirect response metadata but no independently addressable redirect response body." }
    : null;
}

/** Preserves the raw Network domain timestamps for one browser response. */
export function responseRecord(requestWillBeSent, responseReceived, loadingFinished) {
  const { requestId, response } = responseReceived;
  return {
    requestId,
    url: response.url,
    status: response.status,
    headers: response.headers,
    mimeType: response.mimeType,
    timing: {
      requestWillBeSent: requestWillBeSent ? { timestamp: requestWillBeSent.timestamp, wallTime: requestWillBeSent.wallTime } : null,
      responseReceived: { source: responseReceived.source ?? "Network.responseReceived", timestamp: responseReceived.timestamp, timing: response.timing ?? null },
      loadingFinished: loadingFinished ? { timestamp: loadingFinished.timestamp, encodedDataLength: loadingFinished.encodedDataLength } : null,
    },
  };
}
