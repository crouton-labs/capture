import { z } from 'zod';

export const ScaleParam = z
  .number()
  .optional()
  .default(1)
  .describe('Display-density scale factor for returned media URLs. Use 1.');

export const CursorParam = z
  .string()
  .nullable()
  .optional()
  .describe(
    'Opaque cursor returned by the previous page. null/omit for first page.',
  );

export const getContextSchema = {
  name: 'getContext',
  description:
    "Extract the viewer's session tokens from an authenticated facebook.com page. Call first; no other function requires these as explicit parameters (they are read fresh from the page at call time).",
  notes:
    'Must be executed on a www.facebook.com page after login. Tokens (fb_dtsg, lsd) rotate during a session; subsequent library calls re-read them automatically from the Meta module system, so a single getContext() at the start of a session is sufficient.',
  input: z.object({}),
  output: z.object({
    userId: z
      .string()
      .describe('Viewer user id (USER_ID from CurrentUserInitialData).'),
    fbDtsg: z
      .string()
      .describe('CSRF token, format <token>:<schema>:<issued_ts>.'),
    lsd: z.string().describe('Link Security Descriptor, session-scoped.'),
    asbdId: z
      .string()
      .describe(
        'Anti-Scraping Behavior Detection id for the current JS bundle.',
      ),
    origin: z
      .string()
      .describe('Window origin; always https://www.facebook.com.'),
  }),
};

export type GetContextOutput = z.infer<typeof getContextSchema.output>;
