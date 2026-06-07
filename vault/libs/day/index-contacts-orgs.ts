import type {
  ListOrganizationsInput,
  ListOrganizationsOutput,
  GetOrganizationInput,
  GetOrganizationOutput,
  SearchContactsInput,
  SearchContactsOutput,
  SearchOrganizationsInput,
  SearchOrganizationsOutput,
  CreateContactInput,
  CreateContactOutput,
  UpdateContactInput,
  UpdateContactOutput,
  CreateOrganizationInput,
  CreateOrganizationOutput,
  UpdateOrganizationInput,
  UpdateOrganizationOutput,
} from './schemas-contacts-orgs';
import { Validation, NotFound, UpstreamError, ContractDrift, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Constants
// ============================================================================

const TRPC_BASE = 'https://gateway.prod.day.ai/trpc';
const GRAPHQL_URL = 'https://day.ai/api/graphql';

// ============================================================================
// Helpers
// ============================================================================

interface TrpcResponse<T> {
  result: { data: T };
}

async function trpcCall<T>(
  accessToken: string,
  procedure: string,
  body: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(`${TRPC_BASE}/${procedure}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throwForStatus(resp.status, truncated);
  }

  const json = (await resp.json()) as TrpcResponse<T>;
  return json.result.data;
}

interface GqlResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

async function graphqlCall<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'auth-provider': 'supabase',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throwForStatus(resp.status, text.slice(0, 500));
  }

  const json = (await resp.json()) as GqlResponse<T>;
  if (json.errors && json.errors.length > 0) {
    throw new UpstreamError(`Day.ai GraphQL error: ${json.errors[0].message}`);
  }

  return json.data;
}

async function createObject(
  accessToken: string,
  workspaceId: string,
  objectId: string,
  objectType: string,
): Promise<void> {
  await graphqlCall<{ createObject: boolean }>(
    accessToken,
    `mutation CreateObjectFromWeb($workspaceId: String!, $objectId: String!, $objectType: String!) {
      createObject(workspaceId: $workspaceId, objectId: $objectId, objectType: $objectType)
    }`,
    { workspaceId, objectId, objectType },
  );
}

async function updateObjectProperty(
  accessToken: string,
  workspaceId: string,
  objectId: string,
  objectType: string,
  propertyDefinitionId: string,
  value: string,
  propertyType: string,
): Promise<void> {
  const result = await graphqlCall<{
    updateObjectProperty: { success: boolean };
  }>(
    accessToken,
    `mutation UpdateObjectProperty($input: UpdateObjectPropertyInput!) {
      updateObjectProperty(input: $input) { success }
    }`,
    {
      input: {
        workspaceId,
        objectId,
        objectType,
        propertyDefinitionId,
        value: { value },
        propertyType,
      },
    },
  );

  if (!result.updateObjectProperty.success) {
    throw new ContractDrift(
      `Failed to update ${propertyDefinitionId} on ${objectId}: server returned success=false`,
    );
  }
}

// ============================================================================
// Functions
// ============================================================================

/**
 * List organizations in the workspace.
 */
export async function listOrganizations(
  opts: ListOrganizationsInput,
): Promise<ListOrganizationsOutput> {
  const offset = opts.offset ? opts.offset : '1970-01-01T00:00:00.000Z';
  const limit = opts.limit ? opts.limit : 100;

  const items = await trpcCall<Record<string, unknown>[]>(
    opts.accessToken,
    'tables.getObjects',
    {
      workspaceId: opts.workspaceId,
      objectType: 'native_organization',
      offset,
      limit,
    },
  );

  return { organizations: items as ListOrganizationsOutput['organizations'] };
}

/**
 * Get a single organization by domain name.
 */
export async function getOrganization(
  opts: GetOrganizationInput,
): Promise<GetOrganizationOutput> {
  const items = await trpcCall<Record<string, unknown>[]>(
    opts.accessToken,
    'tables.getObjects',
    {
      workspaceId: opts.workspaceId,
      objectType: 'native_organization',
      offset: '1970-01-01T00:00:00.000Z',
      limit: 1000,
    },
  );

  const org = items.find(
    (o) => o.objectId === opts.domain || o._domain === opts.domain,
  );

  if (!org) {
    throw new NotFound(
      `Organization not found with domain: ${opts.domain}. Found ${items.length} organizations in workspace.`,
    );
  }

  return { organization: org as GetOrganizationOutput['organization'] };
}

/**
 * Search contacts by query string. Matches against name, email, and company.
 */
export async function searchContacts(
  opts: SearchContactsInput,
): Promise<SearchContactsOutput> {
  const offset = opts.offset ?? '1970-01-01T00:00:00.000Z';
  const limit = opts.limit ?? 1000;

  const items = await trpcCall<Record<string, unknown>[]>(
    opts.accessToken,
    'tables.getObjects',
    {
      workspaceId: opts.workspaceId,
      objectType: 'native_contact',
      offset,
      limit,
    },
  );

  const q = opts.query.toLowerCase();

  const matched = items.filter((c) => {
    const firstName =
      typeof c._firstName === 'string' ? c._firstName.toLowerCase() : '';
    const lastName =
      typeof c._lastName === 'string' ? c._lastName.toLowerCase() : '';
    const email = typeof c._email === 'string' ? c._email.toLowerCase() : '';
    const objectId =
      typeof c.objectId === 'string' ? c.objectId.toLowerCase() : '';
    const company =
      typeof c._currentCompanyName === 'string'
        ? c._currentCompanyName.toLowerCase()
        : '';
    const fullName = `${firstName} ${lastName}`.trim();

    return (
      firstName.includes(q) ||
      lastName.includes(q) ||
      fullName.includes(q) ||
      email.includes(q) ||
      objectId.includes(q) ||
      company.includes(q)
    );
  });

  return {
    contacts: matched as SearchContactsOutput['contacts'],
    total: matched.length,
  };
}

/**
 * Search organizations by query string. Matches against name and domain.
 */
export async function searchOrganizations(
  opts: SearchOrganizationsInput,
): Promise<SearchOrganizationsOutput> {
  const offset = opts.offset ? opts.offset : '1970-01-01T00:00:00.000Z';
  const limit = opts.limit ? opts.limit : 1000;

  const items = await trpcCall<Record<string, unknown>[]>(
    opts.accessToken,
    'tables.getObjects',
    {
      workspaceId: opts.workspaceId,
      objectType: 'native_organization',
      offset,
      limit,
    },
  );

  const q = opts.query.toLowerCase();

  const matched = items.filter((o) => {
    const name = typeof o._name === 'string' ? o._name.toLowerCase() : '';
    const domain = typeof o._domain === 'string' ? o._domain.toLowerCase() : '';
    const objectId =
      typeof o.objectId === 'string' ? o.objectId.toLowerCase() : '';

    return name.includes(q) || domain.includes(q) || objectId.includes(q);
  });

  return {
    organizations: matched as SearchOrganizationsOutput['organizations'],
    total: matched.length,
  };
}

/**
 * Create a new contact in the workspace. Email is the unique ID.
 */
export async function createContact(
  opts: CreateContactInput,
): Promise<CreateContactOutput> {
  if (!opts.accessToken) {
    throw new Validation(
      'createContact: accessToken is undefined; call getContext() first and ensure the workspace is not locked or session expired',
    );
  }

  await createObject(
    opts.accessToken,
    opts.workspaceId,
    opts.email,
    'native_contact',
  );

  const fieldUpdates: Array<[string, string, string]> = [];
  if (opts.firstName)
    fieldUpdates.push(['firstName', opts.firstName, 'textarea']);
  if (opts.lastName) fieldUpdates.push(['lastName', opts.lastName, 'textarea']);
  if (opts.jobTitle)
    fieldUpdates.push(['currentJobTitle', opts.jobTitle, 'textarea']);
  if (opts.companyName)
    fieldUpdates.push(['currentCompanyName', opts.companyName, 'textarea']);
  if (opts.linkedInUrl)
    fieldUpdates.push(['linkedInUrl', opts.linkedInUrl, 'url']);
  if (opts.phone) fieldUpdates.push(['phoneNumbers', opts.phone, 'textarea']);
  if (opts.description)
    fieldUpdates.push(['description', opts.description, 'textarea']);
  if (opts.headline) fieldUpdates.push(['headline', opts.headline, 'textarea']);
  if (opts.location) fieldUpdates.push(['location', opts.location, 'textarea']);
  if (opts.timezone) fieldUpdates.push(['timezone', opts.timezone, 'textarea']);
  if (opts.country) fieldUpdates.push(['country', opts.country, 'textarea']);
  if (opts.city) fieldUpdates.push(['city', opts.city, 'textarea']);
  if (opts.state) fieldUpdates.push(['state', opts.state, 'textarea']);
  if (opts.postalCode)
    fieldUpdates.push(['postalCode', opts.postalCode, 'textarea']);
  if (opts.twitterUrl)
    fieldUpdates.push(['socialTwitter', opts.twitterUrl, 'url']);
  if (opts.careerSummary)
    fieldUpdates.push(['careerSummary', opts.careerSummary, 'textarea']);
  if (opts.photoUrl) fieldUpdates.push(['photoUrl', opts.photoUrl, 'url']);

  for (const [propId, val, propType] of fieldUpdates) {
    await updateObjectProperty(
      opts.accessToken,
      opts.workspaceId,
      opts.email,
      'native_contact',
      propId,
      val,
      propType,
    );
  }

  // Day.ai uses Materialize for read models; newly created objects take 1-3s
  // to appear in tables.getObjects. Retry with delay.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    const items = await trpcCall<Record<string, unknown>[]>(
      opts.accessToken,
      'tables.getObjects',
      {
        workspaceId: opts.workspaceId,
        objectType: 'native_contact',
        offset: '1970-01-01T00:00:00.000Z',
        limit: 1000,
      },
    );

    const contact = items.find(
      (c) => c.objectId === opts.email || c._email === opts.email,
    );

    if (contact) {
      return { contact: contact as CreateContactOutput['contact'] };
    }
  }

  throw new UpstreamError(
    `Contact created but not found in workspace after retries. Email: ${opts.email}`,
  );
}

/**
 * Update properties on an existing contact.
 */
export async function updateContact(
  opts: UpdateContactInput,
): Promise<UpdateContactOutput> {
  const fieldUpdates: Array<[string, string, string]> = [];
  if (opts.firstName !== undefined)
    fieldUpdates.push(['firstName', opts.firstName, 'textarea']);
  if (opts.lastName !== undefined)
    fieldUpdates.push(['lastName', opts.lastName, 'textarea']);
  if (opts.jobTitle !== undefined)
    fieldUpdates.push(['currentJobTitle', opts.jobTitle, 'textarea']);
  if (opts.companyName !== undefined)
    fieldUpdates.push(['currentCompanyName', opts.companyName, 'textarea']);
  if (opts.linkedInUrl !== undefined)
    fieldUpdates.push(['linkedInUrl', opts.linkedInUrl, 'url']);
  if (opts.phone !== undefined)
    fieldUpdates.push(['phoneNumbers', opts.phone, 'textarea']);

  if (fieldUpdates.length === 0) {
    throw new Validation('No fields provided to update.');
  }

  for (const [propId, val, propType] of fieldUpdates) {
    await updateObjectProperty(
      opts.accessToken,
      opts.workspaceId,
      opts.email,
      'native_contact',
      propId,
      val,
      propType,
    );
  }

  const items = await trpcCall<Record<string, unknown>[]>(
    opts.accessToken,
    'tables.getObjects',
    {
      workspaceId: opts.workspaceId,
      objectType: 'native_contact',
      offset: '1970-01-01T00:00:00.000Z',
      limit: 1000,
    },
  );

  const contact = items.find(
    (c) => c.objectId === opts.email || c._email === opts.email,
  );

  if (!contact) {
    throw new NotFound(`Contact not found with email: ${opts.email}`);
  }

  return { contact: contact as UpdateContactOutput['contact'] };
}

/**
 * Create a new organization in the workspace. Domain is the unique ID.
 */
export async function createOrganization(
  opts: CreateOrganizationInput,
): Promise<CreateOrganizationOutput> {
  if (!opts.domain || opts.domain.trim() === '') {
    throw new Validation(
      'createOrganization: domain must not be empty. Provide a bare hostname like "example.com".',
    );
  }
  if (opts.domain.startsWith('http://') || opts.domain.startsWith('https://')) {
    throw new Validation(
      `createOrganization: domain must be a bare hostname like "example.com", not a full URL. Got: "${opts.domain}". Strip the protocol prefix before calling this function.`,
    );
  }

  await createObject(
    opts.accessToken,
    opts.workspaceId,
    opts.domain,
    'native_organization',
  );

  const textUpdates: Array<[string, string]> = [];
  if (opts.name) textUpdates.push(['name', opts.name]);
  if (opts.description) textUpdates.push(['description', opts.description]);
  if (opts.industry) textUpdates.push(['industry', opts.industry]);
  if (opts.industryType) textUpdates.push(['industryType', opts.industryType]);
  if (opts.website) textUpdates.push(['resolvedUrl', opts.website]);
  if (opts.linkedInUrl) textUpdates.push(['socialLinkedIn', opts.linkedInUrl]);
  if (opts.socialFacebook)
    textUpdates.push(['socialFacebook', opts.socialFacebook]);
  if (opts.socialTwitter)
    textUpdates.push(['socialTwitter', opts.socialTwitter]);
  if (opts.socialYouTube)
    textUpdates.push(['socialYouTube', opts.socialYouTube]);
  if (opts.socialInstagram)
    textUpdates.push(['socialInstagram', opts.socialInstagram]);
  if (opts.photoSquare) textUpdates.push(['photoSquare', opts.photoSquare]);
  if (opts.city) textUpdates.push(['city', opts.city]);
  if (opts.state) textUpdates.push(['state', opts.state]);
  if (opts.country) textUpdates.push(['country', opts.country]);
  if (opts.postalCode) textUpdates.push(['postalCode', opts.postalCode]);
  if (opts.location) textUpdates.push(['location', opts.location]);
  if (opts.address) textUpdates.push(['address', opts.address]);
  if (opts.founded) textUpdates.push(['founded', opts.founded]);
  if (opts.stockTicker) textUpdates.push(['stockTicker', opts.stockTicker]);
  if (opts.isHiring !== undefined)
    textUpdates.push(['isHiring', String(opts.isHiring)]);

  for (const [propId, val] of textUpdates) {
    await updateObjectProperty(
      opts.accessToken,
      opts.workspaceId,
      opts.domain,
      'native_organization',
      propId,
      val,
      'textarea',
    );
  }

  const numberUpdates: Array<[string, number]> = [];
  if (opts.employeeCount !== undefined)
    numberUpdates.push(['employeeCount', opts.employeeCount]);
  if (opts.employeeCountFrom !== undefined)
    numberUpdates.push(['employeeCountFrom', opts.employeeCountFrom]);
  if (opts.employeeCountTo !== undefined)
    numberUpdates.push(['employeeCountTo', opts.employeeCountTo]);
  if (opts.annualRevenue !== undefined)
    numberUpdates.push(['annualRevenue', opts.annualRevenue]);
  if (opts.funding !== undefined) numberUpdates.push(['funding', opts.funding]);

  for (const [propId, val] of numberUpdates) {
    await updateObjectProperty(
      opts.accessToken,
      opts.workspaceId,
      opts.domain,
      'native_organization',
      propId,
      String(val),
      'number',
    );
  }

  // Day.ai uses Materialize for read models; newly created objects take 1-3s
  // to appear in tables.getObjects. Retry with delay.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    const items = await trpcCall<Record<string, unknown>[]>(
      opts.accessToken,
      'tables.getObjects',
      {
        workspaceId: opts.workspaceId,
        objectType: 'native_organization',
        offset: '1970-01-01T00:00:00.000Z',
        limit: 1000,
      },
    );

    const org = items.find((o) => o.objectId === opts.domain);

    if (org) {
      return { organization: org as CreateOrganizationOutput['organization'] };
    }
  }

  throw new UpstreamError(
    `Organization created but not found in workspace after retries. Domain: ${opts.domain}`,
  );
}

/**
 * Update properties on an existing organization.
 */
export async function updateOrganization(
  opts: UpdateOrganizationInput,
): Promise<UpdateOrganizationOutput> {
  const fieldUpdates: Array<[string, string]> = [];
  if (opts.name !== undefined) fieldUpdates.push(['name', opts.name]);
  if (opts.description !== undefined)
    fieldUpdates.push(['description', opts.description]);
  if (opts.industry !== undefined)
    fieldUpdates.push(['industry', opts.industry]);
  if (opts.website !== undefined)
    fieldUpdates.push(['resolvedUrl', opts.website]);
  if (opts.linkedInUrl !== undefined)
    fieldUpdates.push(['socialLinkedIn', opts.linkedInUrl]);

  if (fieldUpdates.length === 0) {
    throw new Validation('No fields provided to update.');
  }

  for (const [propId, val] of fieldUpdates) {
    await updateObjectProperty(
      opts.accessToken,
      opts.workspaceId,
      opts.domain,
      'native_organization',
      propId,
      val,
      'textarea',
    );
  }

  const items = await trpcCall<Record<string, unknown>[]>(
    opts.accessToken,
    'tables.getObjects',
    {
      workspaceId: opts.workspaceId,
      objectType: 'native_organization',
      offset: '1970-01-01T00:00:00.000Z',
      limit: 1000,
    },
  );

  const org = items.find((o) => o.objectId === opts.domain);

  if (!org) {
    throw new NotFound(`Organization not found with domain: ${opts.domain}`);
  }

  return { organization: org as UpdateOrganizationOutput['organization'] };
}
