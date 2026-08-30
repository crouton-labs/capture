import { createServer, connect as connectTcp } from "node:net";
import { appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

function isVersionOnlyHttpProbe(bytes, totalBytes) {
  if (bytes.length !== totalBytes) return false;
  const headerEnd = bytes.indexOf("\r\n\r\n");
  if (headerEnd < 0 || headerEnd + 4 !== bytes.length) return false;
  const lines = bytes.subarray(0, headerEnd).toString("latin1").split("\r\n");
  if (lines.shift() !== "GET /json/version HTTP/1.1") return false;
  return !lines.some((line) => /^(?:content-length|transfer-encoding|upgrade):/i.test(line));
}

/**
 * A byte-transparent TCP proxy for a Chrome DevTools endpoint. Chrome derives
 * webSocketDebuggerUrl from the inbound Host header, so forwarding that header
 * unchanged deliberately makes /json responses point clients back at this port.
 */
export async function startCdpProxy({ targetPort, targetHost = "127.0.0.1", port = 0, logPath }) {
  if (!Number.isInteger(targetPort) || targetPort < 1) throw new Error("targetPort must be a TCP port");
  if (!logPath) throw new Error("logPath is required");
  await mkdir(dirname(logPath), { recursive: true });
  let nextConnId = 1;
  const pendingWrites = new Set();
  const clients = new Set();
  // allowHalfOpen keeps the response path alive for a client that half-closes
  // after writing its request; without it Node ends the proxy's writable side on
  // the client's FIN, the socket closes, and the browser's reply is discarded.
  const server = createServer({ allowHalfOpen: true }, (client) => {
    clients.add(client);
    const record = {
      connId: nextConnId++, acceptedAt: new Date().toISOString(), closedAt: null,
      remoteAddr: client.remoteAddress ?? "", remotePort: client.remotePort ?? 0,
      bytesToBrowser: 0, bytesToClient: 0, firstRequestLine: "",
    };
    let firstBytes = Buffer.alloc(0);
    let finalized = false;
    const browser = connectTcp({ host: targetHost, port: targetPort });
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      record.closedAt = new Date().toISOString();
      record.versionOnlyHttpProbe = isVersionOnlyHttpProbe(firstBytes, record.bytesToBrowser);
      const write = appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8").finally(() => pendingWrites.delete(write));
      pendingWrites.add(write);
    };
    client.on("data", (chunk) => {
      record.bytesToBrowser += chunk.length;
      if (!record.firstRequestLine && firstBytes.length < 16_384) {
        firstBytes = Buffer.concat([firstBytes, chunk]).subarray(0, 16_384);
        const ending = firstBytes.indexOf("\r\n");
        if (ending >= 0) record.firstRequestLine = firstBytes.subarray(0, ending).toString("latin1");
      }
    });
    browser.on("data", (chunk) => { record.bytesToClient += chunk.length; });
    const tearDown = (source, peer) => {
      source.destroy();
      peer.destroy();
      finalize();
    };
    client.on("error", () => tearDown(client, browser));
    browser.on("error", () => tearDown(browser, client));
    client.on("close", () => { clients.delete(client); browser.destroy(); finalize(); });
    // Chrome closes its /json HTTP connections after each response, so ending the
    // client rather than destroying it lets the piped response flush instead of
    // being truncated by an RST.
    browser.on("close", () => { client.end(); finalize(); });
    client.pipe(browser);
    browser.pipe(client);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port }, resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("CDP proxy did not bind a TCP port");
  return {
    port: address.port,
    host: "127.0.0.1",
    url: `http://127.0.0.1:${address.port}`,
    async stop() { for (const client of clients) client.destroy(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await Promise.all(pendingWrites); },
  };
}
