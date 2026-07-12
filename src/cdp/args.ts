import { invalidInput } from '../errors.js';
import { getActiveSession } from '../session-context.js';
import { type ParsedArgs } from './types.js';

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
    page: ['click', 'type', 'scroll', 'navigate', 'exec', 'shot', 'elements'],
    tab: ['list', 'open', 'reset', 'network'],
    measure: ['snap', 'check', 'diff', 'census', 'explain', 'sweep', 'map'],
    motion: ['rec', 'mask', 'timeline', 'jank', 'response'],
  };
  const known = branches[command];
  if (known && !known.includes(leaf)) throw invalidInput(`Unknown ${command} leaf: ${leaf}.`, 'unknown_command');
  if (command === 'measure' && leaf === 'map' && positional[1] !== undefined) {
    const mapLeaf = positional[1];
    if (!['focus', 'scroll', 'layers', 'ax'].includes(mapLeaf)) throw invalidInput(`Unknown measure map leaf: ${mapLeaf}.`, 'unknown_command');
  }
}

/**
 * Syntax/provenance parse is intentionally pure: malformed input must fail
 * before active-session lookup (which can clean stale pointers) or env access.
 */
export function parseCliArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? '';
  const rest = expandEqualsFlags(argv.slice(1));
  const positional: string[] = [];
  const parsed: Partial<ParsedArgs> = { command, positional };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = rest[i + 1];
    if (VALUE_FLAGS.has(arg)) valueFor(arg, next);

    if (arg === '--port') { parsed.port = integer(valueFor(arg, next), '--port', 1, 65535); i++; }
    else if (arg === '--out') { parsed.out = valueFor(arg, next); i++; }
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--duration') { parsed.duration = durationMs(valueFor(arg, next)); i++; }
    else if (arg === '--settle') { parsed.settle = integer(valueFor(arg, next), '--settle', 0, 2_147_483_647); i++; }
    else if (arg === '--file') { parsed.file = valueFor(arg, next); i++; }
    else if (arg === '--new') parsed.new = true;
    else if (arg === '--target') { parsed.target = valueFor(arg, next); i++; }
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

  validateKnownLeaf(command, positional);

  // The env is only the SELECTED port source when no higher-precedence
  // explicit --port provided one. Validate the selected env token before the
  // active-pointer lookup so a malformed selected env cannot clean stale
  // state; an irrelevant ambient CDP_PORT alongside an explicit --port is
  // never parsed and never fails the invocation.
  const envPort = parsed.port === undefined && process.env.CDP_PORT !== undefined
    ? integer(process.env.CDP_PORT, 'CDP_PORT', 1, 65535)
    : undefined;
  const session = getActiveSession();
  if (session) {
    if (!parsed.har && session.harId) parsed.har = session.harId;
    // A session target is inseparable from the endpoint that created it.
    // Prefer that endpoint over ambient CDP_PORT, but retain an explicit
    // --port override for deliberate multi-browser work.
    if (!parsed.port && session.cdpPort) parsed.port = session.cdpPort;
    // An explicit --url picks a different (parallel) tab than the session's
    // own — don't let the session's targetId clobber that choice.
    if (!parsed.target && !parsed.url && session.targetId) parsed.target = session.targetId;
  }
  if (!parsed.port && envPort !== undefined) parsed.port = envPort;
  if (!parsed.target && !parsed.url && process.env.CDP_TARGET) parsed.target = process.env.CDP_TARGET;
  return parsed as ParsedArgs;
}
