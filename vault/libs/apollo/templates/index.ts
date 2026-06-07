/**
 * Apollo Email Template Operations
 */

import { Validation, throwForStatus } from '@vallum/_runtime';

import type {
  SearchEmailTemplatesOutput,
  CreateEmailTemplateOutput,
  UpdateEmailTemplateOutput,
  DeleteEmailTemplateOutput,
} from '../schemas';

/**
 * Search email templates with pagination.
 */
export async function searchEmailTemplates(opts: {
  page?: number;
  perPage?: number;
}): Promise<SearchEmailTemplatesOutput> {
  const { page = 1, perPage = 25 } = opts;

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/emailer_templates/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      page,
      per_page: perPage,
    }),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Create a new email template.
 */
export async function createEmailTemplate(opts: {
  name: string;
  subject: string;
  bodyHtml: string;
}): Promise<CreateEmailTemplateOutput> {
  const { name, subject, bodyHtml } = opts;

  if (!name) throw new Validation('name is required');
  if (!subject) throw new Validation('subject is required');
  if (!bodyHtml) throw new Validation('bodyHtml is required');

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/emailer_templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      name,
      subject,
      body_html: bodyHtml,
      global: true,
    }),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Update an existing email template.
 */
export async function updateEmailTemplate(opts: {
  id: string;
  name?: string;
  subject?: string;
  bodyHtml?: string;
}): Promise<UpdateEmailTemplateOutput> {
  const { id, name, subject, bodyHtml } = opts;

  if (!id) throw new Validation('id is required');

  const body: Record<string, unknown> = {};
  if (name !== undefined) body.name = name;
  if (subject !== undefined) body.subject = subject;
  if (bodyHtml !== undefined) body.body_html = bodyHtml;

  const response = await fetch(`/api/v1/emailer_templates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Delete an email template by ID.
 */
export async function deleteEmailTemplate(opts: {
  id: string;
}): Promise<DeleteEmailTemplateOutput> {
  const { id } = opts;

  if (!id) throw new Validation('id is required');

  const response = await fetch(`/api/v1/emailer_templates/${id}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return { success: true };
}
