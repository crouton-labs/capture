import { type CDPClient } from './client.js';

export interface ConsoleEntry {
  level: 'log' | 'warning' | 'error' | 'info' | 'debug';
  text: string;
  timestamp: number;
  source?: string;
}

export class ConsoleRecorder {
  private entries: ConsoleEntry[] = [];

  constructor(private client: CDPClient) {}

  async start(): Promise<void> {
    await this.client.send('Runtime.enable');

    this.client.on('Runtime.consoleAPICalled', (params: unknown) => {
      const p = params as {
        type: string;
        args: Array<{ type: string; value?: unknown; description?: string }>;
        timestamp: number;
      };
      const text = p.args
        .map((a) =>
          a.value !== undefined ? String(a.value) : (a.description ?? ''),
        )
        .join(' ');
      this.entries.push({
        level: p.type as ConsoleEntry['level'],
        text,
        timestamp: p.timestamp,
      });
    });

    this.client.on('Runtime.exceptionThrown', (params: unknown) => {
      const p = params as {
        timestamp: number;
        exceptionDetails: {
          exception?: { description?: string };
          text?: string;
          url?: string;
          lineNumber?: number;
        };
      };
      this.entries.push({
        level: 'error',
        text:
          p.exceptionDetails.exception?.description ??
          p.exceptionDetails.text ??
          'Unknown exception',
        timestamp: p.timestamp,
        source: p.exceptionDetails.url
          ? `${p.exceptionDetails.url}:${p.exceptionDetails.lineNumber}`
          : undefined,
      });
    });
  }

  finish(): ConsoleEntry[] {
    return [...this.entries];
  }
}

export function printConsoleSummary(entries: ConsoleEntry[]): void {
  const errors = entries.filter((e) => e.level === 'error');
  const warnings = entries.filter((e) => e.level === 'warning');
  if (errors.length > 0 || warnings.length > 0) {
    console.error(
      `\nConsole: ${errors.length} errors, ${warnings.length} warnings`,
    );
    for (const entry of [...errors, ...warnings]) {
      const prefix = entry.level === 'error' ? 'ERR' : 'WARN';
      const src = entry.source ? ` (${entry.source})` : '';
      const text =
        entry.text.length > 200 ? entry.text.slice(0, 197) + '...' : entry.text;
      console.error(`  [${prefix}] ${text}${src}`);
    }
  }
}
