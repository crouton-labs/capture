import { z } from 'zod';
import { AuthParam, ContactSummarySchema, ContactDetailSchema } from './shared';

// ============================================================================
// listContacts
// ============================================================================

export const listContactsSchema = {
  name: 'listContacts',
  description:
    'List contacts from the Outlook address book with basic profile information',
  notes:
    'Navigate to outlook.live.com/people/0/ before calling. Use the returned id with getContact() to fetch full contact details. Pagination is cursor-based only (no offset/skip support): if moreAvailable is true, pass the returned skipToken to fetch the next page. Use search or filter to narrow results instead of paging through all contacts.',
  input: z.object({
    auth: AuthParam,
    top: z
      .number()
      .optional()
      .describe(
        'Maximum number of contacts to return per page. Defaults to 50 when omitted.',
      ),
    search: z
      .string()
      .optional()
      .describe(
        'Client-side text search. Filters results where display name, email address, or phone number contains the search term (case-insensitive). Applied after server-side filter/orderby. For exact field matching, use filter with contains() instead.',
      ),
    filter: z
      .string()
      .optional()
      .describe(
        "OData $filter expression. Supported: contains(name/displayName,'...'), contains(name/first,'...'), contains(name/last,'...'), name/displayName eq '...', name/first eq '...', name/last eq '...'. Combine with 'or'. Operators ne/ge/le/gt/lt and functions startswith/endswith are not supported.",
      ),
    orderby: z
      .enum([
        'createdDateTime',
        'createdDateTime desc',
        'createdDateTime asc',
        'lastModifiedDateTime',
        'lastModifiedDateTime desc',
        'lastModifiedDateTime asc',
        'name/first',
        'name/first desc',
        'name/first asc',
        'name/last',
        'name/last desc',
        'name/last asc',
      ])
      .optional()
      .describe(
        'Sort order for results. Sortable fields: createdDateTime, lastModifiedDateTime, name/first, name/last. Default direction is ascending.',
      ),
    select: z
      .array(
        z.enum([
          'id',
          'alternateIds',
          'createdDateTime',
          'lastModifiedDateTime',
          'changeKey',
          'allowedAudiences',
          'mapiSearchKey',
          'mapiEntryId',
          'isEditable',
          'source',
          'inference',
          'legacyContactMetadata',
          'duplicateOf',
          'photoUrl',
          'createdBy',
          'lastModifiedBy',
        ]),
      )
      .optional()
      .describe(
        'OData $select base fields to include in the raw API response. Does not affect the normalized output shape; all ContactSummary fields are always returned. Primarily useful for reducing network transfer size. When omitted, all base fields are returned.',
      ),
    expand: z
      .array(
        z.enum([
          'names',
          'emails',
          'phones',
          'addresses',
          'positions',
          'notes',
          'photos',
          'webAccounts',
          'anniversaries',
          'relationships',
          'websites',
          'tags',
          'interests',
          'skills',
          'languages',
          'certifications',
          'projects',
          'awards',
          'sources',
          'extensions',
        ]),
      )
      .optional()
      .describe(
        'OData $expand relations to include. Defaults to names,emails,phones,addresses,positions,notes,photos when omitted.',
      ),
    skipToken: z
      .string()
      .optional()
      .describe(
        'Cursor token for fetching the next page. Use the skipToken returned from a previous listContacts() call.',
      ),
  }),
  output: z.object({
    contacts: z.array(ContactSummarySchema).describe('List of contacts'),
    returnedCount: z
      .number()
      .describe('Number of contacts returned in this page'),
    moreAvailable: z
      .boolean()
      .describe(
        'Whether more contacts exist beyond this page. True only when the API returns a cursor token for the next page.',
      ),
    skipToken: z
      .string()
      .optional()
      .describe(
        'Cursor token for the next page. Pass to skipToken input parameter to fetch more results. Absent when no more pages.',
      ),
  }),
};

// ============================================================================
// getContact
// ============================================================================

export const getContactSchema = {
  name: 'getContact',
  description:
    'Get detailed contact information for a single contact including name, job title, department, emails, phones, addresses, work history, websites, relationships, birthday, anniversary, and notes',
  notes:
    "Provide exactly one of contactId or emailAddress (not both). contactId is the id returned by listContacts(). emailAddress searches contacts by email to resolve the ID first, then fetches full details; both paths return the same data and a reusable contactId. The emailAddress path only finds contacts in the user's address book (not arbitrary email addresses). Throws an error if both params are provided or if the email is not found.",
  input: z.object({
    auth: AuthParam,
    contactId: z
      .string()
      .optional()
      .describe(
        'Contact ID from listContacts(). Use the id field from a listContacts() result.',
      ),
    emailAddress: z
      .string()
      .optional()
      .describe(
        "Email address to look up in the user's contacts. Searches the address book for a contact with this email. Only finds existing contacts; will not resolve arbitrary email addresses.",
      ),
    select: z
      .array(
        z.enum([
          'id',
          'alternateIds',
          'createdDateTime',
          'lastModifiedDateTime',
          'changeKey',
          'allowedAudiences',
          'mapiSearchKey',
          'mapiEntryId',
          'isEditable',
          'source',
          'inference',
          'legacyContactMetadata',
          'duplicateOf',
          'photoUrl',
          'createdBy',
          'lastModifiedBy',
        ]),
      )
      .optional()
      .describe(
        'OData $select base fields to include in the raw API response. Does not affect the normalized output shape; all ContactDetail fields are always returned. Primarily useful for reducing network transfer size. When omitted, all base fields are returned.',
      ),
    expand: z
      .array(
        z.enum([
          'names',
          'emails',
          'phones',
          'addresses',
          'positions',
          'notes',
          'photos',
          'webAccounts',
          'anniversaries',
          'relationships',
          'websites',
          'tags',
          'interests',
          'skills',
          'languages',
          'certifications',
          'projects',
          'awards',
          'sources',
          'extensions',
        ]),
      )
      .optional()
      .describe(
        'OData $expand relations to include. Defaults to names,emails,phones,addresses,positions,notes,photos,anniversaries,relationships,websites when omitted. Use webAccounts to include IM/chat accounts, tags for contact categories, or extensions for extended properties.',
      ),
    extensionsFilter: z
      .string()
      .optional()
      .describe(
        "OData sub-filter for the extensions expand. Applied as extensions($filter=...) in the $expand parameter. Example: \"extensionName eq 'com.outlook.extendedproperties.security'\" to return only the security extension. Requires 'extensions' in expand (added automatically if extensionsFilter is set). When omitted, all extensions are returned.",
      ),
  }),
  output: ContactDetailSchema,
};

// ============================================================================
// createContact
// ============================================================================

const ContactEmailInputSchema = z.object({
  address: z.string().describe('Email address'),
  name: z
    .string()
    .optional()
    .describe('Display name for this email (defaults to address)'),
});

const ContactPhoneInputSchema = z.object({
  number: z.string().describe('Phone number'),
  type: z
    .enum(['Mobile', 'BusinessPhone', 'HomePhone'])
    .optional()
    .describe(
      'Phone type. Defaults to BusinessPhone. Limits: 1 Mobile, max 2 BusinessPhone, max 2 HomePhone. Additional numbers of the same type are silently dropped by Exchange. Note: Other and BusinessFax types appear in read responses but cannot be written via the REST API.',
    ),
});

const ContactWebsiteInputSchema = z.object({
  webUrl: z
    .string()
    .describe(
      'Website URL. Maps to the single BusinessHomePage field in Exchange; only one URL is stored. If multiple websites are provided, only the first webUrl is used; the rest are silently dropped.',
    ),
});

const ContactAddressInputSchema = z.object({
  street: z.string().optional().describe('Street address'),
  city: z.string().optional().describe('City'),
  state: z.string().optional().describe('State or province'),
  postalCode: z.string().optional().describe('ZIP or postal code'),
  countryOrRegion: z.string().optional().describe('Country or region'),
  postOfficeBox: z
    .string()
    .optional()
    .describe(
      'P.O. Box number (e.g., "PO Box 123"). Maps to the PostOfficeBox field in the Exchange PhysicalAddress. Stored per address type; each Home, Business, and Other address has its own PostOfficeBox.',
    ),
  type: z
    .enum(['Home', 'Business', 'Other'])
    .optional()
    .describe('Address type. Defaults to Business'),
});

const ContactRelationshipInputSchema = z.object({
  displayName: z.string().describe('Name of the related person'),
  relationship: z
    .enum(['Spouse', 'Child', 'Manager', 'Assistant'])
    .describe(
      'Relationship type. Only these 4 types map to Exchange fields: Spouse → SpouseName, Child → Children (array), Manager → Manager, Assistant → AssistantName. Other relationship types (Parent, Sibling, Colleague, etc.) are not supported by the Exchange REST API and would be silently dropped.',
    ),
});

const ContactImAddressInputSchema = z.object({
  userId: z
    .string()
    .describe(
      'IM/chat user ID or address. Maps to the ImAddresses array in Exchange (plain string values). Service name/URL metadata is not stored; only the userId string is saved.',
    ),
});

export const createContactSchema = {
  name: 'createContact',
  description: 'Create a new contact in the Outlook address book',
  notes:
    'Navigate to outlook.live.com/people/0/ before calling. At least one of givenName or surname should be provided. The returned contactId is compatible with getContact(), updateContact(), and deleteContact(). Maximum 3 email addresses. Phone number limits: 1 Mobile, max 2 BusinessPhone, max 2 HomePhone (5 total max). Other and BusinessFax phone types appear in read responses but cannot be written.',
  input: z.object({
    auth: AuthParam,
    givenName: z.string().optional().describe('First name'),
    surname: z.string().optional().describe('Last name'),
    middleName: z.string().optional().describe('Middle name'),
    nameTitle: z
      .string()
      .optional()
      .describe(
        'Name prefix/title (e.g., Mr, Mrs, Dr). This is the honorific, not the job title.',
      ),
    nameSuffix: z
      .string()
      .optional()
      .describe('Name suffix (e.g., Jr, Sr, III)'),
    nickname: z.string().optional().describe('Nickname or informal name'),
    emailAddresses: z
      .array(ContactEmailInputSchema)
      .optional()
      .describe('Email addresses to add to the contact'),
    phoneNumbers: z
      .array(ContactPhoneInputSchema)
      .optional()
      .describe('Phone numbers to add to the contact'),
    companyName: z.string().optional().describe('Company name'),
    department: z.string().optional().describe('Department'),
    jobTitle: z.string().optional().describe('Job title'),
    officeLocation: z
      .string()
      .optional()
      .describe('Office location (e.g., Building 42, Suite 200)'),
    profession: z
      .string()
      .optional()
      .describe(
        'Profession or occupation (e.g., "Software Engineer", "Architect"). Distinct from jobTitle; profession describes the field/trade, jobTitle is the role at a company.',
      ),
    websites: z
      .array(ContactWebsiteInputSchema)
      .optional()
      .describe(
        'Website URL. Exchange stores only a single BusinessHomePage string; pass one entry with the webUrl. If multiple entries are provided, only the first webUrl is used.',
      ),
    imAddresses: z
      .array(ContactImAddressInputSchema)
      .optional()
      .describe(
        'Instant messaging addresses. Only the userId string from each entry is stored in the Exchange ImAddresses array.',
      ),
    relationships: z
      .array(ContactRelationshipInputSchema)
      .optional()
      .describe(
        'Related people. Only 4 relationship types are supported: Spouse (→ SpouseName), Child (→ Children array), Manager (→ Manager), Assistant (→ AssistantName).',
      ),
    birthday: z
      .string()
      .optional()
      .describe(
        'Birthday in ISO 8601 format (e.g., 1990-03-15 or 1990-03-15T00:00:00Z)',
      ),
    anniversary: z
      .string()
      .optional()
      .describe(
        'Wedding anniversary in ISO 8601 format (e.g., 2020-06-14 or 2020-06-14T00:00:00Z). Stored via MAPI extended property PidTagWeddingAnniversary (0x3A41).',
      ),
    pronunciationFirstName: z
      .string()
      .optional()
      .describe(
        'Phonetic pronunciation of the first name (yomigana / furigana). Stored as YomiFirstName in Exchange.',
      ),
    pronunciationLastName: z
      .string()
      .optional()
      .describe(
        'Phonetic pronunciation of the last name (yomigana / furigana). Stored as YomiLastName in Exchange.',
      ),
    pronunciationCompanyName: z
      .string()
      .optional()
      .describe(
        'Phonetic pronunciation of the company name (yomigana / furigana). Stored as YomiCompanyName in Exchange.',
      ),
    notes: z.string().optional().describe('Personal notes about the contact'),
    addresses: z
      .array(ContactAddressInputSchema)
      .optional()
      .describe(
        'Postal addresses. Maximum one per type: Home, Business, Other.',
      ),
    categories: z
      .array(z.string())
      .optional()
      .describe(
        'Category labels to tag the contact with (e.g., ["Red category", "Business"]).',
      ),
    fileAs: z
      .string()
      .optional()
      .describe(
        'How the contact is filed/sorted (e.g., "LastName, FirstName" or "CompanyName"). Defaults to auto-generated from name fields.',
      ),
    initials: z
      .string()
      .optional()
      .describe(
        'Contact initials (e.g., "JD" for John Doe). Stored as Initials in Exchange.',
      ),
    displayName: z
      .string()
      .optional()
      .describe(
        'Explicit display name override. When omitted, auto-generated from name fields (e.g., "Dr. John Doe Jr."). Set this to control the exact display name shown in the address book.',
      ),
  }),
  output: z.object({
    contactId: z.string().describe('ID of the newly created contact'),
    displayName: z.string().describe('Display name of the created contact'),
  }),
};

// ============================================================================
// updateContact
// ============================================================================

export const updateContactSchema = {
  name: 'updateContact',
  description: 'Update an existing contact in the Outlook address book',
  notes:
    'Navigate to outlook.live.com/people/0/ before calling. Only provided fields are updated; omitted fields remain unchanged. Array fields (emailAddresses, phoneNumbers, imAddresses, relationships, categories) REPLACE all existing values; to keep existing entries, include them in the array alongside new ones. addresses does NOT clear with an empty array; to clear addresses, pass entries with only the type field (e.g., [{type: "Home"}]). websites is a single-value field (BusinessHomePage); pass one entry to set, empty array to clear. Use the contact ID from listContacts(). Maximum 3 email addresses. Phone number limits: 1 Mobile, max 2 BusinessPhone, max 2 HomePhone (5 total max). Other and BusinessFax phone types appear in read responses but cannot be written.',
  input: z.object({
    auth: AuthParam,
    contactId: z
      .string()
      .describe(
        'ID of the contact to update. Use the id field from listContacts() results.',
      ),
    givenName: z.string().optional().describe('First name'),
    surname: z.string().optional().describe('Last name'),
    middleName: z.string().optional().describe('Middle name'),
    nameTitle: z
      .string()
      .optional()
      .describe(
        'Name prefix/title (e.g., Mr, Mrs, Dr). This is the honorific, not the job title.',
      ),
    nameSuffix: z
      .string()
      .optional()
      .describe('Name suffix (e.g., Jr, Sr, III)'),
    nickname: z.string().optional().describe('Nickname or informal name'),
    emailAddresses: z
      .array(ContactEmailInputSchema)
      .optional()
      .describe('Email addresses (replaces all existing emails)'),
    phoneNumbers: z
      .array(ContactPhoneInputSchema)
      .optional()
      .describe('Phone numbers (replaces all existing phone numbers)'),
    companyName: z.string().optional().describe('Company name'),
    department: z.string().optional().describe('Department'),
    jobTitle: z.string().optional().describe('Job title'),
    officeLocation: z
      .string()
      .optional()
      .describe('Office location (e.g., Building 42, Suite 200)'),
    profession: z
      .string()
      .optional()
      .describe(
        'Profession or occupation (e.g., "Software Engineer", "Architect"). Distinct from jobTitle; profession describes the field/trade, jobTitle is the role at a company.',
      ),
    websites: z
      .array(ContactWebsiteInputSchema)
      .optional()
      .describe(
        'Website URL. Exchange stores only a single BusinessHomePage string; pass one entry with the webUrl. If multiple entries are provided, only the first webUrl is used. Pass an empty array to clear.',
      ),
    imAddresses: z
      .array(ContactImAddressInputSchema)
      .optional()
      .describe(
        'Instant messaging addresses. Only the userId string from each entry is stored in the Exchange ImAddresses array. Replaces all existing IM addresses.',
      ),
    relationships: z
      .array(ContactRelationshipInputSchema)
      .optional()
      .describe(
        'Related people. Only 4 relationship types are supported: Spouse (→ SpouseName), Child (→ Children array), Manager (→ Manager), Assistant (→ AssistantName). Replaces all existing relationships of supported types.',
      ),
    birthday: z
      .string()
      .optional()
      .describe(
        'Birthday in ISO 8601 format (e.g., 1990-03-15 or 1990-03-15T00:00:00Z)',
      ),
    anniversary: z
      .string()
      .optional()
      .describe(
        'Wedding anniversary in ISO 8601 format (e.g., 2020-06-14 or 2020-06-14T00:00:00Z). Stored via MAPI extended property PidTagWeddingAnniversary (0x3A41).',
      ),
    categories: z
      .array(z.string())
      .optional()
      .describe(
        'Category labels to tag the contact with (e.g., ["Red category", "Business"]). Replaces all existing categories.',
      ),
    addresses: z
      .array(ContactAddressInputSchema)
      .optional()
      .describe(
        'Postal addresses (replaces all existing). Maximum one per type: Home, Business, Other. To clear addresses, pass entries with only the type field and no other fields (e.g., [{type: "Home"}, {type: "Business"}, {type: "Other"}]). An empty array has no effect; existing addresses are preserved.',
      ),
    fileAs: z
      .string()
      .optional()
      .describe(
        'How the contact is filed/sorted (e.g., "LastName, FirstName" or "CompanyName").',
      ),
    initials: z
      .string()
      .optional()
      .describe(
        'Contact initials (e.g., "JD" for John Doe). Stored as Initials in Exchange.',
      ),
    pronunciationFirstName: z
      .string()
      .optional()
      .describe(
        'Phonetic pronunciation of the first name (yomigana / furigana). Stored as YomiFirstName in Exchange.',
      ),
    pronunciationLastName: z
      .string()
      .optional()
      .describe(
        'Phonetic pronunciation of the last name (yomigana / furigana). Stored as YomiLastName in Exchange.',
      ),
    pronunciationCompanyName: z
      .string()
      .optional()
      .describe(
        'Phonetic pronunciation of the company name (yomigana / furigana). Stored as YomiCompanyName in Exchange.',
      ),
    notes: z.string().optional().describe('Personal notes about the contact'),
    displayName: z
      .string()
      .optional()
      .describe(
        'Explicit display name override. When omitted, auto-generated from name fields. Set this to control the exact display name shown in the address book.',
      ),
  }),
  output: z.object({
    contactId: z.string().describe('ID of the updated contact'),
    displayName: z.string().describe('Display name of the updated contact'),
  }),
};

// ============================================================================
// deleteContact
// ============================================================================

export const deleteContactSchema = {
  name: 'deleteContact',
  description: 'Delete a contact from the Outlook address book',
  notes:
    'Soft-deletes the contact (moves it to the Deleted contacts folder). Use the contact ID from listContacts(). The contact can be restored from the Deleted folder in the Outlook UI. Throws an error if the contactId does not match an existing contact; always use a fresh ID from listContacts() to avoid stale references.',
  input: z.object({
    auth: AuthParam,
    contactId: z
      .string()
      .describe(
        'ID of the contact to delete. Must be a valid ID from listContacts() results. Throws if the contact does not exist.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True when the contact was verified and successfully deleted'),
  }),
};

// ============================================================================
// Inferred Types
// ============================================================================

export type ListContactsInput = z.infer<typeof listContactsSchema.input>;
export type ListContactsOutput = z.infer<typeof listContactsSchema.output>;
export type GetContactInput = z.infer<typeof getContactSchema.input>;
export type GetContactOutput = z.infer<typeof getContactSchema.output>;
export type CreateContactInput = z.infer<typeof createContactSchema.input>;
export type CreateContactOutput = z.infer<typeof createContactSchema.output>;
export type UpdateContactInput = z.infer<typeof updateContactSchema.input>;
export type UpdateContactOutput = z.infer<typeof updateContactSchema.output>;
export type DeleteContactInput = z.infer<typeof deleteContactSchema.input>;
export type DeleteContactOutput = z.infer<typeof deleteContactSchema.output>;
