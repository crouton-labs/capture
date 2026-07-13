/**
 * `capture tab open <url> [--new] [--port <port>]` — open a URL in the
 * browser (reusing a matching tab unless `--new`) and report the tab's
 * identity as a `<tab-opened>` block. Page-derived title/url strings flow
 * through `data()` (I-9).
 */
import { detectCdpPort } from '../../detect.js';
import { captureError, invalidInput } from '../../../errors.js';
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

  // Positional cardinality (exactly 1) is enforced by `validateCliInvocation`
  // before dispatch reaches this leaf; this guard covers direct programmatic
  // callers only. Failures cross the boundary as typed CaptureErrors —
  // capture.ts is the sole renderer/exit-status owner.
  const url = parsed.positional[0];
  if (!url) {
    throw invalidInput('received: no URL; expected: capture tab open <url> [--new] [--port <port>].', 'missing_argument');
  }

  let port: number;
  try {
    port = parsed.port ?? (await detectCdpPort());
  } catch {
    throw captureError(
      'world',
      'no_cdp_endpoint',
      'received: no --port, and no CDP endpoint was discovered on localhost; expected: a running CDP-enabled browser (or an explicit --port <port>). capture tab list probes every localhost CDP endpoint.',
    );
  }

  let tab: CDPTarget;
  try {
    tab = await navigateAndWait(port, url, { forceNew: parsed.new });
  } catch (err) {
    throw captureError('world', 'open_failed', `received: \`${url}\`; opening it on port ${port} failed: ${errorMessage(err)}`, err);
  }

  emitResult(buildTabOpenedResult(tab, port), { json: parsed.json });
}
