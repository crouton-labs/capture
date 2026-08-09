/**
 * `capture tab quit [<port>] [--all]` — stop browsers capture started.
 *
 * Named `quit` rather than `close` deliberately: `capture tab close` closes one
 * TAB inside a browser, this ends the browser process itself. It reaches only
 * browsers in capture's own registry, verified by PID birth — a port capture
 * never launched (the user's own browser, or one an agent started by hand)
 * matches nothing here and is never signalled.
 */
import { quitOwnedBrowsers, sweepOwnedBrowsers, type ReapedBrowser } from '../../browser-process.js';
import { invalidInput } from '../../../errors.js';
import { type ParsedArgs } from '../../types.js';
import { data, emitResult, fact, line, lineList, text, type RenderableResult } from '../../../output/render.js';

const USAGE = `capture tab quit — stop a browser capture started.

input:
  <port>          the port of a capture-launched browser (as reported by tab launch / tab list)
  --all           stop every browser capture launched

output: <browser-quit stopped=…> — one line per stopped browser (port, pid) and the reason it ended.
effects: SIGTERM (then SIGKILL if needed) to capture-launched browsers only, verified by process-birth identity, and removes their private profiles. A browser capture did not start is never signalled — a port with no capture record stops nothing.`;

/** Pure `<browser-quit>` result builder — exported for tests. */
export function buildBrowserQuitResult(stopped: readonly ReapedBrowser[], selector: string): RenderableResult {
  return {
    tag: 'browser-quit',
    attrs: { stopped: stopped.length },
    summary:
      stopped.length === 0
        ? line(text`no capture-launched browser matched `, data(selector), text`; nothing was signalled.`)
        : fact`stopped ${stopped.length} capture-launched browser(s).`,
    sections:
      stopped.length === 0
        ? []
        : [
            lineList(
              stopped.map((browser) =>
                line(
                  text`port `,
                  data(browser.port ?? 'unstarted'),
                  fact`  pid ${browser.pid}  `,
                  data(browser.reason),
                ),
              ),
            ),
          ],
  };
}

export async function cmdTabQuit(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const token = parsed.positional[0];
  if (!parsed.all && token === undefined) {
    throw invalidInput('received: no target; expected: capture tab quit <port> or capture tab quit --all.', 'missing_argument');
  }
  if (parsed.all && token !== undefined) {
    throw invalidInput('received: both a port and --all; expected: one or the other.');
  }
  if (token !== undefined && !/^\d+$/.test(token)) {
    throw invalidInput(`Invalid port: ${token}.`);
  }
  const port = token === undefined ? undefined : Number(token);

  // The sweep runs first so a browser that already exited is reported as
  // reaped rather than as "no match" for the port the caller remembered.
  const swept = await sweepOwnedBrowsers();
  const stopped = await quitOwnedBrowsers({ port, all: parsed.all });
  const matchedSweep = swept.filter((browser) => parsed.all || browser.port === port);

  emitResult(buildBrowserQuitResult([...stopped, ...matchedSweep], parsed.all ? '--all' : String(port)), {
    json: parsed.json,
  });
}
