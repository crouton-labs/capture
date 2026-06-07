/**
 * HubSpot Pinned Properties Operations
 *
 * Get, update, and reset pinned properties shown on the record sidebar.
 * Pinned properties are usually the best indicator of which properties users care about most.
 */

import type {
  GetPinnedPropertiesInput,
  GetPinnedPropertiesOutput,
  UpdatePinnedPropertiesInput,
  UpdatePinnedPropertiesOutput,
  ResetPinnedPropertiesInput,
} from '../schemas';
import { throwForStatus } from '@vallum/_runtime';

function buildCardUrl(
  origin: string,
  objectTypeId: string,
  portalId: string,
): string {
  const cardId = encodeURIComponent(`PROPERTIES_V3/${objectTypeId}/V2`);
  const url = new URL(
    `${origin}/api/crm-record-cards/v3/crm-cards/user-level-customization/${cardId}`,
  );
  url.searchParams.set('portalId', portalId);
  url.searchParams.set('objectTypeId', objectTypeId);
  url.searchParams.set('cardType', 'PROPERTIES_V3');
  return url.toString();
}

export async function getPinnedProperties(
  opts: GetPinnedPropertiesInput,
): Promise<GetPinnedPropertiesOutput> {
  const objectTypeId = opts.objectTypeId ?? '0-1';
  const url = buildCardUrl(window.location.origin, objectTypeId, opts.portalId);

  const resp = await fetch(url, {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!resp.ok) {
    throwForStatus(resp.status, resp.statusText || undefined);
  }

  const data = await resp.json();
  const entries = data.configuration?.userPropertyEntries ?? [];

  return {
    objectTypeId,
    properties: entries.map(
      (e: { propertyName: string; adminDefined: boolean }) => ({
        propertyName: e.propertyName,
        adminDefined: e.adminDefined,
      }),
    ),
    updatedAt: data.updatedAt ?? 0,
  };
}

export async function updatePinnedProperties(
  opts: UpdatePinnedPropertiesInput,
): Promise<UpdatePinnedPropertiesOutput> {
  const objectTypeId = opts.objectTypeId ?? '0-1';
  const url = buildCardUrl(window.location.origin, objectTypeId, opts.portalId);

  // Fetch current config to identify admin-defined properties
  const getResp = await fetch(url, {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!getResp.ok) {
    throwForStatus(getResp.status, await getResp.text().catch(() => undefined));
  }

  const current = await getResp.json();
  const currentEntries: Array<{ propertyName: string; adminDefined: boolean }> =
    current.configuration?.userPropertyEntries ?? [];
  const adminProps = new Set(
    currentEntries.filter((e) => e.adminDefined).map((e) => e.propertyName),
  );

  // Build final list: admin properties cannot be removed, only reordered.
  // Start with the user's requested list, preserving adminDefined flags.
  const requested = new Set(opts.propertyNames);
  const userPropertyEntries = opts.propertyNames.map((name) => ({
    adminDefined: adminProps.has(name),
    propertyName: name,
  }));

  // Append any admin properties the user omitted (API rejects removing them)
  for (const adminProp of adminProps) {
    if (!requested.has(adminProp)) {
      userPropertyEntries.push({
        adminDefined: true,
        propertyName: adminProp,
      });
    }
  }

  const body = {
    cardType: 'PROPERTIES_V3',
    configuration: {
      type: '.PropertiesV3UserDefinedConfiguration',
      userPropertyEntries,
    },
    cardId: `PROPERTIES_V3/${objectTypeId}/V2`,
  };

  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throwForStatus(resp.status, text || undefined);
  }

  return { updated: true };
}

export async function resetPinnedProperties(
  opts: ResetPinnedPropertiesInput,
): Promise<{ reset: true }> {
  const objectTypeId = opts.objectTypeId ?? '0-1';
  const url = buildCardUrl(window.location.origin, objectTypeId, opts.portalId);

  const resp = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (resp.status !== 204 && !resp.ok) {
    const text = await resp.text();
    throwForStatus(resp.status, text || undefined);
  }

  return { reset: true };
}
