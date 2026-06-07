import { z } from 'zod';

// ============================================================================
// Context
// ============================================================================

export const InstagramContextSchema = z.object({
  csrf: z.string().describe('CSRF token for API requests'),
  userId: z.string().describe('Authenticated user numeric ID (Instagram pk)'),
  username: z.string().describe('Authenticated username'),
  fbid: z
    .string()
    .describe(
      'Meta cross-platform FBID; use to match sender_fbid in DMs when sender.igid is unavailable',
    ),
  fullName: z.string().describe('Display name of the authenticated user'),
  isPrivate: z
    .boolean()
    .describe('Whether the authenticated account is set to private'),
  appId: z.string().describe('Instagram app ID for x-ig-app-id header'),
  deviceId: z
    .string()
    .describe(
      'Device ID for DM subscriptions (from localStorage or mid cookie)',
    ),
  ajaxVersion: z.string().describe('Ajax version for x-instagram-ajax header'),
  claimToken: z
    .string()
    .describe('Session claim token for x-ig-www-claim header'),
});

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract Instagram authentication context from current browser session. Returns CSRF token and session identifiers needed by all other functions.',
  notes:
    'Call FIRST before any Instagram operations. User must be logged in at instagram.com.',
  input: z.object({}),
  output: InstagramContextSchema,
};

export type InstagramContext = z.infer<typeof InstagramContextSchema>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
