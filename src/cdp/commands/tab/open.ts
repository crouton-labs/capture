/**
 * `capture tab open <url> [--new] [--port <port>]` — open a URL in the
 * browser (reusing a matching tab unless `--new`) and report the tab's
 * identity as a `<tab-opened>` block. Page-derived title/url strings flow
 * through `data()` (I-9).
 */
import { detectCdpPort } from '../../detect.js';
import { navigateAndWait } from '../../record.js';
import { type CDPTarget, type ParsedArgs } from '../../types.js';
import {
  data,
  emitResult,
  fact,
  line,
  text,
  type RenderableResult,
} from '../../../output/render.js';

const USAGE = `capture tab open — open a URL in the browser and report the tab's target id.

input:
  <url>           required — the URL to open; an existing tab already at it is reused unless --new
  --new           always create a fresh background tab instead of reusing a matching one
  --port <port>   CDP endpoint (default: the auto-discovered preferred endpoint)

output: <tab-opened port=… target=…> — the tab's target id (first 8 chars are enough for --target), title, and url.
effects: opens (or reuses) a background browser tab and waits up to 10s for its load event.`;

/** Pure `<tab-opened>` result builder — exported for tests. */
export function buildTabOpenedResult(tab: CDPTarget, port: number): RenderableResult {
  return {
    tag: 'tab-opened',
    attrs: { port, target: tab.id },
    summary: line(
      text`tab `,
      data(tab.id.slice(0, 8)),
      text`: "`,
      data(tab.title, 120),
      text`"  `,
      data(tab.url, 300),
    ),
    followUp: line(
      text`capture page shot --port `,
      data(port),
      text` --target `,
      data(tab.id.slice(0, 8)),
    ),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function cmdTabOpen(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const url = parsed.positional[0];
  if (!url) {
    emitResult(
      {
        tag: 'error',
        attrs: { command: 'tab open', code: 'missing_argument' },
        summary: text`received: no URL; expected: capture tab open <url> [--new] [--port <port>].`,
      },
      { json: parsed.json },
    );
    process.exit(1);
  }

  let port: number;
  try {
    port = parsed.port ?? (await detectCdpPort());
  } catch {
    emitResult(
      {
        tag: 'error',
        attrs: { command: 'tab open', code: 'no_cdp_endpoint' },
        summary: text`received: no --port, and no CDP endpoint was discovered on localhost; expected: a running CDP-enabled browser (or an explicit --port <port>).`,
        followUp: text`capture tab list probes every localhost CDP endpoint.`,
      },
      { json: parsed.json },
    );
    process.exit(1);
  }

  let tab: CDPTarget;
  try {
    tab = await navigateAndWait(port, url, { forceNew: parsed.new });
  } catch (err) {
    emitResult(
      {
        tag: 'error',
        attrs: { command: 'tab open', code: 'open_failed', port },
        summary: fact`received: \`${url}\`; opening it on port ${port} failed: ${errorMessage(err)}`,
      },
      { json: parsed.json },
    );
    process.exit(1);
  }

  emitResult(buildTabOpenedResult(tab, port), { json: parsed.json });
}
