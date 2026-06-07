import { z } from 'zod';

export const EntityDefinitionSchema = z.object({
  id: z.string().describe('Entity definition UUID'),
  slug: z.string().describe('API slug (e.g. companies, people)'),
  name: z.string().describe('Display name (singular noun)'),
  isArchived: z.boolean().describe('Whether this entity type is archived'),
});

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get workspace slug, IDs, and entity definition list for Attio API calls',
  notes: 'Call FIRST before other Attio operations.',
  input: z.object({}),
  output: z.object({
    slug: z.string().describe('Workspace slug for all API paths'),
    workspaceId: z.string().describe('Workspace UUID'),
    userId: z.string().describe('Current user UUID'),
    entityDefinitions: z
      .array(EntityDefinitionSchema)
      .describe('All entity types in this workspace'),
  }),
};

export type EntityDefinition = z.infer<typeof EntityDefinitionSchema>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
