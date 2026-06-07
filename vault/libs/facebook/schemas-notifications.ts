import { z } from 'zod';

const NotifOutput = z.object({ data: z.unknown() }).passthrough();

export const listNotificationsSchema = {
  name: 'listNotifications',
  description:
    'List notifications for the viewer from the main notifications dropdown.',
  notes: '',
  input: z.object({
    count: z.number().optional().default(15),
    environment: z
      .enum(['MAIN_SURFACE', 'JEWEL_NEW'])
      .optional()
      .default('MAIN_SURFACE'),
  }),
  output: NotifOutput,
};

export type ListNotificationsInput = z.infer<
  typeof listNotificationsSchema.input
>;
export type NotificationsResponse = z.infer<typeof NotifOutput>;
