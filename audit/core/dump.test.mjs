import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDumpDirectory, responseRecord } from "./dump.mjs";

test("prepareDumpDirectory removes stale artifacts before recreating the directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "audit-dump-"));
  const output = join(root, "case-b-dump");
  await prepareDumpDirectory(output);
  await writeFile(join(output, "002-old.css.txt"), "stale");
  await prepareDumpDirectory(output);
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  assert.deepEqual(await readdir(output), []);
  await assert.rejects(access(join(output, "002-old.css.txt")));
});

test("responseRecord preserves raw request, response, and completion timing", () => {
  const record = responseRecord(
    { requestId: "7", timestamp: 101.5, wallTime: 1767225600.25 },
    { requestId: "7", timestamp: 102.75, response: { url: "http://fixture.test/slow.json", status: 200, headers: { "content-type": "application/json" }, mimeType: "application/json", timing: { requestTime: 101.5, receiveHeadersEnd: 1250 } } },
    { requestId: "7", timestamp: 105.25, encodedDataLength: 2048 },
  );
  assert.deepEqual(record, {
    requestId: "7",
    url: "http://fixture.test/slow.json",
    status: 200,
    headers: { "content-type": "application/json" },
    mimeType: "application/json",
    timing: {
      requestWillBeSent: { timestamp: 101.5, wallTime: 1767225600.25 },
      responseReceived: { source: "Network.responseReceived", timestamp: 102.75, timing: { requestTime: 101.5, receiveHeadersEnd: 1250 } },
      loadingFinished: { timestamp: 105.25, encodedDataLength: 2048 },
    },
  });
});

test("responseRecord retains a redirect response identified by requestWillBeSent", () => {
  const record = responseRecord(
    { requestId: "7", timestamp: 101.5, wallTime: 1767225600.25 },
    { requestId: "7", source: "Network.requestWillBeSent.redirectResponse", timestamp: 102.75, response: { url: "http://fixture.test/redirect", status: 302, headers: { location: "/final" }, mimeType: "text/html", timing: { requestTime: 101.5, receiveHeadersEnd: 1250 } } },
    null,
  );
  assert.equal(record.status, 302);
  assert.deepEqual(record.timing.responseReceived, { source: "Network.requestWillBeSent.redirectResponse", timestamp: 102.75, timing: { requestTime: 101.5, receiveHeadersEnd: 1250 } });
  assert.equal(record.timing.loadingFinished, null);
});
