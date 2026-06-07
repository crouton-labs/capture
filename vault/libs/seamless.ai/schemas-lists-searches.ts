import { z } from 'zod';

// ============================================================================
// Shared types
// ============================================================================

const SavedSearchSchema = z.object({
  id: z.string().describe('Saved search ID'),
  name: z.string().describe('Saved search name'),
  type: z.string().describe('Search type: contacts or companies'),
  numResultsApproved: z
    .number()
    .optional()
    .describe('Total results when search was saved'),
  sortColumn: z.string().nullable().describe('Sort column if set'),
  sortOrder: z.string().nullable().describe('Sort order if set'),
  createdAt: z.string().describe('ISO timestamp when search was created'),
  updatedAt: z.string().describe('ISO timestamp when search was last updated'),
  values: z
    .record(z.string(), z.unknown())
    .describe(
      'Saved filter values. Common keys: companies, titles, seniorities, departments, industries, locations, employeeSizes, estimatedRevenues, technologies, keywords',
    ),
  savedSearchTags: z
    .array(z.string())
    .optional()
    .describe('Tag IDs associated with this saved search'),
});

export type SavedSearch = z.infer<typeof SavedSearchSchema>;

// ============================================================================
// deleteContactList
// ============================================================================

export const deleteContactListSchema = {
  name: 'deleteContactList',
  description:
    'Delete a contact list (tag) by ID. Removes the list but does not delete the contacts in it.',
  notes:
    'Get the listId from listContactLists(). Contacts in the list are unaffected; only the list container is removed.',
  input: z.object({
    listId: z
      .string()
      .describe('ID of the list to delete (from listContactLists)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the list was deleted'),
  }),
};

export type DeleteContactListInput = z.infer<
  typeof deleteContactListSchema.input
>;
export type DeleteContactListOutput = z.infer<
  typeof deleteContactListSchema.output
>;

// ============================================================================
// removeContactsFromList
// ============================================================================

export const removeContactsFromListSchema = {
  name: 'removeContactsFromList',
  description:
    'Remove one or more contacts from a specific list. Contacts remain saved but are unlinked from the list.',
  notes:
    'This replaces each contact\'s full tag assignment. If a contact belongs to multiple lists and you want to keep the other assignments, this function handles it automatically by preserving other tags. Use numeric contact IDs (e.g., "5788426795"), not UUID searchResultIds.',
  input: z.object({
    listId: z
      .string()
      .describe(
        'ID of the list to remove contacts from (from listContactLists)',
      ),
    contactIds: z
      .array(z.string())
      .describe('Array of numeric contact IDs to remove from the list'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether contacts were removed'),
    removedCount: z.number().describe('Number of contacts processed'),
  }),
};

export type RemoveContactsFromListInput = z.infer<
  typeof removeContactsFromListSchema.input
>;
export type RemoveContactsFromListOutput = z.infer<
  typeof removeContactsFromListSchema.output
>;

// ============================================================================
// addCompaniesToList
// ============================================================================

export const addCompaniesToListSchema = {
  name: 'addCompaniesToList',
  description:
    'Add saved companies to an existing list (tag). Companies must be saved/researched first.',
  notes:
    'Use the numeric company ID from saved companies, not search result UUIDs. The list must already exist; create one with createContactList first (lists are shared between contacts and companies).',
  input: z.object({
    listId: z
      .string()
      .describe(
        'ID of the target list (from listContactLists or createContactList)',
      ),
    companyIds: z
      .array(z.string())
      .describe('Array of saved company IDs to add to the list'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether companies were added successfully'),
    addedCount: z.number().describe('Number of companies added'),
  }),
};

export type AddCompaniesToListInput = z.infer<
  typeof addCompaniesToListSchema.input
>;
export type AddCompaniesToListOutput = z.infer<
  typeof addCompaniesToListSchema.output
>;

// ============================================================================
// listSavedSearches
// ============================================================================

export const listSavedSearchesSchema = {
  name: 'listSavedSearches',
  description:
    'Get all saved search configurations for contacts or companies. Saved searches preserve filter criteria for re-use.',
  notes:
    'Returns the saved filter values that can be passed back to searchContacts or searchCompanies. Use deleteSavedSearch or createSavedSearch to manage the list.',
  input: z.object({
    type: z
      .enum(['contacts', 'companies'])
      .describe('Type of saved searches to list'),
  }),
  output: z.object({
    savedSearches: z
      .array(SavedSearchSchema)
      .describe('Array of saved search configurations'),
  }),
};

export type ListSavedSearchesInput = z.infer<
  typeof listSavedSearchesSchema.input
>;
export type ListSavedSearchesOutput = z.infer<
  typeof listSavedSearchesSchema.output
>;

// ============================================================================
// deleteSavedSearch
// ============================================================================

export const deleteSavedSearchSchema = {
  name: 'deleteSavedSearch',
  description:
    'Permanently delete a saved search configuration by ID. The underlying contacts or companies are not affected.',
  notes:
    'Get the savedSearchId from listSavedSearches(). This operation is irreversible.',
  input: z.object({
    savedSearchId: z
      .string()
      .describe('ID of the saved search to delete (from listSavedSearches)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the saved search was deleted'),
  }),
};

export type DeleteSavedSearchInput = z.infer<
  typeof deleteSavedSearchSchema.input
>;
export type DeleteSavedSearchOutput = z.infer<
  typeof deleteSavedSearchSchema.output
>;

// ============================================================================
// createSavedSearch
// ============================================================================

export const createSavedSearchSchema = {
  name: 'createSavedSearch',
  description:
    'Save a search filter configuration for reuse. Creates a named saved search with the specified filter criteria that can be loaded later to re-run the same search.',
  notes:
    'The values field uses the same filter fields as searchContacts (companies, titles, seniorities, etc.). All array fields in values must be arrays (not null). ' +
    'IMPORTANT constraints: (1) seniorities only accepts 4 specific values: "VP", "Director", "Manager", "Senior"; any other value (including "C-Suite" and "Individual Contributor") is silently dropped by the API; ' +
    '(2) values is required; omitting it causes a generic 500. ' +
    'Use listSavedSearches to see existing saved searches.',
  input: z.object({
    name: z.string().describe('Name for the saved search'),
    type: z.enum(['contacts', 'companies']).describe('Type of search to save'),
    values: z
      .record(z.string(), z.unknown())
      .describe(
        'Filter object with the same keys as searchContacts input. Known keys: ' +
          'companies (string[]), companiesBulkId (string[]), companiesExactMatch (boolean), includeCompanyAliases (boolean), ' +
          'titles (string[]), titlesBulkId (string[]), titlesExactMatch (boolean), ' +
          'seniorities (string[], valid values ONLY: "VP", "Director", "Manager", "Senior"; other values including "C-Suite" and "Individual Contributor" are silently dropped), departments (string[]), ' +
          'industries (string[]), industrySicCodes (string[]), industryNaicsCodes (string[]), ' +
          'locations (string[]), locationRadius (string[]), locationTypes (string[], e.g. ["both"]), ' +
          'zipCodes (string[]), zipCodesRadius (string[]), zipCodesTypes (string[]), ' +
          'timezones (string[]), timezonesTypes (string[]), ' +
          'names (string[]), namesBulkId (string[]), ' +
          'formerCompanies (string[]), formerCompaniesBulkId (string[]), formerCompaniesExactMatch (boolean), anyFormerCompanyMatch (boolean), ' +
          'employeeSizes (string[], valid values: "0 - 1 (Self-employed)", "2 - 10", "11 - 50", "51 - 200", "201 - 500", "501 - 1,000", "1,001 - 5,000", "5,001 - 10,000", "10,001+"), ' +
          'estimatedRevenues (string[], valid values: "$0 - $100K", "$100K - $1M", "$1M - $5M", "$5M - $20M", "$20M - $50M", "$50M - $100M", "$100M - $500M", "$500M - $1B", "$1B+"), ' +
          'technologies (string[]), technologiesIsOr (boolean), ' +
          'keywords (string[]), keywordsIsOr (boolean), ' +
          'jobChangesType (string[]), jobChangesDayRange (string[]), ' +
          'companyFoundedOn (string[]), companyFundingTotals (string[]), companyLatestFundingDates (string[]), companyLatestFundingClassifications (string[]), companyTypes (string[]). ' +
          'All array fields must be arrays, not null.',
      ),
    sortColumn: z
      .string()
      .nullable()
      .optional()
      .describe('Column to sort results by'),
    sortOrder: z
      .string()
      .nullable()
      .optional()
      .describe('Sort direction: asc or desc'),
    lastPage: z
      .number()
      .optional()
      .describe('Last page number viewed (defaults to 0)'),
    numResultsApproved: z
      .number()
      .optional()
      .describe('Number of results approved/viewed (defaults to 0)'),
    tagIds: z
      .array(z.string())
      .optional()
      .describe('Tag IDs to associate with this saved search'),
  }),
  output: z.object({
    id: z.string().describe('ID of the created saved search'),
    name: z.string().describe('Name of the created saved search'),
    type: z.string().describe('Search type: contacts or companies'),
  }),
};

export type CreateSavedSearchInput = z.infer<
  typeof createSavedSearchSchema.input
>;
export type CreateSavedSearchOutput = z.infer<
  typeof createSavedSearchSchema.output
>;

// ============================================================================
// exportContacts
// ============================================================================

export type ExportJob = {
  id: string;
  type: string;
  recordCount?: number;
  fileName?: string;
  isFinished: boolean;
  startedAt?: string;
  completedAt?: string;
  erroredAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export const exportContactsSchema = {
  name: 'exportContacts',
  description:
    'Export all saved contacts as a file. Triggers an async export job via POST /api/users/dataExports and polls until completion (typically 1-3 seconds). Can export all contacts or filter to a specific list using the lists param.',
  notes:
    'The export API does not return a download URL; the exported file is only accessible from login.seamless.ai/data-export (the Data Exports page). This function returns the job metadata (status, fileName, recordCount) once the export completes. Requires a paid plan (returns 401 on free tier accounts). The dateRange filter affects which contacts are included based on when they were researched/saved. Use the lists param to export only contacts from a specific list (corresponds to the "Download Filtered" option in the UI).',
  input: z.object({
    format: z
      .enum(['csv', 'xlsx'])
      .optional()
      .describe('Export file format. Defaults to csv.'),
    fileVersion: z
      .enum(['cleaned', 'raw', 'custom'])
      .optional()
      .describe(
        'Download type. "cleaned" = de-duplicated and formatted (default), "raw" = raw data as stored, "custom" = custom field selection.',
      ),
    dateRange: z
      .enum(['all', 'today', 'last7Days', 'currentMonth', 'priorMonth'])
      .optional()
      .describe(
        'Filter contacts by when they were researched/saved. Defaults to "all" (exports all saved contacts).',
      ),
    downloadUserId: z
      .string()
      .optional()
      .describe(
        'Numeric user ID to export contacts for. Auto-fetched from /users/me if not provided.',
      ),
    fileName: z
      .string()
      .optional()
      .describe(
        'Custom file name for the export (without extension). A default name is generated if omitted.',
      ),
    lists: z
      .string()
      .optional()
      .describe(
        'Filter the export to contacts in a specific list. Provide the list name (from listContactLists). Corresponds to the "Download Filtered" export option in the UI. When omitted, all saved contacts are exported.',
      ),
    ownership: z
      .enum(['both', 'shared', 'my-contacts', 'none'])
      .optional()
      .describe(
        'Filter contacts by ownership. "both" = all contacts (default), "shared" = shared/team contacts only, "my-contacts" = contacts I researched only, "none" = no contacts (empty export).',
      ),
    emailAiFilterType: z
      .enum([
        'personalEmail',
        'companyEmail',
        'personalAndCompanyEmail',
        'personalOrCompanyEmail',
      ])
      .optional()
      .describe(
        'Filter by email type to include. "companyEmail" = company emails only (default), "personalEmail" = personal/contact emails only, "personalAndCompanyEmail" = must have both, "personalOrCompanyEmail" = either type.',
      ),
    phoneAiFilterType: z
      .enum([
        'contactPhone',
        'companyPhone',
        'contactAndCompanyPhone',
        'contactOrCompanyPhone',
      ])
      .optional()
      .describe(
        'Filter by phone type to include. "companyPhone" = company phones only (default), "contactPhone" = personal/contact phones only, "contactAndCompanyPhone" = must have both, "contactOrCompanyPhone" = either type.',
      ),
    totalAiRange: z
      .string()
      .optional()
      .describe(
        'Email AI confidence score range filter. Format: "min|max" where min and max are integers 0-100. Example: "50|100" exports only contacts with ≥50% email confidence. Defaults to "0|100" (all confidence levels).',
      ),
    phoneTotalAiRange: z
      .string()
      .optional()
      .describe(
        'Phone AI confidence score range filter. Format: "min|max" where min and max are integers 0-100. Example: "50|100" exports only contacts with ≥50% phone confidence. Defaults to "0|100" (all confidence levels).',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the export job completed successfully'),
    jobId: z.string().optional().describe('Export job ID'),
    status: z
      .string()
      .describe(
        'Export status: "completed" (done), "processing" (still running, timed out waiting), "failed" (errored).',
      ),
    fileName: z
      .string()
      .optional()
      .describe(
        'The generated or custom file name for the export (e.g., "MyContacts_export_user@example.com_2026-03-09_cleaned.csv").',
      ),
    startedAt: z
      .string()
      .optional()
      .describe('ISO timestamp when the export job started processing.'),
    completedAt: z
      .string()
      .optional()
      .describe('ISO timestamp when the export job completed.'),
    recordCount: z
      .number()
      .optional()
      .describe('Total number of contacts included in the export.'),
  }),
};

export type ExportContactsInput = z.infer<typeof exportContactsSchema.input>;
export type ExportContactsOutput = z.infer<typeof exportContactsSchema.output>;

// ============================================================================
// listEnrichJobs
// ============================================================================

const EnrichJobSchema = z.object({
  id: z.string().describe('Enrich job ID'),
  name: z
    .string()
    .optional()
    .describe('Job name (original uploaded file name)'),
  listName: z.string().optional().describe('Display name of the list'),
  type: z
    .enum([
      'contactList',
      'companyList',
      'jobChanges',
      'emailList',
      'cleanseList',
      'phoneList',
    ])
    .optional()
    .describe(
      'Enrichment type: contactList, companyList, jobChanges, emailList, cleanseList, phoneList',
    ),
  status: z
    .string()
    .describe(
      'Job status from API (uppercase): COMPLETE, ERROR, CANCELED, RESEARCHING',
    ),
  isResearched: z
    .boolean()
    .optional()
    .describe('Whether all records have been fully researched'),
  hasError: z.boolean().optional().describe('Whether the job has an error'),
  error: z
    .string()
    .optional()
    .describe('Error message if the job encountered an error'),
  totalRecords: z
    .number()
    .optional()
    .describe('Total number of records in the uploaded file'),
  numResearched: z
    .number()
    .optional()
    .describe('Number of records that have been researched so far'),
  numAlreadyResearched: z
    .number()
    .optional()
    .describe('Number of records already researched before this job ran'),
  numResultsExpected: z
    .number()
    .optional()
    .describe('Expected number of results (used for jobChanges type)'),
  totalBytes: z
    .number()
    .optional()
    .describe('Size of the uploaded file in bytes'),
  addToMyContacts: z
    .boolean()
    .optional()
    .describe('Whether results have been added to My Contacts'),
  addToMyCompanies: z
    .boolean()
    .optional()
    .describe('Whether results have been added to My Companies'),
  // Field names from older API responses; actual API returns totalRecords and numResearched
  totalContacts: z
    .number()
    .optional()
    .describe('Older field name; use totalRecords instead'),
  completedContacts: z
    .number()
    .optional()
    .describe('Older field name; use numResearched instead'),
  createdAt: z
    .string()
    .optional()
    .describe('ISO timestamp when job was created'),
  updatedAt: z
    .string()
    .optional()
    .describe('ISO timestamp of last status update'),
});

export type EnrichJob = z.infer<typeof EnrichJobSchema>;

export const listEnrichJobsSchema = {
  name: 'listEnrichJobs',
  description:
    'List bulk enrichment jobs and their statuses. These are file-upload enrichment jobs created on the /enrich page, not per-contact researchBatch jobs.',
  notes:
    'Endpoint: GET /api/users/enrich. Filter by type to see jobs of a specific kind. Returns {success: true, data: [...]} where data is the array of jobs.',
  input: z.object({
    type: z
      .enum([
        'contactList',
        'companyList',
        'jobChanges',
        'emailList',
        'cleanseList',
        'phoneList',
      ])
      .optional()
      .describe(
        'Filter jobs by enrichment type. contactList=contact list enrichment, companyList=company list enrichment, jobChanges=job change enrichment, emailList=email list enrichment, cleanseList=cleanse list, phoneList=phone number list. Omit to return all types.',
      ),
    page: z.number().optional().describe('Page number (0-indexed). Default 0.'),
    limit: z.number().optional().describe('Results per page. Default 20.'),
  }),
  output: z.object({
    jobs: z
      .array(EnrichJobSchema)
      .describe('Array of enrichment jobs with status information'),
    totalCount: z
      .number()
      .optional()
      .describe('Total number of enrichment jobs'),
  }),
};

export type ListEnrichJobsInput = z.infer<typeof listEnrichJobsSchema.input>;
export type ListEnrichJobsOutput = z.infer<typeof listEnrichJobsSchema.output>;

// ============================================================================
// allSchemas
// ============================================================================

export const allSchemas = [
  deleteContactListSchema,
  removeContactsFromListSchema,
  addCompaniesToListSchema,
  listSavedSearchesSchema,
  deleteSavedSearchSchema,
  createSavedSearchSchema,
  exportContactsSchema,
  listEnrichJobsSchema,
];
