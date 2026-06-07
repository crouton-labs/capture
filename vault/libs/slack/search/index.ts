/**
 * Slack Search Operations
 *
 * Search messages and files.
 */

import type {
  SearchMessagesInput,
  SearchMessagesOutput,
  SearchFilesInput,
  SearchFilesOutput,
  SearchAllInput,
  SearchAllOutput,
  SearchChannelsInput,
  SearchChannelsOutput,
  SearchPeopleInput,
  SearchPeopleOutput,
} from '../schemas';
import { slackApi } from '../helpers';

export async function searchMessages(
  params: SearchMessagesInput,
): Promise<SearchMessagesOutput> {
  return slackApi<SearchMessagesOutput>(
    'search.messages',
    params.token,
    params,
  );
}

export async function searchFiles(
  params: SearchFilesInput,
): Promise<SearchFilesOutput> {
  return slackApi<SearchFilesOutput>('search.files', params.token, params);
}

export async function searchAll(
  params: SearchAllInput,
): Promise<SearchAllOutput> {
  return slackApi<SearchAllOutput>('search.all', params.token, params);
}

export async function searchChannels(
  params: SearchChannelsInput,
): Promise<SearchChannelsOutput> {
  return slackApi<SearchChannelsOutput>('search.modules', params.token, {
    ...params,
    module: 'channels',
  });
}

export async function searchPeople(
  params: SearchPeopleInput,
): Promise<SearchPeopleOutput> {
  return slackApi<SearchPeopleOutput>('search.modules', params.token, {
    ...params,
    module: 'people',
  });
}
