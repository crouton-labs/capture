/**
 * Apollo Calls Module
 *
 * Search, view, and download recordings from Apollo dialer call history.
 */

import { ContractDrift, Validation, UpstreamError, throwForStatus } from '@vallum/_runtime';

import type {
  SearchCallsInput,
  SearchCallsOutput,
  GetCallInput,
  GetCallOutput,
  DownloadRecordingInput,
  DownloadRecordingOutput,
} from '../schemas';
import type { FileRef } from '../../files/schemas';

declare const window: Window & {
  __vallum_files?: {
    download(params: {
      url: string;
      filename?: string;
      path?: string;
    }): Promise<FileRef>;
  };
};

/**
 * Search/paginate phone calls with sorting.
 */
export async function searchCalls(
  opts: SearchCallsInput,
): Promise<SearchCallsOutput> {
  const {
    page = 1,
    perPage = 25,
    sortByField = 'start_time',
    sortAscending = false,
  } = opts;

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/phone_calls/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      page,
      per_page: perPage,
      sort_by_field: sortByField,
      sort_ascending: sortAscending,
    }),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  return {
    phoneCalls: data.phone_calls || [],
    pagination: data.pagination || {
      page,
      perPage,
      totalEntries: 0,
      totalPages: 0,
    },
  };
}

/**
 * Get a single call by ID with full details including recording URL.
 */
export async function getCall(opts: GetCallInput): Promise<GetCallOutput> {
  const { id } = opts;

  if (!id) throw new Validation('id is required');

  const base = window.location.origin;
  const response = await fetch(
    `${base}/api/v1/phone_calls/${id}?cacheKey=${Date.now()}`,
    {
      credentials: 'include',
    },
  );

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  return { phoneCall: data.phone_call };
}

/**
 * Download a call's .wav recording file to the user's device.
 * Fetches recording_url from the call, then downloads via Northlight files API.
 */
export async function downloadRecording(
  opts: DownloadRecordingInput,
): Promise<DownloadRecordingOutput> {
  const { callId, filename, path = '~/Downloads' } = opts;

  if (!callId) throw new Validation('callId is required');

  // Get the call to find recording URL
  const { phoneCall } = await getCall({ id: callId });

  const recordingUrl = phoneCall.recording_url;
  if (!recordingUrl || typeof recordingUrl !== 'string') {
    throw new ContractDrift(
      `Call ${callId} has no recording. Only calls with recording_url can be downloaded.`,
    );
  }

  if (!window.__vallum_files) {
    throw new Validation(
      'Northlight files API not available. Ensure the Northlight agent is running.',
    );
  }

  const api = window.__vallum_files;
  const resolvedFilename =
    filename ??
    new URL(recordingUrl).pathname.split('/').pop() ??
    `${callId}.wav`;
  const fullPath = `${path}/${resolvedFilename}`;

  const fileRef = await api.download({ url: recordingUrl, path: fullPath });

  return {
    fileRef,
    filename: resolvedFilename,
  };
}
