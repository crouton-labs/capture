/**
 * Wayback Machine Library
 *
 * Browser-executable functions for querying the Internet Archive's Wayback Machine.
 * Extracts logos, testimonials, and text from archived web pages.
 * No authentication required; all APIs are public.
 */

import type {
  GetSnapshotsInput,
  GetSnapshotsOutput,
  ExtractLogosInput,
  ExtractLogosOutput,
  ExtractTestimonialsInput,
  ExtractTestimonialsOutput,
  ExtractPageTextInput,
  ExtractPageTextOutput,
} from './schemas';

import { NotFound, throwForStatus } from '@vallum/_runtime';

function toRawUrl(snapshotUrl: string): string {
  // Convert standard Wayback URL to raw (id_) URL to get original HTML
  // without injected toolbar or rewritten links
  // https://web.archive.org/web/20240301103239/https://... → .../20240301103239id_/https://...
  return snapshotUrl.replace(/\/web\/(\d+)\//, '/web/$1id_/');
}

async function fetchArchivedPage(snapshotUrl: string): Promise<Document> {
  const rawUrl = toRawUrl(snapshotUrl);
  const resp = await fetch(rawUrl);
  if (!resp.ok) {
    throwForStatus(resp.status, `${rawUrl}`);
  }
  const html = await resp.text();
  return new DOMParser().parseFromString(html, 'text/html');
}

export async function getSnapshots(
  args: GetSnapshotsInput,
): Promise<GetSnapshotsOutput> {
  const params = new URLSearchParams({
    url: args.url,
    output: 'json',
    fl: 'timestamp,original,statuscode',
    filter: 'statuscode:200',
  });

  if (args.matchType) params.set('matchType', args.matchType);
  if (args.from) params.set('from', args.from);
  if (args.to) params.set('to', args.to);
  if (args.collapse) params.set('collapse', `timestamp:${args.collapse}`);
  if (args.limit) params.set('limit', String(args.limit));

  const resp = await fetch(
    `https://web.archive.org/cdx/search/cdx?${params.toString()}`,
  );
  if (!resp.ok) {
    throwForStatus(resp.status);
  }

  const data: string[][] = await resp.json();

  // First row is headers, rest are data
  const rows = data.slice(1);

  const snapshots = rows.map((row) => ({
    timestamp: row[0],
    originalUrl: row[1],
    snapshotUrl: `https://web.archive.org/web/${row[0]}/${row[1]}`,
    statusCode: row[2],
  }));

  return { snapshots, total: snapshots.length };
}

export async function extractLogos(
  args: ExtractLogosInput,
): Promise<ExtractLogosOutput> {
  const doc = await fetchArchivedPage(args.snapshotUrl);

  const imgs = Array.from(doc.querySelectorAll('img'));

  // Identify logo images: must have "logo" in alt, class, or src
  // Exclude integration/tool logos (Jira, GitHub, Slack, etc.)
  const INTEGRATION_MARKERS = ['integration', 'stack', 'tool', 'feature'];

  const logos = imgs
    .filter((img) => {
      const alt = (img.alt || '').toLowerCase();
      const cls = (img.className || '').toLowerCase();
      const src = (img.src || '').toLowerCase();
      const isLogo =
        alt.includes('logo') ||
        cls.includes('logo') ||
        src.includes('logo') ||
        cls.includes('brand') ||
        cls.includes('partner') ||
        cls.includes('customer-logo') ||
        cls.includes('client-logo');
      if (!isLogo) return false;

      // Exclude integration/tool logos by class or parent section
      const isIntegration = INTEGRATION_MARKERS.some(
        (m) => cls.includes(m) || img.closest(`[class*="${m}"]`),
      );
      return !isIntegration;
    })
    .map((img) => {
      const altText = img.alt || '';
      const src = img.getAttribute('src') || img.src || '';

      // Extract company name from alt text first: "Drata Logo" → "Drata"
      let companyName = altText
        .replace(/\s*logo\s*/i, '')
        .replace(/\s*icon\s*/i, '')
        .trim();

      // Fallback: extract from src filename (e.g., "logo-appcues-1.svg" → "appcues")
      if (!companyName) {
        const srcMatch = src.match(/logo[_-]([a-zA-Z0-9]+)/i);
        if (srcMatch) {
          companyName =
            srcMatch[1].charAt(0).toUpperCase() + srcMatch[1].slice(1);
        }
      }

      return {
        companyName: companyName || 'Unknown',
        altText,
        imageUrl: src,
        width: img.width || 0,
        height: img.height || 0,
      };
    })
    .filter((logo) => logo.companyName && logo.companyName !== 'Unknown');

  // Deduplicate by company name
  const seen = new Set<string>();
  const uniqueLogos = logos.filter((logo) => {
    const key = logo.companyName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    logos: uniqueLogos,
    pageTitle: doc.title || '',
    snapshotUrl: args.snapshotUrl,
  };
}

export async function extractTestimonials(
  args: ExtractTestimonialsInput,
): Promise<ExtractTestimonialsOutput> {
  const doc = await fetchArchivedPage(args.snapshotUrl);

  const testimonials: ExtractTestimonialsOutput['testimonials'] = [];

  // Strategy 1: Find testimonial photos and walk up to containers
  const photos = Array.from(doc.querySelectorAll('img')).filter(
    (img) =>
      (img.src && img.src.includes('testimonial')) ||
      (img.alt && img.alt.includes('Photo of')),
  );

  for (const photo of photos) {
    const result = extractTestimonialFromContainer(photo);
    if (result) testimonials.push(result);
  }

  // Strategy 2: Find blockquotes with attribution
  if (testimonials.length === 0) {
    const blockquotes = Array.from(doc.querySelectorAll('blockquote'));
    for (const bq of blockquotes) {
      const result = extractTestimonialFromBlockquote(bq);
      if (result) testimonials.push(result);
    }
  }

  // Strategy 3: Look for common testimonial section patterns
  if (testimonials.length === 0) {
    const sections = Array.from(
      doc.querySelectorAll(
        '[class*="testimonial"], [class*="review"], [class*="quote"], [data-testimonial]',
      ),
    );
    for (const section of sections) {
      const result = extractTestimonialFromSection(section);
      if (result) testimonials.push(result);
    }
  }

  // Deduplicate by person name
  const seen = new Set<string>();
  const unique = testimonials.filter((t) => {
    const key = t.personName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    testimonials: unique,
    pageTitle: doc.title || '',
    snapshotUrl: args.snapshotUrl,
  };
}

function getLeafTexts(el: Element): string[] {
  // Collect text from leaf elements to preserve boundaries between DOM nodes
  const texts: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(
    el,
    4, // NodeFilter.SHOW_TEXT
  );
  let node: Node | null = walker.nextNode();
  while (node) {
    const t = (node.textContent ?? '').trim();
    if (t.length > 0) texts.push(t);
    node = walker.nextNode();
  }
  return texts;
}

function extractTestimonialFromContainer(
  photo: HTMLImageElement,
): ExtractTestimonialsOutput['testimonials'][0] | null {
  let container = photo.parentElement;
  for (let i = 0; i < 10; i++) {
    if (!container) break;
    const text = container.textContent ?? '';
    // Look for quoted text with a name and company
    if (text.length > 80 && (text.includes('"') || text.includes('\u201C'))) {
      const leafTexts = getLeafTexts(container);
      return parseTestimonialFromLeafTexts(leafTexts);
    }
    container = container.parentElement;
  }
  return null;
}

function extractTestimonialFromBlockquote(
  bq: HTMLQuoteElement,
): ExtractTestimonialsOutput['testimonials'][0] | null {
  // Get the quote text
  const quoteText = bq.textContent?.trim() || '';
  if (quoteText.length < 20) return null;

  // Look for attribution in siblings or parent
  const parent = bq.parentElement;
  if (!parent) return null;

  const cite =
    parent.querySelector('cite') ||
    parent.querySelector('[class*="author"]') ||
    parent.querySelector('[class*="name"]');
  if (!cite) return null;

  const attribution = cite.textContent?.trim() || '';
  const parsed = parseAttribution(attribution);
  if (!parsed) return null;

  return {
    quote: cleanQuote(quoteText),
    ...parsed,
  };
}

function extractTestimonialFromSection(
  section: Element,
): ExtractTestimonialsOutput['testimonials'][0] | null {
  const text = section.textContent;
  if (!text || text.length < 50) return null;
  const leafTexts = getLeafTexts(section);
  return parseTestimonialFromLeafTexts(leafTexts);
}

function parseTestimonialFromLeafTexts(
  texts: string[],
): ExtractTestimonialsOutput['testimonials'][0] | null {
  // Find the quote (it's typically the longest text segment and contains quotes)
  const quoteIdx = texts.findIndex(
    (t) =>
      t.length > 40 &&
      (t.includes('"') || t.includes('\u201C') || t.includes('\u201D')),
  );
  if (quoteIdx === -1) return null;

  const rawQuote = texts[quoteIdx];
  const quote = rawQuote
    .replace(/^[\u201C"\u201D]+/, '')
    .replace(/[\u201C"\u201D]+$/, '')
    .trim();
  if (quote.length < 20) return null;

  // Attribution segments come after the quote
  // Filter out the quote, empty strings, and pipe characters
  const attribution = texts
    .slice(quoteIdx + 1)
    .filter((t) => t !== '|' && t.length > 1 && t.length < 100);

  if (attribution.length < 2) return null;

  // Pattern: [name, title, company] or [name, company]
  const personName = attribution[0];
  const title = attribution.length >= 3 ? attribution[1] : '';
  const companyName = attribution[attribution.length - 1];

  if (!personName || !companyName) return null;

  return { quote, personName, title, companyName };
}

function parseAttribution(
  text: string,
): { personName: string; title: string; companyName: string } | null {
  const parts = text
    .split(/[,|—–\-\n]/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length < 2) return null;

  return {
    personName: parts[0],
    title: parts.length >= 3 ? parts[1] : '',
    companyName: parts[parts.length - 1],
  };
}

function cleanQuote(text: string): string {
  return text
    .replace(/^[\u201C"]+/, '')
    .replace(/[\u201D"]+$/, '')
    .trim();
}

export async function extractPageText(
  args: ExtractPageTextInput,
): Promise<ExtractPageTextOutput> {
  const doc = await fetchArchivedPage(args.snapshotUrl);

  let target: Element | null = doc.body;
  if (args.selector) {
    target = doc.querySelector(args.selector);
    if (!target) {
      throw new NotFound(
        `Selector "${args.selector}" not found on page: ${args.snapshotUrl}`,
      );
    }
  }

  const text = (target?.textContent || '').replace(/\s+/g, ' ').trim();

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    text,
    pageTitle: doc.title || '',
    snapshotUrl: args.snapshotUrl,
    wordCount,
  };
}
