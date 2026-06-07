/**
 * vault/bundle — the import-driven exec engine.
 *
 * Ports the bundling mechanism of northlight's
 * `apps/core/src/tool-registry/lib/bundle-agent-code.ts`, DROPPING the telemetry
 * envelope (no `__vallumStartCall`, no `__snapshot`, no `borgEnabled`). When
 * `capture exec` is handed code containing leading static imports, this turns it
 * into a single self-contained IIFE: the user's `libs/<name>` imports are
 * resolved to the forked vault source, esbuild bundles the whole tree on the
 * fly, and the result is a string the exec path evals over CDP.
 *
 * No top-level `esbuild` import — it is loaded lazily via `loadEsbuild()` so the
 * published package (no esbuild) never crashes at startup.
 */

import * as fs from "fs";
import * as path from "path";
import type { Plugin, BuildResult, Message } from "esbuild";
import {
  isValidLibName,
  loadEsbuild,
  unknownLibMsg,
  vaultLibsDir,
  vaultRepoRoot,
} from "./paths.js";

// Sentinel the post-bundle return-insert anchors on. esbuild with minify:false
// never renames top-level identifiers, and no first-party lib references
// __CAPTURE_*, so this literal survives bundling intact and uniquely (the same
// invariant core relies on for __VALLUM_USER_PROMISE).
const SENTINEL = "__CAPTURE_RESULT";

// Matches a leading run of static import statements (plus any leading comments)
// per statement: leading ws/comments, then `import` through its single
// module-specifier string and optional `;`. A normal import has exactly one
// string literal (the specifier), so this is unambiguous. Ported from
// bundle-agent-code.ts, with one addition: the `(?!\s*\()` lookahead so a
// leading dynamic `import(...)` CALL is NOT misclassified as a static import
// statement (it would otherwise be hoisted and the body run detached, silently
// returning undefined). Dynamic `import(...)` anywhere in the body is untouched.
const IMPORT_STMT_RE =
  /^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*import\b(?!\s*\()[^'"`]*?(['"])(?:[^'"`\\]|\\.)*\1[^\n;]*;?/;

function splitLeadingImports(code: string): { imports: string; body: string } {
  const imports: string[] = [];
  let body = code;
  for (;;) {
    const m = IMPORT_STMT_RE.exec(body);
    if (!m) break;
    imports.push(m[0]);
    body = body.slice(m[0].length);
  }
  return { imports: imports.join(""), body };
}

/**
 * True iff `code` contains ≥1 leading static `import` statement. This is the
 * trigger exec.ts uses to preserve the no-import fast path: plain exec has no
 * top-level import, so esbuild never runs for it.
 */
export function hasImports(code: string): boolean {
  return splitLeadingImports(code).imports.length > 0;
}

// Matches a `libs/<name>` module specifier inside a string literal.
const LIB_SPECIFIER_RE = /(['"])libs\/((?:[^'"\\]|\\.)*)\1/g;

// Validate every `libs/<name>` specifier up front. esbuild with treeShaking:true
// drops an UNUSED import before its resolver ever runs, so a bogus-lib import
// whose binding is unreferenced would otherwise bundle silently; this guarantees
// the `Unknown lib` error deterministically, and before esbuild is even loaded
// (fail fast, before any CDP). Mirrors vaultResolver's existence check exactly.
function preflightLibs(imports: string): void {
  const libs = vaultLibsDir();
  LIB_SPECIFIER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LIB_SPECIFIER_RE.exec(imports)) !== null) {
    const name = m[2];
    if (!isValidLibName(name) || !fs.existsSync(path.join(libs, name, "index.ts"))) {
      throw new Error(unknownLibMsg(name));
    }
  }
}

// Hoist the imports to module top level (so esbuild resolves & tree-shakes them)
// and wrap the body in a result-capturing async IIFE bound to the sentinel. The
// trailing `.then()` is a preserved no-op call → DCE-safe anchor for the
// post-bundle return insert (a bare `__CAPTURE_RESULT;` statement can be dropped
// by tree-shaking; a call survives).
function buildEntry(code: string): string {
  const { imports, body } = splitLeadingImports(code);
  const expr = body.trim().replace(/;+\s*$/, "");
  return [
    imports,
    `const ${SENTINEL} = (async () => { ${expr} })();`,
    `${SENTINEL}.then();`,
  ].join("\n");
}

// Maps the two bare specifier shapes (`@vallum/_runtime`, `libs/<name>`) to
// absolute source paths in the DEFAULT `file` namespace — no custom namespace,
// no onLoad. esbuild then natively resolves each file's own relative imports
// (`./context`, `./messages/send`) and npm imports (`zod`) off disk, pulling the
// whole nested source tree in for free.
function vaultResolver(): Plugin {
  const libs = vaultLibsDir();
  const runtime = path.join(libs, "_runtime", "index.ts");
  return {
    name: "vault",
    setup(build) {
      build.onResolve({ filter: /^@vallum\/_runtime$/ }, () => ({
        path: runtime,
      }));
      build.onResolve({ filter: /^libs\// }, (args) => {
        const name = args.path.slice("libs/".length);
        if (!isValidLibName(name)) {
          return { errors: [{ text: unknownLibMsg(name) }] };
        }
        const entry = path.join(libs, name, "index.ts");
        return fs.existsSync(entry)
          ? { path: entry }
          : { errors: [{ text: unknownLibMsg(name) }] };
      });
    },
  };
}

async function runEsbuild(entry: string): Promise<BuildResult<{ write: false }>> {
  const esbuild = await loadEsbuild();
  const opts = {
    stdin: {
      contents: entry,
      resolveDir: vaultRepoRoot(),
      loader: "ts" as const,
      sourcefile: "exec.ts",
    },
    plugins: [vaultResolver()],
    bundle: true,
    write: false as const,
    format: "iife" as const,
    target: "es2020",
    platform: "browser" as const,
    treeShaking: true,
    minify: false,
    logLevel: "silent" as const,
  };
  try {
    return await esbuild.build(opts);
  } catch (error) {
    // esbuild's background process can crash, making all future calls fail with
    // "The service is no longer running". stop() forces a fresh process; retry once.
    if (
      error instanceof Error &&
      error.message.includes("service is no longer running")
    ) {
      esbuild.stop();
      return await esbuild.build(opts);
    }
    throw error;
  }
}

// The only post-bundle edit: esbuild's iife wrapper `(() => { … })()` has no
// return, so the script completion value is undefined. Insert `return ` before
// the last `__CAPTURE_RESULT.then(` so the IIFE returns the user's promise.
function applyReturnInsert(bundled: string): string {
  const anchor = `${SENTINEL}.then(`;
  const i = bundled.lastIndexOf(anchor);
  return i === -1 ? bundled : bundled.slice(0, i) + "return " + bundled.slice(i);
}

function formatBuildErrors(errors: Message[]): string {
  return errors
    .map((e) => {
      const l = e.location;
      const loc = l ? ` (${l.file}:${l.line}:${l.column})` : "";
      return `${e.text}${loc}`;
    })
    .join("\n");
}

/**
 * Bundle import-bearing exec code into a complete IIFE string that returns the
 * user's promise. Throws an Error whose message formats esbuild's `errors[]`
 * (text + file:line:col) on a build/resolve failure — exec.ts prints it and
 * exits before opening a CDP connection.
 */
export async function bundleExec(code: string): Promise<string> {
  preflightLibs(splitLeadingImports(code).imports);
  const entry = buildEntry(code);
  let result: BuildResult<{ write: false }>;
  try {
    result = await runEsbuild(entry);
  } catch (error) {
    const errs = (error as { errors?: Message[] })?.errors;
    if (Array.isArray(errs) && errs.length > 0) {
      throw new Error(formatBuildErrors(errs));
    }
    throw error;
  }
  if (!result.outputFiles || result.outputFiles.length === 0) {
    throw new Error("esbuild produced no output");
  }
  return applyReturnInsert(result.outputFiles[0].text);
}
