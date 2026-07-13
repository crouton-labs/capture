/**
 * `page elements` — the live targeting navigator (the D1 split's first
 * half): what can be acted on in the live tab right now, selection-shaped
 * for the next `page` call.
 *
 * Default lists interactive elements only; every record carries the three
 * discriminators the next `page click`/`type` needs — role, accessible
 * name, `backendNodeId` (I-3) — straight from the live
 * `Accessibility.getFullAXTree` fetch. `--all` widens to the full exposed
 * tree. There is no computed-CSS-selector field: `backend:<id>` is the
 * canonical retry/targeting key (D1).
 *
 * Read-only: the AX fetch is CDP-side — no page-observable writes (I-1/
 * I-2). During a live composed recording the connection routes through the
 * recorder unmarked (no input landmark — this leaf dispatches no input).
 * A truncated list states the total as an explicit `elements-truncated`
 * fact (I-5); "0 interactive elements" is itself the measurement (I-8).
 */
import { type ParsedArgs } from '../../types.js';
import { withConnection } from '../../connection.js';
import { INTERACTIVE_ROLES, readFullAXTree } from '../../a11y.js';
import {
  emitResult,
  fact,
  text,
  lineList,
  type FactLine,
  type RenderableResult,
} from '../../../output/render.js';

/** `--limit` default (Resolved 4): keeps the list selection-shaped on dense
 * pages while covering normal pages untruncated. */
export const DEFAULT_LIMIT = 100;

const USAGE = `capture page elements — list what can be acted on in the live tab: role, accessible name, backend:<id> per element.

Input:
  --all               full exposed accessibility tree instead of interactive elements only
  --limit <n>         max elements listed (positive integer, default ${DEFAULT_LIMIT}; a capped list states the total as an elements-truncated fact)
  --target <tabId> | --url <pattern> | --port <n>   tab targeting; defaults to the active session tab
  --json              mirror the result as JSON

Output:
  <elements scope="interactive|all" count=<total>> — one row per element: role "name" backend:<id>

Effects: read-only — the accessibility fetch is CDP-side, no page-observable writes; routes unmarked through an active composed recording.`;

/** The minimal CDP surface this leaf reads through — `CDPClient` and the
 * recorder-held adapter both satisfy it structurally. */
export interface ElementsClient {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** One listed element. `backendNodeId` is always present on the default
 * (interactive) records — the drivability discriminator — and `null` only
 * for `--all` tree nodes the browser exposes without a DOM node. */
export interface ElementRecord {
  readonly role: string;
  readonly name: string;
  readonly backendNodeId: number | null;
}

/**
 * Fetches the live AX tree and flattens it to element records in document
 * order. Default keeps interactive roles with a `backendNodeId` (the
 * actionable set); `all` keeps every non-ignored node with a role. Pure
 * CDP reads — no page-observable calls.
 */
export async function collectElements(
  client: ElementsClient,
  opts: { all?: boolean } = {},
): Promise<ElementRecord[]> {
  const nodes = await readFullAXTree(client);

  const records: ElementRecord[] = [];
  for (const node of nodes) {
    if (node.ignored) continue;
    const role = node.role?.value ?? '';
    if (!role) continue;
    if (!opts.all) {
      if (!INTERACTIVE_ROLES.has(role)) continue;
      if (node.backendDOMNodeId === undefined) continue;
    }
    records.push({
      role,
      name: node.name?.value ?? '',
      backendNodeId: node.backendDOMNodeId ?? null,
    });
  }
  return records;
}

/**
 * Assembles the `<elements>` result. Every page-derived value (role, name)
 * flows through the `fact` interpolation lane — escaped and capped (I-9).
 * Truncation is an explicit fact carrying the total count (I-5); an empty
 * list renders count 0 with no advice (I-8).
 */
export function buildElementsResult(
  records: readonly ElementRecord[],
  opts: { all: boolean; limit: number },
): RenderableResult {
  const total = records.length;
  const shown = records.slice(0, opts.limit);

  const rows = shown.map((r) =>
    r.backendNodeId !== null
      ? fact`${r.role} "${r.name}" backend:${r.backendNodeId}`
      : fact`${r.role} "${r.name}"`,
  );

  const sections: FactLine[] = [];
  if (rows.length > 0) sections.push(lineList(rows));
  if (total > shown.length) {
    sections.push(fact`elements-truncated: listing capped at ${shown.length} of ${total} elements (--limit)`);
  }

  return {
    tag: 'elements',
    attrs: { scope: opts.all ? 'all' : 'interactive', count: total },
    summary: opts.all
      ? fact`${total} elements in the exposed accessibility tree`
      : fact`${total} interactive elements`,
    sections,
    followUp: text`capture page click <target> · capture measure map ax <url|snap>`,
  };
}

export async function cmdPageElements(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const limit = parsed.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    emitResult(
      {
        tag: 'error',
        attrs: { command: 'page elements', code: 'invalid_flag' },
        summary: fact`received: --limit ${String(parsed.limit)}; expected: a positive integer.`,
      },
      { json: parsed.json },
    );
    process.exit(1);
  }

  const records = await withConnection(
    parsed,
    (client) => collectElements(client, { all: parsed.all }),
    { settle: 0 },
  );

  emitResult(buildElementsResult(records, { all: Boolean(parsed.all), limit }), {
    json: parsed.json,
  });
}
