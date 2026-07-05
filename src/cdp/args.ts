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
    } else if (arg === '--interactive') {
      parsed.interactive = true;
    } else if (arg === '--har-out' && next) {
      parsed.harOut = next;
      i++;
    } else if (arg === '--record') {
      parsed.record = true;
    } else if (arg === '--duration' && next) {
      parsed.duration = parseInt(next, 10);
      i++;
    } else if (arg === '--settle' && next) {
      parsed.settle = parseInt(next, 10);
      i++;
    } else if (arg === '--file' && next) {
      parsed.file = next;
      i++;
    } else if (arg === '--nested') {
      parsed.nested = true;
    } else if (arg === '--har' && next) {
      parsed.har = next;
      i++;
    } else if (arg === '--new') {
      parsed.new = true;
    } else if (arg === '--target' && next) {
      parsed.target = next;
      i++;
    } else if (arg === '--url' && next) {
      parsed.url = next;
      i++;
    } else if (arg === '--role' && next) {
      parsed.role = next;
      i++;
    } else if (arg === '--into' && next) {
      parsed.into = next;
      i++;
    } else if (arg === '--no-screenshot') {
      parsed.noScreenshot = true;
    } else if (arg === '--viewport' && next) {
      parsed.viewport = next;
      i++;
    } else if (arg === '--full-page') {
      parsed.fullPage = true;
    } else if (arg === '--height' && next) {
      parsed.height = parseInt(next, 10);
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
      parsed.limit = parseInt(next, 10);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  // Fill gaps from environment variables (set by pipeline orchestrators)
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
  if (!parsed.har && process.env.CDP_HAR_ID) {
    parsed.har = process.env.CDP_HAR_ID;
  }

  // Fill remaining gaps from active session context (explicit flags always win)
  const session = getActiveSession();
  if (session) {
    if (!parsed.har && session.harId) parsed.har = session.harId;
    // An explicit --url picks a different (parallel) tab than the session's
    // own — don't let the session's targetId clobber that choice.
    if (!parsed.target && !parsed.url && session.targetId) parsed.target = session.targetId;
  }

  return parsed as ParsedArgs;
}
