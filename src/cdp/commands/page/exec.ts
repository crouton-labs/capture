/**
 * `page exec <code> | --file <path>` — run arbitrary JavaScript in the tab.
 *
 * A bare expression evaluates directly; a statement body may use top-level
 * `return`/`await` (wrapped in an async IIFE by `buildExecExpression`);
 * leading static imports bundle the forked vault libs before any CDP
 * connection is opened (fail fast). The JSON-serialized return value is
 * rendered inline in the `<exec-result>` block under a generous cap; a
 * result exceeding the cap is additionally written WHOLE to a private
 * artifact file — the active session's `page/` dir when a session exists,
 * else a one-shot artifact dir (`createOneshotSession('page')`), never a
 * loose `/tmp` file — and the block carries that file's absolute path.
 * `--json` mirrors the block with the value at full fidelity. During a live
 * composed recording the CDP routes through the recorder socket unmarked
 * (`Runtime.evaluate` is never a landmark).
 */
import * as fs from 'fs';
import * as path from 'path';
import { type ParsedArgs } from '../../types.js';
import { withPageAction, type SettleFacts } from '../../connection.js';
import { CaptureError, captureError } from '../../../errors.js';
import { buildExecExpression } from '../../exec-expression.js';
import { getActiveSession } from '../../../session-context.js';
import { createOneshotSession } from '../../../session/commands.js';
import { writePrivateFile } from '../../../session/artifacts.js';
import { withScopeSerialization } from '../../scope-lock.js';
import { isRecorderHeldClient } from '../../recorder-client.js';
import { hasImports, bundleExec } from '../../../vault/bundle.js';
import {
  capped,
  data,
  emitResult,
  fact,
  line,
  text,
  type FactLine,
} from '../../../output/render.js';

/** Generous inline cap for the serialized result value: big enough for a
 * typical scrape/query result, still bounded in the prose block. `--json`
 * carries the value uncapped (full fidelity); a result larger than this is
 * also spilled whole to an artifact file. */
const GENEROUS_RESULT_CAP = 4000;

const DEFAULT_SETTLE_MS = 3000;

const USAGE = `capture page exec <code> | --file <path> — run arbitrary JavaScript in the tab: a bare expression evaluates directly; a statement body may use top-level return/await (wrapped in an async IIFE); leading static imports bundle the forked vault libs (dev checkout only)

input:
  <code>           JS source as one argument (exactly one of <code> / --file)
  --file <path>    read the JS source from a file instead of inline
  --settle <ms>    network-settle window after execution so an active session's HAR captures the requests the code triggers (default: ${DEFAULT_SETTLE_MS}; 0 disables); the block reports the measured requested/waited settle
  --target <id>    target a tab explicitly (default: the active session tab; with no active session, --target or --url is required)
  --url <pattern>  target the first tab whose URL matches <pattern>
output:
  <exec-result result-chars=…> — the JSON-serialized return value inline, escaped and capped at ${GENEROUS_RESULT_CAP} chars; a larger result is also written whole to a private artifact file (the active session's page/ dir, else a one-shot artifact dir) whose absolute path appears in the block. --json mirrors the same block with the value at full fidelity.
effects:
  runs the code in the page with full DOM/JS access — whatever the code mutates, it mutates; emulates focus on the tab for the duration of the call (disabled again before the command returns); writes the oversize-result artifact file when the inline cap is exceeded`;

// ---------------------------------------------------------------------------
// Test-injectable dependency seam (repo CDP-stub pattern — see
// `test/page-exec.test.ts`).
// ---------------------------------------------------------------------------

export interface PageExecDeps {
  withPageAction: typeof withPageAction;
  getActiveSession: typeof getActiveSession;
  createOneshotSession: typeof createOneshotSession;
  isRecorderHeldClient: typeof isRecorderHeldClient;
}

let deps: PageExecDeps = { withPageAction, getActiveSession, createOneshotSession, isRecorderHeldClient };

/** Swap the connection/session seams for the CDP-stub tests. */
export function __setPageExecDepsForTest(overrides: Partial<PageExecDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...overrides };
  return () => { deps = previous; };
}

function emitExecError(parsed: ParsedArgs, code: string, summary: FactLine, followUp?: FactLine): void {
  emitResult(
    { tag: 'error', attrs: { command: 'page exec', code }, summary, followUp },
    { json: parsed.json },
  );
  process.exitCode = 1;
}

/**
 * Writes an over-cap result whole to a private (0600) artifact file: into
 * the active session's `page/` dir when a session exists, else into a fresh
 * one-shot artifact dir. Returns the absolute file path.
 */
function spillWholeResult(payload: string): string {
  const name = `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.json`;
  const session = deps.getActiveSession();
  const filePath = session
    ? path.join(session.dir, 'page', name)
    : path.join(deps.createOneshotSession('page').artifactsDir, name);
  writePrivateFile(filePath, payload);
  return filePath;
}

interface EvalResult {
  result?: { value?: unknown };
  exceptionDetails?: { exception?: { description?: string } };
}

/** The structural client surface the focus/evaluation scope drives — the
 * subset of `CDPClient` both a direct connection and the recorder-held
 * adapter satisfy. */
interface ExecClient {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/**
 * The one focus-emulation state transaction: focus true → evaluate → focus
 * false. A lost enable response does not prove Chrome rejected the override,
 * so restoration ownership is claimed BEFORE the enable is awaited and the
 * matching disable is always sent exactly once in `finally`. A disable
 * failure prevents success: alone it throws a typed cleanup failure; paired
 * with a primary failure it throws an `AggregateError` preserving both.
 */
async function focusScopedEvaluate(client: ExecClient, expression: string): Promise<EvalResult> {
  let ownsFocusOverride = false;
  let primaryFailed = false;
  let primaryError: unknown;
  try {
    // Emulate focus so network requests the code triggers aren't deferred
    // by the browser, without foregrounding the tab.
    ownsFocusOverride = true;
    await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    return (await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as EvalResult;
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
    throw error;
  } finally {
    if (ownsFocusOverride) {
      try {
        await client.send('Emulation.setFocusEmulationEnabled', { enabled: false });
      } catch (error) {
        const cleanupError = captureError(
          'cleanup',
          'focus_cleanup_failed',
          'Emulation.setFocusEmulationEnabled(false) failed after page exec — the tab may retain a focus-emulation override.',
          error,
        );
        if (primaryFailed) {
          throw new AggregateError(
            [primaryError, cleanupError],
            'page exec failed and focus-emulation cleanup also failed.',
            { cause: primaryError },
          );
        }
        throw cleanupError;
      }
    }
  }
}

/**
 * Runs the focus/evaluation scope, serialized when the connection is the
 * recorder-held one. The recorder holds ONE persistent tab connection whose
 * focus-emulation state outlives any single command, so two concurrent
 * routed execs could otherwise clear one another's live override; the
 * entire three-request scope therefore runs under the owning session's
 * `.focus-scope.lock` via the shared scope-serialization authority
 * (`../../scope-lock.js`), passing this module's injectable seams so the
 * test-controlled deps govern the held/session branch. A direct connection
 * needs no lock — its emulation state is scoped to its own websocket
 * session, which closes with the command.
 */
async function evaluateWithFocusEmulation(client: ExecClient, expression: string): Promise<EvalResult> {
  return withScopeSerialization(
    client,
    'focus',
    'page exec',
    () => focusScopedEvaluate(client, expression),
    { isRecorderHeldClient: deps.isRecorderHeldClient, getActiveSession: deps.getActiveSession },
  );
}

export async function cmdPageExec(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  let code: string;
  if (parsed.file !== undefined) {
    if (parsed.positional.length > 0) {
      return emitExecError(
        parsed,
        'invalid_input',
        text`received: both inline <code> and --file; expected exactly one source of JS to run.`,
      );
    }
    try {
      code = fs.readFileSync(parsed.file, 'utf-8');
    } catch (err) {
      return emitExecError(
        parsed,
        'file_unreadable',
        fact`received: --file ${parsed.file} which could not be read (${err instanceof Error ? err.message : String(err)}); expected: a readable JS source file.`,
      );
    }
  } else {
    if (parsed.positional.length !== 1 || !parsed.positional[0]) {
      return emitExecError(
        parsed,
        'invalid_input',
        fact`received: ${parsed.positional.length} positional arguments; expected exactly one <code> argument (or --file <path>).`,
      );
    }
    code = parsed.positional[0];
  }

  // Import-driven exec: leading static imports bundle the forked vault libs
  // on the fly (esbuild) BEFORE opening a tab — fail fast, no wasted CDP
  // connection. Plain exec (no imports) skips this entirely.
  let prebuilt: string | undefined;
  if (hasImports(code)) {
    try {
      prebuilt = await bundleExec(code);
    } catch (err) {
      return emitExecError(
        parsed,
        'bundle_failed',
        fact`vault import bundling failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const settle = parsed.settle ?? DEFAULT_SETTLE_MS;

  // A prebuilt bundle is already a complete IIFE returning the user's
  // promise; otherwise buildExecExpression wraps statement bodies. Pure
  // string work — built before any connection is opened.
  const expression = buildExecExpression(code, prebuilt);

  let evalResult: EvalResult;
  let settleFacts: SettleFacts;
  try {
    // connection.ts derives its per-invocation label from parsed.command,
    // which the router leaves as the branch token 'page' — restore the verb
    // so a routed exec is labeled `exec:…`. Runtime.evaluate is never a
    // markable method, so the routed call stays unmarked in events.jsonl.
    const outcome = await deps.withPageAction(
      { ...parsed, command: 'exec' },
      { settleMs: settle },
      (client) => evaluateWithFocusEmulation(client, expression),
    );
    evalResult = outcome.result;
    settleFacts = outcome.settle;
  } catch (err) {
    // A typed failure (e.g. `recorder_unavailable` from strict A2 routing,
    // `har_missing`, or a lone `focus_cleanup_failed`) crosses the boundary
    // unrelabeled — only a genuinely untyped error is the exec-specific
    // `exec_failed`.
    if (err instanceof CaptureError) throw err;
    if (err instanceof AggregateError && err.errors.length === 2) {
      // The primary+disable dual failure — preserve both facts distinctly.
      const message = (value: unknown) => (value instanceof Error ? value.message : String(value));
      return emitExecError(
        parsed,
        'exec_failed',
        fact`execution failed (${message(err.errors[0])}) and focus-emulation cleanup also failed (${message(err.errors[1])})`,
      );
    }
    return emitExecError(
      parsed,
      'exec_failed',
      fact`execution failed: ${err instanceof Error ? err.message : String(err)}`,
      text`Check a CDP-enabled browser is running and a tab is targetable (probe: capture tab list).`,
    );
  }

  if (evalResult.exceptionDetails) {
    const description = evalResult.exceptionDetails.exception?.description ?? 'Unknown error';
    return emitExecError(
      parsed,
      'exec_exception',
      line(text`the page threw during execution: `, data(capped(description, GENEROUS_RESULT_CAP))),
    );
  }

  const payload = JSON.stringify(evalResult.result?.value) ?? 'undefined';

  let spillPath: string | undefined;
  if (payload.length > GENEROUS_RESULT_CAP) {
    spillPath = spillWholeResult(payload);
  }

  const inlineCap = parsed.json ? payload.length : GENEROUS_RESULT_CAP;
  const sections: FactLine[] = [line(text`result: `, data(capped(payload, inlineCap)))];
  if (spillPath) {
    sections.push(fact`full result (${payload.length} chars) written whole to ${spillPath}`);
  }
  sections.push(fact`settle: requested ${settleFacts.requestedMs}ms, waited ${settleFacts.waitedMs}ms`);

  emitResult(
    {
      tag: 'exec-result',
      attrs: {
        'result-chars': payload.length,
        'result-file': spillPath,
      },
      sections,
    },
    { json: parsed.json },
  );
}
