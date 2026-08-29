import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { detectCdpPort } from '../detect.js';
import { captureError } from '../../errors.js';
import { type ParsedArgs } from '../types.js';
import { CAPTURE_ROOT, ensurePrivateDir, processPidBirthProvider, writeJsonPrivate, writePrivateFile } from '../../session/artifacts.js';
import { getActiveSession } from '../../session-context.js';
import { withSessionLifecycle } from '../../session/coordinator.js';
import { collectorHostSocketPath, startCollectorHost } from '../bridge/spawn.js';
import { sendHostRequest } from '../host/client.js';
import { scanCollectorHost } from '../host/handle.js';
import { stopAndReapCollectorHostAtSessionStop } from '../host/lifecycle.js';
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
  readonly score: number;
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
      .filter((audit): audit is typeof audit & { score: number } => typeof audit.score === 'number' && audit.score < 1)
      .map(audit => ({
        id: audit.id ?? '',
        title: audit.title ?? '',
        score: audit.score,
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

type TracingReservation = { socketPath: string; nonce: string; token: string; targetId: string };

type LighthousePage = NonNullable<Parameters<typeof import('lighthouse').default>[3]>;

type PuppeteerSession = { send(method: string, params?: Record<string, unknown>): Promise<unknown>; detach(): Promise<void> };
type PuppeteerPage = { target(): { createCDPSession(): Promise<PuppeteerSession> } };
type PuppeteerBrowser = { pages(): Promise<PuppeteerPage[]>; disconnect(): Promise<void> };
type PuppeteerModule = { connect(options: { browserURL: string; defaultViewport: null }): Promise<PuppeteerBrowser> };

function claimFailure(message: string): never {
  throw captureError('precondition', 'claim_held', `${message} Run \`capture session collectors\` to see live collectors, stop the holder, then re-issue.`);
}

async function reserveTracing(port: number): Promise<TracingReservation | undefined> {
  const active = getActiveSession();
  if (!active?.targetId || active.port !== port) return undefined;
  return withSessionLifecycle(active.dir, async () => {
    const session = getActiveSession();
    if (!session || session.dir !== active.dir || !session.targetId || session.port !== port) return undefined;
    let scanned = scanCollectorHost(session.dir);
    if (scanned.classification === 'unknown' || scanned.classification === 'malformed') {
      throw captureError('precondition', 'collector_host_unavailable', `This session's collector host is ${scanned.classification}; Lighthouse cannot reserve the browser-global tracing claim.`);
    }
    if (scanned.classification === 'dead') {
      const reaped = await stopAndReapCollectorHostAtSessionStop(session.dir);
      if (reaped.status === 'terminal') throw captureError('precondition', 'collector_host_unavailable', `This session's collector host could not be reaped: ${reaped.error}`);
      scanned = scanCollectorHost(session.dir);
    }
    if (scanned.classification === 'absent') {
      await startCollectorHost(collectorHostSocketPath(session.dir), port, session.targetId, session.dir);
      scanned = scanCollectorHost(session.dir);
    }
    if (scanned.classification !== 'live' || !scanned.handle) {
      throw captureError('precondition', 'collector_host_unavailable', 'Collector host did not publish a live handle for Lighthouse.');
    }
    if (scanned.handle.targetId !== session.targetId) {
      throw captureError('precondition', 'collector_host_target_mismatch', 'A collector host is bound to a different session target. Stop the session before running Lighthouse.');
    }
    const birth = processPidBirthProvider.read(process.pid);
    if (birth.status !== 'found') {
      throw captureError('precondition', 'collector_host_unavailable', 'Lighthouse could not establish its process identity to reserve the tracing claim.');
    }
    const response = await sendHostRequest(scanned.handle.socketPath, {
      type: 'claim-reserve', nonce: scanned.handle.nonce, claims: ['tracing'], exclusive: true, holderLabel: 'lighthouse', pid: process.pid, birth: birth.identity,
    });
    if (!response.ok) {
      const message = response.error ?? 'collector host refused the tracing reservation.';
      if (message.startsWith('Claim ') || message.startsWith('Target ')) claimFailure(`Lighthouse could not reserve the target tab and browser-global tracing claim: ${message}`);
      throw captureError('precondition', 'collector_host_reservation_failed', `Lighthouse could not reserve the target tab and browser-global tracing claim: ${message}`);
    }
    const reservation = response.reservation as { token?: unknown } | undefined;
    if (!reservation || typeof reservation.token !== 'string') {
      throw captureError('internal', 'collector_host_reservation_malformed', 'Collector host returned a malformed tracing reservation.');
    }
    return { socketPath: scanned.handle.socketPath, nonce: scanned.handle.nonce, token: reservation.token, targetId: session.targetId };
  });
}

async function releaseTracing(reservation: TracingReservation): Promise<void> {
  const response = await sendHostRequest(reservation.socketPath, { type: 'claim-release', nonce: reservation.nonce, token: reservation.token });
  if (!response.ok) throw captureError('cleanup', 'tracing_claim_release_failed', `Lighthouse finished but its tracing reservation could not be released: ${response.error ?? 'collector host refused the release.'}`);
}

async function pageForSessionTarget(port: number, targetId: string): Promise<{ browser: PuppeteerBrowser; page: LighthousePage }> {
  const lighthouseRequire = createRequire(require.resolve('lighthouse'));
  const puppeteer = lighthouseRequire('puppeteer-core') as PuppeteerModule;
  const browser = await puppeteer.connect({ browserURL: `http://localhost:${port}`, defaultViewport: null });
  try {
    for (const page of await browser.pages()) {
      const session = await page.target().createCDPSession();
      try {
        const result = await session.send('Target.getTargetInfo') as { targetInfo?: { targetId?: unknown } };
        if (result.targetInfo?.targetId === targetId) return { browser, page: page as LighthousePage };
      } finally {
        await session.detach();
      }
    }
  } catch (error) {
    try {
      await browser.disconnect();
    } catch (disconnectError) {
      throw new AggregateError([error, disconnectError], 'Lighthouse could not resolve the active session target or disconnect its browser client.');
    }
    throw error;
  }
  await browser.disconnect();
  throw captureError('precondition', 'lighthouse_target_unavailable', `Lighthouse could not find the active session target ${targetId} on CDP port ${port}.`);
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
      score: audit.score,
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
    rows.push(line(text`  `, fact`${audit.id} — ${audit.title}; score ${audit.score}`));
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
  const reservation = await reserveTracing(port);
  let run: Awaited<ReturnType<typeof lighthouseModule.default>> | undefined;
  let browser: PuppeteerBrowser | undefined;
  let primary: unknown;
  try {
    const target = reservation && await pageForSessionTarget(port, reservation.targetId);
    browser = target?.browser;
    run = await lighthouseModule.default(url, {
      port,
      output: ['json', 'html'],
      onlyCategories: categories,
      logLevel: 'error',
    }, preset === 'desktop' ? lighthouseModule.desktopConfig : undefined, target?.page);
  } catch (error) {
    primary = captureError('world', 'lighthouse_failed', `Lighthouse could not run: ${error instanceof Error ? error.message : String(error)}`, error);
  }
  const cleanupFailures: unknown[] = [];
  if (browser) {
    try {
      await browser.disconnect();
    } catch (error) {
      cleanupFailures.push(captureError('cleanup', 'lighthouse_browser_disconnect_failed', `Lighthouse finished but its browser client could not be disconnected: ${error instanceof Error ? error.message : String(error)}`, error));
    }
  }
  if (reservation) {
    try {
      await releaseTracing(reservation);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (primary && cleanupFailures.length > 0) throw new AggregateError([primary, ...cleanupFailures], 'Lighthouse failed and cleanup could not complete.');
  if (primary) throw primary;
  if (cleanupFailures.length === 1) throw cleanupFailures[0];
  if (cleanupFailures.length > 1) throw new AggregateError(cleanupFailures, 'Lighthouse completed but cleanup could not complete.');
  if (!run) throw captureError('world', 'lighthouse_no_report', 'Lighthouse completed without a report.');

  const reports = reportStrings(run.report);
  const artifact = reportDirectory();
  const reportPath = path.join(artifact.dir, 'report.json');
  writePrivateFile(reportPath, reports.json);
  if (parsed.out) {
    writePrivateFile(path.join(artifact.dir, 'report.html'), reports.html);
    try {
      writeHtml(parsed.out, reports.html);
    } catch (error) {
      throw captureError('world', 'lighthouse_html_write_failed', `Lighthouse report JSON was stored at ${reportPath}, but its HTML could not be written to ${parsed.out}: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }
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
