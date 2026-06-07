/**
 * HubSpot Merge Operations
 *
 * Merge duplicate companies and contacts.
 */

import type {
  MergeCompaniesInput,
  MergeCompaniesOutput,
  MergeContactsInput,
  MergeContactsOutput,
} from '../schemas';
import { throwForStatus } from '@vallum/_runtime';

/**
 * Merge two companies into one.
 * The secondary company is merged INTO the primary company.
 * All associations, activities, and properties from the secondary are moved to the primary.
 * The secondary company is then deleted.
 *
 * @param primaryCompanyId - The company to keep (receives all data)
 * @param companyIdToMerge - The company to merge and delete
 */
export async function mergeCompanies(
  opts: MergeCompaniesInput,
): Promise<MergeCompaniesOutput> {
  const url = new URL(
    `${window.location.origin}/api/crm/v3/objects/companies/merge`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({
      primaryObjectId: opts.primaryCompanyId,
      objectIdToMerge: opts.companyIdToMerge,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  const data = await response.json();

  return {
    mergedObjectId: data.id || opts.primaryCompanyId,
    primaryObjectId: opts.primaryCompanyId,
    objectIdMerged: opts.companyIdToMerge,
  };
}

/**
 * Merge two contacts into one.
 * The secondary contact is merged INTO the primary contact.
 * All associations, activities, and properties from the secondary are moved to the primary.
 * The secondary contact is then deleted.
 *
 * @param primaryContactId - The contact to keep (receives all data)
 * @param contactIdToMerge - The contact to merge and delete
 */
export async function mergeContacts(
  opts: MergeContactsInput,
): Promise<MergeContactsOutput> {
  const url = new URL(
    `${window.location.origin}/api/crm/v3/objects/contacts/merge`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({
      primaryObjectId: opts.primaryContactId,
      objectIdToMerge: opts.contactIdToMerge,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  const data = await response.json();

  return {
    mergedObjectId: data.id || opts.primaryContactId,
    primaryObjectId: opts.primaryContactId,
    objectIdMerged: opts.contactIdToMerge,
  };
}
