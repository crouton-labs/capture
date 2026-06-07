import { getViewerUserId, graphql } from './helpers';
import type {
  ListContactsInput,
  ListContactChannelsInput,
  ListCommunityChatsInput,
  ListContactGroupsInput,
  MessagingResponse,
} from './schemas-messaging';

export async function listContacts(
  params: ListContactsInput,
): Promise<MessagingResponse> {
  const userId = getViewerUserId();
  return graphql<MessagingResponse>(
    userId,
    '9702448419859311',
    'CometHomeContactsContainerQuery',
    {
      numContactsToFetch: params.numContactsToFetch,
      scale: 1,
    },
  );
}

export async function listContactChannels(
  _params: ListContactChannelsInput,
): Promise<MessagingResponse> {
  const userId = getViewerUserId();
  return graphql<MessagingResponse>(
    userId,
    '9934887189887478',
    'CometHomeContactChannelsContainerQuery',
    {},
  );
}

export async function listCommunityChats(
  params: ListCommunityChatsInput,
): Promise<MessagingResponse> {
  const userId = getViewerUserId();
  return graphql<MessagingResponse>(
    userId,
    '25889826240633646',
    'CometHomeContactCommunityChatsContainerQuery',
    { numChatsToFetch: params.numChatsToFetch },
  );
}

export async function listContactGroups(
  _params: ListContactGroupsInput,
): Promise<MessagingResponse> {
  const userId = getViewerUserId();
  return graphql<MessagingResponse>(
    userId,
    '27445733491681996',
    'CometHomeContactGroupsContainerQuery',
    {
      excludeBroadcastChannelThreads: true,
      excludeCmThreads: true,
      __relay_internal__pv__WebPixelRatiorelayprovider: 1,
    },
  );
}
