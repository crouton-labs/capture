/**
 * `capture lib <list|search|show|read>` — search the forked vault libs.
 *
 * Pure local reads, NO CDP connection. Mirrors `nl lib`
 * (northlight apps/core/src/cli/families/lib/lib-cli.provider.ts): same search
 * scoring and the discover→schema→run loop, sourced from on-demand doc-gen
 * (`../../vault/docs.ts`) + sha cache. Output contract: every result is a
 * render.ts block — `<libs>` selection lists for `list`/`search`, a `<lib>`
 * block for `show`/`read` — with `--json` mirroring the same result. Every
 * block naming a lib carries `src` = the absolute path to that lib's `.ts`
 * source, the agent's full-fidelity pointer; `lib read` is the schema-level
 * full-fidelity leaf. Dev-checkout only: with `vault/` source missing
 * (published package) every leaf throws a typed `dev_only` failure, rendered
 * at the root boundary as `<error code="dev_only">`, exit 1. Every failure
 * here throws typed (`CaptureError`) — the `src/capture.ts` root boundary is
 * the one renderer and exit-code authority.
 */

import * as path from "path";
import { captureError, invalidInput } from "../../errors.js";
import { type ParsedArgs } from "../types.js";
import {
  emitResult,
  fact,
  text,
  lineList,
  capped,
  type FactLine,
} from "../../output/render.js";
import { vaultLibsDir, listLibs, DEV_ONLY_MSG } from "../../vault/paths.js";
import {
  getDoc,
  listDocs,
  isAgentVisible,
  type LibraryDoc,
} from "../../vault/docs.js";

/** Root-help representation of this leaf, assembled by `src/capture.ts`. */
export const COMMAND_BLOCK = `<command name="lib">
vault-lib introspection (dev checkout only) — discover the forked vault libs and their function schemas, then run them in the tab
use when scripting against a bundled service lib: find the function, read its schema, invoke it via page exec
  list · search · show · read — \`capture lib -h\`
</command>`;

const LIB_USAGE = `capture lib — vault-lib introspection (dev checkout only): discover the
forked vault libs and their function schemas, then run them in the tab via
\`capture page exec\`.

Pure local reads — no CDP connection. Requires a capture checkout with
vault/ source + esbuild; the published package answers every leaf with a
structured dev_only error.

<subcommand name="list" args="" whenToUse="list every lib — name, function count, one-line summary"/>
<subcommand name="search" args="<query> [--limit <n>]" whenToUse="rank functions across all libs against a query (default limit 20, max 500; multi-word queries require every token to match)"/>
<subcommand name="show" args="<name>" whenToUse="one lib's function summaries — names + one-line descriptions, no schemas"/>
<subcommand name="read" args="<name> [fn…]" whenToUse="full input/output JSON Schemas for named functions — the full-fidelity step before exec"/>

capture lib <leaf> -h    Per-leaf usage`;

const LEAF_USAGE: Record<string, string> = {
  list: `capture lib list — list every vault lib: name, function count, one-line summary.

Input: none.
Output: <libs count=…> selection block, one row per lib (name — summary — function count).
Effects: local reads only (doc cache maintained under vault/.cache/docs); no CDP connection. Dev checkout required.`,
  search: `capture lib search <query> [--limit <n>] — rank functions across all libs against a query.

Input: <query> (required; multi-word queries require every token to contribute a match); --limit <n> caps rows shown (default 20, max 500).
Output: <libs query=… hits=… shown=…> selection block, one row per hit (service.function — match kind — summary), best score first.
Effects: local reads only; no CDP connection. Dev checkout required.`,
  show: `capture lib show <name> — one lib's function summaries, no schemas.

Input: <name> (required; exact lib name or unambiguous case-insensitive prefix).
Output: <lib name=… functions=… src=…> block — description, notes/login when present, one row per function (name — summary).
Effects: local reads only; no CDP connection. Dev checkout required.`,
  read: `capture lib read <name> [fn…] — full input/output JSON Schemas for named functions.

Input: <name> (required; exact lib name or unambiguous case-insensitive prefix); [fn…] function names — with none given, falls back to the function summary list.
Output: <lib name=… src=…> block — per named function: description, notes, input and output JSON Schema (capped inline; the src path is the full-fidelity pointer).
Effects: local reads only; no CDP connection. Dev checkout required.`,
};

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

/** Plain-string truncation for thrown messages (the `capped()` render marker
 * only works inside `fact` templates, not in a `CaptureError` message). */
const cap = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

const srcPathFor = (name: string): string =>
  path.join(vaultLibsDir(), name, "index.ts");

/** Resolve a user-supplied name against a candidate set: exact, then ci-prefix. */
type NameResolution =
  | { name: string }
  | { ambiguous: string[] }
  | { unknown: true };

function resolveName(query: string, names: string[]): NameResolution {
  if (names.includes(query)) return { name: query };
  const lower = query.toLowerCase();
  const prefix = names.filter((n) => n.toLowerCase().startsWith(lower));
  if (prefix.length === 1) return { name: prefix[0] };
  if (prefix.length > 1) return { ambiguous: prefix };
  return { unknown: true };
}

/** Resolve a lib name or throw typed (unknown/ambiguous). */
function resolveNameOrFail(command: string, query: string): string {
  const names = listLibs();
  const r = resolveName(query, names);
  if ("ambiguous" in r) {
    throw invalidInput(
      `${command} received: lib name \`${query}\` — matches ${r.ambiguous.join(", ")}; expected exactly one lib. Re-run with the full lib name.`,
      "ambiguous_lib",
    );
  }
  if ("unknown" in r) {
    throw invalidInput(
      `${command} received: unknown lib \`${query}\`; available: ${cap(names.join(", "), 1600)}. Run \`capture lib list\` for every lib with its summary.`,
      "unknown_lib",
    );
  }
  return r.name;
}

/** `getDoc` or throw typed. `DEV_ONLY_MSG` rethrows to the shared dev-only
 * handler in `cmdLib`; any other build failure is a typed doc_unavailable
 * failure. */
async function getDocOrFail(command: string, name: string): Promise<LibraryDoc> {
  try {
    return await getDoc(name);
  } catch (e) {
    if (e instanceof Error && e.message === DEV_ONLY_MSG) throw e;
    throw captureError(
      "world",
      "doc_unavailable",
      `${command}: doc generation for lib \`${name}\` failed: ${(e as Error).message}`,
      e,
    );
  }
}

// ─── subcommands ─────────────────────────────────────────────────────────────

async function libList(parsed: ParsedArgs): Promise<void> {
  const docs = await listDocs();
  const rows = docs.map((d) => {
    const name = svcName(d);
    return fact`${name} — ${capped(d.description ?? "", 160)} (${d.functions.length} functions)`;
  });
  emitResult(
    {
      tag: "libs",
      attrs: { count: docs.length },
      summary: fact`${docs.length} vault libs.`,
      sections: rows.length > 0 ? [lineList(rows)] : undefined,
      followUp: text`\`capture lib show <name>\` lists one lib's functions; \`capture lib read <name> <fn…>\` loads full schemas.`,
    },
    { json: parsed.json },
  );
}

async function libSearch(parsed: ParsedArgs): Promise<void> {
  const query = parsed.positional[1];
  if (!query) {
    throw invalidInput(
      "lib search received: no query; expected: capture lib search <query> [--limit <n>].",
    );
  }
  const limit = Math.min(
    typeof parsed.limit === "number" && parsed.limit > 0 ? parsed.limit : 20,
    500,
  );
  const docs = await listDocs();
  const hits: Array<{
    service: string;
    fn: string;
    match: string;
    score: number;
    description: string;
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
          fn: fn.name,
          match,
          score,
          description: fn.description ?? "",
        });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, limit);
  const rows = top.map(
    (h) =>
      fact`${h.service}.${h.fn} — ${h.match} — ${capped(h.description, 160)}`,
  );
  emitResult(
    {
      tag: "libs",
      attrs: { query, hits: hits.length, shown: top.length },
      summary: fact`${hits.length} functions matched; showing ${top.length}, best score first.`,
      sections: rows.length > 0 ? [lineList(rows)] : undefined,
      followUp: text`\`capture lib read <service> <fn>\` loads the full input/output schemas.`,
    },
    { json: parsed.json },
  );
}

/** The show-style summary block shared by `show` and fn-less `read`. */
function emitLibSummary(
  parsed: ParsedArgs,
  service: string,
  doc: LibraryDoc,
  followUp: FactLine,
): void {
  const sections: FactLine[] = [];
  if (doc.loginUrl) sections.push(fact`login: ${doc.loginUrl}`);
  if (doc.notes) sections.push(fact`notes: ${capped(doc.notes, 400)}`);
  if (doc.functions.length > 0) {
    sections.push(
      lineList(
        doc.functions.map(
          (f) => fact`${f.name} — ${capped(f.description ?? "", 160)}`,
        ),
      ),
    );
  }
  emitResult(
    {
      tag: "lib",
      attrs: {
        name: service,
        functions: doc.functions.length,
        src: srcPathFor(service),
      },
      summary: fact`${capped(doc.description ?? "", 300)}`,
      sections,
      followUp,
    },
    { json: parsed.json },
  );
}

async function libShow(parsed: ParsedArgs): Promise<void> {
  const name = parsed.positional[1];
  if (!name) {
    throw invalidInput(
      "lib show received: no lib name; expected: capture lib show <name>.",
    );
  }
  // Resolve + build ONLY the named lib (design §3.1: show is single-lib, not
  // an all-lib bundle). Mirrors the read path; adds show's visibility filter
  // (a present-but-non-visible lib is treated as unknown).
  const resolved = resolveNameOrFail("lib show", name);
  const doc = await getDocOrFail("lib show", resolved);
  if (!isAgentVisible(doc)) {
    throw invalidInput(
      `lib show received: unknown lib \`${name}\`; available: ${cap(listLibs().join(", "), 1600)}. Run \`capture lib list\` for every lib with its summary.`,
      "unknown_lib",
    );
  }
  emitLibSummary(
    parsed,
    resolved,
    doc,
    fact`\`capture lib read ${resolved} <fn>\` loads full input/output JSON Schemas.`,
  );
}

async function libRead(parsed: ParsedArgs): Promise<void> {
  const name = parsed.positional[1];
  if (!name) {
    throw invalidInput(
      "lib read received: no lib name; expected: capture lib read <name> [fn…].",
    );
  }
  // `read` may read ANY present lib (no visibility filter).
  const resolved = resolveNameOrFail("lib read", name);
  const doc = await getDocOrFail("lib read", resolved);
  const service = svcName(doc);
  const fns = parsed.positional.slice(2);

  // No function names → summary fallback (show-style).
  if (fns.length === 0) {
    emitLibSummary(
      parsed,
      service,
      doc,
      fact`Name functions to load schemas: \`capture lib read ${service} <fn> [fn…]\`.`,
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
    throw invalidInput(
      `lib read received: ${missing.join(", ")} — not in ${service}; available: ${cap(
        doc.functions.map((f) => f.name).join(", "),
        1600,
      )}. \`capture lib show ${service}\` lists every function with its summary.`,
      "unknown_function",
    );
  }

  const sections: FactLine[] = found.map((f) =>
    lineList([
      fact`${f.name} — ${capped(f.description ?? "", 200)}`,
      ...(f.notes ? [fact`notes: ${capped(f.notes, 300)}`] : []),
      fact`input: ${capped(JSON.stringify(f.input), 2000)}`,
      fact`output: ${capped(JSON.stringify(f.output), 2000)}`,
    ]),
  );
  if (missing.length > 0) {
    sections.push(fact`not in ${service}: ${missing.join(", ")}`);
  }
  const firstFn = found[0].name;
  emitResult(
    {
      tag: "lib",
      attrs: { name: service, src: srcPathFor(service) },
      summary: fact`${found.length} of ${doc.functions.length} functions, full schemas; full source at the src path.`,
      sections,
      followUp: fact`Run it in the tab: capture page exec "import {${firstFn}} from 'libs/${service}'; return await ${firstFn}({…})".`,
    },
    { json: parsed.json },
  );
}

// ─── command ─────────────────────────────────────────────────────────────────

export async function cmdLib(
  parsed: ParsedArgs,
  _args: string[],
): Promise<void> {
  const sub = parsed.positional[0];

  // Help never touches vault/ — it must work in the published package too.
  if (parsed.help) {
    console.log(sub && LEAF_USAGE[sub] ? LEAF_USAGE[sub] : LIB_USAGE);
    return;
  }

  try {
    switch (sub) {
      case "list":
        return await libList(parsed);
      case "search":
        return await libSearch(parsed);
      case "show":
        return await libShow(parsed);
      case "read":
        return await libRead(parsed);
      case undefined:
        // Bare `lib` prints branch usage, exit 0 — same posture as the other
        // root branches (page/tab/measure/motion).
        console.log(LIB_USAGE);
        return;
      default:
        // Defense-in-depth mirror of the sibling branch routers; central
        // dispatch (`validateCliInvocation`) rejects unknown lib leaves with
        // the same typed shape before this switch runs.
        throw invalidInput(`Unknown lib leaf: ${sub}.`, "unknown_command");
    }
  } catch (e) {
    // The dev-only gate (vault/ source or esbuild missing) surfaces here from
    // any leaf; gate behavior is unchanged, only its presentation is the
    // typed vocabulary rendered at the root boundary.
    if (e instanceof Error && e.message === DEV_ONLY_MSG) {
      throw captureError("precondition", "dev_only", e.message, e);
    }
    throw e;
  }
}
