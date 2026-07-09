import { z } from 'zod';

// ============================================================================
// Shared entity shape
// ============================================================================

export const FolderSchema = z
  .object({
    folderId: z
      .string()
      .describe(
        'Folder id. Pass to updateFolder, deleteFolder, addDomainsToFolder, and removeDomainsFromFolder.',
      ),
    name: z.string().describe('Folder display name.'),
    domainCount: z
      .number()
      .optional()
      .describe('Number of domains in the folder, when reported.'),
    domains: z
      .array(z.string())
      .optional()
      .describe(
        'Domain names that belong to the folder, present when membership is included in the response.',
      ),
  })
  .passthrough()
  .describe(
    'A portfolio folder that groups domains for organization and bulk management.',
  );

// ============================================================================
// listFolders
// ============================================================================

export const listFoldersSchema = {
  name: 'listFolders',
  description:
    'List all portfolio folders for the signed-in account, each with its id, name, and domain count. Use to discover folder ids before organizing domains.',
  notes: '',
  input: z.object({
    includeAllDomains: z
      .boolean()
      .optional()
      .describe(
        'When true (default), includes the virtual "All domains" folder (id -1) in the results. Pass false to return only user-created folders.',
      ),
  }),
  output: z.object({
    folders: z
      .array(FolderSchema)
      .describe(
        'All folders for the account. Empty array when the account has no folders.',
      ),
    total: z.number().describe('Number of folders returned.'),
  }),
};

// ============================================================================
// createFolder
// ============================================================================

export const createFolderSchema = {
  name: 'createFolder',
  description: 'Create a new, empty portfolio folder with the given name.',
  notes:
    'Add domains to the new folder with addDomainsToFolder, using the returned folderId.',
  input: z.object({
    name: z.string().min(1).describe('Display name for the new folder.'),
  }),
  output: z.object({
    folder: FolderSchema.describe(
      'The newly created folder, including its folderId.',
    ),
  }),
};

// ============================================================================
// updateFolder
// ============================================================================

export const updateFolderSchema = {
  name: 'updateFolder',
  description: 'Rename an existing portfolio folder.',
  notes: '',
  input: z.object({
    folderId: z
      .string()
      .describe('Id of the folder to rename (from listFolders).'),
    name: z.string().min(1).describe('New display name for the folder.'),
  }),
  output: z.object({
    folder: FolderSchema.describe('The folder after renaming.'),
  }),
};

// ============================================================================
// deleteFolder
// ============================================================================

export const deleteFolderSchema = {
  name: 'deleteFolder',
  description:
    'Delete a portfolio folder. The domains it contained remain in the account, only the grouping is removed.',
  notes: '',
  input: z.object({
    folderId: z
      .string()
      .describe('Id of the folder to delete (from listFolders).'),
  }),
  output: z.object({
    folderId: z.string().describe('Id of the deleted folder.'),
    deleted: z.boolean().describe('True when the folder was deleted.'),
  }),
};

// ============================================================================
// addDomainsToFolder
// ============================================================================

export const addDomainsToFolderSchema = {
  name: 'addDomainsToFolder',
  description: 'Add one or more domains to a portfolio folder.',
  notes:
    'Domains must be fully-qualified domain names already registered in the account (e.g. "example.com"). A domain can belong to more than one folder.',
  input: z.object({
    folderId: z
      .string()
      .describe('Id of the target folder (from listFolders).'),
    domainNames: z
      .array(z.string())
      .describe(
        'Fully-qualified domain names. With INCLUDE (default), adds these domains. With EXCLUDE, adds all account domains EXCEPT these (pass [] to add all domains).',
      ),
    domainFilterType: z
      .enum(['INCLUDE', 'EXCLUDE'])
      .optional()
      .describe(
        'How domainNames is interpreted. "INCLUDE" (default): add only the listed domains. "EXCLUDE": add ALL domains in the account EXCEPT the listed ones.',
      ),
  }),
  output: z.object({
    folderId: z.string().describe('Id of the folder that was updated.'),
    added: z.array(z.string()).describe('Domain names added to the folder.'),
  }),
};

// ============================================================================
// removeDomainsFromFolder
// ============================================================================

export const removeDomainsFromFolderSchema = {
  name: 'removeDomainsFromFolder',
  description:
    'Remove one or more domains from a portfolio folder. The domains remain registered in the account.',
  notes:
    'Domains must be fully-qualified domain names (e.g. "example.com"). All filter params narrow the set of domains operated on — they combine as AND conditions.',
  input: z.object({
    folderId: z
      .string()
      .describe('Id of the folder to remove domains from (from listFolders).'),
    domainNames: z
      .array(z.string())
      .describe(
        'Fully-qualified domain names. With INCLUDE (default), removes these domains. With EXCLUDE, removes all account domains from the folder EXCEPT these (pass [] to remove all).',
      ),
    domainFilterType: z
      .enum(['INCLUDE', 'EXCLUDE'])
      .optional()
      .describe(
        'How domainNames is interpreted. "INCLUDE" (default): remove only the listed domains. "EXCLUDE": remove ALL domains in the account EXCEPT the listed ones.',
      ),
    domainNameContains: z
      .string()
      .optional()
      .describe(
        'Remove only domains whose name contains this substring. Combines with domainNames as an AND condition.',
      ),
    folderIds: z
      .array(z.string())
      .optional()
      .describe(
        'Remove only domains that are currently members of these folders. Provide numeric folder id strings from listFolders (e.g. "12345"). Non-numeric values are rejected. Combines as an AND condition with other filters.',
      ),
    profileIds: z
      .array(z.string())
      .optional()
      .describe(
        'Remove only domains that have one of these profiles assigned. Provide numeric profile id strings from listDomainProfiles (e.g. "67890"). Non-numeric values are rejected. Combines as an AND condition with other filters.',
      ),
    domainStates: z
      .array(
        z.enum([
          'ACTIVE',
          'DCC_ACTIVE_EXCEPT_STATUS_ZERO',
          'DNS_HOSTING',
          'DNS_OFFSITE',
          'INACTIVE',
          'RAA_ACTION_NEEDED',
          'REDEMPTION',
          'ADULT_BLOCK',
          'DCC_ACTIVE_REGISTERED_DOMAINS',
          'DCC_REGISTERED_DOMAINS_EXCEPT_STATUS_ZERO',
          'DCC_TRANSFER',
        ]),
      )
      .optional()
      .describe(
        'Remove only domains in these status states. Common values: "ACTIVE", "REDEMPTION". Combines as an AND condition with other filters.',
      ),
    registrationTypes: z
      .array(
        z.enum([
          'DOMAIN_BLOCK',
          'LEASE_TO_OWN',
          'DOMAIN_NES',
          'ANNUAL_TERM_MONTHLY_PAYMENT',
          'NOT_SPECIFIED',
        ]),
      )
      .optional()
      .describe(
        'Remove only domains with these registration types. "NOT_SPECIFIED" covers standard registrations; "ANNUAL_TERM_MONTHLY_PAYMENT" covers ATMP domains. Combines as an AND condition with other filters.',
      ),
    tlds: z
      .array(z.string())
      .optional()
      .describe(
        'Remove only domains with these TLD extensions (e.g. ["com", "net", "org"]). Combines as an AND condition with other filters.',
      ),
    isAutoRenewEnabled: z
      .boolean()
      .optional()
      .describe(
        'Remove only domains matching this auto-renew state: true = auto-renew ON, false = auto-renew OFF. Omit to include both.',
      ),
    isLocked: z
      .boolean()
      .optional()
      .describe(
        'Remove only domains matching this transfer-lock state: true = locked, false = unlocked. Omit to include both.',
      ),
    privacyLevels: z
      .array(z.enum(['OPEN', 'BASIC', 'FULL']))
      .optional()
      .describe(
        'Remove only domains with these privacy/masking levels. "OPEN" = no privacy, "BASIC" = basic masking, "FULL" = full privacy. Combines as an AND condition with other filters.',
      ),
    protectionPlans: z
      .array(
        z.enum(['GOOD', 'BETTER', 'DOPCLONE', 'DOPL', 'BEST', 'NOTELIGIBLE']),
      )
      .optional()
      .describe(
        'Remove only domains with these protection plan levels. Combines as an AND condition with other filters.',
      ),
    nameservers: z
      .array(z.string())
      .optional()
      .describe(
        'Remove only domains using these nameservers (e.g. ["ns1.example.com"]). Combines with nameserverFilterType as an AND condition with other filters.',
      ),
    nameserverFilterType: z
      .enum(['INCLUDE', 'EXCLUDE'])
      .optional()
      .describe(
        'How nameservers is interpreted. "INCLUDE" (default): match domains using these nameservers. "EXCLUDE": match domains NOT using these nameservers. Only used when nameservers is provided.',
      ),
    minimumExpirationDays: z
      .number()
      .optional()
      .describe(
        'Remove only domains expiring at least this many days from now. Combines as an AND condition with other filters.',
      ),
    maximumExpirationDays: z
      .number()
      .optional()
      .describe(
        'Remove only domains expiring within at most this many days from now. Combines as an AND condition with other filters.',
      ),
    forwardingURL: z
      .string()
      .optional()
      .describe(
        'Remove only domains forwarding to this URL. Combines as an AND condition with other filters.',
      ),
  }),
  output: z.object({
    folderId: z.string().describe('Id of the folder that was updated.'),
    removed: z
      .array(z.string())
      .describe('Domain names removed from the folder.'),
  }),
};

// ============================================================================
// Registry + inferred output types
// ============================================================================

export const foldersSchemas = [
  listFoldersSchema,
  createFolderSchema,
  updateFolderSchema,
  deleteFolderSchema,
  addDomainsToFolderSchema,
  removeDomainsFromFolderSchema,
];

export type Folder = z.infer<typeof FolderSchema>;
export type ListFoldersOutput = z.infer<typeof listFoldersSchema.output>;
export type CreateFolderOutput = z.infer<typeof createFolderSchema.output>;
export type UpdateFolderOutput = z.infer<typeof updateFolderSchema.output>;
export type DeleteFolderOutput = z.infer<typeof deleteFolderSchema.output>;
export type AddDomainsToFolderOutput = z.infer<
  typeof addDomainsToFolderSchema.output
>;
export type RemoveDomainsFromFolderOutput = z.infer<
  typeof removeDomainsFromFolderSchema.output
>;
