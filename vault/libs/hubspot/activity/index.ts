/**
 * HubSpot Activity & Property History Operations
 *
 * Read the activity timeline (property changes, deal stage changes,
 * lifecycle changes, sequence events, object creation) and per-property
 * change history for any CRM object.
 */

import type {
  GetTimelineInput,
  GetTimelineOutput,
  GetPropertyHistoryInput,
  GetPropertyHistoryOutput,
} from '../schemas';
import { throwForStatus } from '@vallum/_runtime';

export async function getTimeline(
  opts: GetTimelineInput,
): Promise<GetTimelineOutput> {
  const objectTypeMap: Record<string, string> = {
    CONTACT: '0-1',
    COMPANY: '0-2',
    DEAL: '0-3',
    TICKET: '0-5',
    contacts: '0-1',
    companies: '0-2',
    deals: '0-3',
    tickets: '0-5',
    '0-1': '0-1',
    '0-2': '0-2',
    '0-3': '0-3',
    '0-5': '0-5',
  };
  const objectTypeId = objectTypeMap[opts.objectType] || opts.objectType;

  const limit = opts.count ?? 20;
  const url = new URL(
    `${window.location.origin}/api/timeline/v2/object/${objectTypeId}/${opts.objectId}`,
  );
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('renderingRequested', 'true');
  url.searchParams.set('portalId', opts.portalId);
  if (opts.startTimestamp) {
    url.searchParams.set('startTimestamp', String(opts.startTimestamp));
  }

  const response = await fetch(url.toString(), {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  const data = await response.json();
  const events = (data.events || []).map((e: Record<string, unknown>) => {
    const event: Record<string, unknown> = {
      timestamp: e.timestamp,
      type: e.etype,
      id: e.id,
    };

    const ed = (e.eventData || {}) as Record<string, unknown>;

    const engagement = ed.engagement as Record<string, unknown> | undefined;
    const metadata = ed.metadata as Record<string, unknown> | undefined;
    const interpretedSource = ed.interpretedSource as
      | Record<string, unknown>
      | undefined;
    const sequence = ed.sequence as Record<string, unknown> | undefined;
    const interpretedPropertySource = ed.interpretedPropertySource as
      | Record<string, unknown>
      | undefined;

    switch (e.etype) {
      case 'eventEngagement':
        event.engagementType = ed.engagementType || engagement?.type;
        event.subject =
          metadata?.subject || metadata?.title || engagement?.bodyPreview || '';
        event.body = engagement?.bodyPreview || metadata?.body || '';
        event.engagementId = engagement?.id || ed.objectId;
        break;

      case 'eventLifecycleStage':
      case 'dealstageChange':
      case 'dealCreated':
        event.value = ed.value;
        event.sourceAction = ed.sourceAction;
        event.source = ed['source-type'];
        if (interpretedSource?.user) {
          const user = interpretedSource.user as Record<string, unknown>;
          event.changedBy = {
            userId: user.id,
            email: user.email,
            name: user.displayResult,
          };
        }
        break;

      case 'eventSequence':
        event.sequenceId = ed.sequenceId;
        event.state = ed.state;
        event.sequenceName = sequence?.name;
        break;

      case 'eventObjectCreated': {
        const interpretedSource2 =
          interpretedPropertySource?.interpretedSource as
            | Record<string, unknown>
            | undefined;
        event.source = interpretedSource2?.label;
        break;
      }

      default:
        event.eventData = ed;
        break;
    }

    return event;
  });

  return {
    events,
    hasMore: data.hasMore ?? false,
    nextTimestamp: data.nextTimestamp,
  };
}

export async function getPropertyHistory(
  opts: GetPropertyHistoryInput,
): Promise<GetPropertyHistoryOutput> {
  const objectTypeMap: Record<string, string> = {
    CONTACT: '0-1',
    COMPANY: '0-2',
    DEAL: '0-3',
    TICKET: '0-5',
    contacts: '0-1',
    companies: '0-2',
    deals: '0-3',
    tickets: '0-5',
    '0-1': '0-1',
    '0-2': '0-2',
    '0-3': '0-3',
    '0-5': '0-5',
  };
  const objectTypeId = objectTypeMap[opts.objectType] || opts.objectType;

  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/${objectTypeId}/${opts.objectId}`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');
  url.searchParams.set('allPropertiesFetchMode', 'all_versions');

  const response = await fetch(url.toString(), {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  const data = await response.json();
  const allProperties = data.properties || {};

  // Filter to requested properties (or all if none specified)
  const targetProps = opts.properties?.length
    ? opts.properties
    : Object.keys(allProperties);

  const history: GetPropertyHistoryOutput['history'] = {};

  for (const propName of targetProps) {
    const prop = allProperties[propName];
    if (!prop) continue;

    const versions = (prop.versions || []).map(
      (v: Record<string, unknown>) => ({
        value: v.value,
        timestamp: v.timestamp,
        source: v.source,
        sourceId: v.sourceId,
        updatedByUserId: v.updatedByUserId,
      }),
    );

    if (versions.length > 0) {
      history[propName] = {
        currentValue: prop.value,
        versions,
      };
    }
  }

  return { objectId: opts.objectId, history };
}
