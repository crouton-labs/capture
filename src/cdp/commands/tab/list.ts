/**
 * `capture tab list [--port <port>]` — CDP endpoint discovery and page-tab
 * listing merged into one selection-shaped `<tabs>` block (D5: the old
 * `detect` root command's discovery is the no-port default of listing tabs).
 *
 * A per-endpoint tab-fetch failure is reported as an `endpoints-unreachable`
 * fact, never silently dropped (I-5). Every endpoint/page-derived string
 * (titles, URLs, app names, target ids) flows through `data()`/`fact` (I-9).
 */
import {
  detectCdpPortsAsync,
  getDefaultBrowserId,
  pickPreferredEndpoint,
} from '../../detect.js';
import { listTargets } from '../../targets.js';
import { type ParsedArgs } from '../../types.js';
import {
  data,
  emitResult,
  fact,
  line,
  lineList,
  text,
  type FactLine,
  type RenderableResult,
} from '../../../output/render.js';

const USAGE = `capture tab list — discover CDP endpoints and list the page tabs on each.

input:
  --port <port>   probe one endpoint only, instead of discovering every localhost CDP endpoint

output: <tabs endpoints=… tabs=…> — one section per reachable endpoint (port, app, page-tab count, preferred marker) listing each page tab's target id (first 8 chars, enough for --target), title, and url; an endpoint that failed the tab fetch is an endpoints-unreachable fact, never a silent omission.
effects: read-only — probes local CDP endpoints over HTTP/WebSocket; no page-observable writes.`;

export interface TabRow {
  id: string;
  title: string;
  url: string;
}

export interface EndpointTabs {
  port: number;
  /** Endpoint-derived app name (from its /json/version User-Agent) — untrusted. */
  app?: string;
  /** Marked on the endpoint auto-discovery would pick for port-less commands. */
  preferred: boolean;
  pages: TabRow[];
}

export interface UnreachableEndpoint {
  port: number;
  app?: string;
  reason: string;
}

/** Pure `<tabs>` result builder — exported for tests. */
export function buildTabsResult(
  endpoints: readonly EndpointTabs[],
  unreachable: readonly UnreachableEndpoint[],
): RenderableResult {
  const totalTabs = endpoints.reduce((n, ep) => n + ep.pages.length, 0);

  let summary: FactLine =
    endpoints.length === 0 && unreachable.length === 0
      ? text`0 CDP endpoints found listening on localhost.`
      : fact`${totalTabs} page tab(s) on ${endpoints.length} reachable CDP endpoint(s).`;
  if (unreachable.length > 0) {
    summary = line(summary, fact` ${unreachable.length} endpoint(s) unreachable.`);
  }

  const sections: FactLine[] = endpoints.map((ep) => {
    const header = line(
      text`port `,
      data(ep.port),
      ...(ep.app !== undefined ? [line(text` — `, data(ep.app, 80))] : []),
      fact` — ${ep.pages.length} page tab(s)`,
      ...(ep.preferred ? [text` [preferred]`] : []),
    );
    const rows = ep.pages.map((t) =>
      line(text`  `, data(t.id.slice(0, 8)), text`  "`, data(t.title, 120), text`"  `, data(t.url, 300)),
    );
    return lineList([header, ...rows]);
  });

  if (unreachable.length > 0) {
    sections.push(
      lineList(
        unreachable.map((u) =>
          line(
            text`endpoints-unreachable: port `,
            data(u.port),
            ...(u.app !== undefined ? [line(text` (`, data(u.app, 80), text`)`)] : []),
            text` — `,
            data(u.reason, 300),
          ),
        ),
      ),
    );
  }

  return {
    tag: 'tabs',
    attrs: {
      endpoints: endpoints.length,
      tabs: totalTabs,
      ...(unreachable.length > 0 ? { unreachable: unreachable.length } : {}),
    },
    summary,
    sections,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function cmdTabList(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const reachable: EndpointTabs[] = [];
  const unreachable: UnreachableEndpoint[] = [];

  if (parsed.port) {
    try {
      const targets = await listTargets(parsed.port);
      reachable.push({
        port: parsed.port,
        preferred: false,
        pages: targets
          .filter((t) => t.type === 'page')
          .map((t) => ({ id: t.id, title: t.title, url: t.url })),
      });
    } catch (err) {
      unreachable.push({ port: parsed.port, reason: errorMessage(err) });
    }
  } else {
    const endpoints = await detectCdpPortsAsync();
    const preferredPort =
      endpoints.length > 0 ? pickPreferredEndpoint(endpoints, getDefaultBrowserId()).port : null;
    await Promise.all(
      endpoints.map(async (ep) => {
        try {
          const targets = await listTargets(ep.port);
          reachable.push({
            port: ep.port,
            app: ep.app,
            preferred: ep.port === preferredPort,
            pages: targets
              .filter((t) => t.type === 'page')
              .map((t) => ({ id: t.id, title: t.title, url: t.url })),
          });
        } catch (err) {
          unreachable.push({ port: ep.port, app: ep.app, reason: errorMessage(err) });
        }
      }),
    );
    // Parallel probes land in arrival order — sort for deterministic output.
    reachable.sort((a, b) => a.port - b.port);
    unreachable.sort((a, b) => a.port - b.port);
  }

  emitResult(buildTabsResult(reachable, unreachable), { json: parsed.json });
}
