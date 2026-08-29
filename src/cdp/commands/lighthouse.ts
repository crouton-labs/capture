import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectCdpPort } from '../detect.js';
import { captureError } from '../../errors.js';
import { type ParsedArgs } from '../types.js';
import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate, writePrivateFile } from '../../session/artifacts.js';
import { getActiveSession } from '../../session-context.js';
import { capped, emitResult, fact, formatArtifactList, line, lineList, text, type FactLine, type JsonValue, type RenderableResult } from '../../output/render.js';

export const COMMAND_BLOCK = `<command name="lighthouse">
a third-party scored report — capture runs Lighthouse against a URL and stores its report unmodified
use when the caller wants Lighthouse's own categories, scores, and audits; capture scores nothing itself, so every number capture measures lives in \`measure\`, \`motion\`, \`perf\`, or \`heap\`
</command>`;

const HELP = `capture lighthouse <url> [--categories <list>] [--preset mobile|desktop] [--limit <N>] [--out <path>] — run Lighthouse against a URL and store its report

input:
  <url>                 required. The URL Lighthouse navigates to. Lighthouse drives the browser destructively — it clears state and reloads — so it will not run against a tab another collector is recording
  --categories <list>   comma-separated Lighthouse categories; default performance. Any category Lighthouse ships (performance, accessibility, best-practices, seo)
  --preset <preset>     mobile (default, Lighthouse's mobile emulation and simulated throttling) or desktop
  --limit <N>           render at most N failing nodes per audit; default 25, --json always carries every node
  --out <path>          also write Lighthouse's HTML report to this path
output: <lighthouse …> — Lighthouse's own category scores, its audit pass/fail counts, one row per failing audit, and for each failing node that audit's DOM path with its selector, snippet, and Lighthouse's own explanation; plus the absolute path to the unmodified JSON report; capture adds no assessment of its own; --json mirrors
effects: drives the browser destructively — Lighthouse clears storage and cache and performs its own navigations on the target tab, and runs its own trace. Refused while anything holds the browser-global \`tracing\` claim, and refused while any collector is live on the target tab; both refusals name the holder.`;

type NodeItem = {
  readonly path: string;
  readonly selector: string;
  readonly snippet: string;
  readonly explanation: string;
  readonly nodeLabel?: string;
};

type FailingAudit = {
  readonly id: string;
  readonly title: string;
  readonly items: readonly NodeItem[];
};

type Category = {
  readonly id: string;
  readonly score: number | null;
  readonly auditsPassed: number;
  readonly auditsFailed: number;
  readonly failingAudits: readonly FailingAudit[];
};

type LighthouseReport = {
  readonly requestedUrl?: string;
  readonly finalUrl?: string;
  readonly lighthouseVersion?: string;
  readonly environment?: { readonly credits?: Record<string, string | undefined> };
  readonly categories?: Record<string, {
    readonly id?: string;
    readonly score?: number | null;
    readonly auditRefs?: readonly { readonly id?: string }[];
  }>;
  readonly audits?: Record<string, {
    readonly id?: string;
    readonly title?: string;
    readonly score?: number | null;
    readonly details?: { readonly items?: readonly unknown[] };
  }>;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function nodeItem(value: unknown): NodeItem | undefined {
  const item = record(value);
  const node = item && record(item.node);
  if (!node) return undefined;
  const nodePath = string(node.path);
  const rawSelector = node.selector;
  const selector = typeof rawSelector === 'string'
    ? rawSelector
    : Array.isArray(rawSelector) && rawSelector.every(part => typeof part === 'string')
      ? rawSelector.join(', ')
      : undefined;
  if (!nodePath || !selector) return undefined;
  return {
    path: nodePath,
    selector,
    snippet: string(node.snippet) ?? '',
    explanation: string(node.explanation) ?? '',
    nodeLabel: string(node.nodeLabel),
  };
}

function categoriesFrom(report: LighthouseReport): readonly Category[] {
  const audits = report.audits ?? {};
  return Object.entries(report.categories ?? {}).map(([categoryId, category]) => {
    const refs = category.auditRefs ?? [];
    const categoryAudits = refs.map(ref => audits[ref.id ?? '']).filter((audit): audit is NonNullable<typeof audit> => audit !== undefined);
    const failingAudits = categoryAudits
      .filter(audit => audit.score === 0)
      .map(audit => ({
        id: audit.id ?? '',
        title: audit.title ?? '',
        items: (audit.details?.items ?? []).map(nodeItem).filter((item): item is NodeItem => item !== undefined),
      }));
    return {
      id: category.id ?? categoryId,
      score: category.score ?? null,
      auditsPassed: categoryAudits.filter(audit => audit.score === 1).length,
      auditsFailed: failingAudits.length,
      failingAudits,
    };
  });
}

function reportDirectory(): { id: string; dir: string } {
  const id = `report-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
  const parent = getActiveSession()?.dir ?? path.join(CAPTURE_ROOT, `oneshot-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`);
  const dir = path.join(parent, 'lighthouse', 'reports', id);
  ensurePrivateDir(dir);
  return { id, dir };
}

function writeHtml(pathname: string, html: string): void {
  try {
    ensurePrivateDir(path.dirname(pathname));
    writePrivateFile(pathname, html);
  } catch (error) {
    if (path.resolve(pathname).startsWith(`${CAPTURE_ROOT}${path.sep}`)) throw error;
    fs.writeFileSync(pathname, html);
  }
}

function reportStrings(report: string | readonly string[]): { json: string; html: string } {
  const outputs = Array.isArray(report) ? report : [report];
  const json = outputs.find(output => output.trimStart().startsWith('{'));
  const html = outputs.find(output => output.trimStart().startsWith('<'));
  if (!json || !html) throw captureError('world', 'lighthouse_report_missing', 'Lighthouse did not return both JSON and HTML reports.');
  return { json, html };
}

const FULL_DATA_MAX = Number.MAX_SAFE_INTEGER;

function full(value: string) {
  return capped(value, FULL_DATA_MAX);
}

function categoryJson(category: Category): JsonValue {
  return {
    category: category.id,
    score: category.score,
    auditsPassed: category.auditsPassed,
    auditsFailed: category.auditsFailed,
    failingAudits: category.failingAudits.map(audit => ({
      id: audit.id,
      title: audit.title,
      score: 0,
      items: audit.items.map(item => ({
        path: full(item.path),
        selector: full(item.selector),
        snippet: full(item.snippet),
        explanation: full(item.explanation),
        ...(item.nodeLabel === undefined ? {} : { nodeLabel: full(item.nodeLabel) }),
      })),
    })),
  };
}

function categoryProse(category: Category, limit: number): FactLine {
  const rows: FactLine[] = [fact`${category.id}: score ${category.score ?? 'not-scored'}; ${category.auditsPassed} passed audit(s), ${category.auditsFailed} failed audit(s).`];
  for (const audit of category.failingAudits) {
    rows.push(line(text`  `, fact`${audit.id} — ${audit.title}`));
    const displayed = audit.items.slice(0, limit);
    for (const item of displayed) {
      rows.push(line(text`    path: `, fact`${full(item.path)}`));
      rows.push(line(text`    selector: `, fact`${full(item.selector)}`));
      rows.push(line(text`    snippet: `, fact`${full(item.snippet)}`));
      rows.push(line(text`    Lighthouse explanation: `, fact`${full(item.explanation)}`));
      if (item.nodeLabel !== undefined) rows.push(line(text`    node label: `, fact`${full(item.nodeLabel)}`));
    }
    if (audit.items.length === 0) rows.push(text`    No failing nodes were attached to this audit by Lighthouse.`);
    if (audit.items.length > displayed.length) rows.push(fact`    ${displayed.length} of ${audit.items.length} failing node(s) rendered (--limit ${limit}).`);
  }
  return lineList(rows);
}

function resultFor(input: {
  id: string;
  dir: string;
  url: string;
  report: LighthouseReport;
  preset: 'mobile' | 'desktop';
  categories: readonly string[];
  htmlStored: boolean;
  limit: number;
}): RenderableResult {
  const categories = categoriesFrom(input.report);
  const lighthouseVersion = input.report.lighthouseVersion ?? 'unknown';
  const axe = input.report.environment?.credits?.['axe-core'];
  const finalUrl = input.report.finalUrl ?? input.url;
  return {
    tag: 'lighthouse',
    attrs: {
      report: input.id,
      path: input.dir,
      'report-path': full(path.join(input.dir, 'report.json')),
      url: input.url,
      'final-url': finalUrl,
      preset: input.preset,
      categories: input.categories.join(','),
      lighthouse: lighthouseVersion,
      axe,
    },
    summary: fact`Scores and audit results are Lighthouse's own, computed by lighthouse@${lighthouseVersion} under the ${input.preset} preset. Capture stores the report unmodified and adds no assessment of its own.`,
    artifacts: formatArtifactList(input.htmlStored ? [{ name: 'report.json' }, { name: 'report.html' }] : [{ name: 'report.json' }]),
    jsonArtifacts: input.htmlStored ? ['report.json', 'report.html'] : ['report.json'],
    sections: [
      ...categories.map(category => categoryProse(category, input.limit)),
      text`Lighthouse applies simulated throttling by default, so its timings are not the wall-clock timings of an unthrottled load and are not comparable with capture perf vitals.`,
      text`Failing-node selectors are minimized by axe and may drop class modifiers, so a selector can match more elements than the one that failed; the DOM path identifies the failing node.`,
    ],
    jsonSections: categories.map(categoryJson),
  };
}

export async function cmdLighthouse(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(HELP);
    return;
  }

  let lighthouseModule: typeof import('lighthouse');
  try {
    lighthouseModule = await import('lighthouse');
  } catch (error) {
    throw captureError('precondition', 'lighthouse_unavailable', 'Lighthouse is not installed. Install capture with its production dependencies before running this command.', error);
  }

  const url = parsed.positional[0]!;
  const preset = parsed.preset === 'desktop' ? 'desktop' : 'mobile';
  const categories = parsed.categories?.split(',') ?? ['performance'];
  const port = parsed.port ?? await detectCdpPort();
  let run: Awaited<ReturnType<typeof lighthouseModule.default>> | undefined;
  try {
    run = await lighthouseModule.default(url, {
      port,
      output: ['json', 'html'],
      onlyCategories: categories,
      logLevel: 'error',
    }, preset === 'desktop' ? lighthouseModule.desktopConfig : undefined);
  } catch (error) {
    throw captureError('world', 'lighthouse_failed', `Lighthouse could not run: ${error instanceof Error ? error.message : String(error)}`, error);
  }
  if (!run) throw captureError('world', 'lighthouse_no_report', 'Lighthouse completed without a report.');

  const reports = reportStrings(run.report);
  const artifact = reportDirectory();
  if (parsed.out) writeHtml(parsed.out, reports.html);
  writePrivateFile(path.join(artifact.dir, 'report.json'), reports.json);
  if (parsed.out) writePrivateFile(path.join(artifact.dir, 'report.html'), reports.html);
  const report = run.lhr as unknown as LighthouseReport;
  writeJsonPrivate(path.join(artifact.dir, 'meta.json'), {
    id: artifact.id,
    url,
    finalUrl: report.finalUrl ?? url,
    preset,
    categories,
    lighthouse: report.lighthouseVersion ?? null,
    axe: report.environment?.credits?.['axe-core'] ?? null,
  });

  emitResult(resultFor({
    id: artifact.id,
    dir: artifact.dir,
    url,
    report,
    preset,
    categories,
    htmlStored: parsed.out !== undefined,
    limit: parsed.limit ?? 25,
  }), { json: parsed.json });
}
