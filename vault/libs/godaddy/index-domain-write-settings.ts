/**
 * GoDaddy — domain write settings.
 *
 * Management writes against mgnt.dcc.api.godaddy.com (DCC `mgmtApi`): auto-renew,
 * registrar lock, nameservers, contacts, and URL forwarding. All account-scoped
 * via the signed-in session's customerId; callers thread no account ids.
 */

import { dccFetch, getCustomerId, MGNT_DCC_API, Validation } from './_shared';
import type {
  DomainContactSet,
  DomainForwardingConfig,
  SetDomainAutoRenewOutput,
  SetDomainLockOutput,
  UpdateDomainNameserversOutput,
  UpdateDomainContactsOutput,
  UpdateDomainForwardingOutput,
  DeleteDomainForwardingOutput,
} from './schemas-domain-write-settings';

export type {
  DomainContact,
  DomainContactSet,
  DomainForwardingConfig,
  SetDomainAutoRenewOutput,
  SetDomainLockOutput,
  UpdateDomainNameserversOutput,
  UpdateDomainContactsOutput,
  UpdateDomainForwardingOutput,
  DeleteDomainForwardingOutput,
} from './schemas-domain-write-settings';

const CONTACT_ROLES = ['registrant', 'admin', 'tech', 'billing'] as const;
type ContactRole = (typeof CONTACT_ROLES)[number];

/** Base path for the customer-scoped management write surface. */
function domainsBase(version: 'v1' | 'v2' = 'v1'): string {
  return `${MGNT_DCC_API}/${version}/customers/${getCustomerId()}/domains`;
}

function dryRunQuery(dryRun: boolean): string {
  return `?dryRun=${dryRun ? 'true' : 'false'}`;
}

// ============================================================================
// setDomainAutoRenew
// ============================================================================

export async function setDomainAutoRenew(args: {
  domainNames: string[];
  autoRenew: boolean;
  dryRun?: boolean;
}): Promise<SetDomainAutoRenewOutput> {
  if (!args.domainNames?.length) {
    throw new Validation(
      'setDomainAutoRenew requires at least one domain name.',
    );
  }
  if (typeof args.autoRenew !== 'boolean') {
    throw new Validation(
      'setDomainAutoRenew requires autoRenew to be a boolean.',
    );
  }

  const dryRun = args.dryRun ?? false;
  await dccFetch(`${domainsBase()}/autorenew${dryRunQuery(dryRun)}`, {
    method: 'POST',
    body: JSON.stringify({
      domainFilter: { names: args.domainNames, type: 'INCLUDE' },
      enable: args.autoRenew,
    }),
  });

  return { domainNames: args.domainNames, autoRenew: args.autoRenew, dryRun };
}

// ============================================================================
// setDomainLock
// ============================================================================

export async function setDomainLock(args: {
  domainNames: string[];
  locked: boolean;
}): Promise<SetDomainLockOutput> {
  if (!args.domainNames?.length) {
    throw new Validation('setDomainLock requires at least one domain name.');
  }
  if (typeof args.locked !== 'boolean') {
    throw new Validation('setDomainLock requires locked to be a boolean.');
  }

  await dccFetch(`${domainsBase()}/updateLocks`, {
    method: 'POST',
    body: JSON.stringify({
      domainFilter: { names: args.domainNames, type: 'INCLUDE' as const },
      lock: args.locked,
    }),
  });

  return { domainNames: args.domainNames, locked: args.locked };
}

// ============================================================================
// updateDomainNameservers
// ============================================================================

export async function updateDomainNameservers(args: {
  domainNames: string[];
  nameservers: string[];
  nameserverType?: 'DEFAULT' | 'HOSTING' | 'FORWARDING' | 'CUSTOM';
  dryRun?: boolean;
}): Promise<UpdateDomainNameserversOutput> {
  if (!args.domainNames?.length) {
    throw new Validation(
      'updateDomainNameservers requires at least one domain name.',
    );
  }
  if (!args.nameservers?.length) {
    throw new Validation(
      'updateDomainNameservers requires at least one nameserver hostname.',
    );
  }

  const dryRun = args.dryRun ?? false;
  const nameserverType = args.nameserverType ?? 'CUSTOM';
  await dccFetch(`${domainsBase()}/updateNameServers${dryRunQuery(dryRun)}`, {
    method: 'POST',
    body: JSON.stringify({
      domainFilter: { names: args.domainNames, type: 'INCLUDE' },
      nameServers: args.nameservers,
      entity: { nameserverType },
    }),
  });

  return {
    domainNames: args.domainNames,
    nameservers: args.nameservers,
    dryRun,
  };
}

// ============================================================================
// updateDomainContacts
// ============================================================================

/** Standard agreement IDs required by the registrar contacts PATCH endpoint. */
const STANDARD_AGREEMENT_IDS = ['UTOS', 'DNRA', 'DOMAIN_NC'] as const;

/**
 * Build the `agreements` body field required by the registrar/contacts endpoint.
 * Scoped to only the API role keys being updated (e.g. 'administrative', not all 4).
 */
function buildContactAgreements(
  apiRoles: string[],
  extraAgreementId?: string,
): Record<string, Array<{ agreementId: string; consent: boolean }>> {
  const ids = extraAgreementId
    ? [...STANDARD_AGREEMENT_IDS, extraAgreementId]
    : [...STANDARD_AGREEMENT_IDS];
  const list = ids.map((agreementId) => ({ agreementId, consent: true }));
  const result: Record<
    string,
    Array<{ agreementId: string; consent: boolean }>
  > = {};
  for (const role of apiRoles) {
    result[role] = list;
  }
  return result;
}

/** Validate required fields within a contact object (nameFirst, nameLast, email, phone, addressMailing.*). */
function validateContactFields(
  contact: NonNullable<DomainContactSet[ContactRole]>,
  role: string,
): void {
  const ctx = `updateDomainContacts contacts.${role}`;
  if (!contact.nameFirst) throw new Validation(`${ctx}.nameFirst is required.`);
  if (!contact.nameLast) throw new Validation(`${ctx}.nameLast is required.`);
  if (!contact.email) throw new Validation(`${ctx}.email is required.`);
  if (!contact.phone) throw new Validation(`${ctx}.phone is required.`);
  if (!contact.addressMailing)
    throw new Validation(`${ctx}.addressMailing is required.`);
  const addr = contact.addressMailing;
  if (!addr.address1)
    throw new Validation(`${ctx}.addressMailing.address1 is required.`);
  if (!addr.city)
    throw new Validation(`${ctx}.addressMailing.city is required.`);
  if (!addr.state)
    throw new Validation(`${ctx}.addressMailing.state is required.`);
  if (!addr.postalCode)
    throw new Validation(`${ctx}.addressMailing.postalCode is required.`);
  if (!addr.country)
    throw new Validation(`${ctx}.addressMailing.country is required.`);
}

/** Remap user-facing contact role keys to the API's expected key names. */
function toApiContactSet(set: DomainContactSet): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (set.registrant != null) out.registrant = set.registrant;
  if (set.admin != null) out.administrative = set.admin;
  if (set.tech != null) out.technical = set.tech;
  if (set.billing != null) out.billing = set.billing;
  return out;
}

export async function updateDomainContacts(args: {
  domainNames: string[];
  contacts: DomainContactSet;
  localContacts?: DomainContactSet;
  dryRun?: boolean;
}): Promise<UpdateDomainContactsOutput> {
  if (!args.domainNames?.length) {
    throw new Validation(
      'updateDomainContacts requires at least one domain name.',
    );
  }
  const updatedRoles = CONTACT_ROLES.filter(
    (role) => args.contacts?.[role] != null,
  ) as ContactRole[];
  if (!updatedRoles.length) {
    throw new Validation(
      'updateDomainContacts requires at least one contact role (registrant, admin, tech, or billing).',
    );
  }
  for (const role of updatedRoles) {
    validateContactFields(args.contacts[role]!, role);
  }

  const dryRun = args.dryRun ?? false;
  const contactsObj = toApiContactSet(args.contacts);
  const body: Record<string, unknown> = {
    domainFilter: { names: args.domainNames, type: 'INCLUDE' },
    contacts: contactsObj,
    agreements: buildContactAgreements(Object.keys(contactsObj)),
    localContacts: toApiContactSet(args.localContacts ?? args.contacts),
  };

  await dccFetch(`${domainsBase()}/registrar/contacts${dryRunQuery(dryRun)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

  return { domainNames: args.domainNames, updatedRoles, dryRun };
}

// ============================================================================
// updateDomainForwarding
// ============================================================================

const FORWARDING_TYPES = [
  'MASKED',
  'REDIRECT_PERMANENT',
  'REDIRECT_TEMPORARY',
] as const;

export async function updateDomainForwarding(args: {
  domainName: string;
  subdomain?: string;
  forwarding: DomainForwardingConfig;
}): Promise<UpdateDomainForwardingOutput> {
  if (!args.domainName) {
    throw new Validation('updateDomainForwarding requires a domainName.');
  }
  if (!args.forwarding?.type || !args.forwarding?.destination) {
    throw new Validation(
      'updateDomainForwarding requires forwarding.type and forwarding.destination.',
    );
  }
  if (
    !FORWARDING_TYPES.includes(
      args.forwarding.type as (typeof FORWARDING_TYPES)[number],
    )
  ) {
    throw new Validation(
      `updateDomainForwarding: forwarding.type must be one of MASKED, REDIRECT_PERMANENT, REDIRECT_TEMPORARY. Got: "${args.forwarding.type}".`,
    );
  }

  const fqdn = args.subdomain
    ? `${args.subdomain}.${args.domainName}`
    : args.domainName;
  const customerId = getCustomerId();
  await dccFetch(
    `${MGNT_DCC_API}/v1/customers/${customerId}/domains/${encodeURIComponent(args.domainName)}/domainforwarding`,
    {
      method: 'POST',
      body: JSON.stringify({ fqdn, ...args.forwarding }),
    },
  );

  return {
    domainName: args.domainName,
    ...(args.subdomain ? { subdomain: args.subdomain } : {}),
    forwarding: args.forwarding,
  };
}

// ============================================================================
// deleteDomainForwarding
// ============================================================================

export async function deleteDomainForwarding(args: {
  domainName: string;
  subdomain?: string;
}): Promise<DeleteDomainForwardingOutput> {
  if (!args.domainName) {
    throw new Validation('deleteDomainForwarding requires a domainName.');
  }

  const customerId = getCustomerId();
  const base = `${MGNT_DCC_API}/v1/customers/${customerId}/domains/${encodeURIComponent(args.domainName)}/domainforwarding`;
  const fqdn = args.subdomain
    ? `${args.subdomain}.${args.domainName}`
    : args.domainName;

  await dccFetch(`${base}?fqdn=${encodeURIComponent(fqdn)}`, {
    method: 'DELETE',
  });

  return {
    domainName: args.domainName,
    ...(args.subdomain ? { subdomain: args.subdomain } : {}),
    deleted: true,
  };
}
