import { z } from 'zod';

const FriendsOutput = z.object({ data: z.unknown() }).passthrough();

export const listFriendsContentSchema = {
  name: 'listFriendsContent',
  description:
    'Get the friends page payload: suggestions, pending requests, and friend list.',
  notes: '',
  input: z.object({}),
  output: FriendsOutput,
};

export const getFriendRequestBadgeCountSchema = {
  name: 'getFriendRequestBadgeCount',
  description: 'Get the unseen friend-request badge count for the viewer.',
  notes: '',
  input: z.object({}),
  output: FriendsOutput,
};

export const markFriendsBadgeReadSchema = {
  name: 'markFriendsBadgeRead',
  description: 'Mark the friends-tab badge as read, clearing the unseen count.',
  notes: '',
  input: z.object({}),
  output: FriendsOutput,
};

export const sendFriendRequestSchema = {
  name: 'sendFriendRequest',
  description: 'Send a friend request to a user by their numeric user ID.',
  notes: '',
  input: z.object({
    userID: z
      .string()
      .describe(
        'Numeric Facebook user ID of the person to friend. Sourced from getProfileHeader, listProfileFriends, searchAll (entityId), or listFriendsContent.',
      ),
    friendingChannel: z
      .string()
      .optional()
      .default('PROFILE_BUTTON')
      .describe(
        'Origin surface label sent to Facebook. Common values: PROFILE_BUTTON, PROFILE_HOVERCARD, PYMK, SEARCH, FRIENDS_HOME. Default PROFILE_BUTTON works in all contexts.',
      ),
  }),
  output: z.object({
    userID: z.string().describe('User ID that was friend-requested.'),
    friendshipStatus: z
      .string()
      .describe(
        'New friendship status. OUTGOING_REQUEST = request sent. ARE_FRIENDS = already friends. CAN_REQUEST = request did not stick.',
      ),
    raw: z.unknown(),
  }),
};

export type ListFriendsContentInput = z.infer<
  typeof listFriendsContentSchema.input
>;
export type GetFriendRequestBadgeCountInput = z.infer<
  typeof getFriendRequestBadgeCountSchema.input
>;
export type MarkFriendsBadgeReadInput = z.infer<
  typeof markFriendsBadgeReadSchema.input
>;
export type SendFriendRequestInput = z.infer<
  typeof sendFriendRequestSchema.input
>;
export type SendFriendRequestOutput = z.infer<
  typeof sendFriendRequestSchema.output
>;
export type FriendsResponse = z.infer<typeof FriendsOutput>;
