/**
 * Outlook Contacts: listContacts, getContact, createContact, updateContact, deleteContact
 *
 * All operations use the PeopleGraphVx REST endpoint.
 * OWA REST responses use camelCase field names.
 */

import type {
  OutlookAuth,
  ListContactsInput,
  ListContactsOutput,
  GetContactInput,
  GetContactOutput,
  CreateContactInput,
  CreateContactOutput,
  UpdateContactInput,
  UpdateContactOutput,
  DeleteContactInput,
  DeleteContactOutput,
  ContactSummary,
  ContactEmail,
  ContactPhone,
  ContactAddress,
  ContactPosition,
  ContactWebAccount,
  ContactTag,
} from './schemas';
import { Validation, ContractDrift, NotFound, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Local Helpers
// ============================================================================

/** Explicitly validate that a value is a string; return empty string otherwise. */
function str(val: unknown): string {
  return typeof val === 'string' ? val : '';
}

/** Explicitly validate that a value is a boolean; return false otherwise. */
function bool(val: unknown): boolean {
  return typeof val === 'boolean' ? val : false;
}

/**
 * Build headers for the PeopleGraph REST endpoint (GET; no action header, no content-type).
 */
function buildRestHeaders(auth: OutlookAuth): Record<string, string> {
  const headers: Record<string, string> = {
    'x-owa-sessionid': auth.sessionId,
    'x-anchormailbox': auth.anchorMailbox,
    'x-owa-correlationid': auth.correlationId,
    'x-req-source': 'People',
    'x-owa-hosted-ux': 'false',
    prefer: 'IdType="ImmutableId"',
  };

  if (auth.canary && auth.canary !== 'X-OWA-CANARY_cookie_is_null_or_empty') {
    headers['x-owa-canary'] = auth.canary;
  }

  if (auth.authorization) {
    headers.authorization = auth.authorization;
  }

  return headers;
}

// ============================================================================
// REST (PeopleGraphVx) Response Parsers
// ============================================================================

/**
 * Parse email addresses from PeopleGraphVx REST response.
 * Format: array of { address, displayName, type }
 */
function parseContactEmailsRest(raw: unknown): ContactEmail[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>).map((e) => ({
    address: str(e.address),
    displayName: str(e.displayName),
    type: str(e.type),
  }));
}

/**
 * Parse phone numbers from PeopleGraphVx REST response.
 * Format: array of { number, displayName, type }
 */
function parseContactPhonesRest(raw: unknown): ContactPhone[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>).map((p) => ({
    number: str(p.number),
    type: str(p.type),
  }));
}

/**
 * Parse postal addresses from PeopleGraphVx REST response.
 * Format: array of { detail: { street, city, state, postalCode, countryOrRegion, type } }
 */
function parseContactAddressesRest(raw: unknown): ContactAddress[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>).map((a) => {
    const detail = a.detail as Record<string, unknown> | undefined;
    const result: ContactAddress = {
      street: str(detail?.street),
      city: str(detail?.city),
      state: str(detail?.state),
      postalCode: str(detail?.postalCode),
      country: str(detail?.countryOrRegion),
      type: str(detail?.type),
    };
    const poBox = str(detail?.postOfficeBox);
    if (poBox) result.postOfficeBox = poBox;
    return result;
  });
}

/**
 * Parse work positions from PeopleGraphVx REST response.
 * Format: array of { detail: { jobTitle, company: { displayName, department } }, isCurrent, ... }
 */
function parseContactPositionsRest(raw: unknown): ContactPosition[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>).map((p) => {
    const detail = p.detail as Record<string, unknown> | undefined;
    const company = detail?.company as Record<string, unknown> | undefined;
    return {
      company: str(company?.displayName),
      title: str(detail?.jobTitle),
      department: str(company?.department),
      startDate: str(detail?.startMonthYear),
      endDate: str(detail?.endMonthYear),
      isCurrent: bool(p.isCurrent),
    };
  });
}

/**
 * Parse notes from PeopleGraphVx REST response.
 * Format: array of { detail: { content, contentType } }
 */
function parseNotesRest(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return '';
  const first = (raw as Array<Record<string, unknown>>)[0];
  const detail = first?.detail as Record<string, unknown> | undefined;
  return str(detail?.content);
}

/**
 * Parse photo URL from PeopleGraphVx REST response photos array.
 * Format: array of { detail: { url } }
 */
function parsePhotoUrlRest(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return '';
  const first = (raw as Array<Record<string, unknown>>)[0];
  const detail = first?.detail as Record<string, unknown> | undefined;
  return str(detail?.url);
}

/**
 * Extract company name from positions array.
 */
function parseCompanyFromPositions(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return '';
  const first = (raw as Array<Record<string, unknown>>)[0];
  const detail = first?.detail as Record<string, unknown> | undefined;
  const company = detail?.company as Record<string, unknown> | undefined;
  return str(company?.displayName);
}

/**
 * Extract job title from the first position's detail.jobTitle.
 */
function parseJobTitleFromPositions(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return '';
  const first = (raw as Array<Record<string, unknown>>)[0];
  const detail = first?.detail as Record<string, unknown> | undefined;
  return str(detail?.jobTitle);
}

/**
 * Extract department from the first position's detail.company.department.
 */
function parseDepartmentFromPositions(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return '';
  const first = (raw as Array<Record<string, unknown>>)[0];
  const detail = first?.detail as Record<string, unknown> | undefined;
  const company = detail?.company as Record<string, unknown> | undefined;
  return str(company?.department);
}

/**
 * Extract office location from the first position's detail.company.officeLocation.
 */
function parseOfficeLocationFromPositions(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return '';
  const first = (raw as Array<Record<string, unknown>>)[0];
  const detail = first?.detail as Record<string, unknown> | undefined;
  const company = detail?.company as Record<string, unknown> | undefined;
  return str(company?.officeLocation);
}

/**
 * Parse anniversaries from PeopleGraphVx REST response.
 * Format: array of { date, type } (top-level fields, not nested in detail)
 */
function parseAnniversariesRest(
  raw: unknown,
): { date: string; type: string }[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>).map((a) => ({
    date: str(a.date),
    type: str(a.type),
  }));
}

/**
 * Parse websites from PeopleGraphVx REST response.
 * Format: array of { detail: { address, displayName, categories } }
 */
function parseWebsitesRest(
  raw: unknown,
): { webUrl: string; displayName: string; type: string }[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .map((w) => {
      const cats = Array.isArray(w.categories)
        ? (w.categories as string[])
        : [];
      return {
        webUrl: str(w.webUrl),
        displayName: str(w.displayName),
        type: cats.length > 0 ? cats[0] : '',
      };
    })
    .filter((w) => w.webUrl !== '');
}

/**
 * Parse relationships from PeopleGraphVx REST response.
 * Combines positions[].manager and positions[].colleagues with top-level relationships expansion.
 * Format for relationships expansion: array of { detail: { displayName, relationship } }
 * Format for positions: manager: { displayName, relationship }, colleagues: [{ displayName, relationship }]
 */
function parseRelationshipsFromPositions(
  raw: unknown,
): { displayName: string; relationship: string }[] {
  const results: { displayName: string; relationship: string }[] = [];
  if (!Array.isArray(raw)) return results;
  for (const p of raw as Array<Record<string, unknown>>) {
    const manager = p.manager as Record<string, unknown> | undefined;
    if (manager && str(manager.displayName)) {
      results.push({
        displayName: str(manager.displayName),
        relationship: str(manager.relationship) || 'Manager',
      });
    }
    const colleagues = p.colleagues as
      | Array<Record<string, unknown>>
      | undefined;
    if (Array.isArray(colleagues)) {
      for (const c of colleagues) {
        if (str(c.displayName)) {
          results.push({
            displayName: str(c.displayName),
            relationship: str(c.relationship) || 'Colleague',
          });
        }
      }
    }
  }
  return results;
}

/**
 * Parse relationships from top-level relationships expand.
 * Format: array of { detail: { displayName, relationship } }
 */
function parseRelationshipsRest(
  raw: unknown,
): { displayName: string; relationship: string }[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .map((r) => ({
      displayName: str(r.displayName),
      relationship: str(r.relationship),
    }))
    .filter((r) => r.displayName !== '');
}

// ============================================================================
// listContacts
// ============================================================================

/**
 * List contacts from the Outlook People graph via the PeopleGraphVx REST endpoint.
 */
export async function listContacts(
  params: ListContactsInput,
): Promise<ListContactsOutput> {
  const {
    auth,
    top = 50,
    search,
    filter,
    orderby,
    select,
    expand,
    skipToken,
  } = params;

  const origin = window.location.origin;
  const defaultExpand = 'names,emails,phones,addresses,positions,notes,photos';
  const expandValue = expand ? expand.join(',') : defaultExpand;

  const queryParams = new URLSearchParams({
    $top: String(top),
    $expand: expandValue,
  });
  if (skipToken) queryParams.set('$skiptoken', skipToken);
  if (filter) queryParams.set('$filter', filter);
  if (orderby) queryParams.set('$orderby', orderby);
  if (select) queryParams.set('$select', select.join(','));
  const url = `${origin}/PeopleGraphVx/v1.0/contacts?${queryParams.toString()}`;

  const headers = buildRestHeaders(auth);

  const response = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const items = Array.isArray(data.value)
    ? (data.value as Array<Record<string, unknown>>)
    : [];

  // Extract skipToken from @odata.nextLink if present
  let nextSkipToken: string | undefined;
  const nextLink =
    typeof data['@odata.nextLink'] === 'string'
      ? (data['@odata.nextLink'] as string)
      : undefined;
  if (nextLink) {
    const match = nextLink.match(/\$skiptoken=([^&]+)/);
    if (match) nextSkipToken = decodeURIComponent(match[1]);
  }

  let contacts: ContactSummary[] = items.map((item) => {
    const name = (item.name as Record<string, unknown>) || {};
    return {
      id: str(item.id),
      displayName: str(name.displayName),
      givenName: str(name.first),
      surname: str(name.last),
      companyName: parseCompanyFromPositions(item.positions),
      department: parseDepartmentFromPositions(item.positions),
      jobTitle: parseJobTitleFromPositions(item.positions),
      emails: parseContactEmailsRest(item.emails),
      phones: parseContactPhonesRest(item.phones),
      addresses: parseContactAddressesRest(item.addresses),
      positions: parseContactPositionsRest(item.positions),
      notes: parseNotesRest(item.notes),
      photoUrl: parsePhotoUrlRest(item.photos),
    };
  });

  // Client-side search: PeopleGraphVx contacts endpoint ignores $search,
  // so we filter locally against display name, email addresses, and phone numbers.
  if (search) {
    const term = search.toLowerCase();
    contacts = contacts.filter(
      (c) =>
        c.displayName.toLowerCase().includes(term) ||
        c.givenName.toLowerCase().includes(term) ||
        c.surname.toLowerCase().includes(term) ||
        c.emails.some((e) => e.address.toLowerCase().includes(term)) ||
        c.phones.some((p) => p.number.includes(term)),
    );
  }

  return {
    contacts,
    returnedCount: contacts.length,
    moreAvailable: !!nextSkipToken,
    ...(nextSkipToken ? { skipToken: nextSkipToken } : {}),
  };
}

// ============================================================================
// createContact
// ============================================================================

/**
 * Build the REST v2.0 PATCH body for fields that PeopleGraphVx POST does not support.
 * Returns null if no patchable fields are present.
 */
function buildRestPatchBody(
  params: CreateContactInput,
): Record<string, unknown> | null {
  const {
    phoneNumbers,
    notes,
    relationships,
    pronunciationFirstName,
    pronunciationLastName,
    pronunciationCompanyName,
    fileAs,
    initials,
    profession,
    displayName,
  } = params;

  // Fields now handled directly by PGVx POST (no longer need PATCH):
  // - birthday → pgBody.anniversaries [{date, type:'Birthday'}]
  // - anniversary → pgBody.anniversaries [{date, type:'Wedding'}]
  // - websites → pgBody.websites [{webUrl, displayName, categories:['Personal']}]
  // - imAddresses → pgBody.webAccounts [{userId, service:{name, webUrl}}]
  // - categories → pgBody.tags [{displayName}]

  const body: Record<string, unknown> = {};
  let hasFields = false;

  // Phone numbers: PeopleGraphVx POST ignores type, so we use REST v2.0
  // to set typed phone numbers (Mobile, Business, Home).
  // REST v2.0 limits: max 2 BusinessPhones, max 2 HomePhones, 1 MobilePhone1.
  if (phoneNumbers && phoneNumbers.length > 0) {
    const businessPhones: string[] = [];
    const homePhones: string[] = [];
    let mobilePhone: string | undefined;
    for (const p of phoneNumbers) {
      const type = p.type || 'BusinessPhone';
      if (type === 'Mobile') {
        mobilePhone = p.number;
      } else if (type === 'HomePhone') {
        homePhones.push(p.number);
      } else {
        businessPhones.push(p.number);
      }
    }
    body.BusinessPhones = businessPhones;
    body.HomePhones = homePhones;
    if (mobilePhone !== undefined) body.MobilePhone1 = mobilePhone;
    hasFields = true;
  }

  if (notes !== undefined) {
    body.PersonalNotes = notes;
    hasFields = true;
  }
  if (profession !== undefined) {
    body.Profession = profession;
    hasFields = true;
  }
  if (fileAs !== undefined) {
    body.FileAs = fileAs;
    hasFields = true;
  }
  if (initials !== undefined) {
    body.Initials = initials;
    hasFields = true;
  }
  if (displayName !== undefined) {
    body.DisplayName = displayName;
    hasFields = true;
  }
  if (pronunciationFirstName !== undefined) {
    body.YomiGivenName = pronunciationFirstName;
    hasFields = true;
  }
  if (pronunciationLastName !== undefined) {
    body.YomiSurname = pronunciationLastName;
    hasFields = true;
  }
  if (pronunciationCompanyName !== undefined) {
    body.YomiCompanyName = pronunciationCompanyName;
    hasFields = true;
  }

  if (relationships && relationships.length > 0) {
    const spouse = relationships.find((r) => r.relationship === 'Spouse');
    const manager = relationships.find((r) => r.relationship === 'Manager');
    const assistant = relationships.find((r) => r.relationship === 'Assistant');
    const children = relationships.filter((r) => r.relationship === 'Child');
    if (spouse) body.SpouseName = spouse.displayName;
    if (manager) body.Manager = manager.displayName;
    if (assistant) body.AssistantName = assistant.displayName;
    if (children.length > 0) body.Children = children.map((c) => c.displayName);
    hasFields = true;
  }

  return hasFields ? body : null;
}

/**
 * Create a new contact via PeopleGraphVx POST.
 *
 * Step 1: POST to PeopleGraphVx to create the contact and get a PeopleGraphVx
 * ID (Rg-format) that is immediately compatible with getContact(),
 * updateContact(), and deleteContact().
 *
 * Step 2: If the contact has fields that PeopleGraphVx POST does not support
 * (notes, websites, phone types, birthday, relationships, etc.), resolve the
 * V2ID from the PeopleGraphVx contact and PATCH via REST v2.0.
 */
export async function createContact(
  params: CreateContactInput,
): Promise<CreateContactOutput> {
  const {
    auth,
    givenName,
    surname,
    middleName,
    nameTitle,
    nameSuffix,
    nickname,
    emailAddresses,
    companyName,
    department,
    jobTitle,
    officeLocation,
    addresses,
  } = params;

  const origin = window.location.origin;

  // Step 1: Create via PeopleGraphVx POST; returns Rg-format ID immediately.
  const pgBody: Record<string, unknown> = {};

  // names (array of one entry with all name fields)
  const nameEntry: Record<string, string> = {};
  if (givenName !== undefined) nameEntry.first = givenName;
  if (surname !== undefined) nameEntry.last = surname;
  if (middleName !== undefined) nameEntry.middle = middleName;
  if (nameTitle !== undefined) nameEntry.title = nameTitle;
  if (nameSuffix !== undefined) nameEntry.suffix = nameSuffix;
  if (nickname !== undefined) nameEntry.nickname = nickname;
  if (Object.keys(nameEntry).length > 0) pgBody.names = [nameEntry];

  // emails (array of { address } or { address, displayName })
  if (emailAddresses && emailAddresses.length > 0) {
    pgBody.emails = emailAddresses.map((e) => {
      const entry: Record<string, string> = { address: e.address };
      if (e.name) entry.displayName = e.name;
      return entry;
    });
  }

  // phones: Skip in PeopleGraphVx POST. PGVx ignores phone types and assigns
  // all phones as "Home", which hits the 2-phone-per-type limit with >2 numbers.
  // Phone numbers are set exclusively via the REST v2.0 PATCH step below.

  // positions (company, jobTitle, department)
  if (companyName || department || jobTitle || officeLocation) {
    const company: Record<string, string> = {};
    if (companyName !== undefined) company.displayName = companyName;
    if (department !== undefined) company.department = department;
    if (officeLocation !== undefined) company.officeLocation = officeLocation;
    const detail: Record<string, unknown> = { company };
    if (jobTitle !== undefined) detail.jobTitle = jobTitle;
    pgBody.positions = [{ detail, isCurrent: true }];
  }

  // addresses (array of { detail: { street, city, state, postalCode, countryOrRegion, postOfficeBox, type } })
  if (addresses && addresses.length > 0) {
    pgBody.addresses = addresses.map((addr) => {
      const detail: Record<string, string> = {};
      if (addr.street) detail.street = addr.street;
      if (addr.city) detail.city = addr.city;
      if (addr.state) detail.state = addr.state;
      if (addr.postalCode) detail.postalCode = addr.postalCode;
      if (addr.countryOrRegion) detail.countryOrRegion = addr.countryOrRegion;
      if (addr.postOfficeBox) detail.postOfficeBox = addr.postOfficeBox;
      detail.type = addr.type || 'Business';
      return { detail };
    });
  }

  // anniversaries: PGVx POST accepts [{date, type}] directly; avoids MAPI
  // extended property PATCH for wedding anniversary and REST v2.0 for birthday.
  if (params.birthday || params.anniversary) {
    const annArray: Array<{ date: string; type: string }> = [];
    if (params.birthday)
      annArray.push({ date: params.birthday, type: 'Birthday' });
    if (params.anniversary)
      annArray.push({ date: params.anniversary, type: 'Wedding' });
    pgBody.anniversaries = annArray;
  }

  // websites: PGVx POST accepts [{webUrl, displayName, categories: ['Personal']}].
  // Only the 'Personal' category is allowed by PGVx.
  // Exchange only allows 1 website entry; sending 2+ causes a 400 error.
  // Trim to first entry before sending.
  if (params.websites && params.websites.length > 0) {
    const first = params.websites[0];
    pgBody.websites = [
      {
        webUrl: first.webUrl,
        displayName: first.webUrl,
        categories: ['Personal'],
      },
    ];
  }

  // imAddresses → webAccounts: PGVx POST accepts [{userId, service: {name, webUrl}}]
  // which preserves service metadata instead of the bare ImAddresses string array.
  if (params.imAddresses && params.imAddresses.length > 0) {
    pgBody.webAccounts = params.imAddresses.map((im) => ({
      userId: im.userId,
      service: { name: 'Unknown', webUrl: '' },
    }));
  }

  // tags: PGVx POST accepts [{displayName}] directly; maps to contact
  // categories without needing a REST v2.0 PATCH.
  if (params.categories && params.categories.length > 0) {
    pgBody.tags = params.categories.map((c) => ({ displayName: c }));
  }

  const pgHeaders = buildRestHeaders(auth);
  pgHeaders['content-type'] = 'application/json';

  const pgUrl = `${origin}/PeopleGraphVx/v1.0/contacts`;
  const pgResponse = await fetch(pgUrl, {
    method: 'POST',
    headers: pgHeaders,
    body: JSON.stringify(pgBody),
    credentials: 'include',
  });

  if (!pgResponse.ok) throwForStatus(pgResponse.status, await pgResponse.text().catch(() => undefined));

  const pgData = (await pgResponse.json()) as Record<string, unknown>;
  const contactId = str(pgData.id);
  const pgName = (pgData.name as Record<string, unknown>) || {};
  let resultDisplayName = str(pgName.displayName);

  if (!contactId) {
    throw new ContractDrift(
      'createContact: PeopleGraphVx returned no id for new contact.',
    );
  }

  // Step 2: PATCH via REST v2.0 for fields PeopleGraphVx POST can't handle.
  const patchBody = buildRestPatchBody(params);
  if (patchBody) {
    const v2Id = await resolveV2Id(auth, contactId);
    const patchUrl = `${origin}/api/v2.0/me/contacts/${v2Id}`;
    const patchResponse = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        authorization: auth.authorization,
        'x-anchormailbox': auth.anchorMailbox,
        'content-type': 'application/json',
      },
      body: JSON.stringify(patchBody),
      credentials: 'include',
    });

    if (!patchResponse.ok) throwForStatus(patchResponse.status, await patchResponse.text().catch(() => undefined));

    const patchData = (await patchResponse.json()) as Record<string, unknown>;
    if (patchBody.DisplayName) {
      resultDisplayName = str(patchData.DisplayName);
    }
  }

  return {
    contactId,
    displayName: resultDisplayName,
  };
}

// ============================================================================
// updateContact
// ============================================================================

/**
 * Extract the V2ID from an alternateIds array.
 * Returns the EWS-compatible URL-safe ID (V2ID prefix stripped).
 */
function extractV2Id(alternateIds: unknown): string | null {
  if (!Array.isArray(alternateIds)) return null;
  const v2Entry = (alternateIds as string[]).find((id) =>
    id.startsWith('V2ID:'),
  );
  return v2Entry ? v2Entry.slice(5) : null;
}

/**
 * Resolve a PeopleGraphVx contact ID to the V2ID (EWS-compatible URL-safe ID)
 * needed by the Outlook REST v2.0 API.
 *
 * Tries single-contact GET first. If that returns 404 (PeopleGraphVx index
 * can lag after REST v2.0 writes), falls back to listing contacts and
 * matching by ID.
 */
async function resolveV2Id(
  auth: OutlookAuth,
  contactId: string,
): Promise<string> {
  const origin = window.location.origin;
  const headers = buildRestHeaders(auth);

  // Fast path: single-contact GET with alternateIds
  const url = `${origin}/PeopleGraphVx/v1.0/contacts/${encodeURIComponent(contactId)}?$select=id,alternateIds`;
  const response = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (response.ok) {
    const data = (await response.json()) as Record<string, unknown>;
    const v2Id = extractV2Id(data.alternateIds);
    if (v2Id) return v2Id;
    throw new ContractDrift(
      'updateContact: PeopleGraphVx contact has no V2ID alternate ID.',
    );
  }

  // Fallback: PeopleGraphVx index may lag after REST v2.0 writes.
  // List contacts with alternateIds and match by ID.
  if (response.status === 404) {
    const listUrl = `${origin}/PeopleGraphVx/v1.0/contacts?$top=200&$select=id,alternateIds`;
    const listResp = await fetch(listUrl, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    if (listResp.ok) {
      const listData = await listResp.json();
      const items = Array.isArray(listData.value)
        ? (listData.value as Array<Record<string, unknown>>)
        : [];
      const match = items.find((item) => item.id === contactId);
      if (match) {
        const v2Id = extractV2Id(match.alternateIds);
        if (v2Id) return v2Id;
      }
    }
  }

  const text = await response.text().catch(() => '');
  throw new ContractDrift(
    `updateContact: could not resolve V2ID for contact ${contactId}. PeopleGraphVx returned ${response.status}. ${text.slice(0, 300)}`,
  );
}

/**
 * Update an existing contact via the Outlook REST v2.0 API.
 *
 * PeopleGraphVx does not support PATCH for contacts, so we resolve the
 * contact's V2ID (EWS-compatible) from alternateIds and PATCH via
 * /api/v2.0/me/contacts/{id}.
 */
export async function updateContact(
  params: UpdateContactInput,
): Promise<UpdateContactOutput> {
  const {
    auth,
    contactId,
    givenName,
    surname,
    middleName,
    nameTitle,
    nameSuffix,
    nickname,
    emailAddresses,
    phoneNumbers,
    companyName,
    department,
    jobTitle,
    officeLocation,
    profession,
    websites,
    imAddresses,
    relationships,
    birthday,
    anniversary,
    categories,
    addresses,
    fileAs,
    initials,
    pronunciationFirstName,
    pronunciationLastName,
    pronunciationCompanyName,
    notes,
    displayName,
  } = params;

  const origin = window.location.origin;

  // Resolve PeopleGraphVx ID → V2ID for the REST v2.0 API
  const v2Id = await resolveV2Id(auth, contactId);

  const url = `${origin}/api/v2.0/me/contacts/${v2Id}`;

  const body: Record<string, unknown> = {};
  if (displayName !== undefined) body.DisplayName = displayName;
  if (givenName !== undefined) body.GivenName = givenName;
  if (surname !== undefined) body.Surname = surname;
  if (middleName !== undefined) body.MiddleName = middleName;
  if (nameTitle !== undefined) body.Title = nameTitle;
  if (nameSuffix !== undefined) body.Generation = nameSuffix;
  if (nickname !== undefined) body.NickName = nickname;
  if (pronunciationFirstName !== undefined)
    body.YomiGivenName = pronunciationFirstName;
  if (pronunciationLastName !== undefined)
    body.YomiSurname = pronunciationLastName;
  if (pronunciationCompanyName !== undefined)
    body.YomiCompanyName = pronunciationCompanyName;
  if (emailAddresses !== undefined) {
    body.EmailAddresses = emailAddresses.map((e) => ({
      Address: e.address,
      Name: e.name || e.address,
    }));
  }
  if (phoneNumbers !== undefined) {
    const businessPhones: string[] = [];
    const homePhones: string[] = [];
    let mobilePhone: string | undefined;
    for (const p of phoneNumbers) {
      const type = p.type || 'BusinessPhone';
      if (type === 'Mobile') {
        mobilePhone = p.number;
      } else if (type === 'HomePhone') {
        homePhones.push(p.number);
      } else {
        businessPhones.push(p.number);
      }
    }
    body.BusinessPhones = businessPhones;
    body.HomePhones = homePhones;
    body.MobilePhone1 = mobilePhone ?? null;
  }
  if (companyName !== undefined) body.CompanyName = companyName;
  if (department !== undefined) body.Department = department;
  if (jobTitle !== undefined) body.JobTitle = jobTitle;
  if (officeLocation !== undefined) body.OfficeLocation = officeLocation;
  if (profession !== undefined) body.Profession = profession;
  if (birthday !== undefined) body.Birthday = birthday;
  if (categories !== undefined) body.Categories = categories;
  if (fileAs !== undefined) body.FileAs = fileAs;
  if (initials !== undefined) body.Initials = initials;
  if (addresses !== undefined) {
    for (const addr of addresses) {
      const addrObj: Record<string, string> = {};
      if (addr.street) addrObj.Street = addr.street;
      if (addr.city) addrObj.City = addr.city;
      if (addr.state) addrObj.State = addr.state;
      if (addr.postalCode) addrObj.PostalCode = addr.postalCode;
      if (addr.countryOrRegion) addrObj.CountryOrRegion = addr.countryOrRegion;
      if (addr.postOfficeBox) addrObj.PostOfficeBox = addr.postOfficeBox;
      const type = addr.type || 'Business';
      if (type === 'Home') body.HomeAddress = addrObj;
      else if (type === 'Other') body.OtherAddress = addrObj;
      else body.BusinessAddress = addrObj;
    }
  }
  if (notes !== undefined) body.PersonalNotes = notes;
  if (websites !== undefined) {
    body.BusinessHomePage = websites.length > 0 ? websites[0].webUrl : '';
  }
  if (imAddresses !== undefined) {
    body.ImAddresses = imAddresses.map((im) => im.userId);
  }
  if (relationships !== undefined) {
    const spouse = relationships.find((r) => r.relationship === 'Spouse');
    const manager = relationships.find((r) => r.relationship === 'Manager');
    const assistant = relationships.find((r) => r.relationship === 'Assistant');
    const children = relationships.filter((r) => r.relationship === 'Child');
    // Always set all 4 fields when relationships is provided; clears any not in the array
    body.SpouseName = spouse ? spouse.displayName : '';
    body.Manager = manager ? manager.displayName : '';
    body.AssistantName = assistant ? assistant.displayName : '';
    body.Children =
      children.length > 0 ? children.map((c) => c.displayName) : [];
  }

  // Anniversary is not a direct REST v2.0 property; set via MAPI extended
  // property PidTagWeddingAnniversary (0x3A41, SystemTime).
  if (anniversary !== undefined) {
    body.SingleValueExtendedProperties = [
      { PropertyId: 'SystemTime 0x3A41', Value: anniversary },
    ];
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      authorization: auth.authorization,
      'x-anchormailbox': auth.anchorMailbox,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = (await response.json()) as Record<string, unknown>;

  return {
    contactId,
    displayName: str(data.DisplayName),
  };
}

// ============================================================================
// deleteContact
// ============================================================================

/**
 * Delete a contact via the PeopleGraphVx REST endpoint.
 *
 * Verifies the contact exists before deleting, since the Microsoft API
 * returns 204 for DELETE of any path (including nonexistent IDs).
 */
export async function deleteContact(
  params: DeleteContactInput,
): Promise<DeleteContactOutput> {
  const { auth, contactId } = params;

  if (!contactId || typeof contactId !== 'string' || !contactId.trim()) {
    throw new Validation(
      'deleteContact: contactId is required and must be a non-empty string.',
    );
  }

  const origin = window.location.origin;
  const headers = buildRestHeaders(auth);

  // Verify the contact exists before deleting; the DELETE endpoint returns
  // 204 for any path (including nonexistent/fake IDs), so we can't rely on
  // the delete response alone to confirm the contact was real.
  const verifyUrl = `${origin}/PeopleGraphVx/v1.0/contacts/${encodeURIComponent(contactId)}`;
  const verifyResp = await fetch(verifyUrl, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!verifyResp.ok) {
    throw new NotFound(
      `deleteContact: contact not found (${verifyResp.status}). Verify the contactId is correct and comes from listContacts().`,
    );
  }

  // Contact exists; proceed with deletion
  const deleteUrl = `${origin}/PeopleGraphVx/v1.0/contacts/${encodeURIComponent(contactId)}`;
  const response = await fetch(deleteUrl, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return { success: true };
}

// ============================================================================
// getContact
// ============================================================================

/**
 * Get detailed contact information via PeopleGraphVx REST.
 * - contactId: direct GET by ID
 * - emailAddress: filter contacts by email, then GET by resolved ID
 *
 * Both paths use the same REST API, so the returned data shape and contactId
 * are always consistent and reusable with other contact functions.
 */
export async function getContact(
  params: GetContactInput,
): Promise<GetContactOutput> {
  const { auth, contactId, emailAddress, select, expand, extensionsFilter } =
    params;

  if (!contactId && !emailAddress) {
    throw new Validation(
      'getContact: either contactId or emailAddress must be provided.',
    );
  }

  if (contactId && emailAddress) {
    throw new Validation(
      'getContact: provide either contactId or emailAddress, not both.',
    );
  }

  const origin = window.location.origin;
  const defaultExpand =
    'names,emails,phones,addresses,positions,notes,photos,anniversaries,relationships,websites';

  // Build expand value, applying sub-filter to extensions if requested
  let expandParts = expand ? [...expand] : defaultExpand.split(',');
  if (extensionsFilter) {
    // Ensure extensions is in the expand list
    if (!expandParts.includes('extensions')) {
      expandParts.push('extensions');
    }
    // Replace plain 'extensions' with sub-filtered version
    expandParts = expandParts.map((p) =>
      p === 'extensions' ? `extensions($filter=${extensionsFilter})` : p,
    );
  }
  const expandValue = expandParts.join(',');

  // Resolve the contact ID when only emailAddress is provided.
  // Use PeopleGraphVx list endpoint with email filter to find the matching contact,
  // then fetch it by ID so both paths return identical data and a reusable contactId.
  let resolvedId = contactId;
  if (!resolvedId && emailAddress) {
    const filterUrl = `${origin}/PeopleGraphVx/v1.0/contacts?$top=50&$expand=emails`;
    const filterHeaders = buildRestHeaders(auth);

    const filterResp = await fetch(filterUrl, {
      method: 'GET',
      headers: filterHeaders,
      credentials: 'include',
    });

    if (!filterResp.ok) throwForStatus(filterResp.status, await filterResp.text().catch(() => undefined));

    const filterData = await filterResp.json();
    const items = Array.isArray(filterData.value)
      ? (filterData.value as Array<Record<string, unknown>>)
      : [];

    const emailLower = emailAddress.toLowerCase();
    const match = items.find((item) => {
      const emails = item.emails;
      if (!Array.isArray(emails)) return false;
      return (emails as Array<Record<string, unknown>>).some(
        (e) => str(e.address).toLowerCase() === emailLower,
      );
    });

    if (!match || !match.id) {
      throw new NotFound(
        `getContact: no contact found with email address: ${emailAddress}`,
      );
    }

    resolvedId = str(match.id);
  }

  // Fetch full contact details by ID via PeopleGraphVx REST
  const queryParams = new URLSearchParams({
    $expand: expandValue,
  });
  if (select) queryParams.set('$select', select.join(','));
  const url = `${origin}/PeopleGraphVx/v1.0/contacts/${encodeURIComponent(resolvedId!)}?${queryParams.toString()}`;
  const headers = buildRestHeaders(auth);

  const response = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const item = (await response.json()) as Record<string, unknown>;
  const name = (item.name as Record<string, unknown>) || {};

  // Parse anniversaries to extract birthday and wedding anniversary
  const anniversaries = parseAnniversariesRest(item.anniversaries);
  const birthday = anniversaries.find((a) => a.type === 'Birthday')?.date || '';
  const anniversary =
    anniversaries.find((a) => a.type === 'Wedding')?.date || '';

  // Parse relationships from both positions (manager/colleagues) and top-level expansion
  const positionRelationships = parseRelationshipsFromPositions(item.positions);
  const topLevelRelationships = parseRelationshipsRest(item.relationships);
  // Dedupe: prefer position-sourced relationships, then add any from top-level not already present
  const seenNames = new Set(
    positionRelationships.map((r) => r.displayName.toLowerCase()),
  );
  const allRelationships = [...positionRelationships];
  for (const r of topLevelRelationships) {
    if (!seenNames.has(r.displayName.toLowerCase())) {
      allRelationships.push(r);
      seenNames.add(r.displayName.toLowerCase());
    }
  }

  // Parse webAccounts if expanded
  const webAccounts: ContactWebAccount[] | undefined = Array.isArray(
    item.webAccounts,
  )
    ? (item.webAccounts as Array<Record<string, unknown>>).map((wa) => {
        const service = wa.service as Record<string, unknown> | undefined;
        return {
          userId: str(wa.userId),
          serviceName: str(service?.name),
          serviceWebUrl: str(service?.webUrl),
        };
      })
    : undefined;

  // Parse tags if expanded
  const tags: ContactTag[] | undefined = Array.isArray(item.tags)
    ? (item.tags as Array<Record<string, unknown>>).map((t) => ({
        id: str(t.id),
        displayName: str(t.displayName),
      }))
    : undefined;

  // Extract metadata fields
  const legacyMeta = item.legacyContactMetadata as
    | Record<string, unknown>
    | undefined;

  const result: GetContactOutput = {
    contactId: str(item.id),
    displayName: str(name.displayName),
    givenName: str(name.first),
    surname: str(name.last),
    middleName: str(name.middle),
    nickname: str(name.nickname),
    nameTitle: str(name.title),
    nameSuffix: str(name.suffix),
    companyName: parseCompanyFromPositions(item.positions),
    department: parseDepartmentFromPositions(item.positions),
    jobTitle: parseJobTitleFromPositions(item.positions),
    officeLocation: parseOfficeLocationFromPositions(item.positions),
    emails: parseContactEmailsRest(item.emails),
    phones: parseContactPhonesRest(item.phones),
    addresses: parseContactAddressesRest(item.addresses),
    positions: parseContactPositionsRest(item.positions),
    websites: parseWebsitesRest(item.websites),
    relationships: allRelationships,
    birthday,
    anniversary,
    notes: parseNotesRest(item.notes),
    photoUrl: parsePhotoUrlRest(item.photos),
  };

  // Conditionally include optional fields only when present in the API response
  if (webAccounts) result.webAccounts = webAccounts;
  if (tags) result.tags = tags;
  if (typeof item.createdDateTime === 'string')
    result.createdDateTime = item.createdDateTime;
  if (typeof item.lastModifiedDateTime === 'string')
    result.lastModifiedDateTime = item.lastModifiedDateTime;
  if (typeof item.isEditable === 'boolean') result.isEditable = item.isEditable;
  if (legacyMeta && typeof legacyMeta.parentFolderId === 'string')
    result.parentFolderId = legacyMeta.parentFolderId;

  // Pronunciation fields from name.pronunciation
  const pronunciation = name.pronunciation as
    | Record<string, unknown>
    | undefined;
  if (pronunciation) {
    const pronFirst = str(pronunciation.first);
    const pronLast = str(pronunciation.last);
    if (pronFirst) result.pronunciationFirstName = pronFirst;
    if (pronLast) result.pronunciationLastName = pronLast;
  }

  // Initials from name.initials
  const nameInitials = str(name.initials);
  if (nameInitials) result.initials = nameInitials;

  // Company pronunciation and webUrl from positions[0].detail.company
  if (
    Array.isArray(item.positions) &&
    (item.positions as unknown[]).length > 0
  ) {
    const pos0 = (item.positions as Array<Record<string, unknown>>)[0];
    const detail = pos0?.detail as Record<string, unknown> | undefined;
    const company = detail?.company as Record<string, unknown> | undefined;
    if (company) {
      const compPron = str(company.pronunciation);
      const compWebUrl = str(company.webUrl);
      if (compPron) result.companyPronunciation = compPron;
      if (compWebUrl) result.companyWebUrl = compWebUrl;
    }
  }

  // Legacy metadata fields
  if (legacyMeta) {
    const sensitivity = str(legacyMeta.sensitivity);
    if (
      sensitivity === 'Normal' ||
      sensitivity === 'Personal' ||
      sensitivity === 'Private' ||
      sensitivity === 'Confidential'
    )
      result.sensitivity = sensitivity;
    const rights = str(legacyMeta.effectiveRights);
    if (rights) result.effectiveRights = rights;
    const itemCls = str(legacyMeta.itemClass);
    if (itemCls) result.itemClass = itemCls;
  }

  // Top-level metadata fields
  if (typeof item.allowedAudiences === 'string')
    result.allowedAudiences = item.allowedAudiences as string;
  const etagValue =
    typeof item['@odata.etag'] === 'string'
      ? (item['@odata.etag'] as string)
      : '';
  if (etagValue) result.etag = etagValue;

  return result;
}
