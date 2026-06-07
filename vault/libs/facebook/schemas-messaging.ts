import { z } from 'zod';

const MsgOutput = z.object({ data: z.unknown() }).passthrough();

export const listContactsSchema = {
  name: 'listContacts',
  description:
    "List the viewer's Messenger contact suggestions from the home-page contacts rail.",
  notes:
    'Returns the sidebar contact list only. Full Messenger thread fetch/send is delivered over MQTT on wss://edge-chat.facebook.com and is not exposed by this library.',
  input: z.object({
    numContactsToFetch: z.number().optional().default(17),
  }),
  output: MsgOutput,
};

export const listContactChannelsSchema = {
  name: 'listContactChannels',
  description: 'List Messenger broadcast channels the viewer follows.',
  notes: '',
  input: z.object({}),
  output: MsgOutput,
};

export const listCommunityChatsSchema = {
  name: 'listCommunityChats',
  description: 'List community chats the viewer participates in.',
  notes: '',
  input: z.object({
    numChatsToFetch: z.number().optional().default(3),
  }),
  output: MsgOutput,
};

export const listContactGroupsSchema = {
  name: 'listContactGroups',
  description: 'List Messenger group threads the viewer participates in.',
  notes: '',
  input: z.object({}),
  output: MsgOutput,
};

export type ListContactsInput = z.infer<typeof listContactsSchema.input>;
export type ListContactChannelsInput = z.infer<
  typeof listContactChannelsSchema.input
>;
export type ListCommunityChatsInput = z.infer<
  typeof listCommunityChatsSchema.input
>;
export type ListContactGroupsInput = z.infer<
  typeof listContactGroupsSchema.input
>;
export type MessagingResponse = z.infer<typeof MsgOutput>;
