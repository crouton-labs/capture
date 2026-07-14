/**
 * Unit checks for the import-driven exec trigger (`hasImports`).
 *
 * Run: `pnpm test` (node --test via tsx). Lives outside the `files` allowlist
 * so it is never shipped. `hasImports` calls only `splitLeadingImports` — pure
 * string work, no vault/ source or esbuild needed — so this runs anywhere.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { hasImports, bundleExec, applyReturnInsert } from "../src/vault/bundle.js";

test("leading static import is detected", () => {
  assert.equal(
    hasImports("import {listInbox} from 'libs/gmail'; return typeof listInbox"),
    true,
  );
});

test("namespace and default static imports are detected", () => {
  assert.equal(hasImports("import * as g from 'libs/gmail'; return g"), true);
  assert.equal(hasImports("import gmail from 'libs/gmail'; return gmail"), true);
});

test("awaited dynamic import in the body is NOT a static import", () => {
  // Regression: must run via the normal await-path, not be misclassified.
  assert.equal(hasImports("const m = await import('libs/gmail')"), false);
});

test("a leading dynamic import() CALL is NOT a static import", () => {
  // Regression: `import(...)` is an expression, not a static import statement;
  // misclassifying it hoisted the call and silently returned undefined.
  assert.equal(hasImports("import('libs/gmail').then(m => m.listInbox())"), false);
  assert.equal(hasImports("import ('libs/gmail')"), false);
});

test("plain code has no imports", () => {
  assert.equal(hasImports("document.title"), false);
  assert.equal(hasImports("return 1 + 1"), false);
});

// ---------------------------------------------------------------------------
// Real bundle + evaluate (M20): the string bundleExec returns is a complete
// IIFE whose completion value is the sentinel promise — exactly what CDP's
// Runtime.evaluate({awaitPromise:true}) awaits. Evaluating it under Node with
// `eval` mirrors that: the bundle inlines the forked `libs/day` source and its
// zod dependency, so the script is self-contained and safe under Node eval.
// Each case references the `day` namespace so tree-shaking cannot drop the
// import that forces esbuild to actually resolve the lib. Needs the dev
// checkout (vault/libs + esbuild), both present here.
// ---------------------------------------------------------------------------

test("a missing return-insert anchor is a hard error, never a silently returnless bundle", () => {
  // The sentinel `.then(` anchor is an invariant buildEntry establishes; if
  // esbuild output ever lost it, the old code returned the bundle unchanged
  // and the exec silently completed with undefined instead of the value.
  assert.throws(
    () => applyReturnInsert("(() => { const x = 1; })();"),
    /__CAPTURE_RESULT\.then\( return anchor/,
  );
});

test("bundle: a declaration + natural final expression resolves to the final value (M20 regression)", async () => {
  // Old code inserted the body as raw statements into a returnless IIFE, so a
  // natural final expression evaluated to undefined. It must now be the value.
  const bundled = await bundleExec(
    "import * as day from 'libs/day'; const f = () => typeof day; f()",
  );
  assert.equal(await eval(bundled), "object");
});

test("bundle: an explicit top-level return carries its value through the bundle path", async () => {
  const bundled = await bundleExec("import * as day from 'libs/day'; return 6 * 7");
  assert.equal(await eval(bundled), 42);
});

test("bundle: a top-level await resolves through the sentinel promise", async () => {
  const bundled = await bundleExec(
    "import * as day from 'libs/day'; const p = Promise.resolve(7); await p",
  );
  assert.equal(await eval(bundled), 7);
});

test("bundle: a thrown exception rejects the sentinel promise", async () => {
  const bundled = await bundleExec(
    "import * as day from 'libs/day'; throw new Error('boom')",
  );
  await assert.rejects(eval(bundled), /boom/);
});

test("bundle: an unknown lib fails deterministically before esbuild runs", async () => {
  // A bogus specifier whose binding is unreferenced would tree-shake away
  // before esbuild's resolver ever sees it; preflightLibs guarantees the
  // Unknown lib error up front regardless.
  await assert.rejects(bundleExec("import x from 'libs/nope'; x"), /Unknown lib/);
});
