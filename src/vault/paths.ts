/**
 * vault/paths — locate the forked vault lib source on disk + the dev-only guard.
 *
 * Shared foundation for the import-driven exec bundler (`bundle.ts`) and the
 * on-demand doc generator (`docs.ts`). This module must NOT import `esbuild` at
 * the top level — esbuild is loaded lazily (see `loadEsbuild`) so the published
 * package (which ships neither `vault/` nor `esbuild`) never crashes at startup.
 */

import * as fs from "fs";
import * as path from "path";

/**
 * The single dev-only degradation message. Thrown when `vault/libs` is missing
 * (published package) or when `esbuild` cannot be loaded. (design §2.6, verbatim)
 */
export const DEV_ONLY_MSG =
  "This is a dev-only feature of capture — run it from a capture checkout\n" +
  "(vault/ source + `pnpm install`). Not available in the published package.";

/**
 * Absolute path to the forked `vault/libs` directory. Dual `__dirname`
 * candidates cover the built bin (`bin/../vault/libs`) and tsx dev
 * (`src/vault/../../vault/libs`) — mirrors the `__dirname`+`..` precedent in
 * `capture.ts`. Throws `DEV_ONLY_MSG` if neither candidate holds the source.
 */
export function vaultLibsDir(): string {
  const candidates = [
    path.resolve(__dirname, "..", "vault", "libs"), // built bin: bin/../vault/libs
    path.resolve(__dirname, "..", "..", "vault", "libs"), // tsx dev: src/vault/../../vault/libs
  ];
  const hit = candidates.find((p) =>
    fs.existsSync(path.join(p, "_runtime", "index.ts"))
  );
  if (!hit) throw new Error(DEV_ONLY_MSG);
  return hit;
}

/**
 * The `vault/` directory (parent of `vault/libs`). Used as esbuild's
 * `resolveDir` so its native node-resolution finds `node_modules/zod` etc.
 */
export function vaultRepoRoot(): string {
  return path.dirname(vaultLibsDir());
}

/**
 * Sorted list of available lib names — directories under `vault/libs`,
 * excluding `_`-prefixed internal dirs (e.g. `_runtime`). Used by the
 * resolver's "Available: …" error and by the docs/lib surfaces.
 */
export function listLibs(): string[] {
  return fs
    .readdirSync(vaultLibsDir(), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
}

/**
 * The friendly "Unknown lib" message, shared by the exec resolver/preflight
 * (`bundle.ts`) and the doc generator (`docs.ts`) so an unknown OR malformed
 * lib name surfaces byte-identical text everywhere.
 */
export function unknownLibMsg(name: string): string {
  return `Unknown lib "${name}". Available: ${listLibs().join(", ")}`;
}

// A lib name is a single path segment of `[A-Za-z0-9_.-]` (covers `hunter.io`)
// with no `..`. Rejects path separators / traversal (`libs/../x`, `libs/a/b`)
// before a name reaches `path.join`/esbuild — defense-in-depth (exec already
// runs arbitrary JS, so this only buys a clearer error, not isolation).
const VALID_LIB_NAME = /^[A-Za-z0-9_.-]+$/;
export function isValidLibName(name: string): boolean {
  return VALID_LIB_NAME.test(name) && !name.includes("..");
}

/**
 * Lazily load `esbuild`. Kept here so both `bundle.ts` and `docs.ts` share one
 * lazy loader and the top-level module never statically imports esbuild — a
 * published install (no esbuild) only fails when the feature path is exercised.
 */
export async function loadEsbuild(): Promise<typeof import("esbuild")> {
  return await import("esbuild").catch(() => {
    throw new Error(DEV_ONLY_MSG);
  });
}
