import { type ParsedArgs } from '../../types.js';
import { resolveLiveTarget, clickResolved, focusAndType, typeText, type ClickDispatch, type LiveClient, type ResolutionFailure } from '../../../interact.js';
import { emitResult, fact, lineList, type FactLine } from '../../../output/render.js';
import { effectiveSettle, emitInvalidInput, pageInputDeps } from './click.js';

const MAX_STEPS = 20;
const MAX_ITERATIONS = 100;

const USAGE = `capture page repeat --steps <json> --iterations <n> [--settle <ms>] — repeat one bounded declarative click/type sequence

input:
  --steps <json>       required JSON array of 1..${MAX_STEPS} action objects, in order: {"action":"click","target":"<live target>"} or {"action":"type","text":"<text>","into":"<live target>"}; type omits into to insert into the focused element
  --iterations <n>     required repeat count from 1 to ${MAX_ITERATIONS}
  --settle <ms>        network-settle window applied after each completed sequence (default: 1000; 2500 with an active session; 0 disables)
  --target <tabId> | --url <pattern> | --port <n>  tab targeting; defaults to the active session tab
output:
  <repeated iterations=… steps=…> — one factual completion record per iteration with step action, resolved identity when applicable, dispatch coordinates, elapsed duration, and measured requested/waited settle
effects:
  drives every click through the same live target resolution and real mouse dispatch as page click, and every type through the same focused/targeted real text insertion as page type; each completed iteration receives its own action lifecycle and settle window; no automatic screenshots are written`;

type RepeatStep =
  | { readonly action: 'click'; readonly target: string }
  | { readonly action: 'type'; readonly text: string; readonly into?: string };

interface ActionRecord {
  readonly action: 'click' | 'type';
  readonly target?: string;
  readonly text?: string;
  readonly backendNodeId?: number;
  readonly role?: string;
  readonly name?: string;
  readonly x?: number;
  readonly y?: number;
  readonly focused?: boolean;
  readonly hitTestReceiverBackendNodeId?: number;
}

interface FailureRecord {
  readonly code: string;
  readonly target: string;
  readonly matches?: number;
}

interface IterationRecord {
  readonly iteration: number;
  readonly completion: 'completed' | 'failed';
  readonly durationMs: number;
  readonly settle?: { readonly requestedMs: number; readonly waitedMs: number };
  readonly actions: readonly ActionRecord[];
  readonly failure?: FailureRecord;
}

class RepeatResolutionFailure extends Error {
  constructor(readonly failure: ResolutionFailure, readonly actions: readonly ActionRecord[]) {
    super('page repeat target resolution did not complete.');
  }
}

function parseSteps(raw: string | undefined): RepeatStep[] | null {
  if (raw === undefined || raw.length > 10_000) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_STEPS) return null;
    const out: RepeatStep[] = [];
    for (const valueStep of value) {
      if (!valueStep || typeof valueStep !== 'object' || Array.isArray(valueStep)) return null;
      const step = valueStep as Record<string, unknown>;
      if (step.action === 'click' && Object.keys(step).length === 2 && typeof step.target === 'string' && step.target.length > 0) {
        out.push({ action: 'click', target: step.target });
      } else if (step.action === 'type' && Object.keys(step).every(key => key === 'action' || key === 'text' || key === 'into') && typeof step.text === 'string' && (step.into === undefined || (typeof step.into === 'string' && step.into.trim().length > 0))) {
        out.push({ action: 'type', text: step.text, ...(typeof step.into === 'string' ? { into: step.into } : {}) });
      } else return null;
    }
    return out;
  } catch {
    return null;
  }
}

function actionRecord(action: 'click' | 'type', dispatch: ClickDispatch, target: string, text?: string): ActionRecord {
  return {
    action,
    target,
    ...(text === undefined ? {} : { text }),
    backendNodeId: dispatch.backendNodeId,
    ...(dispatch.role === null ? {} : { role: dispatch.role }),
    ...(dispatch.name === null ? {} : { name: dispatch.name }),
    x: dispatch.x,
    y: dispatch.y,
    ...(action === 'type' ? { focused: true } : {}),
    ...(dispatch.hitTestReceiverBackendNodeId === undefined ? {} : { hitTestReceiverBackendNodeId: dispatch.hitTestReceiverBackendNodeId }),
  };
}

function emitRepeatResult(parsed: ParsedArgs, steps: number, settle: number, records: readonly IterationRecord[], completion: 'completed' | 'partial'): void {
  const sections: FactLine[] = records.map(record => lineList([
    record.completion === 'completed'
      ? fact`iteration ${record.iteration} completed in ${record.durationMs.toFixed(1)}ms; settle requested ${record.settle!.requestedMs}ms, waited ${record.settle!.waitedMs}ms.`
      : fact`iteration ${record.iteration} did not complete in ${record.durationMs.toFixed(1)}ms; target ${record.failure!.target} resolution returned ${record.failure!.code}${record.failure!.matches === undefined ? '' : ` with ${record.failure!.matches} live matches`}.`,
    ...record.actions.map(action => action.action === 'click'
      ? fact`click ${action.target ?? '(unknown)'} → backend:${action.backendNodeId ?? '(unknown)'}${action.role === undefined ? '' : ` role=${action.role}`}${action.name === undefined ? '' : ` name=${action.name}`} at x=${action.x ?? '(unknown)'} y=${action.y ?? '(unknown)'}${action.hitTestReceiverBackendNodeId === undefined ? '' : `; hit-test receiver backend:${action.hitTestReceiverBackendNodeId}`}`
      : action.backendNodeId === undefined
        ? fact`type into focused element: ${action.text ?? ''}`
        : fact`type into ${action.target ?? '(unknown)'} → backend:${action.backendNodeId}${action.role === undefined ? '' : ` role=${action.role}`}${action.name === undefined ? '' : ` name=${action.name}`} at x=${action.x ?? '(unknown)'} y=${action.y ?? '(unknown)'}${action.hitTestReceiverBackendNodeId === undefined ? '' : `; hit-test receiver backend:${action.hitTestReceiverBackendNodeId}`}: ${action.text ?? ''}`),
  ]));
  emitResult({
    tag: 'repeated',
    attrs: { iterations: records.length, steps, 'settle-ms': settle, completion, ...(completion === 'partial' ? { 'failed-iteration': records.at(-1)!.iteration, 'failure-code': records.at(-1)!.failure!.code } : {}) },
    summary: completion === 'completed'
      ? fact`${records.length} iteration(s) completed; each record is one ordered ${steps}-step sequence against the live tab.`
      : fact`${records.length - 1} iteration(s) completed before iteration ${records.at(-1)!.iteration} did not complete; completed action records remain in this result.`,
    sections,
    jsonSections: { iterations: records },
  }, { json: parsed.json });
  if (completion === 'partial') process.exitCode = 1;
}

export async function cmdPageRepeat(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  const steps = parseSteps(parsed.steps);
  const iterations = parsed.iterations;
  if (parsed.positional.length !== 0 || steps === null || iterations === undefined || !Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    return emitInvalidInput(parsed, 'page repeat', fact`received: ${parsed.positional.length} positional arguments, --steps=${parsed.steps === undefined ? '(missing)' : 'provided'}, --iterations=${String(iterations ?? '(missing)')}; expected no positionals, a JSON array of 1..${MAX_STEPS} click/type step objects, and an iteration count from 1 to ${MAX_ITERATIONS}.`);
  }

  const deps = pageInputDeps();
  const settle = effectiveSettle(parsed, { standalone: 1000, session: 2500 });
  const records: IterationRecord[] = [];

  for (let iteration = 1; iteration <= iterations; iteration++) {
    const started = performance.now();
    try {
      const { result, settle: settleFacts } = await deps.withPageAction(
        { ...parsed, command: 'repeat' },
        { settleMs: settle },
        async (client) => {
          const live = client as unknown as LiveClient;
          const actions: ActionRecord[] = [];
          for (const step of steps) {
            if (step.action === 'click') {
              const resolved = await resolveLiveTarget(live, step.target);
              if (!resolved.ok) throw new RepeatResolutionFailure(resolved, actions);
              const dispatch = await clickResolved(live, resolved, { inspectHitTest: true, includeHitTestReceiver: true });
              actions.push(actionRecord('click', dispatch, step.target));
            } else if (step.into !== undefined) {
              const resolved = await resolveLiveTarget(live, step.into);
              if (!resolved.ok) throw new RepeatResolutionFailure(resolved, actions);
              const dispatch = await focusAndType(live, resolved, step.text, { inspectHitTest: true, includeHitTestReceiver: true });
              actions.push(actionRecord('type', dispatch, step.into, step.text));
            } else {
              await typeText(live, step.text);
              actions.push({ action: 'type', text: step.text, focused: true });
            }
          }
          return { actions } as const;
        },
      );
      records.push({ iteration, completion: 'completed', durationMs: performance.now() - started, settle: { requestedMs: settleFacts.requestedMs, waitedMs: settleFacts.waitedMs }, actions: result.actions });
    } catch (error) {
      if (!(error instanceof RepeatResolutionFailure)) throw error;
      const failure = error.failure;
      const failureRecord: FailureRecord = {
        code: failure.code,
        target: failure.input,
        ...('matchCount' in failure ? { matches: failure.matchCount } : {}),
      };
      records.push({ iteration, completion: 'failed', durationMs: performance.now() - started, actions: error.actions, failure: failureRecord });
      return emitRepeatResult(parsed, steps.length, settle, records, 'partial');
    }
  }

  emitRepeatResult(parsed, steps.length, settle, records, 'completed');
}
