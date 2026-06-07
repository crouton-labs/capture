import { getViewerUserId, graphql } from './helpers';
import type {
  ListFriendsContentInput,
  GetFriendRequestBadgeCountInput,
  MarkFriendsBadgeReadInput,
  SendFriendRequestInput,
  SendFriendRequestOutput,
  FriendsResponse,
} from './schemas-friends';

export async function listFriendsContent(
  _params: ListFriendsContentInput,
): Promise<FriendsResponse> {
  const userId = getViewerUserId();
  return graphql<FriendsResponse>(
    userId,
    '9103543533085580',
    'FriendingCometRootContentQuery',
    { scale: 1 },
    { routeName: 'comet.fbweb.CometFriendingHomeRoute' },
  );
}

export async function getFriendRequestBadgeCount(
  _params: GetFriendRequestBadgeCountInput,
): Promise<FriendsResponse> {
  const userId = getViewerUserId();
  return graphql<FriendsResponse>(
    userId,
    '9598595396903163',
    'useFriendingCometFriendRequestBadgeCountQuery',
    {},
  );
}

export async function markFriendsBadgeRead(
  _params: MarkFriendsBadgeReadInput,
): Promise<FriendsResponse> {
  const userId = getViewerUserId();
  return graphql<FriendsResponse>(
    userId,
    '10034776853248745',
    'FriendingCometFriendsBadgeCountClearMutation',
    {
      bookmarkIDs: ['2356318349'],
      hasTopTab: true,
      hasBookmark: true,
      input: {
        action_type: 'read',
        notif_ids: [],
        source: 'friending_tab',
        actor_id: userId,
        client_mutation_id: '1',
      },
    },
  );
}

interface RawSendFriendRequestResponse {
  data?: {
    friend_request_send?: {
      friend_requestees?: Array<{
        id?: string;
        friendship_status?: string;
      }>;
    };
  };
}

export async function sendFriendRequest(
  params: SendFriendRequestInput,
): Promise<SendFriendRequestOutput> {
  const userId = getViewerUserId();
  const raw = await graphql<RawSendFriendRequestResponse>(
    userId,
    '34373951838917178',
    'FriendingCometFriendRequestSendMutation',
    {
      input: {
        actor_id: userId,
        click_correlation_id: String(Date.now()),
        click_proof_validation_result: '{"validated":true}',
        client_mutation_id: String(Date.now() % 1000),
        friend_requestee_ids: [params.userID],
        friending_channel: params.friendingChannel ?? 'PROFILE_BUTTON',
        warn_ack_for_ids: [],
      },
      scale: 1,
    },
  );

  const requestees = raw.data?.friend_request_send?.friend_requestees ?? [];
  const target =
    requestees.find((r) => r.id === params.userID) ?? requestees[0];
  if (!target?.id) {
    throw new Error(
      `Facebook FriendingCometFriendRequestSendMutation returned no friend_requestees for userID=${params.userID}.`,
    );
  }

  return {
    userID: target.id,
    friendshipStatus:
      typeof target.friendship_status === 'string'
        ? target.friendship_status
        : 'UNKNOWN',
    raw: raw.data,
  };
}
