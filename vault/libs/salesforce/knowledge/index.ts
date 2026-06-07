/**
 * Salesforce Knowledge Module
 *
 * List and retrieve Salesforce Knowledge article records via Aura framework API.
 * Requires the Knowledge feature to be enabled in the Salesforce org.
 */

import { Validation, NotFound } from '@vallum/_runtime';
import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
}

interface ArticleRecord {
  Id: string;
  [key: string]: unknown;
}

interface ListResultItem {
  record: ArticleRecord;
  actions?: Array<{ label: string; [key: string]: unknown }>;
}

interface ListResult {
  result: ListResultItem[];
  totalCount: number;
}

interface GetRecordResult {
  record: ArticleRecord;
}

interface RecordUiResult {
  id: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
}

function isAuraRecord(
  val: unknown,
): val is { id: string; fields: Record<string, { value: unknown }> } {
  return (
    typeof val === 'object' &&
    val !== null &&
    'id' in val &&
    'fields' in val &&
    typeof (val as Record<string, unknown>).fields === 'object'
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCtx(creds: AuraCredentials): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}


// ---------------------------------------------------------------------------
// List Articles
// ---------------------------------------------------------------------------

/**
 * List Salesforce Knowledge articles using getItems.
 * Returns paginated article records with optional page size and offset.
 */
export async function listArticles(
  args: AuraCredentials & {
    pageSize?: number;
    page?: number;
    filterName?: string;
    sortBy?: string;
    layoutType?: 'FULL' | 'COMPACT' | 'SEARCH';
    searchTerm?: string;
    enableRowActions?: boolean;
    useTimeout?: boolean;
  },
): Promise<{
  totalCount: number;
  articles: ArticleRecord[];
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  if (
    args.pageSize !== undefined &&
    (typeof args.pageSize !== 'number' || args.pageSize < 1)
  ) {
    throw new Validation('pageSize must be a positive number.');
  }

  if (
    args.page !== undefined &&
    (typeof args.page !== 'number' || args.page < 0)
  ) {
    throw new Validation('page must be a non-negative number.');
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    entityNameOrId: 'Knowledge__kav',
    layoutType: args.layoutType ?? 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: args.page ?? 0,
    useTimeout: args.useTimeout ?? false,
    getCount: true,
    enableRowActions: args.enableRowActions ?? false,
  };

  if (args.filterName) {
    params.filterName = args.filterName;
  }

  if (args.sortBy != null) {
    params.sortBy = args.sortBy;
  }

  if (args.searchTerm) {
    params.searchTerm = args.searchTerm;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

  const result = raw as ListResult;

  const articles = result.result.map((item) => {
    const article: Record<string, unknown> = { ...item.record };
    if (args.enableRowActions && item.actions) {
      article.actions = item.actions.map((a) => ({
        label: a.label as string,
        devNameOrId: a.devNameOrId as string,
        actionTypeEnum: a.actionTypeEnum as string,
      }));
    }
    return article as ArticleRecord;
  });

  return {
    totalCount: result.totalCount || articles.length,
    articles,
  };
}

// ---------------------------------------------------------------------------
// Get Article
// ---------------------------------------------------------------------------

/**
 * Retrieve a single Knowledge article record by ID.
 */
export async function getArticle(
  args: AuraCredentials & {
    articleId: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    fields?: string[];
    optionalFields?: string[];
  },
): Promise<ArticleRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.articleId, 'articleId');

  const ctx = buildCtx(args);

  // When fields or optionalFields are specified, use
  // RecordUiController/getRecordWithFields which supports these params.
  // DetailController ignores them.
  if (args.fields || args.optionalFields) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.articleId,
      ...(args.fields ? { fields: args.fields } : {}),
      ...(args.optionalFields ? { optionalFields: args.optionalFields } : {}),
    });

    const result = raw as RecordUiResult & { onLoadErrorMessage?: string };

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getArticle: Article not found (${args.articleId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    return flattenRecordUiFields(result) as ArticleRecord;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, {
    recordId: args.articleId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
  });

  const result = raw as GetRecordResult & { onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getArticle: Article not found (${args.articleId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}
