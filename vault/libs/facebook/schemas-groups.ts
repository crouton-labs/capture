import { z } from 'zod';

const GroupsOutput = z.object({ data: z.unknown() }).passthrough();

export const listGroupsSchema = {
  name: 'listGroups',
  description:
    "List groups in the viewer's left-rail Groups panel (admin + member groups).",
  notes: '',
  input: z.object({
    adminGroupsCount: z.number().optional().default(3),
    memberGroupsCount: z.number().optional().default(10),
  }),
  output: GroupsOutput,
};

export const listGroupFeedSchema = {
  name: 'listGroupFeed',
  description:
    "Get the combined feed of posts across the viewer's joined groups.",
  notes: '',
  input: z.object({}),
  output: GroupsOutput,
};

export const discoverGroupsSchema = {
  name: 'discoverGroups',
  description:
    'Get the Discover page suggestions for groups the viewer might join.',
  notes: '',
  input: z.object({}),
  output: GroupsOutput,
};

export const listJoinedGroupsSchema = {
  name: 'listJoinedGroups',
  description:
    'List the groups the viewer has joined, ordered by the supplied criterion.',
  notes: '',
  input: z.object({
    ordering: z
      .enum(['viewer_added', 'last_post', 'alphabetical'])
      .optional()
      .default('viewer_added'),
  }),
  output: GroupsOutput,
};

export const getGroupsBadgeCountSchema = {
  name: 'getGroupsBadgeCount',
  description: 'Get the unseen Groups-tab badge count for the viewer.',
  notes: '',
  input: z.object({}),
  output: GroupsOutput,
};

export type ListGroupsInput = z.infer<typeof listGroupsSchema.input>;
export type ListGroupFeedInput = z.infer<typeof listGroupFeedSchema.input>;
export type DiscoverGroupsInput = z.infer<typeof discoverGroupsSchema.input>;
export type ListJoinedGroupsInput = z.infer<
  typeof listJoinedGroupsSchema.input
>;
export type GetGroupsBadgeCountInput = z.infer<
  typeof getGroupsBadgeCountSchema.input
>;
export type GroupsResponse = z.infer<typeof GroupsOutput>;
