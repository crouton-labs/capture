import { z } from 'zod';

const AuraTokenParam = z.string().describe('Aura token from getContext()');
const AuraContextParam = z.string().describe('Aura context from getContext()');

// ============================================================================
// Custom Field Inspection (read-only)
// ============================================================================

export const listCustomFieldsSchema = {
  name: 'listCustomFields',
  description:
    'List all custom fields for a specific object, filtering out standard Salesforce fields. Returns only fields with __c suffix (user-created custom fields).',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe(
        'API name of the object (e.g., "Account", "Contact", "CustomObj__c")',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe('Filter fields by search term (matches label or API name)'),
    sortBy: z
      .enum([
        'Label',
        'QualifiedApiName',
        'DataType',
        'ControllingFieldDefinition.Label',
        'IsIndexed',
      ])
      .optional()
      .describe('Field to sort results by (default "Label")'),
    sortDirection: z
      .enum(['ascending', 'descending'])
      .optional()
      .describe('Sort direction (default "ascending")'),
  }),
  output: z.object({
    fields: z
      .array(
        z
          .object({
            label: z.string().describe('Field label (display name)'),
            apiName: z
              .string()
              .describe(
                'Field API name (always ends in __c for custom fields)',
              ),
            developerName: z.string().describe('Field developer name'),
            dataType: z
              .string()
              .describe(
                'Field data type (e.g., "Text(255)", "Lookup(User)", "Picklist", "Number(18, 0)", "Checkbox")',
              ),
            indexed: z.boolean().describe('Whether the field is indexed'),
            fieldDurableId: z.string().describe('Durable ID of the field'),
            entityLabel: z.string().describe('Label of the parent object'),
          })
          .passthrough(),
      )
      .describe(
        'Array of custom field records (only __c fields, no standard fields)',
      ),
  }),
  notes:
    'Requires Setup access. Uses the same endpoint as listObjectFields but filters to custom fields only (apiName ends with __c). Auto-paginates internally.',
};

export type ListCustomFieldsInput = z.infer<
  typeof listCustomFieldsSchema.input
>;
export type ListCustomFieldsOutput = z.infer<
  typeof listCustomFieldsSchema.output
>;

export const getFieldDependenciesSchema = {
  name: 'getFieldDependencies',
  description:
    'Get field dependency rules for an object, showing which picklist fields control other picklist fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe('API name of the object (e.g., "Account", "CustomObj__c")'),
  }),
  output: z.object({
    dependencies: z
      .array(
        z.object({
          controllingField: z
            .string()
            .describe('API name of the controlling field'),
          dependentField: z
            .string()
            .describe('API name of the dependent field'),
          controllingValues: z
            .record(z.string(), z.number())
            .describe(
              'Map of controlling field value labels to their index positions',
            ),
          dependentValues: z
            .array(
              z.object({
                label: z.string().describe('Display label'),
                value: z.string().describe('API value'),
                validFor: z
                  .array(z.number())
                  .describe(
                    'Array of controlling value indices for which this dependent value is valid',
                  ),
              }),
            )
            .describe(
              'Dependent field values with their controlling value mappings',
            ),
        }),
      )
      .describe(
        'Array of field dependency rules. Empty array if no dependencies are configured.',
      ),
  }),
  notes:
    'Uses getObjectInfo to extract dependency data from the dependentFields map, then getPicklistValuesByRecordType to get the actual controlling/dependent values with their validFor mappings.',
};

export type GetFieldDependenciesInput = z.infer<
  typeof getFieldDependenciesSchema.input
>;
export type GetFieldDependenciesOutput = z.infer<
  typeof getFieldDependenciesSchema.output
>;

export const fieldSchemas = [
  listCustomFieldsSchema,
  getFieldDependenciesSchema,
];
