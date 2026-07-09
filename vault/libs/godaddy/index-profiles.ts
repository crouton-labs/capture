/**
 * GoDaddy — domain profiles (portfolio organization).
 *
 * Domain profiles are reusable bundles of domain settings (auto-renew,
 * registrar lock, privacy, nameservers, contacts, forwarding) that can be
 * applied to many domains at once. Backed by the DCC `profilesApi` group on
 * domainsapi.godaddy.com; cookie auth + DCC-DomainController app key.
 */

import {
  dccFetch,
  getCustomerId,
  PROFILE_API,
  Validation,
  ContractDrift,
} from './_shared';
import type {
  DomainProfile,
  ListDomainProfilesOutput,
  CreateDomainProfileOutput,
  UpdateDomainProfileOutput,
  DeleteDomainProfileOutput,
  ApplyDomainProfileOutput,
} from './schemas-profiles';

export type {
  DomainProfile,
  ListDomainProfilesOutput,
  CreateDomainProfileOutput,
  UpdateDomainProfileOutput,
  DeleteDomainProfileOutput,
  ApplyDomainProfileOutput,
} from './schemas-profiles';

function toProfile(raw: Record<string, unknown>): DomainProfile {
  return { ...raw, profileId: String(raw.profileId) } as DomainProfile;
}

export async function listDomainProfiles(): Promise<ListDomainProfilesOutput> {
  const cid = getCustomerId();
  const resp = await dccFetch<{ profiles: Array<Record<string, unknown>> }>(
    `${PROFILE_API}/v1/customers/${cid}/domains/profiles`,
    {},
    'DCC_Controller',
  );
  if (!Array.isArray(resp?.profiles)) {
    throw new ContractDrift(
      `listDomainProfiles: unexpected response shape — expected {profiles:[...]}, got: ${JSON.stringify(resp).slice(0, 200)}`,
    );
  }
  const profiles = resp.profiles.map(toProfile);
  return { profiles, total: profiles.length };
}

export async function createDomainProfile(args: {
  name: string;
  description?: string;
  privacy?: boolean;
  contacts?: Record<string, unknown>;
  forwarding?: Record<string, unknown>;
  renewAuto?: { apply: boolean; enabled?: boolean };
  locking?: { apply: boolean; enabled?: boolean };
  nameServers?: {
    apply: boolean;
    source?: 'HOSTED' | 'PARKED' | 'CUSTOM';
    hostnames?: string[];
  };
  [key: string]: unknown;
}): Promise<CreateDomainProfileOutput> {
  if (!args?.name || !args.name.trim()) {
    throw new Validation('createDomainProfile requires a non-empty `name`.');
  }
  const cid = getCustomerId();
  const createResp = await dccFetch<Record<string, unknown>>(
    `${PROFILE_API}/v1/customers/${cid}/domains/profiles`,
    { method: 'POST', body: JSON.stringify(args) },
    'DCC_Controller',
  );
  const profileId = createResp?.profileId;
  if (!profileId) {
    throw new ContractDrift(
      `createDomainProfile: response missing profileId: ${JSON.stringify(createResp).slice(0, 200)}`,
    );
  }
  const profileResp = await dccFetch<Record<string, unknown>>(
    `${PROFILE_API}/v1/customers/${cid}/domains/profiles/${encodeURIComponent(String(profileId))}`,
    {},
    'DCC_Controller',
  );
  return { profile: toProfile(profileResp) };
}

export async function updateDomainProfile(args: {
  profileId: string;
  name?: string;
  description?: string;
  privacy?: boolean;
  contacts?: Record<string, unknown>;
  forwarding?: Record<string, unknown>;
  renewAuto?: { apply: boolean; enabled?: boolean };
  locking?: { apply: boolean; enabled?: boolean };
  nameServers?: {
    apply: boolean;
    source?: 'HOSTED' | 'PARKED' | 'CUSTOM';
    hostnames?: string[];
  };
  [key: string]: unknown;
}): Promise<UpdateDomainProfileOutput> {
  if (!args?.profileId) {
    throw new Validation('updateDomainProfile requires `profileId`.');
  }
  if (typeof args.name === 'string' && args.name.trim() === '') {
    throw new Validation(
      'updateDomainProfile: `name` must not be empty. Omit the field to keep the current name.',
    );
  }
  const cid = getCustomerId();
  const { profileId, ...changes } = args;

  // GoDaddy PATCH replaces the entire profile — it is NOT a partial update.
  // Must read-modify-write to avoid silently resetting unspecified fields to defaults.
  const current = await dccFetch<Record<string, unknown>>(
    `${PROFILE_API}/v1/customers/${cid}/domains/profiles/${encodeURIComponent(profileId)}`,
    {},
    'DCC_Controller',
  );
  // Strip non-writable identity fields before merging.
  const { profileId: _id, ...currentFields } = current;
  const merged = { ...currentFields, ...changes };

  await dccFetch<unknown>(
    `${PROFILE_API}/v1/customers/${cid}/domains/profiles/${encodeURIComponent(profileId)}`,
    { method: 'PATCH', body: JSON.stringify(merged) },
    'DCC_Controller',
  );
  // PATCH returns 202 null; re-fetch to return the updated profile.
  const profileResp = await dccFetch<Record<string, unknown>>(
    `${PROFILE_API}/v1/customers/${cid}/domains/profiles/${encodeURIComponent(profileId)}`,
    {},
    'DCC_Controller',
  );
  return { profile: toProfile(profileResp) };
}

export async function deleteDomainProfile(args: {
  profileId: string;
}): Promise<DeleteDomainProfileOutput> {
  if (!args?.profileId) {
    throw new Validation('deleteDomainProfile requires `profileId`.');
  }
  const cid = getCustomerId();
  await dccFetch<unknown>(
    `${PROFILE_API}/v1/customers/${cid}/domains/profiles/${encodeURIComponent(args.profileId)}`,
    { method: 'DELETE' },
    'DCC_Controller',
  );
  return { profileId: args.profileId, deleted: true };
}

export async function applyDomainProfile(args: {
  profileId: string;
  domainNames: string[];
}): Promise<ApplyDomainProfileOutput> {
  if (!args?.profileId) {
    throw new Validation('applyDomainProfile requires `profileId`.');
  }
  if (!Array.isArray(args.domainNames) || args.domainNames.length === 0) {
    throw new Validation(
      'applyDomainProfile requires a non-empty `domainNames` array.',
    );
  }
  const cid = getCustomerId();
  await dccFetch<unknown>(
    `${PROFILE_API}/v1/customers/${cid}/profiles/${encodeURIComponent(args.profileId)}/domain/$each/add`,
    { method: 'POST', body: JSON.stringify({ domains: args.domainNames }) },
    'DCC_Controller',
  );
  return {
    profileId: args.profileId,
    applied: args.domainNames,
    count: args.domainNames.length,
  };
}
