/**
 * HubSpot Owners Operations
 *
 * User/owner management in HubSpot portals.
 */

import { ContractDrift, throwForStatus } from '@vallum/_runtime';

export interface Owner {
  id: string;
  email: string;
  type: string;
  firstName: string;
  lastName: string;
  userId: number;
  userIdIncludingInactive: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export async function listOwners(opts: {
  csrf: string;
  portalId: string;
}): Promise<Owner[]> {
  const url = new URL(`${window.location.origin}/api/crm/v3/owners`);
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('limit', '100');

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

  if (!data.results || !Array.isArray(data.results)) {
    throw new ContractDrift('Invalid response: missing results array');
  }

  return data.results;
}
