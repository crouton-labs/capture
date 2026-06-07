import { z } from 'zod';

const SlugParam = z.string().describe('Workspace slug from getContext()');

export const AttributeDefinitionSchema = z.object({
  id: z.string().describe('Attribute definition UUID'),
  slug: z.string().describe('API slug for this attribute'),
  title: z.string().describe('Display name'),
  type: z
    .string()
    .describe('Attribute type (text, number, date, select, etc.)'),
  isRequired: z.boolean().describe('Whether this attribute is required'),
  isArchived: z.boolean().describe('Whether archived'),
});

export const ObjectTypeSchema = z.object({
  id: z.string().describe('Entity definition UUID'),
  slug: z.string().describe('API slug (e.g. companies, people)'),
  name: z.string().describe('Display name (singular noun)'),
  isArchived: z.boolean().describe('Whether this entity type is archived'),
  attributes: z
    .array(AttributeDefinitionSchema)
    .describe('Attribute definitions for this object type'),
});

export const listObjectsSchema = {
  name: 'listObjects',
  description:
    'List all entity definitions (object types) with their attribute schemas',
  notes:
    'Returns richer data than getContext(); includes per-object attribute definitions. Use to discover available fields before reading or writing records.',
  input: z.object({
    slug: SlugParam,
  }),
  output: z.object({
    objectTypes: z
      .array(ObjectTypeSchema)
      .describe('All entity types with their attribute definitions'),
  }),
};

export const UserSchema = z.object({
  id: z.string().describe('User UUID'),
  emailAddress: z.string().describe('Email address'),
  name: z
    .object({
      first: z.string().nullable().optional().describe('First name'),
      last: z.string().nullable().optional().describe('Last name'),
      full: z.string().nullable().optional().describe('Full display name'),
    })
    .describe('User name parts'),
  avatarUrl: z.string().nullable().optional().describe('Avatar URL'),
  accessLevel: z
    .string()
    .describe('Workspace access level. Common values: "admin", "member".'),
});

export const listUsersSchema = {
  name: 'listUsers',
  description:
    'List all workspace members with their roles, email addresses, and user UUIDs',
  notes:
    'Use this to resolve user UUIDs for assigning tasks or filtering by assignee.',
  input: z.object({
    slug: SlugParam,
  }),
  output: z.object({
    users: z.array(UserSchema).describe('Workspace members'),
  }),
};

export const ListSchema = z
  .object({
    id: z.string().describe('Collection UUID'),
    name: z.string().nullable().optional().describe('Collection display name'),
    isArchived: z.boolean().nullable().optional().describe('Whether archived'),
  })
  .passthrough();

export const listListsSchema = {
  name: 'listLists',
  description: 'List all collections (saved views/lists) in the workspace',
  notes:
    'Returns an empty array in fresh workspaces with no collections created.',
  input: z.object({
    slug: SlugParam,
  }),
  output: z.object({
    lists: z.array(ListSchema).describe('Collections in this workspace'),
  }),
};

export const SearchResultSchema = z.object({
  recordId: z.string().describe('Record UUID'),
  entityDefinitionId: z.string().describe('Entity type UUID'),
  entitySlug: z.string().optional().describe('Entity type slug'),
  title: z.string().describe('Display title of the matched record'),
  subtitle: z.string().nullable().optional().describe('Secondary display text'),
});

export const searchRecordsSchema = {
  name: 'searchRecords',
  description: 'Search across all record types by query string',
  notes:
    'Use entityDefinitionId to filter results to a specific object type. Obtain entity definition IDs from getContext().',
  input: z.object({
    slug: SlugParam,
    query: z.string().describe('Search query string'),
    entityDefinitionId: z
      .string()
      .optional()
      .describe('Filter to a specific entity type UUID from getContext()'),
  }),
  output: z.object({
    results: z.array(SearchResultSchema).describe('Matching records'),
  }),
};

export type ListObjectsOutput = z.infer<typeof listObjectsSchema.output>;
export type ListUsersOutput = z.infer<typeof listUsersSchema.output>;
export type ListListsOutput = z.infer<typeof listListsSchema.output>;
export type SearchRecordsOutput = z.infer<typeof searchRecordsSchema.output>;
