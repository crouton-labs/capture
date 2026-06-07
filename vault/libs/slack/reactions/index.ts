/**
 * Slack Reaction Operations
 *
 * Add, get, and remove emoji reactions.
 */

import type {
  ReactionsAddInput,
  ReactionsAddOutput,
  ReactionsGetInput,
  ReactionsGetOutput,
  ReactionsRemoveInput,
  ReactionsRemoveOutput,
} from '../schemas';
import { slackApi } from '../helpers';

export async function reactionsAdd(
  params: ReactionsAddInput,
): Promise<ReactionsAddOutput> {
  return slackApi<ReactionsAddOutput>('reactions.add', params.token, params);
}

export async function reactionsGet(
  params: ReactionsGetInput,
): Promise<ReactionsGetOutput> {
  return slackApi<ReactionsGetOutput>('reactions.get', params.token, params);
}

export async function reactionsRemove(
  params: ReactionsRemoveInput,
): Promise<ReactionsRemoveOutput> {
  return slackApi<ReactionsRemoveOutput>(
    'reactions.remove',
    params.token,
    params,
  );
}
