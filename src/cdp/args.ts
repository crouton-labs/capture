import { invalidInput } from '../errors.js';
import { getActiveSession } from '../session-context.js';
import { type ParsedArgs } from './types.js';
import { assertParseableUrl, assertScrollDestination, assertSweepBounds, parsePositiveNumber, parseDoAction, type SweepAxisName } from './leaf-grammar.js';

export function expandEqualsFlags(argv: string[]): string[] {
  const out: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=');
      out.push(arg.slice(0, eq), arg.slice(eq + 1));
    } else out.push(arg);
  }
  return out;
}

const VALUE_FLAGS = new Set([
  '--port', '--out', '--duration', '--settle', '--file', '--target', '--url', '--into', '--viewport', '--session',
  '--filter', '--name', '--filter-url', '--filter-status', '--filter-method', '--limit', '--params', '--wait-event',
  '--timeout', '--socket', '--settle-timeout', '--state', '--for', '--before', '--after', '--snap', '--set-file',
  '--axis', '--from', '--to', '--viewport-height', '--rec-id', '--selector', '--do', '--element', '--prop', '--action', '--occurrence',
]);

function valueFor(flag: string, next: string | undefined): string {
  if (next === undefined || next.startsWith('--')) throw invalidInput(`${flag} requires a value.`);
  return next;
}

function integer(token: string, flag: string, min: number, max: number, safe = false): number {
  // Full unsigned decimal integer grammar (leading zeros allowed); no sign,
  // exponent, decimal point, partial token, or non-finite value.
  if (!/^\d+$/.test(token)) throw invalidInput(`Invalid ${flag}: ${token}.`);
  const value = Number(token);
  if (!Number.isInteger(value) || value < min || value > max || (safe && !Number.isSafeInteger(value))) {
    throw invalidInput(`Invalid ${flag}: ${token}.`);
  }
  return value;
}

function durationMs(token: string): number {
  // Full unsigned decimal-seconds grammar (`1`, `1.`, `.5`, `00.5`); no sign,
  // exponent, partial token, or non-finite value. Compare the decimal token
  // before Number conversion so precision rounding cannot admit an overflow.
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(token)) throw invalidInput(`Invalid --duration: ${token}.`);
  const [whole = '', fraction = ''] = token.split('.');
  const normalizedWhole = whole.replace(/^0+/, '') || '0';
  const maxWhole = '2147483';
  const wholeComparison = normalizedWhole.length - maxWhole.length || normalizedWhole.localeCompare(maxWhole);
  const maxFraction = '647';
  const fractionComparison = fraction.slice(0, maxFraction.length).padEnd(maxFraction.length, '0').localeCompare(maxFraction);
  if (wholeComparison > 0 || (wholeComparison === 0 && (fractionComparison > 0 || (fractionComparison === 0 && /[1-9]/.test(fraction.slice(maxFraction.length)))))) {
    throw invalidInput(`Invalid --duration: ${token}.`);
  }
  return Number(token) * 1000;
}

function validateKnownLeaf(command: string, positional: readonly string[]): void {
  const leaf = positional[0];
  if (leaf === undefined) return;
  const branches: Record<string, readonly string[]> = {
    session: ['start', 'stop', 'list', 'view', 'har', 'log'],
    page: ['click', 'type', 'scroll', 'navigate', 'exec', 'shot', 'elements'],
    tab: ['list', 'open', 'close', 'reset', 'network'],
    measure: ['snap', 'check', 'diff', 'census', 'explain', 'sweep', 'map'],
    motion: ['rec', 'mask', 'timeline', 'jank', 'response'],
    lib: ['list', 'search', 'show', 'read'],
  };
  const known = branches[command];
  if (known && !known.includes(leaf)) throw invalidInput(`Unknown ${command} leaf: ${leaf}.`, 'unknown_command');
  if (command === 'measure' && leaf === 'map' && positional[1] !== undefined) {
    const mapLeaf = positional[1];
    if (!['focus', 'scroll', 'layers', 'ax'].includes(mapLeaf)) throw invalidInput(`Unknown measure map leaf: ${mapLeaf}.`, 'unknown_command');
  }
}

function requireCount(values: readonly string[], min: number, max: number, command: string): void {
  if (values.length < min || values.length > max) {
    const expected = min === max ? `exactly ${min}` : `${min}..${max}`;
    throw invalidInput(`${command} received ${values.length} positional argument(s); expected ${expected}.`);
  }
}

/** Pure branch/leaf validation. It must stay before session and environment resolution. */
export function validateCliInvocation(parsed: ParsedArgs): void {
  validateKnownLeaf(parsed.command, parsed.positional);
  if (parsed.help) return;
  if (parsed.command === 'cdp') {
    requireCount(parsed.positional, 0, 1, 'cdp');
    if (parsed.positional.length === 0 && !parsed.waitEvent) throw invalidInput('cdp requires a method or --wait-event.');
    if (parsed.params !== undefined) {
      try {
        const value = JSON.parse(parsed.params) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
      } catch {
        throw invalidInput('--params must be a JSON object.');
      }
    }
    return;
  }
  if (parsed.positional[0] === undefined) return;

  const leaf = parsed.positional[0];
  const values = parsed.positional.slice(1);
  if (parsed.command === 'session') {
    const ranges: Record<string, readonly [number, number]> = {
      start: [0, 0], stop: [1, 1], list: [0, 0], view: [1, 1], har: [0, 1], log: [1, 1],
    };
    const [min, max] = ranges[leaf];
    requireCount(values, min, max, `session ${leaf}`);
    return;
  }

  if (parsed.command === 'page') {
    if (leaf === 'click' || leaf === 'type' || leaf === 'navigate') requireCount(values, 1, 1, `page ${leaf}`);
    if (leaf === 'navigate') assertParseableUrl(values[0], 'URL');
    if (leaf === 'scroll') {
      requireCount(values, 1, 1, 'page scroll');
      if (parsed.to === undefined) throw invalidInput('page scroll requires --to <top|bottom|px>.');
      assertScrollDestination(parsed.to);
    }
    if (leaf === 'exec') requireCount(values, parsed.file === undefined ? 1 : 0, parsed.file === undefined ? 1 : 0, 'page exec');
    if (leaf === 'shot' || leaf === 'elements') requireCount(values, 0, 0, `page ${leaf}`);
    if (leaf === 'shot' && parsed.viewport !== undefined) {
      const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(parsed.viewport);
      if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2]))) {
        throw invalidInput(`Invalid --viewport: ${parsed.viewport}.`);
      }
    }
    return;
  }

  if (parsed.command === 'tab') {
    requireCount(values, leaf === 'list' ? 0 : 1, leaf === 'list' ? 0 : 1, `tab ${leaf}`);
    if (leaf === 'network' && values[0] !== 'offline' && values[0] !== 'online') {
      throw invalidInput('tab network requires offline or online.');
    }
    return;
  }

  if (parsed.command === 'measure') {
    if (leaf === 'snap' || leaf === 'check' || leaf === 'sweep') requireCount(values, 0, 1, `measure ${leaf}`);
    if (leaf === 'diff' || leaf === 'census') requireCount(values, 0, 0, `measure ${leaf}`);
    if (leaf === 'diff' && (!parsed.before || !parsed.after)) throw invalidInput('measure diff requires --before and --after.');
    if (leaf === 'census' && !['color', 'font', 'spacing', 'radius', 'shadow', 'animation', 'geometry', 'media', 'queries'].includes(parsed.axis ?? '')) {
      throw invalidInput('measure census requires a documented --axis value.');
    }
    if (leaf === 'explain') {
      requireCount(values, 1, 1, 'measure explain');
      if (!parsed.selector?.trim()) throw invalidInput('measure explain requires --selector.');
    }
    if (leaf === 'sweep') {
      if (!['width', 'dpr', 'zoom', 'color-scheme', 'reduced-motion'].includes(parsed.axis ?? '')) {
        throw invalidInput('measure sweep requires a documented --axis value.');
      }
      assertSweepBounds(parsed.axis as SweepAxisName, parsed.from, parsed.to);
      if (parsed.viewportHeight !== undefined) parsePositiveNumber(parsed.viewportHeight, 1, '--viewport-height');
    }
    if (leaf === 'map') {
      const mapLeaf = values[0];
      if (mapLeaf === undefined) return;
      const targets = values.slice(1);
      requireCount(targets, mapLeaf === 'focus' || mapLeaf === 'ax' ? 1 : 0, 1, `measure map ${mapLeaf}`);
    }
    return;
  }

  if (parsed.command === 'motion') {
    if (leaf === 'mask' || leaf === 'jank' || leaf === 'response') requireCount(values, 1, 1, `motion ${leaf}`);
    if (leaf === 'timeline') {
      requireCount(values, 1, 1, 'motion timeline');
      if (!parsed.element?.trim()) throw invalidInput('motion timeline requires --element.');
    }
    if (leaf === 'rec') {
      if (parsed.start && parsed.stop) throw invalidInput('motion rec cannot combine --start and --stop.');
      if (!parsed.stop && parsed.recId) throw invalidInput('motion rec accepts --rec-id only with --stop.');
      if (parsed.start || parsed.stop) {
        requireCount(values, 0, 0, 'motion rec lifecycle');
        if (parsed.do || parsed.duration !== undefined || (parsed.stop && parsed.viewport !== undefined)) {
          throw invalidInput('motion rec lifecycle flags cannot be combined with one-shot flags.');
        }
      } else {
        // The URL is optional: omitting it records the active session tab
        // (enforced downstream once session state is known — this pure
        // validator only bounds cardinality at 0..1 and checks a supplied URL).
        requireCount(values, 0, 1, 'motion rec');
        if (!parsed.do) throw invalidInput('motion rec one-shot requires --do.');
        if (values[0] !== undefined) assertParseableUrl(values[0], 'recording URL');
        parseDoAction(parsed.do);
      }
      if (parsed.viewport !== undefined) {
        const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(parsed.viewport);
        if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2]))) {
          throw invalidInput(`Invalid --viewport: ${parsed.viewport}.`);
        }
      }
    }
    return;
  }

  if (parsed.command === 'lib') {
    if (leaf === 'list') requireCount(values, 0, 0, 'lib list');
    if (leaf === 'search' || leaf === 'show') requireCount(values, 1, 1, `lib ${leaf}`);
    if (leaf === 'read') requireCount(values, 1, Number.MAX_SAFE_INTEGER, 'lib read');
  }
}

/** Pure syntax/provenance parsing: no session or environment reads. */
export function parseCliSyntax(argv: string[]): ParsedArgs {
  const command = argv[0] ?? '';
  const rest = expandEqualsFlags(argv.slice(1));
  const positional: string[] = [];
  const parsed: Partial<ParsedArgs> = { command, positional };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = rest[i + 1];
    if (VALUE_FLAGS.has(arg)) valueFor(arg, next);

    if (arg === '--port') { parsed.port = integer(valueFor(arg, next), '--port', 1, 65535); parsed.portSource = 'flag'; i++; }
    else if (arg === '--out') { parsed.out = valueFor(arg, next); i++; }
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--duration') { parsed.duration = durationMs(valueFor(arg, next)); i++; }
    else if (arg === '--settle') { parsed.settle = integer(valueFor(arg, next), '--settle', 0, 2_147_483_647); i++; }
    else if (arg === '--file') { parsed.file = valueFor(arg, next); i++; }
    else if (arg === '--new') parsed.new = true;
    else if (arg === '--target') { parsed.target = valueFor(arg, next); parsed.targetSource = 'flag'; i++; }
    else if (arg === '--url') { const value = valueFor(arg, next); parsed.url = value; (parsed.urls ??= []).push(value); i++; }
    else if (arg === '--into') { parsed.into = valueFor(arg, next); i++; }
    else if (arg === '--no-screenshot') parsed.noScreenshot = true;
    else if (arg === '--viewport') { const value = valueFor(arg, next); parsed.viewport = value; (parsed.viewports ??= []).push(value); i++; }
    else if (arg === '--full-page') parsed.fullPage = true;
    else if (arg === '--all') parsed.all = true;
    else if (arg === '--session') { parsed.session = valueFor(arg, next); i++; }
    else if (arg === '--hold') parsed.hold = true;
    else if (arg === '--filter') { parsed.filter = valueFor(arg, next); i++; }
    else if (arg === '--name') { parsed.name = valueFor(arg, next); i++; }
    else if (arg === '--filter-url') { parsed.filterUrl = valueFor(arg, next); i++; }
    else if (arg === '--filter-status') { parsed.filterStatus = valueFor(arg, next); i++; }
    else if (arg === '--filter-method') { parsed.filterMethod = valueFor(arg, next).toUpperCase(); i++; }
    else if (arg === '--limit') { parsed.limit = integer(valueFor(arg, next), '--limit', 1, Number.MAX_SAFE_INTEGER, true); i++; }
    else if (arg === '--browser') parsed.browser = true;
    else if (arg === '--params') { parsed.params = valueFor(arg, next); i++; }
    else if (arg === '--wait-event') { parsed.waitEvent = valueFor(arg, next); i++; }
    else if (arg === '--timeout') { parsed.timeoutMs = integer(valueFor(arg, next), '--timeout', 1, 2_147_483_647); i++; }
    else if (arg === '--socket') { parsed.socket = valueFor(arg, next); i++; }
    else if (arg === '--freeze-animations') parsed.freezeAnimations = true;
    else if (arg === '--settle-timeout') { parsed.settleTimeout = integer(valueFor(arg, next), '--settle-timeout', 1, 2_147_483_647); i++; }
    else if (arg === '--capture-unsettled') parsed.captureUnsettled = true;
    else if (arg === '--pixels') parsed.pixels = true;
    else if (arg === '--state') { (parsed.state ??= []).push(valueFor(arg, next)); i++; }
    else if (arg === '--for') { parsed.for = valueFor(arg, next); i++; }
    else if (arg === '--before') { parsed.before = valueFor(arg, next); i++; }
    else if (arg === '--after') { parsed.after = valueFor(arg, next); i++; }
    else if (arg === '--full') parsed.full = true;
    else if (arg === '--gate') parsed.gate = true;
    else if (arg === '--snap') { (parsed.snap ??= []).push(valueFor(arg, next)); i++; }
    else if (arg === '--set-file') { parsed.setFile = valueFor(arg, next); i++; }
    else if (arg === '--axis') { parsed.axis = valueFor(arg, next); i++; }
    else if (arg === '--from') { parsed.from = valueFor(arg, next); i++; }
    else if (arg === '--to') { parsed.to = valueFor(arg, next); i++; }
    else if (arg === '--viewport-height') { parsed.viewportHeight = valueFor(arg, next); i++; }
    else if (arg === '--rec-id') { parsed.recId = valueFor(arg, next); i++; }
    else if (arg === '--selector') { parsed.selector = valueFor(arg, next); i++; }
    else if (arg === '--size') parsed.size = true;
    else if (arg === '--text') parsed.text = true;
    else if (arg === '--form') parsed.form = true;
    else if (arg === '--start') parsed.start = true;
    else if (arg === '--stop') parsed.stop = true;
    else if (arg === '--do') { parsed.do = valueFor(arg, next); i++; }
    else if (arg === '--element') { parsed.element = valueFor(arg, next); i++; }
    else if (arg === '--prop') { parsed.prop = valueFor(arg, next); i++; }
    else if (arg === '--action') { parsed.action = valueFor(arg, next); i++; }
    else if (arg === '--occurrence') { parsed.occurrence = integer(valueFor(arg, next), '--occurrence', 1, Number.MAX_SAFE_INTEGER, true); i++; }
    else if (arg === '-h') parsed.help = true;
    else if (arg.startsWith('--')) throw invalidInput(`Unknown flag: ${arg}.`, 'unknown_flag');
    else positional.push(arg);
  }

  return parsed as ParsedArgs;
}

/**
 * Decides whether an invocation needs CDP endpoint (port/target) resolution.
 * Bare branches (`session`, `page`, ... with no leaf) and `measure map` with no
 * sub-leaf only render help. `lib` never touches a browser. Of the `session`
 * lifecycle leaves, only `start` connects to CDP — `stop`, `list`, `view`,
 * `har`, and `log` finalize/read session state and must NOT parse `CDP_PORT`
 * or read/clean the active-session index (a malformed ambient `CDP_PORT` must
 * never block `session stop <id>` from finalizing).
 */
function needsEndpointResolution(parsed: ParsedArgs): boolean {
  if (parsed.help || parsed.command === 'lib') return false;
  const branchOnly = ['session', 'page', 'tab', 'measure', 'motion'].includes(parsed.command)
    && (parsed.positional.length === 0 || (parsed.command === 'measure' && parsed.positional.length === 1 && parsed.positional[0] === 'map'));
  if (branchOnly) return false;
  if (parsed.command === 'session' && parsed.positional[0] !== 'start') return false;
  return true;
}

/**
 * Hydrates endpoint/session defaults only after pure invocation validation
 * succeeds. Endpoint precedence is `explicit flag > session endpoint > env`:
 * the active session is hydrated FIRST, and the ambient `CDP_PORT` token is
 * parsed only when neither an explicit `--port` nor a session port supplies
 * one — so a malformed `CDP_PORT` can never reject a command whose session
 * already holds the authoritative port.
 */
export function resolveCliContext(parsed: ParsedArgs): ParsedArgs {
  if (!needsEndpointResolution(parsed)) return parsed;
  const session = getActiveSession({ cleanStale: false });
  if (session) {
    if (!parsed.har && session.harId) parsed.har = session.harId;
    // An explicit --url picks a different (parallel) tab than the session's
    // own — don't let the session's targetId clobber that choice.
    if (!parsed.target && !parsed.url && session.targetId) { parsed.target = session.targetId; parsed.targetSource = 'session'; }
    // A session target is inseparable from the endpoint that created it.
    // Prefer that endpoint over ambient CDP_PORT, but retain an explicit
    // --port override for deliberate multi-browser work.
    if (parsed.port === undefined && session.port !== undefined && session.port !== null) { parsed.port = session.port; parsed.portSource = 'session'; }
  }
  if (parsed.port === undefined && process.env.CDP_PORT !== undefined) {
    parsed.port = integer(process.env.CDP_PORT, 'CDP_PORT', 1, 65535);
    parsed.portSource = 'env';
  }
  // Preserve historical stale-index cleanup once endpoint validation has
  // succeeded; only the malformed-env throw path deliberately leaves it alone.
  if (!session) getActiveSession();
  if (!parsed.target && !parsed.url && process.env.CDP_TARGET) { parsed.target = process.env.CDP_TARGET; parsed.targetSource = 'env'; }
  return parsed;
}

/** Public pure parser used by command-level tests and programmatic branch callers. */
export function parseCliArgs(argv: string[]): ParsedArgs {
  return parseCliSyntax(argv);
}
