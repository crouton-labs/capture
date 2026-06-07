/**
 * vault/docs — on-demand library doc generation + sha-keyed cache.
 *
 * Reimplements vault's `generateDocs` (northlight-vault
 * lib-pipeline/build/build-libs.ts:138-184) in-process, dropping the
 * manifest/sha/scripts half: for a lib we esbuild-bundle its `schemas.ts` to a
 * self-contained CJS string (zod inlined from node_modules by `bundle:true`),
 * evaluate it in-memory, then convert each function's Zod input/output to JSON
 * Schema (Zod-4-native `toJSONSchema()`, with the `void` special-case ported
 * verbatim). Results are cached gitignored under `vault/.cache/docs/<svc>.json`
 * with an embedded `_srcSha` = sha256(schemas.ts); a stale/missing sha rebuilds.
 *
 * Nothing here imports `esbuild` at the top level — it is loaded lazily via
 * `loadEsbuild()` so the published package (no `vault/`, no `esbuild`) degrades
 * to a single `DEV_ONLY_MSG` instead of crashing.
 */

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { vaultLibsDir, vaultRepoRoot, listLibs, loadEsbuild } from "./paths.js";

/** A single library function's doc entry (input/output are JSON Schema). */
export interface LibraryDocFunction {
  name: string;
  description: string;
  notes?: string;
  input: unknown;
  output: unknown;
}

/** A library's generated doc — same shape `nl lib read --json` returns. */
export interface LibraryDoc {
  /** `@vallum/<svc>` */
  library: string;
  description: string;
  notes?: string;
  loginUrl?: string;
  /** `'public' | 'chat' | 'hidden'` (default `'public'`). */
  visibility: string;
  functions: LibraryDocFunction[];
}

/** Shape of each entry in a lib's `schemas.ts` exported `allSchemas` array. */
interface FunctionSchema {
  name: string;
  description: string;
  notes?: string;
  input: unknown;
  output: unknown;
}

/** Mirrors `nl lib`'s agent-visible filter (vault-client.service.ts:49). */
const AGENT_VISIBLE_VISIBILITIES = new Set(["public", "chat"]);

/**
 * A `require` for the in-memory CJS eval below. zod is inlined by `bundle:true`
 * so this is never actually hit — it's passed defensively. Ambient `require` is
 * available under both the built CJS bin (native) and tsx-ESM (injected into a
 * real module). We avoid `createRequire(import.meta.url)` because `import.meta`
 * is empty under the CJS bin build (esbuild) and would throw at module load.
 */
declare const require: ((id: string) => unknown) | undefined;
const cjsRequire = (id: string): unknown => {
  if (typeof require === "function") return require(id);
  throw new Error(`cannot require('${id}') — unavailable in this runtime`);
};

function cacheDir(): string {
  return path.join(vaultRepoRoot(), ".cache", "docs");
}

function schemasPathFor(svc: string): string {
  return path.join(vaultLibsDir(), svc, "schemas.ts");
}

function srcSha(svc: string): string {
  return createHash("sha256")
    .update(fs.readFileSync(schemasPathFor(svc), "utf8"))
    .digest("hex");
}

/**
 * Zod → JSON Schema, porting build-libs.ts:155-173 verbatim. `z.void()` has no
 * JSON-Schema representation, so it maps to `{type:'null'}` (carrying its
 * description if present); everything else uses Zod 4's `toJSONSchema()`.
 */
function toJsonSchema(zodSchema: unknown): unknown {
  const s = zodSchema as {
    _zod?: { def?: { type?: string } };
    description?: string;
    toJSONSchema?: () => unknown;
  };
  if (s?._zod?.def?.type === "void") {
    const desc = s.description;
    return desc ? { type: "null", description: desc } : { type: "null" };
  }
  if (!s?.toJSONSchema) {
    throw new Error(
      "Schema missing toJSONSchema method - ensure Zod 4+ is installed",
    );
  }
  return s.toJSONSchema();
}

/**
 * Build one lib's doc from source: esbuild-bundle its `schemas.ts` to a
 * self-contained CJS string, eval it in-memory, assemble the `LibraryDoc`.
 */
async function buildDoc(svc: string): Promise<LibraryDoc> {
  const esbuild = await loadEsbuild();
  const result = await esbuild.build({
    entryPoints: [schemasPathFor(svc)],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    target: "es2020",
    logLevel: "silent",
  });
  const text = result.outputFiles?.[0]?.text;
  if (!text) throw new Error(`esbuild produced no output for ${svc}/schemas.ts`);

  // In-memory CJS eval (no temp file). zod is inlined by bundle:true, so the
  // `require` arg is never actually hit — passed defensively for any edge.
  const mod = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", "require", text)(
    mod,
    mod.exports,
    cjsRequire,
  );
  const x = mod.exports as {
    allSchemas?: FunctionSchema[];
    libraryDescription?: string;
    libraryNotes?: string;
    loginUrl?: string;
    libraryVisibility?: string;
  };

  const allSchemas = x.allSchemas ?? [];
  const doc: LibraryDoc = {
    library: `@vallum/${svc}`,
    description: x.libraryDescription ?? `${svc} service library`,
    visibility: x.libraryVisibility ?? "public",
    functions: allSchemas.map((schema) => ({
      name: schema.name,
      description: schema.description,
      ...(schema.notes ? { notes: schema.notes } : {}),
      input: toJsonSchema(schema.input),
      output: toJsonSchema(schema.output),
    })),
  };
  if (x.libraryNotes) doc.notes = x.libraryNotes;
  if (x.loginUrl) doc.loginUrl = x.loginUrl;
  return doc;
}

/**
 * Get one lib's doc — reads the sha-valid cache if present, else (re)builds and
 * writes it. May read ANY present lib (no visibility filter); used by
 * `lib read`. Throws `Unknown lib …` if the named lib has no `schemas.ts`.
 */
export async function getDoc(name: string): Promise<LibraryDoc> {
  if (!fs.existsSync(schemasPathFor(name))) {
    throw new Error(
      `Unknown lib "${name}". Available: ${listLibs().join(", ")}`,
    );
  }
  const sha = srcSha(name);
  const cacheFile = path.join(cacheDir(), `${name}.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as
        & LibraryDoc
        & { _srcSha?: string };
      if (cached._srcSha === sha) {
        delete cached._srcSha;
        return cached;
      }
    } catch {
      // corrupt/unreadable cache → fall through and rebuild
    }
  }
  const doc = await buildDoc(name);
  fs.mkdirSync(cacheDir(), { recursive: true });
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({ ...doc, _srcSha: sha }, null, 2),
  );
  return doc;
}

/**
 * All agent-visible libs' docs (visibility ∈ {public, chat}). Lazily builds any
 * missing/stale doc, then filters by visibility. A lib whose `schemas.ts` fails
 * to build is skipped with a stderr warning rather than failing the whole list.
 * Used by `lib list`/`search`/`show`.
 */
export async function listDocs(): Promise<LibraryDoc[]> {
  const out: LibraryDoc[] = [];
  for (const name of listLibs()) {
    let doc: LibraryDoc;
    try {
      doc = await getDoc(name);
    } catch (e) {
      console.error(
        `WARN: skipping lib "${name}" — ${(e as Error).message}`,
      );
      continue;
    }
    if (AGENT_VISIBLE_VISIBILITIES.has(doc.visibility)) out.push(doc);
  }
  return out;
}
