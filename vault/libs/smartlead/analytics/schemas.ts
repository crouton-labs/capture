import { z } from 'zod';

export const getCampaignPerformanceSchema = {
  name: 'getCampaignPerformance',
  description:
    'Get aggregate campaign performance metrics across all campaigns or a filtered set. Returns sent count, opens, clicks, replies, and bounces. Pro+ only — throws on trial/base plans.',
  notes:
    'Returns 403 on non-Pro plans. Pass campaignId to filter to a single campaign; omit for workspace-wide aggregate.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    campaignId: z
      .number()
      .optional()
      .describe('Optional campaign ID to filter metrics to a single campaign'),
  }),
  output: z.object({
    sent: z.number().describe('Total emails sent'),
    open_count: z.number().describe('Total emails opened'),
    open_rate: z.number().describe('Open rate as a decimal (0–1)'),
    click_count: z.number().describe('Total link clicks'),
    click_rate: z.number().describe('Click rate as a decimal (0–1)'),
    reply_count: z.number().describe('Total replies received'),
    reply_rate: z.number().describe('Reply rate as a decimal (0–1)'),
    bounce_count: z.number().describe('Total bounces'),
    bounce_rate: z.number().describe('Bounce rate as a decimal (0–1)'),
  }),
};

export type GetCampaignPerformanceInput = z.infer<
  typeof getCampaignPerformanceSchema.input
>;
export type GetCampaignPerformanceOutput = z.infer<
  typeof getCampaignPerformanceSchema.output
>;

export const analyticsSchemas = [getCampaignPerformanceSchema];
