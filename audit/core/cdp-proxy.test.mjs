import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startCdpProxy } from "./cdp-proxy.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Target did not bind a TCP port");
  return address.port;
}

function request(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("error", reject);
    socket.once("connect", () => socket.end(payload));
    socket.resume();
    socket.once("close", resolve);
  });
}

test("proxy records only a complete standalone version request as a version-only probe", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capture-cdp-proxy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = createServer((socket) => socket.on("data", () => socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}")));
  t.after(() => new Promise((resolve, reject) => target.close((error) => error ? reject(error) : resolve())));
  const targetPort = await listen(target);
  const proxy = await startCdpProxy({ targetPort, logPath: join(directory, "connections.ndjson") });
  let stopped = false;
  t.after(async () => { if (!stopped) await proxy.stop(); });

  await request(proxy.port, "GET /json/version HTTP/1.1\r\nHost: localhost\r\n\r\n");
  await request(proxy.port, "GET /json/version HTTP/1.1\r\nHost: localhost\r\n\r\nGET /json/list HTTP/1.1\r\nHost: localhost\r\n\r\n");
  await proxy.stop();
  stopped = true;

  const records = (await readFile(join(directory, "connections.ndjson"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(records.find((record) => record.connId === 1)?.versionOnlyHttpProbe, true);
  assert.equal(records.find((record) => record.connId === 2)?.versionOnlyHttpProbe, false);
});
