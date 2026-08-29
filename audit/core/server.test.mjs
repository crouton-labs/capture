import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixture } from "./server.mjs";

test("fixture server is opaque static hosting with dynamic first refusal", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "audit-server-"));
  const app = join(root, "app"), sealed = join(root, "sealed");
  await mkdir(app); await mkdir(sealed);
  await writeFile(join(app, "index.html"), "<h1>storefront</h1>");
  await writeFile(join(app, "source.map"), "hidden");
  await writeFile(join(root, "fixture.mjs"), `export default { id: "case-a", publicRoot: ${JSON.stringify(app)}, async handle(req, res) { if (req.url === "/today") { res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "max-age=1", "ETag": "leak", "Last-Modified": "yesterday" }); res.end("served by fixture"); return true; } return false; } };`);
  await writeFile(join(sealed, "manifest.faulty.json"), JSON.stringify({ variant: "faulty" }));
  const server = await startFixture({ caseId: "case-a", variant: "faulty", runId: "test", fixtureDir: root, oracleDir: sealed });
  t.after(async () => { await server.stop(); await rm(root, { recursive: true, force: true }); });
  const staticResponse = await fetch(`${server.url}/index.html`);
  assert.equal(staticResponse.status, 200); assert.equal(staticResponse.headers.get("cache-control"), "no-store"); assert.equal(staticResponse.headers.get("etag"), null); assert.equal(staticResponse.headers.get("last-modified"), null); assert.equal(await staticResponse.text(), "<h1>storefront</h1>");
  const dynamicResponse = await fetch(`${server.url}/today`);
  assert.equal(await dynamicResponse.text(), "served by fixture"); assert.equal(dynamicResponse.headers.get("cache-control"), "no-store"); assert.equal(dynamicResponse.headers.get("etag"), null); assert.equal(dynamicResponse.headers.get("last-modified"), null);
  assert.equal((await fetch(`${server.url}/source.map`)).status, 404);
  assert.equal((await fetch(`${server.url}/..%2Foutside`)).status, 403);
  assert.equal(server.requestLog.some((entry) => entry.url === "/today" && entry.status === 200), true);
});
