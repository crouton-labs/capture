/**
 * `capture tab launch [--url <url>] [--port <port>] [--headed]` — start a
 * browser capture owns, and report the endpoint every other capture command can
 * now be pointed at.
 *
 * This is the answer to "a CDP-enabled browser must be running": without it the
 * only way to satisfy that precondition was a hand-rolled detached Chrome with
 * an invented port and an invented scratch profile, which nothing ever reaped.
 * Ownership, registry, and reaping all live in `../../browser-process.ts`; this
 * leaf is the surface over them.
 */
import { launchOwnedBrowser, sweepOwnedBrowsers, IDLE_REAP_MS } from '../../browser-process.js';
import { type ParsedArgs } from '../../types.js';
import { data, emitResult, fact, line, lineList, text, type RenderableResult } from '../../../output/render.js';

const USAGE = `capture tab launch — start a browser capture owns and report its CDP endpoint.

input:
  --url <url>     first page to open (default: about:blank)
  --port <port>   pin the debugging port (default: a free port chosen by the kernel)
  --headed        run with a visible window instead of headless

output: <browser-launched port=… pid=…> — the port to pass as --port (or CDP_PORT), the pid capture owns, and the executable that answered with its provenance (CAPTURE_BROWSER, puppeteer-cache, or system).
effects: spawns a detached browser with a private profile under CAPTURE_ROOT, and registers it as capture-owned. Capture stops it on \`capture tab quit\`, or on the first later capture invocation once it has been unused for ${IDLE_REAP_MS / 60000} minutes; a browser capture did not start is never signalled. Also sweeps previously-launched browsers that have exited, stopped answering CDP, or gone idle.`;

/** Pure `<browser-launched>` result builder — exported for tests. */
export function buildBrowserLaunchedResult(
  browser: { port: number; pid: number; executablePath: string; source: string; headless: boolean },
  swept: number,
): RenderableResult {
  const sections = [
    lineList([
      line(text`executable `, data(browser.executablePath, 300), text` (`, data(browser.source), text`)`),
      line(text`mode `, data(browser.headless ? 'headless' : 'headed')),
    ]),
  ];
  if (swept > 0) sections.push(fact`swept ${swept} previously-launched browser(s) that had exited, stopped answering CDP, or gone idle.`);
  return {
    tag: 'browser-launched',
    attrs: { port: browser.port, pid: browser.pid, headless: browser.headless },
    summary: line(
      text`capture-owned browser on port `,
      data(browser.port),
      fact` (pid ${browser.pid}) is answering CDP.`,
    ),
    sections,
    followUp: line(text`capture session start --port `, data(browser.port)),
  };
}

export async function cmdTabLaunch(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const swept = await sweepOwnedBrowsers();
  const browser = await launchOwnedBrowser({
    url: parsed.url,
    port: parsed.port,
    headless: !parsed.headed,
  });

  emitResult(
    buildBrowserLaunchedResult(
      // A launched browser always reports a port — `launchOwnedBrowser` only
      // returns once its endpoint answered on one.
      { ...browser, port: browser.port! },
      swept.length,
    ),
    { json: parsed.json },
  );
}
