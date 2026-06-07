/**
 * Slack Usergroup Operations
 *
 * Manage user groups (team member groups).
 */

import type {
  UsergroupsListInput,
  UsergroupsListOutput,
  UsergroupsUsersListInput,
  UsergroupsUsersListOutput,
} from '../schemas';
import { slackApi } from '../helpers';

export async function usergroupsList(
  params: UsergroupsListInput,
): Promise<UsergroupsListOutput> {
  return slackApi<UsergroupsListOutput>(
    'usergroups.list',
    params.token,
    params,
  );
}

export async function usergroupsUsersList(
  params: UsergroupsUsersListInput,
): Promise<UsergroupsUsersListOutput> {
  return slackApi<UsergroupsUsersListOutput>(
    'usergroups.users.list',
    params.token,
    params,
  );
}
