import { z } from 'zod';

// ============================================================================
// Common Parameters
// ============================================================================

const AuraTokenParam = z.string().describe('Aura token from getContext()');
const AuraContextParam = z.string().describe('Aura context from getContext()');

const SObjectRecord = z
  .object({
    Id: z.string().describe('Salesforce record ID'),
  })
  .passthrough();

// ============================================================================
// findDuplicates
// ============================================================================

export const findDuplicatesSchema = {
  name: 'findDuplicates',
  description:
    'Find potential duplicate records by providing field values to match against existing records using Salesforce duplicate detection. Searches by name, email, phone, or other identifying fields.',
  notes:
    'Provide the fields that identify the record you want to check for duplicates. For Account: use fields.Name. For Contact/Lead: use fields.LastName (required), optionally fields.FirstName, fields.Email, fields.Company. The more fields you provide, the more accurate the matching. Results are ranked by relevance.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe(
        'API name of the object to check for duplicates (e.g., "Account", "Contact", "Lead")',
      ),
    fields: z
      .record(z.string(), z.unknown())
      .describe(
        'Field values to match against. For Account: { Name: "Acme" }. For Contact: { LastName: "Smith", FirstName: "John", Email: "john@example.com" }. For Lead: { LastName: "Smith", Company: "Acme", Email: "smith@acme.com" }.',
      ),
    maxResults: z
      .number()
      .optional()
      .describe('Maximum number of duplicate matches to return. Default: 25'),
  }),
  output: z.object({
    duplicateResults: z
      .array(
        z.object({
          ruleName: z
            .string()
            .describe('Name of the duplicate/matching rule that fired'),
          matchRecords: z
            .array(SObjectRecord)
            .describe('Records that matched the duplicate criteria'),
        }),
      )
      .describe(
        'Duplicate detection results grouped by rule. Empty array if no duplicates found.',
      ),
    totalMatches: z.number().describe('Total number of matched records'),
    searchTerm: z
      .string()
      .describe('The search term derived from the provided fields'),
  }),
};

export type FindDuplicatesInput = z.infer<typeof findDuplicatesSchema.input>;
export type FindDuplicatesOutput = z.infer<typeof findDuplicatesSchema.output>;

// ============================================================================
// listDuplicateRules
// ============================================================================

export const listDuplicateRulesSchema = {
  name: 'listDuplicateRules',
  description:
    'List duplicate rules configured in the Salesforce org. Shows which objects have duplicate detection enabled and the rule configuration.',
  notes: '',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    activeOnly: z
      .boolean()
      .optional()
      .describe(
        'Filter to only active rules. Default: false (returns all rules)',
      ),
    pageSize: z
      .number()
      .optional()
      .describe('Number of rules to return. Default: 50'),
  }),
  output: z.object({
    rules: z
      .array(
        z.object({
          id: z.string().describe('Duplicate rule record ID'),
          name: z.string().describe('Rule name'),
          developerName: z
            .string()
            .describe('Developer name (API name) of the rule'),
          objectType: z
            .string()
            .describe(
              'Object type the rule applies to (e.g., "Account", "Contact", "Lead")',
            ),
          isActive: z
            .boolean()
            .describe('Whether the rule is currently active'),
        }),
      )
      .describe('Configured duplicate rules'),
    totalCount: z.number().describe('Total number of duplicate rules in org'),
  }),
};

export type ListDuplicateRulesInput = z.infer<
  typeof listDuplicateRulesSchema.input
>;
export type ListDuplicateRulesOutput = z.infer<
  typeof listDuplicateRulesSchema.output
>;

// ============================================================================
// All schemas for this domain
// ============================================================================

export const duplicateSchemas = [
  findDuplicatesSchema,
  listDuplicateRulesSchema,
];
