/**
 * Apollo Email Operations
 */

import { ContractDrift, Validation, throwForStatus } from '@vallum/_runtime';

import type {
  SearchEmailsOutput,
  ViewEmailOutput,
  GetEmailAnalyticsOutput,
  SendEmailNowOutput,
  CreateEmailOutput,
  SendEmailOutput,
  ListTemplateVariablesOutput,
} from '../schemas';

/**
 * Search sent emails from sequences.
 */
export async function searchEmails(
  opts: {
    sequenceId?: string;
    statuses?: string[];
    page?: number;
    perPage?: number;
  } = {},
): Promise<SearchEmailsOutput> {
  const { sequenceId, statuses, page = 1, perPage = 25 } = opts;

  const body: Record<string, unknown> = {
    page,
    per_page: perPage,
    display_mode: 'explorer_mode',
    context: 'emailer_messages',
    finder_version: 1,
    open_factor_names: [],
    num_fetch_result: 2,
  };

  if (sequenceId) body.emailer_campaign_id = sequenceId;
  // Note: emailer_message_statuses server-side filter is broken (always returns 0).
  // Status filtering is done client-side below.

  const response = await fetch('/api/v1/emailer_messages/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));
  const data = await response.json();

  if (statuses && statuses.length > 0) {
    const statusArr = Array.isArray(statuses) ? statuses : [statuses];
    const statusSet = new Set(statusArr);
    data.emailer_messages = (data.emailer_messages || []).filter(
      (msg: { status?: string }) => msg.status && statusSet.has(msg.status),
    );
  }

  return data;
}

/**
 * View a single email message by ID.
 */
export async function viewEmail(opts: {
  id: string;
}): Promise<ViewEmailOutput> {
  const { id } = opts;
  if (!id) throw new Validation('id is required');

  const response = await fetch(`/api/v1/emailer_messages/${id}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}

/**
 * Get email analytics and performance metrics.
 */
export async function getEmailAnalytics(
  opts: {
    sequenceIds?: string[];
    dateRange?: { min: string; max: string };
  } = {},
): Promise<GetEmailAnalyticsOutput> {
  const { sequenceIds, dateRange } = opts;

  const metrics = [
    {
      display_name: '# Emails Sent',
      smart_datetime_reference: 'activity_datetime',
      smart_user_id_reference: 'user_id',
      value: 'num_emails_sent',
    },
    {
      display_name: '# Delivered',
      smart_datetime_reference: 'activity_datetime',
      smart_user_id_reference: 'user_id',
      value: 'num_emails_delivered',
    },
    {
      display_name: '# Opened',
      smart_datetime_reference: 'activity_datetime',
      smart_user_id_reference: 'user_id',
      value: 'num_emails_opened',
    },
    {
      display_name: '# Replied',
      smart_datetime_reference: 'activity_datetime',
      smart_user_id_reference: 'user_id',
      value: 'num_emails_replied',
    },
    {
      display_name: '# Bounced',
      smart_datetime_reference: 'activity_datetime',
      smart_user_id_reference: 'user_id',
      value: 'num_emails_bounced',
    },
    {
      display_name: '# Clicked',
      smart_datetime_reference: 'activity_datetime',
      smart_user_id_reference: 'user_id',
      value: 'num_emails_clicked',
    },
    {
      display_name: '# Interested',
      smart_datetime_reference: 'activity_datetime',
      smart_user_id_reference: 'user_id',
      value: 'num_emails_demoed',
    },
    {
      display_name: '# Unsubscribed',
      smart_datetime_reference: 'activity_datetime',
      smart_user_id_reference: 'user_id',
      value: 'num_emails_unsubscribed',
    },
  ];

  const body: Record<string, unknown> = {
    metrics,
    group_by: [],
    filters: {},
  };

  if (sequenceIds && sequenceIds.length > 0) {
    body.filters = { emailer_campaign_ids: sequenceIds };
  }
  if (dateRange) {
    body.filters = {
      ...(body.filters as Record<string, unknown>),
      smart_datetime_range: dateRange,
    };
  }

  const response = await fetch('/api/v1/reports/sync_report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  const stats = data?.response?.table_response ?? {};

  return {
    sent: stats.num_emails_sent ?? 0,
    delivered: stats.num_emails_delivered ?? 0,
    opened: stats.num_emails_opened ?? 0,
    replied: stats.num_emails_replied ?? 0,
    bounced: stats.num_emails_bounced ?? 0,
    clicked: stats.num_emails_clicked ?? 0,
    interested: stats.num_emails_demoed ?? 0,
    unsubscribed: stats.num_emails_unsubscribed ?? 0,
  };
}

/**
 * Force send a scheduled email immediately.
 */
export async function sendEmailNow(opts: {
  id: string;
}): Promise<SendEmailNowOutput> {
  const { id } = opts;
  if (!id) throw new Validation('id is required');

  const response = await fetch(`/api/v1/emailer_messages/${id}/send_now`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}

/**
 * Create a one-off email draft to a contact (not tied to any sequence).
 */
export async function createEmail(opts: {
  contactId: string;
  emailAccountId: string;
  subject: string;
  bodyHtml: string;
  ccEmails?: string[];
  bccEmails?: string[];
}): Promise<CreateEmailOutput> {
  const { contactId, emailAccountId, subject, bodyHtml, ccEmails, bccEmails } =
    opts;
  if (!contactId) throw new Validation('contactId is required');
  if (!emailAccountId) throw new Validation('emailAccountId is required');
  if (!subject) throw new Validation('subject is required');
  if (!bodyHtml) throw new Validation('bodyHtml is required');

  const recipients: { email: string; recipient_type_cd: string }[] = [];
  if (ccEmails) {
    for (const email of ccEmails) {
      recipients.push({ email, recipient_type_cd: 'cc' });
    }
  }
  if (bccEmails) {
    for (const email of bccEmails) {
      recipients.push({ email, recipient_type_cd: 'bcc' });
    }
  }

  const body: Record<string, unknown> = {
    contact_id: contactId,
    email_account_id: emailAccountId,
    subject,
    body_html: bodyHtml,
    type: 'outreach_manual_email',
  };
  if (recipients.length > 0) {
    body.recipients = recipients;
  }

  const response = await fetch('/api/v1/emailer_messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}

/**
 * Compose and send a one-off email to a contact immediately.
 */
export async function sendEmail(opts: {
  contactId: string;
  emailAccountId: string;
  subject: string;
  bodyHtml: string;
  ccEmails?: string[];
  bccEmails?: string[];
}): Promise<SendEmailOutput> {
  const { contactId, emailAccountId, subject, bodyHtml, ccEmails, bccEmails } =
    opts;
  if (!contactId) throw new Validation('contactId is required');
  if (!emailAccountId) throw new Validation('emailAccountId is required');
  if (!subject) throw new Validation('subject is required');
  if (!bodyHtml) throw new Validation('bodyHtml is required');

  // Step 1: Create draft
  const draft = await createEmail({
    contactId,
    emailAccountId,
    subject,
    bodyHtml,
    ccEmails,
    bccEmails,
  });

  const emailId = draft.emailer_message.id;

  // Step 2: Send immediately
  const sendResponse = await fetch(
    `/api/v1/emailer_messages/${emailId}/send_now`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    },
  );

  if (!sendResponse.ok)
    throwForStatus(sendResponse.status, await sendResponse.text().catch(() => undefined));
  return await sendResponse.json();
}

/**
 * List all available template variables by fetching Apollo's JS bundle
 * and parsing variable definitions from the raw source, plus custom fields from the API.
 */
export async function listTemplateVariables(): Promise<ListTemplateVariablesOutput> {
  // Step 1: Find the index bundle URL from loaded resources
  const resources = performance.getEntriesByType(
    'resource',
  ) as PerformanceResourceTiming[];
  const bundleUrl = resources.find(
    (r) =>
      r.name.includes('bundle-app-production-index') && r.name.endsWith('.js'),
  )?.name;

  if (!bundleUrl)
    throw new ContractDrift('Apollo index bundle not found in loaded resources');

  // Step 2: Fetch the bundle as raw text
  const bundleResp = await fetch(bundleUrl);
  if (!bundleResp.ok)
    throwForStatus(bundleResp.status, await bundleResp.text().catch(() => undefined));
  const text = await bundleResp.text();

  // Step 3: Find the variable definitions section; starts with PERSON_PRIMARY_VARIABLES
  const anchor = 'PERSON_PRIMARY_VARIABLES:[{sig:"{{first_name}}"';
  const anchorIdx = text.indexOf(anchor);
  if (anchorIdx === -1)
    throw new ContractDrift('Template variable definitions not found in bundle');

  // Walk backwards to find the start of the containing object
  let braceDepth = 0;
  let objStart = anchorIdx;
  for (let i = anchorIdx; i >= 0; i--) {
    if (text[i] === '}') braceDepth++;
    if (text[i] === '{') {
      if (braceDepth === 0) {
        objStart = i;
        break;
      }
      braceDepth--;
    }
  }

  // Walk forward to find the end of the containing object
  braceDepth = 0;
  let objEnd = anchorIdx;
  for (let i = objStart; i < text.length; i++) {
    if (text[i] === '{') braceDepth++;
    if (text[i] === '}') {
      braceDepth--;
      if (braceDepth === 0) {
        objEnd = i + 1;
        break;
      }
    }
  }

  const chunk = text.substring(objStart, objEnd);

  // Step 4: Extract category names and their variables using regex
  const vars: Array<{ variable: string; category: string; example: string }> =
    [];
  const categoryPattern = /(\w+):\[/g;
  const categories: Array<{ name: string; startIdx: number }> = [];
  let cm;
  while ((cm = categoryPattern.exec(chunk)) !== null) {
    categories.push({ name: cm[1], startIdx: cm.index });
  }

  // For each category, extract all {sig:"...",example:"..."} entries in its array
  for (let c = 0; c < categories.length; c++) {
    const cat = categories[c];
    const nextStart =
      c + 1 < categories.length ? categories[c + 1].startIdx : chunk.length;
    const section = chunk.substring(cat.startIdx, nextStart);

    const sigPattern = /sig:"([^"]+)"(?:.*?example:"([^"]*)")?/g;
    let sm;
    while ((sm = sigPattern.exec(section)) !== null) {
      vars.push({
        variable: sm[1],
        category: cat.name,
        example: sm[2] || '',
      });
    }
  }

  if (vars.length === 0)
    throw new ContractDrift('No template variables parsed from bundle');

  // Step 5: Append custom fields from API
  try {
    const resp = await fetch(
      `${window.location.origin}/api/v1/typed_custom_fields`,
      {
        credentials: 'include',
      },
    );
    if (resp.ok) {
      const data = await resp.json();
      const fields: Record<string, unknown>[] =
        data.typed_custom_fields || data || [];
      for (const field of fields) {
        if (!field.name) continue;
        vars.push({
          variable: `{{${field.name}}}`,
          category: 'CUSTOM_FIELDS',
          example: (field.label || field.name) as string,
        });
        if (field.type === 'lookup_user') {
          for (const sub of ['email', 'name', 'first_name', 'last_name']) {
            vars.push({
              variable: `{{${field.name}.${sub}}}`,
              category: 'CUSTOM_FIELDS',
              example: `${field.label || field.name} ${sub}`,
            });
          }
        }
      }
    }
  } catch {
    // Custom fields are optional
  }

  return { variables: vars };
}
