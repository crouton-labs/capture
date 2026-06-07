/**
 * Unit checks for the import-driven exec trigger (`hasImports`).
 *
 * Run: `pnpm test` (node --test via tsx). Lives outside the `files` allowlist
 * so it is never shipped. `hasImports` calls only `splitLeadingImports` — pure
 * string work, no vault/ source or esbuild needed — so this runs anywhere.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { hasImports } from "../src/vault/bundle.js";

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
