/**
 * Salesforce Change Data Capture Operations
 *
 * List, enable, and discover CDC-eligible entities via Aura framework API.
 * Uses CdcObjectEnablementController and AvailableCdcEntitiesProviderController.
 *
 * CDC functions run on the Setup domain (*.my.salesforce-setup.com), not the main
 * Lightning domain. They auto-capture Aura context from the current page.
 */

import { Validation } from '@vallum/_runtime';
import { captureAuraContext, auraAction } from '../aura';
import type { AuraContext } from '../aura';
import type {
  ListCDCEntitiesOutput,
  EnableCDCInput,
  EnableCDCOutput,
  GetAvailableCDCEntitiesInput,
  GetAvailableCDCEntitiesOutput,
} from '../schemas';

function buildCtx(creds: {
  auraToken: string;
  auraContext: string;
}): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}

const CDC_ENABLEMENT =
  'serviceComponent://ui.cdc.setup.components.controller.CdcObjectEnablementController/ACTION$';
const CDC_AVAILABLE =
  'serviceComponent://ui.cdc.setup.components.controller.AvailableCdcEntitiesProviderController/ACTION$';

export async function listCDCEntities(): Promise<ListCDCEntitiesOutput> {
  const ctx: AuraContext = await captureAuraContext();

  const [selectedResult, updateableResult] = await Promise.all([
    auraAction(ctx, CDC_ENABLEMENT + 'getSelectedObjects', {}),
    auraAction(ctx, CDC_ENABLEMENT + 'getUpdateable', {}),
  ]);

  const selected = selectedResult as {
    items: Array<{ id: string; label: string }>;
  };

  return {
    entities: selected.items,
    isUpdateable: updateableResult as boolean,
  };
}

export async function enableCDC(
  args: EnableCDCInput,
): Promise<EnableCDCOutput> {
  if (!args.objectApiNames || !Array.isArray(args.objectApiNames)) {
    throw new Validation(
      'enableCDC: objectApiNames is required and must be an array of object API names',
    );
  }

  const ctx = buildCtx(args);

  const model = args.objectApiNames.map((name) => ({
    id: name,
    label: name,
  }));

  // The save operation calls both delete and insert to set the full selection
  await auraAction(ctx, CDC_ENABLEMENT + 'deleteRemovedObjects', { model });
  await auraAction(ctx, CDC_ENABLEMENT + 'insertAddedObjects', { model });

  // Verify what Salesforce actually accepted; some objects may be silently rejected
  const verification = (await auraAction(
    ctx,
    CDC_ENABLEMENT + 'getSelectedObjects',
    {},
  )) as { items: Array<{ id: string; label: string }> };

  const confirmedNames = verification.items.map((item) => item.id);

  return {
    enabled: confirmedNames.length > 0,
    objectApiNames: confirmedNames,
  };
}

export async function getAvailableCDCEntities(
  args: GetAvailableCDCEntitiesInput,
): Promise<GetAvailableCDCEntitiesOutput> {
  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    maxResults: args.maxResults ?? 50,
    offset: args.offset ?? 0,
  };
  if (args.keyword !== undefined) params.keyword = args.keyword;

  const raw = (await auraAction(ctx, CDC_AVAILABLE + 'getList', params)) as {
    canLoadMore: boolean;
    hasReachedLimit: boolean;
    items: Array<{ id: string; label: string }>;
  };

  return {
    entities: raw.items,
    canLoadMore: raw.canLoadMore,
    hasReachedLimit: raw.hasReachedLimit,
  };
}
