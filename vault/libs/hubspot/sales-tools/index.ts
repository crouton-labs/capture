/**
 * HubSpot Sales Productivity Tools
 *
 * Read-only operations for sales productivity features: snippets and meeting links.
 */

import { ContractDrift, throwForStatus } from '@vallum/_runtime';

export interface Snippet {
  id: number;
  name: string;
  shortcut: string;
  body: string;
  htmlBody: string;
  folderId: number | null;
  portalId: number;
  createdBy: number;
  modifiedBy: number;
  createdAt: number;
  modifiedAt: number;
  deletedAt: number | null;
  deletedBy: number | null;
  [key: string]: unknown;
}

export interface MeetingLink {
  id: number;
  portalId: number;
  slug: string;
  link: string;
  name: string;
  active: boolean;
  type: string;
  customParams?: {
    durations?: number[];
    timezone?: string;
    [key: string]: unknown;
  };
}

export async function listSnippets(opts: {
  csrf: string;
  portalId: string;
}): Promise<Snippet[]> {
  const url = new URL(`${window.location.origin}/api/snippets/v1/snippets`);
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new ContractDrift('Invalid response: expected array');
  }

  return data;
}

export async function listMeetingLinks(opts: {
  csrf: string;
  portalId: string;
}): Promise<MeetingLink[]> {
  const url = new URL(`${window.location.origin}/api/meetings/v1/link`);
  url.searchParams.set('includeAssociated', 'true');
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 400 && text.includes('No Meetings User found')) {
      return [];
    }
    throwForStatus(response.status, text || undefined);
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new ContractDrift('Invalid response: expected array');
  }

  return data;
}
