/**
 * Salesforce Commerce Operations
 *
 * Commerce Cloud channel, product, category, order, and promotion operations
 * via Aura framework API.
 */

import { ContractDrift, Validation, NotFound } from '@vallum/_runtime';
import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';
import type {
  ListCommerceChannelsInput,
  ListCommerceChannelsOutput,
  GetCommerceChannelInput,
  GetCommerceChannelOutput,
  ListCommerceProductsInput,
  ListCommerceProductsOutput,
  ListProductCategoriesInput,
  ListProductCategoriesOutput,
  ListOrderSummariesInput,
  ListOrderSummariesOutput,
  GetOrderSummaryInput,
  GetOrderSummaryOutput,
  ListPromotionsInput,
  ListPromotionsOutput,
  GetPromotionInput,
  GetPromotionOutput,
} from '../schemas';

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
}

interface ListResult {
  result: Array<{ record: Record<string, unknown> }>;
  totalCount: number;
}

interface RecordUiResult {
  id: string;
  apiName: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
}

function isAuraRecord(
  val: unknown,
): val is { id: string; fields: Record<string, { value: unknown }> } {
  return (
    typeof val === 'object' && val !== null && 'id' in val && 'fields' in val
  );
}

function flattenAuraValue(val: unknown): unknown {
  if (!isAuraRecord(val)) return val;
  const flat: Record<string, unknown> = { Id: val.id };
  for (const [key, field] of Object.entries(val.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  return flat;
}

function flattenRecordUiFields(
  result: RecordUiResult,
): Record<string, unknown> {
  const record: Record<string, unknown> = { Id: result.id };
  for (const [key, field] of Object.entries(result.fields)) {
    record[key] = flattenAuraValue(field.value);
  }
  return record;
}

interface ListUiRecord {
  apiName: string;
  id: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
}

interface ListUiResult {
  count: number;
  currentPageToken: string | null;
  nextPageToken: string | null;
  previousPageToken: string | null;
  pageSize: number;
  records: ListUiRecord[];
  sortBy: string | null;
  searchTerm: string | null;
}

function flattenListUiRecord(rec: ListUiRecord): Record<string, unknown> {
  const flat: Record<string, unknown> = { Id: rec.id };
  for (const [key, field] of Object.entries(rec.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  return flat;
}

function buildCtx(creds: AuraCredentials): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}


export async function listCommerceChannels(
  args: ListCommerceChannelsInput,
): Promise<ListCommerceChannelsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  if (
    args.pageSize !== undefined &&
    (typeof args.pageSize !== 'number' ||
      !Number.isInteger(args.pageSize) ||
      args.pageSize < 1 ||
      args.pageSize > 2000)
  ) {
    throw new Validation('pageSize must be an integer between 1 and 2000.');
  }

  if (
    args.page !== undefined &&
    (typeof args.page !== 'number' ||
      !Number.isInteger(args.page) ||
      args.page < 0)
  ) {
    throw new Validation('page must be a non-negative integer.');
  }

  const ctx = buildCtx(args);

  const page = args.page ?? 0;
  const raw = await auraAction(ctx, DESCRIPTORS.getItems, {
    entityNameOrId: 'WebStore',
    layoutType: 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: page + 1,
    useTimeout: false,
    getCount: true,
    enableRowActions: false,
  });

  const result = raw as ListResult;

  return {
    totalCount: result.totalCount,
    channels: result.result.map(
      (item: { record: Record<string, unknown> }) => item.record,
    ) as ListCommerceChannelsOutput['channels'],
  };
}

export async function getCommerceChannel(
  args: GetCommerceChannelInput,
): Promise<GetCommerceChannelOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.channelId, 'channelId');

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, {
    recordId: args.channelId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
  });

  const result = raw as {
    record?: Record<string, unknown>;
    onLoadErrorMessage?: string;
  };

  if (result.onLoadErrorMessage) {
    throw new NotFound(`getCommerceChannel: ${result.onLoadErrorMessage.trim()}`);
  }

  if (!result.record) {
    throw new ContractDrift(
      `getCommerceChannel: no record returned for ID ${args.channelId}`,
    );
  }

  return result.record as GetCommerceChannelOutput;
}

export async function listCommerceProducts(
  args: ListCommerceProductsInput,
): Promise<ListCommerceProductsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.channelId, 'channelId');

  if (
    args.pageSize !== undefined &&
    (typeof args.pageSize !== 'number' ||
      !Number.isInteger(args.pageSize) ||
      args.pageSize < 1 ||
      args.pageSize > 2000)
  ) {
    throw new Validation('pageSize must be an integer between 1 and 2000.');
  }

  if (
    args.page !== undefined &&
    (typeof args.page !== 'number' ||
      !Number.isInteger(args.page) ||
      args.page < 0)
  ) {
    throw new Validation('page must be a non-negative integer.');
  }

  const ctx = buildCtx(args);

  const page = args.page ?? 0;
  const raw = await auraAction(ctx, DESCRIPTORS.getItems, {
    entityNameOrId: 'Product2',
    layoutType: 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: page + 1,
    useTimeout: false,
    getCount: true,
    enableRowActions: false,
    filterName: 'productsInStore',
    filterRecordId: args.channelId,
  });

  const result = raw as ListResult;

  return {
    totalCount: result.totalCount,
    products: result.result.map(
      (item: { record: Record<string, unknown> }) => item.record,
    ) as ListCommerceProductsOutput['products'],
  };
}

export async function listProductCategories(
  args: ListProductCategoriesInput,
): Promise<ListProductCategoriesOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.channelId, 'channelId');

  if (
    args.pageSize !== undefined &&
    (typeof args.pageSize !== 'number' ||
      !Number.isInteger(args.pageSize) ||
      args.pageSize < 1 ||
      args.pageSize > 2000)
  ) {
    throw new Validation('pageSize must be an integer between 1 and 2000.');
  }

  if (
    args.page !== undefined &&
    (typeof args.page !== 'number' ||
      !Number.isInteger(args.page) ||
      args.page < 0)
  ) {
    throw new Validation('page must be a non-negative integer.');
  }

  const ctx = buildCtx(args);

  const page = args.page ?? 0;
  const raw = await auraAction(ctx, DESCRIPTORS.getItems, {
    entityNameOrId: 'ProductCategory',
    layoutType: 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: page + 1,
    useTimeout: false,
    getCount: true,
    enableRowActions: false,
    filterName: 'categoriesInStore',
    filterRecordId: args.channelId,
  });

  const result = raw as ListResult;

  return {
    totalCount: result.totalCount,
    categories: result.result.map(
      (item: { record: Record<string, unknown> }) => item.record,
    ) as ListProductCategoriesOutput['categories'],
  };
}

export async function listOrderSummaries(
  args: ListOrderSummariesInput,
): Promise<ListOrderSummariesOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  if (
    args.pageSize !== undefined &&
    (typeof args.pageSize !== 'number' ||
      !Number.isInteger(args.pageSize) ||
      args.pageSize < 1 ||
      args.pageSize > 2000)
  ) {
    throw new Validation('pageSize must be an integer between 1 and 2000.');
  }

  if (
    args.page !== undefined &&
    (typeof args.page !== 'number' ||
      !Number.isInteger(args.page) ||
      args.page < 0)
  ) {
    throw new Validation('page must be a non-negative integer.');
  }

  const ctx = buildCtx(args);

  const page = args.page ?? 0;
  const params: Record<string, unknown> = {
    entityNameOrId: 'OrderSummary',
    layoutType: args.layoutType ?? 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: page + 1,
    useTimeout: args.useTimeout ?? false,
    getCount: true,
    enableRowActions: args.enableRowActions ?? false,
  };

  if (args.sortBy != null) {
    params.sortBy = args.sortBy;
  }

  if (args.filterName != null) {
    params.filterName = args.filterName;
  }

  if (args.searchTerm != null) {
    params.searchTerm = args.searchTerm;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

  const result = raw as ListResult;

  return {
    totalCount: result.totalCount,
    orderSummaries: result.result.map(
      (item: { record: Record<string, unknown> }) => item.record,
    ) as ListOrderSummariesOutput['orderSummaries'],
  };
}

export async function getOrderSummary(
  args: GetOrderSummaryInput,
): Promise<GetOrderSummaryOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.orderSummaryId, 'orderSummaryId');

  const ctx = buildCtx(args);

  // When fields, optionalFields, or childRelationships are specified, use
  // RecordUiController/getRecordWithFields which supports these params.
  // DetailController ignores them.
  if (args.fields || args.optionalFields || args.childRelationships) {
    // getRecordWithFields requires 'fields' param. When only optionalFields or
    // childRelationships are given, use a minimal required field so that
    // optionalFields stays in the optionalFields param (which silently omits
    // non-existent fields instead of erroring).
    const fields = args.fields ?? ['OrderSummary.Id'];
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.orderSummaryId,
      fields,
      ...(args.optionalFields ? { optionalFields: args.optionalFields } : {}),
      ...(args.childRelationships
        ? { childRelationships: args.childRelationships }
        : {}),
      ...(args.recordTypeId ? { recordTypeId: args.recordTypeId } : {}),
      ...(args.pageSize != null ? { pageSize: args.pageSize } : {}),
      ...(args.pageToken ? { pageToken: args.pageToken } : {}),
      ...(args.layoutTypes ? { layoutTypes: args.layoutTypes } : {}),
      ...(args.modes ? { modes: args.modes } : {}),
    });

    const result = raw as RecordUiResult & {
      onLoadErrorMessage?: string;
      childRelationships?: Record<string, unknown>;
    };

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getOrderSummary: record not found for ${args.orderSummaryId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    if (result.apiName !== 'OrderSummary') {
      throw new ContractDrift(
        `getOrderSummary: Record ${args.orderSummaryId} is a ${result.apiName}, not an OrderSummary. Provide a valid OrderSummary ID.`,
      );
    }

    const record = flattenRecordUiFields(result) as GetOrderSummaryOutput;
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      (record as Record<string, unknown>).childRelationships =
        result.childRelationships;
    }
    return record;
  }

  const params: Record<string, unknown> = {
    recordId: args.orderSummaryId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
  };

  if (args.recordTypeId !== undefined) {
    params.recordTypeId = args.recordTypeId;
  }

  if (args.updateMru !== undefined) {
    params.updateMru = args.updateMru;
  }

  if (args.defaultFieldValues !== undefined) {
    params.defaultFieldValues = args.defaultFieldValues;
  }

  if (args.navigationLocation !== undefined) {
    params.navigationLocation = args.navigationLocation;
  }

  if (args.inContextOfComponent !== undefined) {
    params.inContextOfComponent = args.inContextOfComponent;
  }

  if (args.entityApiNameOrKeyPrefix !== undefined) {
    params.entityApiNameOrKeyPrefix = args.entityApiNameOrKeyPrefix;
  }

  if (args.layoutOverride !== undefined) {
    params.layoutOverride = args.layoutOverride;
  }

  if (args.changeRecordType !== undefined) {
    params.changeRecordType = args.changeRecordType;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, params);

  const result = raw as {
    record?: Record<string, unknown>;
    onLoadErrorMessage?: string;
  };

  if (result.onLoadErrorMessage) {
    throw new NotFound(`getOrderSummary: ${result.onLoadErrorMessage.trim()}`);
  }

  if (!result.record) {
    throw new ContractDrift(
      `getOrderSummary: no record returned for ID ${args.orderSummaryId}`,
    );
  }

  const sobjectType = result.record.sobjectType as string | undefined;
  if (sobjectType && sobjectType !== 'OrderSummary') {
    throw new ContractDrift(
      `getOrderSummary: Record ${args.orderSummaryId} is a ${sobjectType}, not an OrderSummary. Provide a valid OrderSummary ID.`,
    );
  }

  return result.record as GetOrderSummaryOutput;
}

export async function listPromotions(
  args: ListPromotionsInput,
): Promise<ListPromotionsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  const pageSize = args.pageSize ?? 25;
  const listRecordsQuery: Record<string, unknown> = {
    fields: args.fields ?? [
      'Promotion.Id',
      'Promotion.Name',
      'Promotion.Campaign.Name',
      'Promotion.CampaignId',
      'Promotion.CreatedBy.Alias',
      'Promotion.CreatedById',
    ],
    optionalFields: args.optionalFields ?? [],
    pageSize,
    sortBy: args.sortBy ?? [],
  };

  if (args.searchTerm) {
    listRecordsQuery.searchTerm = args.searchTerm;
  }

  if (args.where) {
    listRecordsQuery.where = args.where;
  }

  // Support both legacy page-based and new token-based pagination
  if (args.pageToken != null) {
    listRecordsQuery.pageToken = args.pageToken;
  } else if (args.page != null && args.page > 0) {
    listRecordsQuery.pageToken = String(args.page * pageSize);
  }

  const raw = await auraAction(ctx, DESCRIPTORS.postListRecordsByName, {
    objectApiName: 'Promotion',
    listViewApiName: args.listViewApiName ?? '__Recent',
    listRecordsQuery,
  });

  const result = raw as ListUiResult;

  let promotions = result.records.map(flattenListUiRecord);

  // The ListUi API ignores the fields parameter and returns all list view
  // fields regardless. Apply client-side filtering when fields is specified.
  if (args.fields && args.fields.length > 0) {
    const requestedKeys = new Set(
      args.fields.map((f) => {
        // "Promotion.Name" → "Name", "Promotion.Owner.Alias" → "Owner"
        const parts = f.split('.');
        return parts.length > 1 ? parts[1] : parts[0];
      }),
    );
    // Always include Id
    requestedKeys.add('Id');

    promotions = promotions.map((promo) => {
      const filtered: Record<string, unknown> = {};
      for (const key of Array.from(requestedKeys)) {
        if (key in promo) {
          filtered[key] = (promo as Record<string, unknown>)[key];
        }
      }
      return filtered;
    });
  }

  return {
    count: result.count,
    promotions,
    nextPageToken: result.nextPageToken ?? null,
    previousPageToken: result.previousPageToken ?? null,
    currentPageToken: result.currentPageToken ?? null,
  } as ListPromotionsOutput;
}

export async function getPromotion(
  args: GetPromotionInput,
): Promise<GetPromotionOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.promotionId, 'promotionId');

  const ctx = buildCtx(args);

  // When explicit fields or childRelationships are specified, use
  // RecordUiController/getRecordWithFields for precise field selection.
  if (args.fields || args.childRelationships) {
    // getRecordWithFields requires 'fields' param. When only optionalFields or
    // childRelationships are given, use a minimal required field so that
    // optionalFields stays in the optionalFields param (which silently omits
    // non-existent fields instead of erroring).
    const fields = args.fields ?? ['Promotion.Id'];
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.promotionId,
      fields,
      ...(args.optionalFields ? { optionalFields: args.optionalFields } : {}),
      ...(args.childRelationships
        ? { childRelationships: args.childRelationships }
        : {}),
      ...(args.recordTypeId ? { recordTypeId: args.recordTypeId } : {}),
      ...(args.pageSize != null ? { pageSize: args.pageSize } : {}),
      ...(args.pageToken ? { pageToken: args.pageToken } : {}),
      ...(args.layoutTypes ? { layoutTypes: args.layoutTypes } : {}),
      ...(args.modes ? { modes: args.modes } : {}),
    });

    const result = raw as RecordUiResult & {
      onLoadErrorMessage?: string;
      childRelationships?: Record<string, unknown>;
    };

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getPromotion: record not found for ${args.promotionId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    if (result.apiName !== 'Promotion') {
      throw new ContractDrift(
        `getPromotion: Record ${args.promotionId} is a ${result.apiName}, not a Promotion. Provide a valid Promotion ID.`,
      );
    }

    const record = flattenRecordUiFields(result) as GetPromotionOutput;
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      (record as Record<string, unknown>).childRelationships =
        result.childRelationships;
    }
    return record;
  }

  // When optionalFields is specified without explicit fields, use
  // RecordUiController/getRecordWithLayouts which returns all layout-driven
  // fields plus the optional extras in one call. getRecordWithFields would
  // only return the optionalFields, missing the base layout fields.
  if (args.optionalFields) {
    const layoutMap: Record<string, string> = {
      FULL: 'Full',
      COMPACT: 'Compact',
    };
    const modeMap: Record<string, string> = {
      VIEW: 'View',
      EDIT: 'Edit',
      CREATE: 'Create',
      CLONE: 'Clone',
      INLINE_EDIT: 'View',
      DEFAULT: 'View',
    };
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithLayouts, {
      recordId: args.promotionId,
      layoutTypes: [layoutMap[args.layoutType ?? 'FULL']],
      modes: [modeMap[args.mode ?? 'VIEW']],
      optionalFields: args.optionalFields,
    });

    const result = raw as RecordUiResult & {
      onLoadErrorMessage?: string;
    };

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getPromotion: record not found for ${args.promotionId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    if (result.apiName !== 'Promotion') {
      throw new ContractDrift(
        `getPromotion: Record ${args.promotionId} is a ${result.apiName}, not a Promotion. Provide a valid Promotion ID.`,
      );
    }

    return flattenRecordUiFields(result) as GetPromotionOutput;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, {
    recordId: args.promotionId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
    ...(args.recordTypeId !== undefined && { recordTypeId: args.recordTypeId }),
    ...(args.updateMru !== undefined ? { updateMru: args.updateMru } : {}),
    ...(args.defaultFieldValues !== undefined && {
      defaultFieldValues: args.defaultFieldValues,
    }),
    ...(args.navigationLocation !== undefined && {
      navigationLocation: args.navigationLocation,
    }),
    ...(args.inContextOfComponent !== undefined && {
      inContextOfComponent: args.inContextOfComponent,
    }),
    ...(args.entityApiNameOrKeyPrefix !== undefined && {
      entityApiNameOrKeyPrefix: args.entityApiNameOrKeyPrefix,
    }),
    ...(args.layoutOverride !== undefined && {
      layoutOverride: args.layoutOverride,
    }),
    ...(args.changeRecordType !== undefined && {
      changeRecordType: args.changeRecordType,
    }),
    ...(args.formFactor !== undefined && {
      formFactor: args.formFactor,
    }),
    ...(args.densityType !== undefined && {
      densityType: args.densityType,
    }),
    ...(args.includeSystemFields !== undefined && {
      includeSystemFields: args.includeSystemFields,
    }),
    ...(args.includeRelationships !== undefined && {
      includeRelationships: args.includeRelationships,
    }),
    ...(args.record !== undefined && { record: args.record }),
    ...(args.offset !== undefined && { offset: args.offset }),
    ...(args.stencilOverride !== undefined && {
      stencilOverride: args.stencilOverride,
    }),
    ...(args.isCreateOrClone !== undefined && {
      isCreateOrClone: args.isCreateOrClone,
    }),
    ...(args.isCloneWithRelated !== undefined && {
      isCloneWithRelated: args.isCloneWithRelated,
    }),
  });

  const result = raw as {
    record?: Record<string, unknown>;
    onLoadErrorMessage?: string;
  };

  if (result.onLoadErrorMessage) {
    throw new NotFound(`getPromotion: ${result.onLoadErrorMessage.trim()}`);
  }

  if (!result.record) {
    throw new ContractDrift(
      `getPromotion: no record returned for ID ${args.promotionId}`,
    );
  }

  const sobjectType = result.record.sobjectType as string | undefined;
  if (sobjectType && sobjectType !== 'Promotion') {
    throw new ContractDrift(
      `getPromotion: Record ${args.promotionId} is a ${sobjectType}, not a Promotion. Provide a valid Promotion ID.`,
    );
  }

  return result.record as GetPromotionOutput;
}
