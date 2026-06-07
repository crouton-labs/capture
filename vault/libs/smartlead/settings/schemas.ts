import { z } from 'zod';

export const listTeamMembersSchema = {
  name: 'listTeamMembers',
  description:
    'List all team members in the workspace with their roles (Admin, Full Member, Read-Only). Pro+ only — throws on trial/base plans.',
  notes: 'Returns 403 on non-Pro plans.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
  }),
  output: z.object({
    members: z
      .array(
        z.object({
          id: z.number().describe('Team member user ID'),
          email: z.string().describe('Team member email address'),
          name: z.string().describe('Team member display name'),
          role: z
            .string()
            .describe('Role in workspace: Admin, Full Member, or Read-Only'),
        }),
      )
      .describe('List of team members'),
  }),
};

export type ListTeamMembersInput = z.infer<typeof listTeamMembersSchema.input>;
export type ListTeamMembersOutput = z.infer<
  typeof listTeamMembersSchema.output
>;

export const listWebhooksSchema = {
  name: 'listWebhooks',
  description:
    'List all configured webhooks in the workspace, including subscribed events and endpoint URLs.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
  }),
  output: z.object({
    webhooks: z
      .array(
        z.object({
          id: z.number().describe('Webhook ID'),
          url: z.string().describe('Endpoint URL that receives event payloads'),
          events: z
            .array(z.string())
            .describe(
              'List of subscribed event types, e.g. ["lead_replied", "lead_bounced"]',
            ),
          active: z.boolean().describe('Whether the webhook is active'),
        }),
      )
      .describe('List of configured webhooks'),
  }),
};

export type ListWebhooksInput = z.infer<typeof listWebhooksSchema.input>;
export type ListWebhooksOutput = z.infer<typeof listWebhooksSchema.output>;

export const listTagsSchema = {
  name: 'listTags',
  description:
    'List all tags defined in the workspace tag manager. Tags can be applied to campaigns and leads for organization.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
  }),
  output: z.object({
    tags: z
      .array(
        z.object({
          id: z.number().describe('Tag ID'),
          name: z.string().describe('Tag label'),
          color: z
            .string()
            .optional()
            .describe('Tag color hex code, e.g. "#FF5733"'),
        }),
      )
      .describe('List of workspace tags'),
  }),
};

export type ListTagsInput = z.infer<typeof listTagsSchema.input>;
export type ListTagsOutput = z.infer<typeof listTagsSchema.output>;

export const listLeadCategoriesSchema = {
  name: 'listLeadCategories',
  description:
    'List all lead categories/intent labels configured for the workspace (e.g., Interested, Not Interested, Meeting Booked, Out of Office). These are the valid values for updateLeadCategory.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
  }),
  output: z.object({
    categories: z
      .array(
        z.object({
          id: z.number().describe('Category ID'),
          name: z
            .string()
            .describe(
              'Category label used in updateLeadCategory, e.g. "Interested", "Not Interested", "Meeting Booked"',
            ),
        }),
      )
      .describe('List of lead categories'),
  }),
};

export type ListLeadCategoriesInput = z.infer<
  typeof listLeadCategoriesSchema.input
>;
export type ListLeadCategoriesOutput = z.infer<
  typeof listLeadCategoriesSchema.output
>;

export const settingsSchemas = [
  listTeamMembersSchema,
  listWebhooksSchema,
  listTagsSchema,
  listLeadCategoriesSchema,
];
