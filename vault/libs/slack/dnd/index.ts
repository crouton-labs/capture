/**
 * Slack Do Not Disturb Operations
 *
 * Manage DND and snooze settings.
 */

import type {
  DndInfoInput,
  DndInfoOutput,
  DndSetSnoozeInput,
  DndSetSnoozeOutput,
  DndEndSnoozeInput,
  DndEndSnoozeOutput,
  DndEndDndInput,
  DndEndDndOutput,
  DndTeamInfoInput,
  DndTeamInfoOutput,
} from '../schemas';
import { slackApi } from '../helpers';

export async function dndInfo(params: DndInfoInput): Promise<DndInfoOutput> {
  return slackApi<DndInfoOutput>('dnd.info', params.token, params);
}

export async function dndSetSnooze(
  params: DndSetSnoozeInput,
): Promise<DndSetSnoozeOutput> {
  return slackApi<DndSetSnoozeOutput>('dnd.setSnooze', params.token, params);
}

export async function dndEndSnooze(
  params: DndEndSnoozeInput,
): Promise<DndEndSnoozeOutput> {
  return slackApi<DndEndSnoozeOutput>('dnd.endSnooze', params.token, params);
}

export async function dndEndDnd(
  params: DndEndDndInput,
): Promise<DndEndDndOutput> {
  return slackApi<DndEndDndOutput>('dnd.endDnd', params.token, params);
}

export async function dndTeamInfo(
  params: DndTeamInfoInput,
): Promise<DndTeamInfoOutput> {
  return slackApi<DndTeamInfoOutput>('dnd.teamInfo', params.token, params);
}
