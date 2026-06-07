import { getViewerUserId, graphql } from './helpers';
import type {
  ListGroupsInput,
  ListGroupFeedInput,
  DiscoverGroupsInput,
  ListJoinedGroupsInput,
  GetGroupsBadgeCountInput,
  GroupsResponse,
} from './schemas-groups';

export async function listGroups(
  params: ListGroupsInput,
): Promise<GroupsResponse> {
  const userId = getViewerUserId();
  return graphql<GroupsResponse>(
    userId,
    '31152611061018930',
    'GroupsCometLeftRailContainerQuery',
    {
      adminGroupsCount: params.adminGroupsCount,
      memberGroupsCount: params.memberGroupsCount,
      scale: 1,
    },
    { routeName: 'comet.fbweb.CometGroupsMainTabRoute' },
  );
}

export async function listGroupFeed(
  _params: ListGroupFeedInput,
): Promise<GroupsResponse> {
  const userId = getViewerUserId();
  return graphql<GroupsResponse>(
    userId,
    '26439376379090767',
    'GroupsCometCrossGroupFeedContainerQuery',
    {
      feedbackSource: 69,
      feedLocation: 'GROUP',
      focusCommentID: null,
      privacySelectorRenderLocation: 'COMET_STREAM',
      renderLocation: 'groups_tab',
      scale: 1,
      __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
      __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
    },
    { routeName: 'comet.fbweb.CometGroupsFeedTabRoute' },
  );
}

export async function discoverGroups(
  _params: DiscoverGroupsInput,
): Promise<GroupsResponse> {
  const userId = getViewerUserId();
  return graphql<GroupsResponse>(
    userId,
    '25947833531582461',
    'GroupsCometDiscoverContentQuery',
    { scale: 1 },
    { routeName: 'comet.fbweb.CometGroupsDiscoverTabRoute' },
  );
}

export async function listJoinedGroups(
  params: ListJoinedGroupsInput,
): Promise<GroupsResponse> {
  const userId = getViewerUserId();
  return graphql<GroupsResponse>(
    userId,
    '24648931168042404',
    'GroupsCometJoinsRootQuery',
    { ordering: [params.ordering], scale: 1 },
    { routeName: 'comet.fbweb.CometGroupsJoinsRoute' },
  );
}

export async function getGroupsBadgeCount(
  _params: GetGroupsBadgeCountInput,
): Promise<GroupsResponse> {
  const userId = getViewerUserId();
  return graphql<GroupsResponse>(
    userId,
    '30513530544913012',
    'useGroupsCometTabBadgeCountQuery',
    { find: '2361831622' },
  );
}
