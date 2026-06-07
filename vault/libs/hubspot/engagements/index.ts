/**
 * HubSpot Engagement Operations
 *
 * Create and manage engagements (notes, emails, calls, meetings, tasks).
 */

import type {
  ListEngagementsInput,
  ListEngagementsOutput,
  CreateEngagementInput,
  CreateEngagementOutput,
  UpdateEngagementInput,
  DeleteEngagementInput,
} from '../schemas';
import { throwForStatus } from '@vallum/_runtime';

function toEpochMs(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    if (/^\d+$/.test(val)) return Number(val);
    const ms = new Date(val).getTime();
    if (!isNaN(ms)) return ms;
  }
  return Date.now();
}

export async function listEngagements(
  opts: ListEngagementsInput,
): Promise<ListEngagementsOutput> {
  const objectTypeMap: Record<string, string> = {
    CONTACT: 'CONTACT',
    COMPANY: 'COMPANY',
    DEAL: 'DEAL',
    contacts: 'CONTACT',
    companies: 'COMPANY',
    deals: 'DEAL',
  };
  const resolvedType = objectTypeMap[opts.objectType] || opts.objectType;
  const url = `${window.location.origin}/api/engagements/v1/engagements/associated/${resolvedType}/${opts.objectId}/paged?portalId=${opts.portalId}&limit=100`;

  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  type EngagementItem = {
    engagement?: {
      id?: string;
      type?: string;
      createdAt?: number;
      bodyPreview?: string;
    };
    metadata?: {
      subject?: string;
      title?: string;
      body?: string;
      status?: string;
      durationMilliseconds?: number;
    };
  };

  let results: EngagementItem[] = data.results || [];
  if (opts.engagementType) {
    results = results.filter(
      (e) => e.engagement?.type === opts.engagementType!.toUpperCase(),
    );
  }

  return {
    total: results.length,
    engagements: results.map((e) => ({
      id: Number(e.engagement?.id),
      type: e.engagement?.type ?? '',
      createdAt: new Date(e.engagement?.createdAt ?? 0).toLocaleString(),
      subject: e.metadata?.subject || e.metadata?.title || '',
      body: e.engagement?.bodyPreview || e.metadata?.body || '',
      status: e.metadata?.status,
      durationMs: e.metadata?.durationMilliseconds,
    })),
  };
}

export async function createEngagement(
  opts: CreateEngagementInput,
): Promise<CreateEngagementOutput> {
  const url = `${window.location.origin}/api/engagements/v1/engagements?portalId=${opts.portalId}`;

  const associations: Record<string, number[]> = {};
  if (opts.objectType === 'CONTACT')
    associations.contactIds = [Number(opts.objectId)];
  else if (opts.objectType === 'COMPANY')
    associations.companyIds = [Number(opts.objectId)];
  else if (opts.objectType === 'DEAL')
    associations.dealIds = [Number(opts.objectId)];

  const engagementMeta: Record<string, unknown> = {
    body: opts.content,
    ...(opts.metadata || {}),
  };

  if (opts.engagementType === 'CALL') {
    engagementMeta.status = opts.metadata?.status || 'COMPLETED';
    engagementMeta.durationMilliseconds = opts.metadata?.duration || 0;
  }
  if (opts.engagementType === 'MEETING') {
    engagementMeta.title = opts.metadata?.title || opts.content;
    engagementMeta.startTime = toEpochMs(
      opts.metadata?.startTime || Date.now(),
    );
    engagementMeta.endTime = toEpochMs(
      opts.metadata?.endTime || Date.now() + 3600000,
    );
  }
  if (opts.engagementType === 'TASK') {
    engagementMeta.subject = opts.metadata?.subject || opts.content;
    engagementMeta.status = opts.metadata?.status || 'NOT_STARTED';
  }
  if (opts.engagementType === 'EMAIL') {
    engagementMeta.subject = opts.metadata?.subject || 'No subject';
    engagementMeta.text = opts.content;
  }

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({
      engagement: {
        type: opts.engagementType,
        timestamp: toEpochMs(opts.metadata?.timestamp || Date.now()),
      },
      associations,
      metadata: engagementMeta,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  const data = await response.json();
  return { engagementId: data.engagement?.id };
}

export async function updateEngagement(
  opts: UpdateEngagementInput,
): Promise<void> {
  const url = `${window.location.origin}/api/engagements/v1/engagements/${opts.engagementId}?portalId=${opts.portalId}`;

  const metadata: Record<string, unknown> = {
    body: opts.content,
    ...(opts.metadata || {}),
  };
  if (metadata.startTime) metadata.startTime = toEpochMs(metadata.startTime);
  if (metadata.endTime) metadata.endTime = toEpochMs(metadata.endTime);

  const response = await fetch(url, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({ metadata }),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }
}

export async function deleteEngagement(
  opts: DeleteEngagementInput,
): Promise<void> {
  const url = `${window.location.origin}/api/engagements/v1/engagements/${opts.engagementId}?portalId=${opts.portalId}`;

  const response = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (response.status !== 204 && !response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }
}
