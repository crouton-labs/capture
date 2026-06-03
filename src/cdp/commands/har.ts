import {
  createHarRecording,
  readHarRecording as readHarFile,
  deleteHarRecording,
  harFilePath,
} from '../../har-manager.js';
import { getActiveSession } from '../../session-context.js';
import { type ParsedArgs } from '../types.js';

export async function cmdHar(parsed: ParsedArgs, args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture har <create|read|delete>\n\n' +
        '  create                      Create a new HAR recording (returns id)\n' +
        '  read [id]                   Read accumulated HAR entries (id optional in active session)\n' +
        '  delete <id>                 Delete a HAR recording\n\n' +
        'Filters (read):\n' +
        '  --filter-url <pattern>      Substring or regex match on URL\n' +
        '  --filter-status <code>      Status code, prefix (e.g. 4), or range (e.g. 400-499)\n' +
        '  --filter-method <method>    HTTP method (GET, POST, ...)\n' +
        '  --limit <N>                 Return only the first N matching entries\n\n' +
        'Pass --har <id> to exec/navigate commands to append traffic to a recording.',
    );
    process.exit(0);
  }
  const subcommand = args[1];

  if (subcommand === 'create') {
    // Generate a short random ID
    const { id, path: harPath } = createHarRecording();
    console.log(JSON.stringify({ id, path: harPath }, null, 2));
    console.error(
      `\nPass --har ${id} to subsequent commands to record traffic.`,
    );
    return;
  }

  if (subcommand === 'read') {
    // ID is optional — fall back to active session's harId
    let id = args[2];
    if (id && id.startsWith('--')) id = undefined as unknown as string;
    if (!id) {
      const session = getActiveSession();
      if (session?.harId) {
        id = session.harId;
      } else {
        console.error('Usage: capture har read [id]\n' +
          '  ID is optional when a capture session is active.');
        process.exit(1);
      }
    }

    const har = readHarFile(id);
    if (!har) {
      console.error(`No HAR recording found for id: ${id}`);
      process.exit(1);
    }

    let entries = har.log.entries;
    const total = entries.length;
    const filters: string[] = [];

    if (parsed.filterUrl) {
      const pattern = parsed.filterUrl;
      let re: RegExp | null = null;
      try { re = new RegExp(pattern, 'i'); } catch { re = null; }
      entries = entries.filter((e) =>
        re ? re.test(e.request.url) : e.request.url.toLowerCase().includes(pattern.toLowerCase()),
      );
      filters.push(`url~${pattern}`);
    }
    if (parsed.filterStatus) {
      const s = parsed.filterStatus;
      let matcher: (code: number) => boolean;
      if (/^\d+-\d+$/.test(s)) {
        const [lo, hi] = s.split('-').map((n) => parseInt(n, 10));
        matcher = (c) => c >= lo && c <= hi;
      } else if (/^\d+$/.test(s)) {
        if (s.length < 3) {
          matcher = (c) => String(c).startsWith(s);
        } else {
          const n = parseInt(s, 10);
          matcher = (c) => c === n;
        }
      } else {
        matcher = () => true;
      }
      entries = entries.filter((e) => matcher(e.response.status));
      filters.push(`status=${s}`);
    }
    if (parsed.filterMethod) {
      const m = parsed.filterMethod;
      entries = entries.filter((e) => e.request.method.toUpperCase() === m);
      filters.push(`method=${m}`);
    }
    if (typeof parsed.limit === 'number' && parsed.limit > 0) {
      entries = entries.slice(0, parsed.limit);
      filters.push(`limit=${parsed.limit}`);
    }

    const filtersLabel = filters.length > 0 ? `  [${filters.join(', ')}]` : '';
    console.error(
      `HAR: ${harFilePath(id)} (${entries.length}/${total} entries)${filtersLabel}`,
    );
    console.log(JSON.stringify({ log: { entries } }, null, 2));
    return;
  }

  if (subcommand === 'delete') {
    const id = args[2];
    if (!id) {
      console.error('Usage: capture har delete <id>');
      process.exit(1);
    }

    deleteHarRecording(id);
    console.log(JSON.stringify({ deleted: true, id }, null, 2));
    return;
  }

  console.error(
    'Usage: capture har <create|read|delete>\n' +
      '  create              Create a new HAR recording (returns id)\n' +
      '  read <id>           Read accumulated HAR entries\n' +
      '  delete <id>         Delete a HAR recording',
  );
  process.exit(1);
}
