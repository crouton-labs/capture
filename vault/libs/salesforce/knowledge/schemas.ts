import { z } from 'zod';

const AuraTokenParam = z.string().describe('Aura token from getContext()');
const AuraContextParam = z.string().describe('Aura context from getContext()');

const SObjectRecord = z
  .object({ Id: z.string().describe('Salesforce record ID') })
  .passthrough();

export const listArticlesSchema = {
  name: 'listArticles',
  description:
    'List Salesforce Knowledge articles (Knowledge__kav) with pagination',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe(
        'Page number, 1-indexed (default 1). Page 0 is treated as page 1. With pageSize=25 and page=2, returns records 26–50.',
      ),
    filterName: z
      .string()
      .optional()
      .describe(
        'List view API name. Standard views: "All_Articles", "Draft_Articles", "Published_Articles", "Archived_Articles", "__Recent". Note: the SelectableListDataProvider controller ignores this parameter; it returns all records regardless of filter value.',
      ),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field name to sort by, e.g. "Title", "CreatedDate", "LastModifiedDate". Prefix with "-" for descending, e.g. "-CreatedDate".',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT', 'SEARCH'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields (~23) including ArticleBody__c, UrlName, visibility flags. COMPACT returns key fields (~12) including PublishStatus, VersionNumber. SEARCH returns list-optimized fields (~15) including ArticleNumber, ValidationStatus, Summary, LastPublishedDate. Default: FULL.',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search term to filter articles. Note: the SelectableListDataProvider controller ignores this parameter and returns all records regardless of search term value.',
      ),
    enableRowActions: z
      .boolean()
      .optional()
      .describe(
        'When true, each article includes an actions array with available row-level actions. Each action has label (e.g. "Edit", "Publish", "Delete Draft", "Assign"), devNameOrId (e.g. "EditDraftKnowledgeArticleVersion"), and actionTypeEnum. Default: false.',
      ),
    useTimeout: z
      .boolean()
      .optional()
      .describe(
        'When true, the server applies a timeout to the list query. Useful for large datasets where the query may take a long time. Default: false.',
      ),
  }),
  output: z.object({
    totalCount: z
      .number()
      .describe(
        'Number of articles returned. The Salesforce API totalCount for Knowledge__kav is unreliable (often 0), so this reflects the actual number of articles in the response array.',
      ),
    articles: z
      .array(SObjectRecord)
      .describe(
        'Array of Knowledge article records. Fields vary by layoutType: FULL includes Title, UrlName, ArticleBody__c, visibility flags (~23 fields). COMPACT includes PublishStatus, VersionNumber (~12 fields). SEARCH includes Summary, ValidationStatus (~15 fields). When enableRowActions=true, each record also includes an actions array.',
      ),
  }),
  notes: 'Requires Salesforce Knowledge to be enabled in the org.',
};

export type ListArticlesInput = z.infer<typeof listArticlesSchema.input>;
export type ListArticlesOutput = z.infer<typeof listArticlesSchema.output>;

export const getArticleSchema = {
  name: 'getArticle',
  description: 'Get a single Knowledge article by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    articleId: z
      .string()
      .describe('Salesforce Knowledge article ID (Knowledge__kav)'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields (~27), COMPACT returns key fields (~18) including PublishStatus and VersionNumber. Default: FULL',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE'])
      .optional()
      .describe(
        'Record mode. VIEW returns read-only data, EDIT returns data with recordLayout metadata for form rendering, CREATE returns a template for new record creation. Default: VIEW',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["Knowledge__kav.Title", "Knowledge__kav.UrlName"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Knowledge__kav.ArticleNumber", "Knowledge__kav.VersionNumber"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified',
      ),
  }),
  output: SObjectRecord,
  notes:
    'Prerequisite: call getContext() on a Salesforce Lightning page to obtain auraToken and auraContext. The articleId is a Knowledge__kav record ID (prefix ka0). Without fields/optionalFields, returns the full layout including Title, UrlName, ArticleBody__c, ArticleTotalViewCount, ArticleCreatedDate, ArticleArchivedDate, IsVisibleInApp, IsVisibleInCsp, CreatedBy, LastModifiedBy, and formatted date variants (__f, __l suffixes). When fields or optionalFields are specified, only the requested fields are returned. Field names must use ObjectName.FieldName format (e.g. Knowledge__kav.Title).',
};

export type GetArticleInput = z.infer<typeof getArticleSchema.input>;
export type GetArticleOutput = z.infer<typeof getArticleSchema.output>;

export const knowledgeSchemas = [listArticlesSchema, getArticleSchema];
