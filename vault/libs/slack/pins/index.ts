/**
 * Slack Pin Operations
 *
 * Pin and unpin messages and files.
 */

import type {
  PinsAddInput,
  PinsAddOutput,
  PinsListInput,
  PinsListOutput,
  PinsRemoveInput,
  PinsRemoveOutput,
} from '../schemas';
import { slackApi } from '../helpers';

export async function pinsAdd(params: PinsAddInput): Promise<PinsAddOutput> {
  return slackApi<PinsAddOutput>('pins.add', params.token, params);
}

export async function pinsList(params: PinsListInput): Promise<PinsListOutput> {
  return slackApi<PinsListOutput>('pins.list', params.token, params);
}

export async function pinsRemove(
  params: PinsRemoveInput,
): Promise<PinsRemoveOutput> {
  return slackApi<PinsRemoveOutput>('pins.remove', params.token, params);
}
