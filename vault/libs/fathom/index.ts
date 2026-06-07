export type {
  GetContextOutput,
  ListCallsInput,
  ListCallsOutput,
  GetCallInput,
  GetCallOutput,
  GetTranscriptInput,
  GetTranscriptOutput,
  SearchCallsInput,
  SearchCallsOutput,
} from './schemas';

import type {
  GetContextOutput,
  ListCallsOutput,
  GetCallOutput,
  GetTranscriptOutput,
  SearchCallsOutput,
} from './schemas';
import { ContractDrift, NotFound, Unauthenticated, Validation, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Helpers
// ============================================================================

function parseInertiaPage(html: string): Record<string, unknown> {
  const match = html.match(/data-page="([^"]+)"/);
  if (!match) {
    throw new ContractDrift(
      'Could not find Inertia data-page attribute in response HTML',
    );
  }
  const decoded = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
  return JSON.parse(decoded);
}

// ============================================================================
// Context
// ============================================================================

export async function getContext(): Promise<GetContextOutput> {
  if (!window.location.href.includes('fathom.video')) {
    throw new Validation(
      `Not on fathom.video. Current URL: ${window.location.href}`,
    );
  }

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  if (!csrfMeta) {
    throw new Unauthenticated('CSRF meta tag not found. Not logged in to Fathom.');
  }
  const csrf = csrfMeta.getAttribute('content')!;

  // Get user info from the page's Inertia data
  const pageEl = document.querySelector('[data-page]');
  if (!pageEl) {
    throw new ContractDrift('Inertia data-page element not found.');
  }
  const pageData = JSON.parse(
    pageEl
      .getAttribute('data-page')!
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'"),
  );

  const user = pageData.props?.currentUser;
  if (!user) {
    throw new Unauthenticated('currentUser not found in page data. Not logged in.');
  }

  return {
    csrf,
    userId: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
  };
}

// ============================================================================
// List Calls
// ============================================================================

export async function listCalls(
  args: { nextCursor?: string } = {},
): Promise<ListCallsOutput> {
  const url = args.nextCursor
    ? `/calls/previous?cursor=${encodeURIComponent(args.nextCursor)}`
    : '/calls/previous';

  const resp = await fetch(url, {
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = await resp.json();

  const calls = (data.items || []).map(
    (item: Record<string, unknown>): Record<string, unknown> => {
      const host = item.host as Record<string, unknown> | undefined;
      const recording = item.recording as Record<string, unknown> | undefined;
      return {
        id: item.id,
        title: item.title,
        started_at: item.started_at,
        duration_minutes: item.duration_minutes,
        highlight_count: item.highlight_count,
        action_item_count: item.action_item_count,
        short_summary: item.short_summary ?? null,
        permalink: item.permalink,
        host: {
          first_name: host?.first_name ?? '',
          last_name: host?.last_name ?? '',
          email: host?.email ?? '',
        },
        internal: item.internal ?? false,
        is_impromptu: item.is_impromptu ?? false,
        recording_duration_seconds: recording?.duration_seconds ?? 0,
      };
    },
  );

  return {
    calls,
    nextCursor: data.next_cursor ?? null,
    limit: data.limit ?? calls.length,
  };
}

// ============================================================================
// Get Call Detail
// ============================================================================

export async function getCall(args: {
  callId: number;
}): Promise<GetCallOutput> {
  const resp = await fetch(`/calls/${args.callId}`, {
    credentials: 'include',
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const html = await resp.text();
  const pageData = parseInertiaPage(html);
  const props = pageData.props as Record<string, unknown>;
  const call = props.call as Record<string, unknown>;

  if (!call) {
    throw new NotFound(`Call ${args.callId} not found in page data`);
  }

  const host = call.host as Record<string, unknown>;
  const recording = call.recording as Record<string, unknown> | undefined;
  const speakers = (props.speakers as Array<Record<string, unknown>>) || [];
  const shareable = call.universalShareable as
    | Record<string, unknown>
    | undefined;

  return {
    id: call.id as number,
    title: (call.title as string) || (call.topic as string) || '',
    started_at: call.started_at as string,
    state: call.state as string,
    duration_seconds: recording?.duration_seconds
      ? (recording.duration_seconds as number)
      : (props.duration as number) || 0,
    permalink: call.permalink as string,
    speakers: speakers.map((s) => ({
      id: s.id as string,
      name: s.name as string,
      is_host: s.is_host as boolean,
    })),
    host: {
      id: host.id as number,
      first_name: host.first_name as string,
      last_name: host.last_name as string,
      email: host.email as string,
    },
    highlight_count: (call.highlight_count as number) || 0,
    action_item_count: (call.action_item_count as number) || 0,
    bookmarks: (call.bookmarks as unknown[]) || [],
    internal: (call.internal as boolean) || false,
    video_url: (call.video_url as string) ?? null,
    audio_url: (call.audio_url as string) ?? null,
    share_url: (shareable?.shareUrl as string) ?? null,
  };
}

// ============================================================================
// Get Transcript
// ============================================================================

export async function getTranscript(args: {
  callId: number;
}): Promise<GetTranscriptOutput> {
  const resp = await fetch(`/calls/${args.callId}/copy_transcript`, {
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = await resp.json();

  return {
    html: data.html || '',
    plain_text: data.plain_text || '',
  };
}

// ============================================================================
// Search Calls
// ============================================================================

export async function searchCalls(args: {
  csrf: string;
  query: string;
}): Promise<SearchCallsOutput> {
  // Step 1: Create the search query
  const createResp = await fetch('/ask-fathom/search/queries', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRF-Token': args.csrf,
    },
    credentials: 'include',
    body: JSON.stringify({ query: args.query }),
  });

  if (!createResp.ok) {
    const body = await createResp.text().catch(() => undefined);
    throwForStatus(createResp.status, body);
  }

  const createData = await createResp.json();
  const queryUrl = createData.aiCallSearchResultQueryUrl as string;

  if (!queryUrl) {
    throw new ContractDrift('No aiCallSearchResultQueryUrl returned from search');
  }

  // Step 2: Fetch the search result page to get result metadata
  const querySlug = queryUrl.split('/').pop()!;
  const resultPageResp = await fetch(
    `/ask-fathom/search/queries/${querySlug}`,
    { credentials: 'include' },
  );

  if (!resultPageResp.ok) {
    const body = await resultPageResp.text().catch(() => undefined);
    throwForStatus(resultPageResp.status, body);
  }

  const resultHtml = await resultPageResp.text();
  const pageData = parseInertiaPage(resultHtml);
  const props = pageData.props as Record<string, unknown>;
  const resultQuery = props.resultQuery as Record<string, unknown>;
  const actions = props.actions as Record<string, unknown>;
  const resultEntriesUrl = (actions?.resultEntriesUrl as string) || '';

  // Step 3: Fetch result entries
  let entries: unknown[] = [];
  let hasMoreResults = false;
  let processingMore = false;

  if (resultEntriesUrl) {
    // Wait briefly for results to process
    await new Promise((r) => setTimeout(r, 2000));

    const entriesResp = await fetch(resultEntriesUrl, {
      headers: { Accept: 'application/json', 'X-CSRF-Token': args.csrf },
      credentials: 'include',
    });

    if (entriesResp.ok) {
      const entriesData = await entriesResp.json();
      entries = entriesData.items || [];
      hasMoreResults = entriesData.has_more_results || false;
      processingMore = entriesData.processingMore || false;
    }
  }

  return {
    resultQuery: {
      id: resultQuery.id as number,
      query: resultQuery.query as string,
      refined_query: resultQuery.refined_query as string,
      completed_at: (resultQuery.completed_at as string) ?? null,
      failed_at: (resultQuery.failed_at as string) ?? null,
    },
    resultEntriesUrl,
    entries: entries as SearchCallsOutput['entries'],
    hasMoreResults,
    processingMore,
  };
}
