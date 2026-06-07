/**
 * Slack User Operations
 *
 * User information, presence, and profile management.
 */

import type {
  AuthTestInput,
  AuthTestOutput,
  UsersListInput,
  UsersListOutput,
  UsersInfoInput,
  UsersInfoOutput,
  UsersGetPresenceInput,
  UsersGetPresenceOutput,
  UsersProfileGetInput,
  UsersProfileGetOutput,
  UsersProfileSetInput,
  UsersProfileSetOutput,
  UsersSetPresenceInput,
  UsersSetPresenceOutput,
  ResolveDmCounterpartInput,
  ResolveDmCounterpartOutput,
} from '../schemas';
import { slackApi } from '../helpers';
import { conversationsMembers } from '../conversations';

export async function authTest(params: AuthTestInput): Promise<AuthTestOutput> {
  return slackApi<AuthTestOutput>('auth.test', params.token);
}

export async function usersList(
  params: UsersListInput,
): Promise<UsersListOutput> {
  return slackApi<UsersListOutput>('users.list', params.token, params);
}

export async function usersInfo(
  params: UsersInfoInput,
): Promise<UsersInfoOutput> {
  return slackApi<UsersInfoOutput>('users.info', params.token, params);
}

export async function usersGetPresence(
  params: UsersGetPresenceInput,
): Promise<UsersGetPresenceOutput> {
  return slackApi<UsersGetPresenceOutput>(
    'users.getPresence',
    params.token,
    params,
  );
}

export async function usersProfileGet(
  params: UsersProfileGetInput,
): Promise<UsersProfileGetOutput> {
  return slackApi<UsersProfileGetOutput>(
    'users.profile.get',
    params.token,
    params,
  );
}

export async function usersProfileSet(
  params: UsersProfileSetInput,
): Promise<UsersProfileSetOutput> {
  return slackApi<UsersProfileSetOutput>(
    'users.profile.set',
    params.token,
    params,
  );
}

export async function usersSetPresence(
  params: UsersSetPresenceInput,
): Promise<UsersSetPresenceOutput> {
  return slackApi<UsersSetPresenceOutput>(
    'users.setPresence',
    params.token,
    params,
  );
}

export async function resolveDmCounterpart(
  params: ResolveDmCounterpartInput,
): Promise<ResolveDmCounterpartOutput> {
  if (!params.channel.startsWith('D')) {
    return { isDm: false, counterpartUserId: null };
  }

  const membersResult = await conversationsMembers({ token: params.token, channel: params.channel, cursor: undefined, limit: 100 });

  if (membersResult.response_metadata?.next_cursor) {
    return { isDm: false, counterpartUserId: null };
  }

  const { user_id: self } = await authTest({ token: params.token });

  const distinct = [...new Set(membersResult.members)];
  if (distinct.length !== 2) {
    return { isDm: false, counterpartUserId: null };
  }

  const counterpart = distinct.find(id => id !== self);
  if (!counterpart) {
    return { isDm: false, counterpartUserId: null };
  }

  return { isDm: true, counterpartUserId: counterpart };
}
