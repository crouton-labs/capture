/**
 * Seamless.AI Template Functions
 *
 * CRUD operations for email templates within template folders.
 * All endpoints are org-scoped: /api/users/orgs/{orgId}/engagements/templates/...
 */

import type {
  ListTemplatesInput,
  ListTemplatesOutput,
  CreateTemplateInput,
  CreateTemplateOutput,
  UpdateTemplateInput,
  UpdateTemplateOutput,
  DeleteTemplateInput,
  DeleteTemplateOutput,
} from './schemas-templates';

import { Validation } from '@vallum/_runtime';
import {
  seamlessGet,
  seamlessPost,
  seamlessPut,
  seamlessDelete,
} from './helpers';

// ============================================================================
// listTemplates
// ============================================================================

export async function listTemplates(
  params: ListTemplatesInput,
): Promise<ListTemplatesOutput> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('limit', String(params.limit ?? 25));
  if (params.sortColumn !== undefined) qs.set('sortColumn', params.sortColumn);
  if (params.sortOrder !== undefined) qs.set('sortOrder', params.sortOrder);
  if (params.searchText !== undefined) qs.set('searchText', params.searchText);
  if (params.type !== undefined && params.type.length > 0) {
    params.type.forEach((t) => qs.append('type[]', t));
  }
  const data = (await seamlessGet(
    `/users/orgs/${params.orgId}/engagements/templates?${qs.toString()}`,
  )) as Record<string, unknown>;

  const items = (data.items ?? data.templates ?? []) as Array<
    Record<string, unknown>
  >;

  const templates = items.map((t) => ({
    id: String(t.templateId ?? t.id ?? t._id ?? ''),
    name: String(t.name ?? ''),
    type: t.type as ListTemplatesOutput['templates'][number]['type'],
    subject: String(t.subject ?? t.templateSubject ?? ''),
    body: String(t.template ?? t.body ?? ''),
    folderId: Number(t.templateFolderId ?? t.folderId ?? 0),
    isDefault: t.isDefault !== undefined ? Boolean(t.isDefault) : undefined,
    parentTemplateId:
      t.parentTemplateId !== undefined
        ? (t.parentTemplateId as number | null)
        : undefined,
    isFavorite: t.isFavorite !== undefined ? Boolean(t.isFavorite) : undefined,
    tagIds: Array.isArray(t.tagIds) ? (t.tagIds as string[]) : undefined,
    delivered: t.delivered !== undefined ? Number(t.delivered) : undefined,
    replied: t.replied !== undefined ? Number(t.replied) : undefined,
    optedOut: t.optedOut !== undefined ? Number(t.optedOut) : undefined,
    used: t.used !== undefined ? Number(t.used) : undefined,
    lastUsed:
      t.lastUsed !== undefined ? (t.lastUsed as string | null) : undefined,
  }));

  return {
    templates,
    count: Number(data.count ?? items.length),
    hasMore: Boolean(data.hasMore ?? false),
  };
}

// ============================================================================
// createTemplate
// ============================================================================

const VALID_TEMPLATE_TYPES = [
  'email',
  'call',
  'custom',
  'linkedin-message',
  'linkedin-connect-request',
] as const;

export async function createTemplate(
  params: CreateTemplateInput,
): Promise<CreateTemplateOutput> {
  if (
    !VALID_TEMPLATE_TYPES.includes(
      params.templateType as (typeof VALID_TEMPLATE_TYPES)[number],
    )
  ) {
    throw new Validation(
      `createTemplate: invalid templateType "${params.templateType}". Must be one of: ${VALID_TEMPLATE_TYPES.join(', ')}`,
    );
  }
  if (!params.body) {
    throw new Validation('createTemplate: body is required');
  }
  if (params.folderId === undefined || params.folderId === null) {
    throw new Validation('createTemplate: folderId is required');
  }

  // `type` is a query parameter; subject and body go inside `data` in the body
  const templateData: Record<string, unknown> = {
    template: params.body,
  };
  if (params.subject !== undefined) templateData.subject = params.subject;
  if (params.jsonTemplate !== undefined)
    templateData.jsonTemplate = params.jsonTemplate;

  const requestBody: Record<string, unknown> = {
    name: params.name,
    data: templateData,
    templateFolderId: params.folderId,
    tagIds: params.tagIds ?? [],
    isFavorite: params.isFavorite ?? false,
    isDefault: params.isDefault ?? false,
  };
  if (params.parentTemplateId !== undefined) {
    requestBody.parentTemplateId = params.parentTemplateId;
  }

  const data = (await seamlessPost(
    `/users/orgs/${params.orgId}/engagements/templates?type=${params.templateType}`,
    requestBody,
  )) as Record<string, unknown>;

  const t = (data.data ?? data.template ?? data) as Record<string, unknown>;
  const tData = (t.data as Record<string, unknown> | undefined) ?? {};

  const respJsonTemplate =
    (tData.jsonTemplate as Record<string, unknown> | undefined) ??
    (t.jsonTemplate as Record<string, unknown> | undefined);

  return {
    template: {
      id: String(t.id ?? t._id ?? ''),
      name: String(t.name ?? params.name),
      type: params.templateType,
      subject: String(t.subject ?? tData.subject ?? params.subject ?? ''),
      body: String(t.template ?? t.body ?? tData.template ?? params.body),
      folderId: Number(t.templateFolderId ?? t.folderId ?? params.folderId),
      isFavorite: Boolean(t.isFavorite ?? params.isFavorite ?? false),
      tagIds: (t.tagIds as string[]) ?? params.tagIds ?? [],
      ...(respJsonTemplate !== undefined && {
        jsonTemplate: respJsonTemplate as {
          type: string;
          content?: Array<Record<string, unknown>>;
        },
      }),
    },
  };
}

// ============================================================================
// updateTemplate
// ============================================================================

export async function updateTemplate(
  params: UpdateTemplateInput,
): Promise<UpdateTemplateOutput> {
  // The API requires `type` as a query parameter on the PUT URL
  const templateData: Record<string, unknown> = {};
  if (params.subject !== undefined) templateData.subject = params.subject;
  if (params.body !== undefined) templateData.template = params.body;

  // Always include isFavorite to prevent accidentally unfavoriting a currently-starred template.
  // If omitted, the API defaults to unfavorited state for that field.
  const body: Record<string, unknown> = {
    data: templateData,
    isFavorite: params.isFavorite ?? false,
  };
  if (params.name !== undefined) body.name = params.name;
  if (params.tagIds !== undefined) body.tagIds = params.tagIds;
  if (params.isDefault !== undefined) body.isDefault = params.isDefault;
  if (params.isArchiving !== undefined) body.isArchiving = params.isArchiving;
  if (params.templateFolderId !== undefined)
    body.templateFolderId = params.templateFolderId;
  if (params.parentTemplateId !== undefined)
    body.parentTemplateId = params.parentTemplateId;

  const data = (await seamlessPut(
    `/users/orgs/${params.orgId}/engagements/templates/${params.templateId}?type=${params.type}`,
    body,
  )) as Record<string, unknown>;

  const t = (data.data ?? data.template ?? data) as Record<string, unknown>;

  // When isArchiving=true, the API returns {"success":true,"data":{}} (no template data).
  // Return a success indicator without a template object.
  if (
    Object.keys(t).length === 0 ||
    (t.id === undefined && t._id === undefined)
  ) {
    return { archived: true };
  }

  return {
    template: {
      id: String(t.id ?? t._id ?? params.templateId),
      name: String(t.name ?? ''),
      type:
        (t.type as NonNullable<UpdateTemplateOutput['template']>['type']) ??
        undefined,
      subject: String(t.subject ?? ''),
      body: String(t.template ?? t.body ?? ''),
      folderId: Number(t.templateFolderId ?? t.folderId ?? 0),
      isFavorite:
        t.isFavorite !== undefined ? Boolean(t.isFavorite) : undefined,
      isDefault: t.isDefault !== undefined ? Boolean(t.isDefault) : undefined,
      tagIds: Array.isArray(t.tagIds) ? (t.tagIds as string[]) : undefined,
    },
  };
}

// ============================================================================
// deleteTemplate
// ============================================================================

export async function deleteTemplate(
  params: DeleteTemplateInput,
): Promise<DeleteTemplateOutput> {
  const data = (await seamlessDelete(
    `/users/orgs/${params.orgId}/engagements/templates/${params.templateId}?type=${params.type}`,
  )) as Record<string, unknown>;

  return {
    success: (data.success as boolean) ?? true,
  };
}
