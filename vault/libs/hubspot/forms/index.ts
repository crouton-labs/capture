/**
 * HubSpot Forms Operations
 *
 * Retrieve and manage HubSpot forms and form submissions.
 */

import { ContractDrift, Validation, throwForStatus } from '@vallum/_runtime';

export interface Form {
  guid: string;
  name: string;
  formType: string;
  createdAt: number;
}

export interface FormSubmission {
  conversionId: string;
  submittedAt: number;
  values: Array<{
    name: string;
    value: string;
    objectTypeId?: string;
  }>;
  pageUrl?: string;
}

export async function listForms(opts: {
  csrf: string;
  portalId: string;
  limit?: number;
  offset?: number;
}): Promise<Form[]> {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  const url = new URL(`${window.location.origin}/api/forms/v2/forms`);
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new ContractDrift('Expected forms array in response');
  }

  return data as Form[];
}

export async function getForm(opts: {
  csrf: string;
  portalId: string;
  formId: string;
}): Promise<Form> {
  const url = new URL(
    `${window.location.origin}/api/forms/v2/forms/${opts.formId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!data.guid) {
    throw new ContractDrift('Expected form object with guid in response');
  }

  return data as Form;
}

export async function getFormSubmissions(opts: {
  csrf: string;
  portalId: string;
  formId: string;
  limit?: number;
  after?: string;
}): Promise<FormSubmission[]> {
  const limit = Math.min(opts.limit ?? 50, 50);

  const url = new URL(
    `${window.location.origin}/api/form-integrations/v1/submissions/forms/${opts.formId}`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('limit', String(limit));
  if (opts.after) {
    url.searchParams.set('after', opts.after);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) {
    if (response.status === 400) {
      throw new Validation(
        `Cannot fetch submissions for this form. Meeting and system forms do not support submission queries.`,
      );
    }
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  const data = await response.json();

  // Response wraps results in { results: [...] }
  const results = Array.isArray(data) ? data : (data.results ?? []);

  return results as FormSubmission[];
}
