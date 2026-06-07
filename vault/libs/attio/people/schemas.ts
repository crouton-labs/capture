import { z } from 'zod';

export const SlugParam = z
  .string()
  .describe('Workspace slug from getContext()');

export const PersonLocationSchema = z.object({
  city: z.string().nullable().optional().describe('City'),
  state: z.string().nullable().optional().describe('State or province'),
  country_code: z.string().nullable().optional().describe('ISO country code'),
});

export const PersonSchema = z.object({
  id: z.string().describe('Person UUID'),
  name: z.string().nullable().optional().describe('Full name'),
  first_name: z.string().nullable().optional().describe('First name'),
  last_name: z.string().nullable().optional().describe('Last name'),
  email_addresses: z
    .array(z.object({ email_address: z.string() }))
    .optional()
    .describe('Email addresses on file'),
  phone_numbers: z
    .array(z.object({ phone_number: z.string() }))
    .optional()
    .describe('Phone numbers on file'),
  primary_location: PersonLocationSchema.nullable()
    .optional()
    .describe('Primary location'),
  communication_intelligence: z
    .object({
      last_contacted_at: z
        .string()
        .nullable()
        .optional()
        .describe('ISO timestamp of last contact'),
    })
    .nullable()
    .optional()
    .describe('Last contact information'),
});

export const listPeopleSchema = {
  name: 'listPeople',
  description:
    'List all people records in the workspace with full contact details',
  notes:
    'Requires getContext() first to obtain peopleEntityDefId. Look up entityDefinitions where slug === "people".',
  input: z.object({
    slug: SlugParam,
    peopleEntityDefId: z
      .string()
      .describe(
        'People entity definition UUID from getContext() entityDefinitions (slug === "people")',
      ),
    limit: z
      .number()
      .optional()
      .default(100)
      .describe('Max people to return (default: 100)'),
  }),
  output: z.object({
    total: z.number().describe('Total person count in workspace'),
    people: z.array(PersonSchema).describe('Person records'),
  }),
};

export const getPersonSchema = {
  name: 'getPerson',
  description: 'Get full contact details for a single person record by UUID',
  notes: '',
  input: z.object({
    slug: SlugParam,
    personId: z.string().describe('Person UUID'),
  }),
  output: PersonSchema,
};

export const createPersonSchema = {
  name: 'createPerson',
  description:
    'Create a new person record in the workspace with optional contact details',
  notes: 'Requires getContext() first to obtain the workspace slug.',
  input: z.object({
    slug: SlugParam,
    name: z
      .string()
      .optional()
      .describe('Full name (use instead of firstName/lastName when available)'),
    firstName: z.string().optional().describe('First name'),
    lastName: z.string().optional().describe('Last name'),
    emailAddress: z
      .string()
      .optional()
      .describe('Primary email address to associate with the person'),
  }),
  output: PersonSchema,
};

export const updatePersonSchema = {
  name: 'updatePerson',
  description: 'Update one or more attributes on an existing person record',
  notes: 'Obtain personId from listPeople() or searchRecords().',
  input: z.object({
    slug: SlugParam,
    personId: z.string().describe('Person UUID to update'),
    name: z.string().optional().describe('New full name'),
    firstName: z.string().optional().describe('New first name'),
    lastName: z.string().optional().describe('New last name'),
    emailAddress: z.string().optional().describe('New primary email address'),
    phoneNumber: z.string().optional().describe('New primary phone number'),
  }),
  output: PersonSchema,
};

export const deletePersonSchema = {
  name: 'deletePerson',
  description: 'Permanently delete a person record by UUID',
  notes:
    'Obtain personId from listPeople() or searchRecords(). This operation is irreversible.',
  input: z.object({
    slug: SlugParam,
    personId: z.string().describe('Person UUID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('True when person was deleted'),
  }),
};

export type Person = z.infer<typeof PersonSchema>;
export type ListPeopleOutput = z.infer<typeof listPeopleSchema.output>;
export type GetPersonOutput = z.infer<typeof getPersonSchema.output>;
export type CreatePersonOutput = z.infer<typeof createPersonSchema.output>;
export type UpdatePersonOutput = z.infer<typeof updatePersonSchema.output>;
export type DeletePersonOutput = z.infer<typeof deletePersonSchema.output>;
