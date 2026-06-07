/**
 * `capture lib <list|search|show|read>` — search the forked vault libs.
 *
 * Pure local reads, NO CDP connection. Mirrors `nl lib`
 * (northlight apps/core/src/cli/families/lib/lib-cli.provider.ts): same search
 * scoring and the discover→schema→run loop, sourced from on-demand doc-gen
 * (`../../vault/docs.ts`) + sha cache. Output contract (capture convention):
 * the machine result → stdout `JSON.stringify(x, null, 2)`; next-step hints →
 * stderr. Every object naming a lib/function carries `srcPath` = the absolute
 * path to that lib's `.ts` source — the agent's pointer to rebuild on the fly.
 */

import * as path from "path";
import { type ParsedArgs } from "../types.js";
import { vaultLibsDir, listLibs } from "../../vault/paths.js";
import {
  getDoc,
  listDocs,
  isAgentVisible,
  type LibraryDoc,
} from "../../vault/docs.js";

const USAGE =
  "Usage: capture lib <list|search|show|read> [options]\n\n" +
  "  list                          List available libs (name, fn count, description, srcPath)\n" +
  '  search "<query>" [--limit N]  Fuzzy-search functions across all libs (ranked)\n' +
  "  show <name>                   Lib + function summaries (no schemas)\n" +
  "  read <name> [fn…]             Full input/output JSON schemas (+ .ts source path)\n\n" +
  "Then run a lib in the active authenticated tab:\n" +
  "  capture exec \"import {<fn>} from 'libs/<name>'; return await <fn>({…})\"\n\n" +
  "Dev-checkout-only feature (requires vault/ source + esbuild).";

// ─── scoring (ported verbatim from lib-cli.provider.ts:71-152) ───────────────

const FUNCTION_NAME_EXACT = 100;
const FUNCTION_NAME_PREFIX = 60;
const FUNCTION_NAME_SUBSTRING = 40;
const SERVICE_NAME_MATCH = 50;
const FUNCTION_DESC_SUBSTRING = 20;
const SERVICE_DESC_SUBSTRING = 10;

function scoreToken(
  token: string,
  service: string,
  fnName: string,
  fnDesc: string,
  serviceDesc: string,
): { score: number; match: string } {
  const q = token.toLowerCase();
  const fn = fnName.toLowerCase();
  const svc = service.toLowerCase();
  const fnD = fnDesc.toLowerCase();
  const svcD = serviceDesc.toLowerCase();

  let score = 0;
  let match = "";

  if (fn === q) {
    score += FUNCTION_NAME_EXACT;
    match = "function-name (exact)";
  } else if (fn.startsWith(q)) {
    score += FUNCTION_NAME_PREFIX;
    match = "function-name (prefix)";
  } else if (fn.includes(q)) {
    score += FUNCTION_NAME_SUBSTRING;
    match = "function-name";
  }

  if (svc.includes(q)) {
    score += SERVICE_NAME_MATCH;
    if (!match) match = "service-name";
  }

  if (fnD.includes(q)) {
    score += FUNCTION_DESC_SUBSTRING;
    if (!match) match = "function-desc";
  }

  if (svcD.includes(q)) {
    score += SERVICE_DESC_SUBSTRING;
    if (!match) match = "service-desc";
  }

  return { score, match };
}

/**
 * Every whitespace-separated token must contribute > 0 — without this,
 * `lib search "send email"` would return everything matching "send" alone.
 */
function scoreHit(
  query: string,
  service: string,
  fnName: string,
  fnDesc: string,
  serviceDesc: string,
): { score: number; match: string } {
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { score: 0, match: "" };
  if (tokens.length === 1) {
    return scoreToken(tokens[0], service, fnName, fnDesc, serviceDesc);
  }
  let total = 0;
  let bestScore = -1;
  let bestMatch = "";
  for (const token of tokens) {
    const r = scoreToken(token, service, fnName, fnDesc, serviceDesc);
    if (r.score === 0) return { score: 0, match: "" };
    total += r.score;
    if (r.score > bestScore) {
      bestScore = r.score;
      bestMatch = r.match;
    }
  }
  return { score: total, match: bestMatch };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const svcName = (doc: LibraryDoc): string =>
  doc.library.replace(/^@vallum\//, "");

const srcPathFor = (name: string): string =>
  path.join(vaultLibsDir(), name, "index.ts");

/** Resolve a user-supplied name against a candidate set: exact, then ci-prefix. */
function resolveName(
  query: string,
  names: string[],
): { name: string } | { error: string } {
  if (names.includes(query)) return { name: query };
  const lower = query.toLowerCase();
  const prefix = names.filter((n) => n.toLowerCase().startsWith(lower));
  if (prefix.length === 1) return { name: prefix[0] };
  if (prefix.length > 1) {
    return { error: `Ambiguous lib "${query}" — matches: ${prefix.join(", ")}` };
  }
  return { error: `Unknown lib "${query}". Available: ${names.join(", ")}` };
}

// ─── command ─────────────────────────────────────────────────────────────────

export async function cmdLib(
  parsed: ParsedArgs,
  _args: string[],
): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const sub = parsed.positional[0];

  // ── lib list ──────────────────────────────────────────────────────────────
  if (sub === "list") {
    const docs = await listDocs();
    const rows = docs.map((d) => {
      const name = svcName(d);
      return {
        name,
        functionCount: d.functions.length,
        description: d.description,
        srcPath: srcPathFor(name),
      };
    });
    console.log(JSON.stringify(rows, null, 2));
    console.error(
      `\n${rows.length} libs. Next: capture lib show <name>  ·  capture lib read <name> <fn>`,
    );
    return;
  }

  // ── lib search ──────────────────────────────────────────────────────────────
  if (sub === "search") {
    const query = parsed.positional[1];
    if (!query) {
      console.error('Usage: capture lib search "<query>" [--limit N]');
      process.exit(1);
    }
    const limit = Math.min(
      typeof parsed.limit === "number" && parsed.limit > 0 ? parsed.limit : 20,
      500,
    );
    const docs = await listDocs();
    const hits: Array<{
      service: string;
      function: string;
      match: string;
      score: number;
      description: string;
      srcPath: string;
    }> = [];
    for (const d of docs) {
      const service = svcName(d);
      for (const fn of d.functions) {
        const { score, match } = scoreHit(
          query,
          service,
          fn.name,
          fn.description ?? "",
          d.description ?? "",
        );
        if (score > 0) {
          hits.push({
            service,
            function: fn.name,
            match,
            score,
            description: fn.description,
            srcPath: srcPathFor(service),
          });
        }
      }
    }
    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, limit);
    console.log(JSON.stringify(top, null, 2));
    console.error(
      `\n${hits.length} hit(s)${hits.length > limit ? ` (showing ${limit})` : ""}.` +
        ` Next: capture lib read <service> <function>`,
    );
    return;
  }

  // ── lib show ──────────────────────────────────────────────────────────────
  if (sub === "show") {
    const name = parsed.positional[1];
    if (!name) {
      console.error("Usage: capture lib show <name>");
      process.exit(1);
    }
    // Resolve + build ONLY the named lib (design §3.1: show is single-lib, not
    // an all-lib bundle). Mirrors the read path; adds show's visibility filter
    // (a present-but-non-visible lib is treated as Unknown).
    const r = resolveName(name, listLibs());
    if ("error" in r) {
      console.error(r.error);
      process.exit(1);
    }
    let doc: LibraryDoc;
    try {
      doc = await getDoc(r.name);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    if (!isAgentVisible(doc)) {
      console.error(
        `Unknown lib "${name}". Available: ${listLibs().join(", ")}`,
      );
      process.exit(1);
    }
    const service = r.name;
    const out = {
      service,
      description: doc.description,
      ...(doc.loginUrl ? { loginUrl: doc.loginUrl } : {}),
      ...(doc.notes ? { notes: doc.notes } : {}),
      srcPath: srcPathFor(service),
      functions: doc.functions.map((f) => ({
        name: f.name,
        description: f.description,
      })),
    };
    console.log(JSON.stringify(out, null, 2));
    console.error(
      `\nSchemas required before exec — capture lib read ${service} <fn>`,
    );
    return;
  }

  // ── lib read ──────────────────────────────────────────────────────────────
  if (sub === "read") {
    const name = parsed.positional[1];
    if (!name) {
      console.error("Usage: capture lib read <name> [fn…]");
      process.exit(1);
    }
    // `read` may read ANY present lib (no visibility filter).
    const r = resolveName(name, listLibs());
    if ("error" in r) {
      console.error(r.error);
      process.exit(1);
    }
    let doc: LibraryDoc;
    try {
      doc = await getDoc(r.name);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    const service = svcName(doc);
    const fns = parsed.positional.slice(2);

    // No function names → summary fallback (show-style) + hint to name fns.
    if (fns.length === 0) {
      const out = {
        service,
        description: doc.description,
        ...(doc.notes ? { notes: doc.notes } : {}),
        srcPath: srcPathFor(service),
        functions: doc.functions.map((f) => ({
          name: f.name,
          description: f.description,
        })),
      };
      console.log(JSON.stringify(out, null, 2));
      console.error(
        `\nName functions to load schemas: capture lib read ${service} <fn> [fn…]`,
      );
      return;
    }

    const byName = new Map(doc.functions.map((f) => [f.name, f]));
    const found: typeof doc.functions = [];
    const missing: string[] = [];
    for (const op of fns) {
      const fn = byName.get(op);
      if (fn) found.push(fn);
      else missing.push(op);
    }

    if (found.length === 0) {
      const available = doc.functions.map((f) => f.name).join(", ");
      const label =
        missing.length > 1
          ? `Functions "${missing.join('", "')}"`
          : `Function "${missing[0]}"`;
      console.error(`${label} not in ${service}. Available: ${available}`);
      process.exit(1);
    }

    const out = {
      service,
      srcPath: srcPathFor(service),
      functions: found.map((f) => ({
        name: f.name,
        description: f.description,
        ...(f.notes ? { notes: f.notes } : {}),
        input: f.input,
        output: f.output,
      })),
      ...(missing.length > 0 ? { missing } : {}),
    };
    console.log(JSON.stringify(out, null, 2));
    const firstFn = found[0].name;
    console.error(
      `\nRun it: capture exec "import {${firstFn}} from 'libs/${service}'; return await ${firstFn}({…})"`,
    );
    return;
  }

  // ── lib (no/unknown subcommand) ─────────────────────────────────────────────
  console.error(USAGE);
  process.exit(1);
}
