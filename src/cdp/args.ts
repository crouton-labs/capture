import { type ParsedArgs } from './types.js';
import { getActiveSession } from '../session-context.js';

// Every flag below is matched as `--flag` followed by a separate `next`
// token (space-separated). To accept the equally-common `--flag=value` form
// without duplicating every branch, split any `--flag=value` token into two
// tokens up front so the rest of the parser only ever has to handle one
// convention.
export function expandEqualsFlags(argv: string[]): string[] {
  const out: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=');
      out.push(arg.slice(0, eq), arg.slice(eq + 1));
    } else {
      out.push(arg);
    }
  }
  return out;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? '';
  const rest = expandEqualsFlags(argv.slice(1));
  const positional: string[] = [];
  const parsed: Partial<ParsedArgs> = { command, positional };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = rest[i + 1];

    if (arg === '--port' && next) {
      parsed.port = parseInt(next, 10);
      i++;
    } else if (arg === '--out' && next) {
      parsed.out = next;
      i++;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--duration' && next) {
      parsed.duration = parseInt(next, 10);
      i++;
    } else if (arg === '--settle' && next) {
      parsed.settle = parseInt(next, 10);
      i++;
    } else if (arg === '--file' && next) {
      parsed.file = next;
      i++;
    } else if (arg === '--new') {
      parsed.new = true;
    } else if (arg === '--target' && next) {
      parsed.target = next;
      i++;
    } else if (arg === '--url' && next) {
      // Kept last-wins for every existing command's single-target semantics.
      // Also accumulated into `urls` so census/sweep-style leaves can accept
      // the flag repeated for a multi-page set without disturbing that.
      parsed.url = next;
      (parsed.urls ??= []).push(next);
      i++;
    } else if (arg === '--into' && next) {
      parsed.into = next;
      i++;
    } else if (arg === '--no-screenshot') {
      parsed.noScreenshot = true;
    } else if (arg === '--viewport' && next) {
      // Kept last-wins for every existing command's single-value semantics.
      // Also accumulated into `viewports` so check/snap/census-style leaves
      // can accept the flag repeated for a multi-viewport sweep, mirroring
      // the `--url` → { url, urls[] } pattern above.
      parsed.viewport = next;
      (parsed.viewports ??= []).push(next);
      i++;
    } else if (arg === '--full-page') {
      parsed.fullPage = true;
    } else if (arg === '--all') {
      parsed.all = true;
    } else if (arg === '--session' && next) {
      parsed.session = next;
      i++;
    } else if (arg === '--hold') {
      parsed.hold = true;
    } else if (arg === '--filter' && next) {
      parsed.filter = next;
      i++;
    } else if (arg === '--name' && next) {
      parsed.name = next;
      i++;
    } else if (arg === '--filter-url' && next) {
      parsed.filterUrl = next;
      i++;
    } else if (arg === '--filter-status' && next) {
      parsed.filterStatus = next;
      i++;
    } else if (arg === '--filter-method' && next) {
      parsed.filterMethod = next.toUpperCase();
      i++;
    } else if (arg === '--limit' && next) {
      parsed.limitRaw = next;
      parsed.limit = parseInt(next, 10);
      i++;
    } else if (arg === '--browser') {
      parsed.browser = true;
    } else if (arg === '--params' && next) {
      parsed.params = next;
      i++;
    } else if (arg === '--wait-event' && next) {
      parsed.waitEvent = next;
      i++;
    } else if (arg === '--timeout' && next) {
      parsed.timeoutMs = parseInt(next, 10);
      i++;
    } else if (arg === '--socket' && next) {
      parsed.socket = next;
      i++;
    } else if (arg === '--freeze-animations') {
      parsed.freezeAnimations = true;
    } else if (arg === '--settle-timeout' && next) {
      parsed.settleTimeout = parseInt(next, 10);
      i++;
    } else if (arg === '--capture-unsettled') {
      parsed.captureUnsettled = true;
    } else if (arg === '--pixels') {
      parsed.pixels = true;
    } else if (arg === '--state' && next) {
      (parsed.state ??= []).push(next);
      i++;
    } else if (arg === '--for' && next) {
      parsed.for = next;
      i++;
    } else if (arg === '--before' && next) {
      parsed.before = next;
      i++;
    } else if (arg === '--after' && next) {
      parsed.after = next;
      i++;
    } else if (arg === '--full') {
      parsed.full = true;
    } else if (arg === '--gate') {
      parsed.gate = true;
    } else if (arg === '--snap' && next) {
      (parsed.snap ??= []).push(next);
      i++;
    } else if (arg === '--set-file' && next) {
      parsed.setFile = next;
      i++;
    } else if (arg === '--axis' && next) {
      parsed.axis = next;
      i++;
    } else if (arg === '--from' && next) {
      // Raw string — axis units vary (width px / dpr float / zoom); parseInt
      // would lossily truncate a non-integer axis value.
      parsed.from = next;
      i++;
    } else if (arg === '--to' && next) {
      parsed.to = next;
      i++;
    } else if (arg === '--viewport-height' && next) {
      parsed.viewportHeight = next;
      i++;
    } else if (arg === '--rec-id' && next) {
      parsed.recId = next;
      i++;
    } else if (arg === '--selector' && next) {
      parsed.selector = next;
      i++;
    } else if (arg === '--size') {
      parsed.size = true;
    } else if (arg === '--text') {
      parsed.text = true;
    } else if (arg === '--form') {
      parsed.form = true;
    } else if (arg === '--start') {
      parsed.start = true;
    } else if (arg === '--stop') {
      parsed.stop = true;
    } else if (arg === '--do' && next) {
      parsed.do = next;
      i++;
    } else if (arg === '--element' && next) {
      parsed.element = next;
      i++;
    } else if (arg === '--prop' && next) {
      parsed.prop = next;
      i++;
    } else if (arg === '--action' && next) {
      parsed.action = next;
      i++;
    } else if (arg === '--occurrence' && next) {
      const occurrence = Number(next);
      if (!Number.isInteger(occurrence) || occurrence < 1) {
        console.error(`Invalid --occurrence: ${next} (expected a positive integer)`);
        process.exit(1);
      }
      parsed.occurrence = occurrence;
      i++;
    } else if (arg === '-h') {
      parsed.help = true;
    } else if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  // Fill gaps from the active session first. A session is an explicit,
  // scoped choice the caller made (`capture session start`), so its
  // target must win over ambient CDP_PORT/CDP_TARGET env vars — those are
  // meant for orchestrators only when NOT in a session. Letting a
  // stale/inherited env var outrank an active session is how a command
  // silently ends up on the wrong tab instead of the session's own.
  const session = getActiveSession();
  if (session) {
    // `parsed.har` is a session-filled internal slot: it is NOT CLI-settable
    // (there is no --har flag and no env var) — it only ever carries the
    // active session's HAR id so withConnection() can auto-append traffic.
    if (!parsed.har && session.harId) parsed.har = session.harId;
    // A session target is inseparable from the endpoint that created it.
    // Prefer that endpoint over ambient CDP_PORT, but retain an explicit
    // --port override for deliberate multi-browser work.
    if (!parsed.port && session.cdpPort) parsed.port = session.cdpPort;
    // An explicit --url picks a different (parallel) tab than the session's
    // own — don't let the session's targetId clobber that choice.
    if (!parsed.target && !parsed.url && session.targetId) parsed.target = session.targetId;
  }

  // Fill any still-empty gaps from environment variables (set by pipeline
  // orchestrators that aren't using the session concept).
  if (!parsed.port && process.env.CDP_PORT) {
    const envPort = Number.parseInt(process.env.CDP_PORT, 10);
    if (Number.isNaN(envPort)) {
      console.error(`Invalid CDP_PORT: ${process.env.CDP_PORT}`);
      process.exit(1);
    }
    parsed.port = envPort;
  }
  if (!parsed.target && !parsed.url && process.env.CDP_TARGET) {
    parsed.target = process.env.CDP_TARGET;
  }

  return parsed as ParsedArgs;
}
