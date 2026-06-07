/**
 * Apollo Sequences Module
 *
 * Sequence (emailer campaign) management including CRUD operations,
 * step management, contact enrollment, scheduling, and activation.
 */

import { ContractDrift, UpstreamError, Validation, throwForStatus } from '@vallum/_runtime';

import type {
  SearchSequencesOutput,
  ViewSequenceOutput,
  CreateSequenceOutput,
  UpdateSequenceOutput,
  DeleteSequenceOutput,
  UnarchiveSequenceOutput,
  AddSequenceStepOutput,
  EnableSequenceStepOutput,
  DisableSequenceStepOutput,
  DeleteSequenceStepOutput,
  AddContactsToSequenceOutput,
  AddListToSequenceOutput,
  GetSequenceContactsOutput,
  UpdateSequenceContactStatusOutput,
  UpdateSequenceStepOutput,
  DuplicateSequenceStepOutput,
  CloneSequenceOutput,
  ListSequenceSchedulesOutput,
  CreateSequenceScheduleOutput,
  UpdateSequenceScheduleOutput,
  DeleteSequenceScheduleOutput,
  ActivateSequenceOutput,
  DeactivateSequenceOutput,
} from '../schemas';

/**
 * Search sequences (emailer campaigns) with pagination and sorting.
 */
export async function searchSequences(opts: {
  page?: number;
  perPage?: number;
  sortByField?: string;
  sortAscending?: boolean;
  status?: 'active' | 'inactive' | 'archived' | 'unarchived';
}): Promise<SearchSequencesOutput> {
  const {
    page = 1,
    perPage = 25,
    sortByField = 'created_at',
    sortAscending = false,
    status,
  } = opts;

  const body: Record<string, unknown> = {
    page,
    per_page: perPage,
    sort_by_field: sortByField,
    sort_ascending: sortAscending,
  };
  if (status) body.emailer_campaign_status = status;

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/emailer_campaigns/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * View a single sequence by ID.
 */
export async function viewSequence(opts: {
  id: string;
}): Promise<ViewSequenceOutput> {
  const { id } = opts;

  if (!id) throw new Validation('id is required');

  const response = await fetch(`/api/v1/emailer_campaigns/${id}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Create a new sequence.
 */
export async function createSequence(opts: {
  name: string;
  permissions?: 'team_can_use' | 'team_can_view' | 'private';
  active?: boolean;
}): Promise<CreateSequenceOutput> {
  const { name, permissions = 'team_can_use', active = false } = opts;

  if (!name) throw new Validation('name is required');

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/emailer_campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      name,
      permissions,
      active,
    }),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Update an existing sequence.
 */
export async function updateSequence(opts: {
  id: string;
  name?: string;
  active?: boolean;
  permissions?: 'team_can_use' | 'team_can_view' | 'private';
  maxEmailsPerDay?: number;
  emailerScheduleId?: string;
}): Promise<UpdateSequenceOutput> {
  const { id, name, active, permissions, maxEmailsPerDay, emailerScheduleId } =
    opts;

  if (!id) throw new Validation('id is required');

  const body: Record<string, unknown> = {};
  if (name !== undefined) body.name = name;
  if (active !== undefined) body.active = active;
  if (permissions !== undefined) body.permissions = permissions;
  if (maxEmailsPerDay !== undefined) body.max_emails_per_day = maxEmailsPerDay;
  if (emailerScheduleId !== undefined)
    body.emailer_schedule_id = emailerScheduleId;

  // When activating, retry with backoff; Apollo may need time to propagate
  // touch status changes from addSequenceStep before activation succeeds.
  const maxAttempts = active === true ? 3 : 1;

  let result: UpdateSequenceOutput | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(`/api/v1/emailer_campaigns/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });

    if (!response.ok)
      throwForStatus(response.status, await response.text().catch(() => undefined));

    result = await response.json();

    // Check if activation succeeded (or if we weren't trying to activate)
    if (active === undefined || result!.emailer_campaign?.active === active) {
      return result!;
    }

    // Activation didn't take; wait and retry if we have attempts left
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  // All retries exhausted; throw with diagnostics
  const campaign = result!.emailer_campaign;
  const hints: string[] = [];
  if (!campaign.emailer_schedule_id)
    hints.push(
      'no sending schedule assigned (use listSequenceSchedules + emailerScheduleId)',
    );
  if (campaign.num_steps === 0) hints.push('sequence has no steps');
  throw new UpstreamError(
    `updateSequence: requested active=${active} but Apollo returned active=${campaign.active}. ` +
      `Possible causes: unreviewed step touches, ${hints.join(', ') || 'unknown prerequisites not met'}. ` +
      `Check the sequence in Apollo UI for validation errors.`,
  );
}

/**
 * Delete a sequence by ID.
 */
export async function deleteSequence(opts: {
  id: string;
}): Promise<DeleteSequenceOutput> {
  const { id } = opts;

  if (!id) throw new Validation('id is required');

  const response = await fetch(`/api/v1/emailer_campaigns/${id}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return { success: true };
}

/**
 * Restore an archived sequence.
 */
export async function unarchiveSequence(opts: {
  id: string;
}): Promise<UnarchiveSequenceOutput> {
  const { id } = opts;

  if (!id) throw new Validation('id is required');

  const response = await fetch(`/api/v1/emailer_campaigns/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ archived: false }),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Add a step to a sequence.
 */
export async function addSequenceStep(opts: {
  sequenceId: string;
  type:
    | 'auto_email'
    | 'manual_email'
    | 'call'
    | 'action_item'
    | 'linkedin_step_message'
    | 'linkedin_step_connect'
    | 'linkedin_step_view_profile'
    | 'linkedin_step_interact_with_post';
  priority?: 'A' | 'B';
  position?: number;
  waitTime?: number;
  waitMode?: 'day' | 'hour' | 'minute';
  subject?: string;
  bodyHtml?: string;
  replyToThread?: boolean;
}): Promise<AddSequenceStepOutput> {
  const {
    sequenceId,
    type,
    priority = 'A',
    position,
    waitTime = 1,
    waitMode = 'day',
    subject,
    bodyHtml,
    replyToThread,
  } = opts;

  if (!sequenceId) throw new Validation('sequenceId is required');
  if (!type) throw new Validation('type is required');

  const requestBody: Record<string, unknown> = {
    emailer_campaign_id: sequenceId,
    type,
    priority,
    wait_mode: waitMode,
    wait_time: waitTime,
  };

  if (position !== undefined) requestBody.position = position;

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/emailer_steps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(requestBody),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  const result = await response.json();

  const touchId = result.emailer_touch?.id;
  const templateId = result.emailer_template?.id;

  // For replyToThread steps, update the touch type via PUT /emailer_touches/{id}.
  // The PUT endpoint REQUIRES emailer_template in the body (including body_html and subject)
  // or it returns 422 "undefined method '[]' for nil". It also auto-approves the touch.
  if (replyToThread && touchId) {
    const touchBody: Record<string, unknown> = {
      type: 'reply_to_thread',
      emailer_template: {
        body_html: bodyHtml || '',
        subject: subject || '',
        creation_type: 'manual',
      },
    };

    const touchResponse = await fetch(`/api/v1/emailer_touches/${touchId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(touchBody),
    });

    if (!touchResponse.ok) {
      const errText = await touchResponse.text().catch(() => '');
      throw new UpstreamError(
        `addSequenceStep: failed to set replyToThread on touch ${touchId}: ${touchResponse.status} ${errText}`,
      );
    }

    const touchData = await touchResponse.json();
    if (touchData.emailer_touch) {
      result.emailer_touch = touchData.emailer_touch;
      if (touchData.emailer_touch.emailer_template) {
        result.emailer_template = touchData.emailer_touch.emailer_template;
      }
    }
  } else {
    // Non-threaded steps: update template separately if subject/body provided
    if (templateId && (subject || bodyHtml)) {
      const templateBody: Record<string, unknown> = {};
      if (subject) templateBody.subject = subject;
      if (bodyHtml) templateBody.body_html = bodyHtml;

      const templateResponse = await fetch(
        `/api/v1/emailer_templates/${templateId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(templateBody),
        },
      );

      if (templateResponse.ok) {
        const updatedTemplate = await templateResponse.json();
        result.emailer_template = updatedTemplate.emailer_template;
      }
    }

    // Auto-approve the touch so the step is ready to send when sequence activates
    if (touchId) {
      await fetch(`/api/v1/emailer_touches/${touchId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
    }
  }

  return result;
}

/**
 * Enable a sequence step (approve its touch).
 */
export async function enableSequenceStep(opts: {
  touchId: string;
}): Promise<EnableSequenceStepOutput> {
  const { touchId } = opts;
  if (!touchId) throw new Validation('touchId is required');

  const response = await fetch(`/api/v1/emailer_touches/${touchId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return { success: true };
}

/**
 * Disable a sequence step (abort its touch).
 */
export async function disableSequenceStep(opts: {
  touchId: string;
}): Promise<DisableSequenceStepOutput> {
  const { touchId } = opts;
  if (!touchId) throw new Validation('touchId is required');

  const response = await fetch(`/api/v1/emailer_touches/${touchId}/abort`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ check_for_changes: true }),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return { success: true };
}

/**
 * Delete a sequence step by ID.
 */
export async function deleteSequenceStep(opts: {
  id: string;
}): Promise<DeleteSequenceStepOutput> {
  const { id } = opts;

  if (!id) throw new Validation('id is required');

  const response = await fetch(`/api/v1/emailer_steps/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return { success: true };
}

/**
 * Add contacts to a sequence.
 */
export async function addContactsToSequence(opts: {
  sequenceId: string;
  contactIds: string[];
  sendEmailFromEmailAccountId: string;
  sequenceActiveInOtherCampaigns?: boolean;
  sequenceFinishedInOtherCampaigns?: boolean;
  sequenceUnverifiedEmail?: boolean;
}): Promise<AddContactsToSequenceOutput> {
  const {
    sequenceId,
    contactIds,
    sendEmailFromEmailAccountId,
    sequenceActiveInOtherCampaigns = false,
    sequenceFinishedInOtherCampaigns = false,
    sequenceUnverifiedEmail = false,
  } = opts;

  if (!sequenceId) throw new Validation('sequenceId is required');
  if (!contactIds || contactIds.length === 0)
    throw new Validation('contactIds array is required and must not be empty');
  if (!sendEmailFromEmailAccountId)
    throw new Validation('sendEmailFromEmailAccountId is required');

  const response = await fetch(
    `/api/v1/emailer_campaigns/${sequenceId}/add_contact_ids`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        contact_ids: contactIds,
        emailer_campaign_id: sequenceId,
        send_email_from_email_account_id: sendEmailFromEmailAccountId,
        sequence_active_in_other_campaigns: sequenceActiveInOtherCampaigns,
        sequence_finished_in_other_campaigns: sequenceFinishedInOtherCampaigns,
        sequence_unverified_email: sequenceUnverifiedEmail,
      }),
    },
  );

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Add all contacts from a list to a sequence.
 * Handles pagination automatically to add ALL contacts, not just the first page.
 */
export async function addListToSequence(opts: {
  listId: string;
  sequenceId: string;
  sendEmailFromEmailAccountId: string;
  sequenceActiveInOtherCampaigns?: boolean;
}): Promise<AddListToSequenceOutput> {
  const {
    listId,
    sequenceId,
    sendEmailFromEmailAccountId,
    sequenceActiveInOtherCampaigns = false,
  } = opts;

  if (!listId) throw new Validation('listId is required');
  if (!sequenceId) throw new Validation('sequenceId is required');
  if (!sendEmailFromEmailAccountId)
    throw new Validation('sendEmailFromEmailAccountId is required');

  // Collect ALL contact IDs from the list via pagination
  const allContactIds: string[] = [];
  let page = 1;
  // Apollo limits per_page to 25 when filtering by contact_label_ids
  const perPage = 25;

  while (true) {
    const base = window.location.origin;
    const response = await fetch(`${base}/api/v1/mixed_people/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        page,
        per_page: perPage,
        contact_label_ids: [listId],
        prospected_by_current_team: ['yes'],
        display_mode: 'explorer_mode',
        finder_version: 2,
        context: 'people-index-page',
        cacheKey: Date.now(),
      }),
    });

    if (!response.ok)
      throwForStatus(response.status, await response.text().catch(() => undefined));
    const data = await response.json();

    const contacts = data.contacts || [];
    for (const c of contacts) {
      if (c.id) allContactIds.push(c.id);
    }

    const totalPages = data.pagination?.total_pages || 1;
    if (page >= totalPages || contacts.length === 0) break;
    page++;
  }

  if (allContactIds.length === 0) {
    throw new ContractDrift(
      'No contacts found in list. Ensure contacts were saved to CRM via addContactsToList() first.',
    );
  }

  // Add all collected contacts to the sequence
  const addResponse = await fetch(
    `/api/v1/emailer_campaigns/${sequenceId}/add_contact_ids`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        contact_ids: allContactIds,
        emailer_campaign_id: sequenceId,
        send_email_from_email_account_id: sendEmailFromEmailAccountId,
        sequence_active_in_other_campaigns: sequenceActiveInOtherCampaigns,
      }),
    },
  );

  if (!addResponse.ok)
    throwForStatus(addResponse.status, await addResponse.text().catch(() => undefined));

  const result = await addResponse.json();

  const skippedContactIds = result.skipped_contact_ids || {};

  return {
    totalContactsInList: allContactIds.length,
    addedCount: result.contacts?.length || 0,
    skippedCount: Object.keys(skippedContactIds).length,
    skippedContactIds,
    emailer_campaign: result.emailer_campaign,
  };
}

/**
 * Get contacts enrolled in a sequence.
 */
export async function getSequenceContacts(opts: {
  sequenceId: string;
  page?: number;
  perPage?: number;
  contactStatuses?: Array<
    'active' | 'paused' | 'finished' | 'not_sent' | 'bounced' | 'spam_blocked'
  >;
}): Promise<GetSequenceContactsOutput> {
  const { sequenceId, page = 1, perPage = 25, contactStatuses } = opts;

  if (!sequenceId) throw new Validation('sequenceId is required');

  // Apollo returns 422 for per_page > 100
  const safePerPage = Math.min(perPage, 100);

  const body: Record<string, unknown> = {
    page,
    per_page: safePerPage,
    prospected_by_current_team: ['yes'],
    display_mode: 'explorer_mode',
    finder_version: 2,
    emailer_campaign_ids: [sequenceId],
    context: 'emailer-campaign-show-prospects-page',
    cacheKey: Date.now(),
  };

  if (contactStatuses && contactStatuses.length > 0) {
    body.contact_campaign_statuses_or_failure_reasons = contactStatuses.map(
      (s) => sequenceId + s,
    );
  }

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/mixed_people/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  const contacts = data.contacts || [];

  return {
    contacts: contacts.map(
      (c: {
        id: string;
        name?: string;
        email?: string;
        title?: string;
        organization_name?: string;
        organization?: { name?: string };
        contact_campaign_statuses?: Array<{
          emailer_campaign_id?: string;
          status?: string;
          inactive_reason?: string;
          current_step_position?: number;
        }>;
      }) => {
        const campaignStatus = c.contact_campaign_statuses?.find(
          (cs) => cs.emailer_campaign_id === sequenceId,
        );
        return {
          id: c.id,
          name: c.name ?? '',
          email: c.email ?? '',
          title: c.title ?? '',
          company: c.organization_name ?? c.organization?.name ?? '',
          status: campaignStatus?.status ?? '',
          inactiveReason: campaignStatus?.inactive_reason ?? '',
          currentStepPosition: campaignStatus?.current_step_position ?? 0,
        };
      },
    ),
    contactIds: contacts.map((c: { id: string }) => c.id),
    pagination: data.pagination,
  };
}

/**
 * Update the status of contacts in a sequence (pause, resume, or finish).
 */
export async function updateSequenceContactStatus(opts: {
  sequenceId: string;
  contactIds: string[];
  status: 'paused' | 'active' | 'finished';
}): Promise<UpdateSequenceContactStatusOutput> {
  const { sequenceId, contactIds, status } = opts;

  if (!sequenceId) throw new Validation('sequenceId is required');
  if (!contactIds || contactIds.length === 0)
    throw new Validation('contactIds is required and must not be empty');
  if (!['paused', 'active', 'finished'].includes(status))
    throw new Validation(
      `Invalid status: ${status}. Must be paused, active, or finished`,
    );

  const response = await fetch(
    `/api/v1/emailer_campaigns/${sequenceId}/change_contact_statuses`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        contact_ids: contactIds,
        status,
      }),
    },
  );

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  return {
    success: true,
    contacts: (data.contacts || []).map((c: { id: string; name?: string }) => ({
      id: c.id,
      name: c.name || '',
    })),
  };
}

/**
 * Update sequence step metadata and/or email content.
 */
export async function updateSequenceStep(opts: {
  id: string;
  waitTime?: number;
  waitMode?: 'day' | 'hour' | 'minute';
  note?: string;
  autoSkipInDays?: number;
  subject?: string;
  bodyHtml?: string;
}): Promise<UpdateSequenceStepOutput> {
  const { id, waitTime, waitMode, note, autoSkipInDays, subject, bodyHtml } =
    opts;

  if (!id) throw new Validation('id is required');

  // Update step metadata if any timing/metadata fields provided
  const stepBody: Record<string, unknown> = {};
  if (waitTime !== undefined) {
    stepBody.wait_time = waitTime;
    stepBody.wait_mode = waitMode ?? 'day';
  } else if (waitMode !== undefined) {
    stepBody.wait_mode = waitMode;
  }
  if (note !== undefined) stepBody.note = note;
  if (autoSkipInDays !== undefined)
    stepBody.auto_skip_in_x_days = autoSkipInDays;

  let stepResult: Record<string, unknown> = {};
  if (Object.keys(stepBody).length > 0) {
    const response = await fetch(`/api/v1/emailer_steps/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(stepBody),
    });

    if (!response.ok)
      throwForStatus(response.status, await response.text().catch(() => undefined));

    stepResult = await response.json();
  } else {
    // Still need step data even if only updating template
    const getResp = await fetch(`/api/v1/emailer_steps/${id}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    if (!getResp.ok)
      throwForStatus(getResp.status, await getResp.text().catch(() => undefined));
    stepResult = await getResp.json();
  }

  // Update email content if subject or bodyHtml provided
  if (subject !== undefined || bodyHtml !== undefined) {
    const step = stepResult.emailer_step as { emailer_campaign_id?: string };
    const campaignId = step?.emailer_campaign_id;
    if (!campaignId)
      throw new ContractDrift('updateSequenceStep: could not resolve campaign ID');

    // Find the touch for this step
    const touchResp = await fetch(
      `/api/v1/emailer_touches?emailer_campaign_id=${campaignId}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      },
    );
    if (!touchResp.ok)
      throwForStatus(touchResp.status, await touchResp.text().catch(() => undefined));

    const touchData = await touchResp.json();
    const touches = (touchData.emailer_touches || []) as Array<{
      id: string;
      emailer_step_id: string;
      emailer_template_id: string;
    }>;
    const touch = touches.find((t) => t.emailer_step_id === id);

    if (!touch)
      throw new ContractDrift(`updateSequenceStep: no touch found for step ${id}`);

    // Update the template
    const templateBody: Record<string, unknown> = {};
    if (subject !== undefined) templateBody.subject = subject;
    if (bodyHtml !== undefined) templateBody.body_html = bodyHtml;

    const templateResp = await fetch(
      `/api/v1/emailer_templates/${touch.emailer_template_id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(templateBody),
      },
    );

    if (!templateResp.ok)
      throwForStatus(templateResp.status, await templateResp.text().catch(() => undefined));

    const templateResult = await templateResp.json();
    (stepResult as Record<string, unknown>).emailer_template =
      templateResult.emailer_template;
  }

  return stepResult as UpdateSequenceStepOutput;
}

/**
 * Add an A/B test variant to a sequence step.
 */
export async function duplicateSequenceStep(opts: {
  stepId: string;
  sequenceId: string;
  subject?: string;
  bodyHtml?: string;
  copyOriginal?: boolean;
}): Promise<DuplicateSequenceStepOutput> {
  const { stepId, sequenceId, subject, bodyHtml, copyOriginal } = opts;

  if (!stepId) throw new Validation('stepId is required');
  if (!sequenceId) throw new Validation('sequenceId is required');

  // Get existing touches to find the original touch type and content
  const touchResp = await fetch(
    `/api/v1/emailer_touches?emailer_campaign_id=${sequenceId}`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    },
  );
  if (!touchResp.ok)
    throwForStatus(touchResp.status, await touchResp.text().catch(() => undefined));

  const touchData = await touchResp.json();
  const touches = (touchData.emailer_touches || []) as Array<{
    id: string;
    emailer_step_id: string;
    type: string;
    emailer_template: { subject: string; body_html: string };
  }>;
  const originalTouch = touches.find((t) => t.emailer_step_id === stepId);
  if (!originalTouch)
    throw new ContractDrift(`duplicateSequenceStep: no touch found for step ${stepId}`);

  // Create a new touch on the same step (this is how Apollo A/B testing works)
  const createResp = await fetch('/api/v1/emailer_touches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      emailer_step_id: stepId,
      type: originalTouch.type,
    }),
  });

  if (!createResp.ok)
    throwForStatus(createResp.status, await createResp.text().catch(() => undefined));

  const createResult = await createResp.json();
  const newTouch = createResult.emailer_touch;
  const newTemplateId =
    newTouch?.emailer_template?.id || newTouch?.emailer_template_id;

  // Determine content for the new variant
  let finalSubject = subject ?? '';
  let finalBodyHtml = bodyHtml ?? '';

  if (copyOriginal && originalTouch.emailer_template) {
    if (!subject) finalSubject = originalTouch.emailer_template.subject;
    if (!bodyHtml) finalBodyHtml = originalTouch.emailer_template.body_html;
  }

  // Update the template with content
  if (newTemplateId && (finalSubject || finalBodyHtml)) {
    const templateBody: Record<string, unknown> = {};
    if (finalSubject) templateBody.subject = finalSubject;
    if (finalBodyHtml) templateBody.body_html = finalBodyHtml;

    await fetch(`/api/v1/emailer_templates/${newTemplateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(templateBody),
    });
  }

  return {
    touchId: newTouch.id,
    templateId: newTemplateId,
    stepId,
    subject: finalSubject,
    bodyHtml: finalBodyHtml,
  };
}

/**
 * Clone a sequence.
 */
export async function cloneSequence(opts: {
  id: string;
  name?: string;
}): Promise<CloneSequenceOutput> {
  const { id, name } = opts;

  if (!id) throw new Validation('id is required');

  const body: Record<string, unknown> = {};
  if (name !== undefined) body.name = name;

  const response = await fetch(`/api/v1/emailer_campaigns/${id}/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * List all sending schedules.
 */
export async function listSequenceSchedules(): Promise<ListSequenceSchedulesOutput> {
  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/emailer_schedules`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Create a new sending schedule.
 */
export async function createSequenceSchedule(opts: {
  name: string;
  timeZone: string;
  scheduleHash: Record<string, number[][]>;
  useContactsTimeZone?: boolean;
  skipHolidays?: boolean;
}): Promise<CreateSequenceScheduleOutput> {
  const { name, timeZone, scheduleHash, useContactsTimeZone, skipHolidays } =
    opts;

  if (!name) throw new Validation('name is required');
  if (!timeZone) throw new Validation('timeZone is required');
  if (!scheduleHash) throw new Validation('scheduleHash is required');

  const body: Record<string, unknown> = {
    name,
    time_zone: timeZone,
  };
  if (useContactsTimeZone !== undefined)
    body.use_contacts_time_zone = useContactsTimeZone;
  if (skipHolidays !== undefined) body.skip_holidays = skipHolidays;

  const base = window.location.origin;
  const createResponse = await fetch(`${base}/api/v1/emailer_schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!createResponse.ok)
    throwForStatus(createResponse.status, await createResponse.text().catch(() => undefined));

  const createData = await createResponse.json();
  const scheduleId = createData.emailer_schedule?.id;

  if (!scheduleId) throw new ContractDrift('Schedule creation returned no ID');

  // Must update with schedule_hash separately
  const updateResponse = await fetch(
    `/api/v1/emailer_schedules/${scheduleId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        id: scheduleId,
        name,
        time_zone: timeZone,
        schedule_hash: scheduleHash,
      }),
    },
  );

  if (!updateResponse.ok)
    throwForStatus(updateResponse.status, await updateResponse.text().catch(() => undefined));

  return await updateResponse.json();
}

/**
 * Update an existing sending schedule.
 */
export async function updateSequenceSchedule(opts: {
  id: string;
  name?: string;
  timeZone?: string;
  scheduleHash?: Record<string, number[][]>;
  useContactsTimeZone?: boolean;
  skipHolidays?: boolean;
}): Promise<UpdateSequenceScheduleOutput> {
  const {
    id,
    name,
    timeZone,
    scheduleHash,
    useContactsTimeZone,
    skipHolidays,
  } = opts;

  if (!id) throw new Validation('id is required');

  // Fetch current schedule to merge with updates (PUT requires name + time_zone)
  const getResponse = await fetch(`/api/v1/emailer_schedules/${id}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!getResponse.ok)
    throwForStatus(getResponse.status, await getResponse.text().catch(() => undefined));

  const current = await getResponse.json();
  const existing = current.emailer_schedule || current;

  const body: Record<string, unknown> = {
    id,
    name: name ?? existing.name,
    time_zone: timeZone ?? existing.time_zone,
  };
  if (scheduleHash !== undefined) body.schedule_hash = scheduleHash;
  else if (existing.schedule_hash) body.schedule_hash = existing.schedule_hash;
  if (useContactsTimeZone !== undefined)
    body.use_contacts_time_zone = useContactsTimeZone;
  else if (existing.use_contacts_time_zone !== undefined)
    body.use_contacts_time_zone = existing.use_contacts_time_zone;
  if (skipHolidays !== undefined) body.skip_holidays = skipHolidays;
  else if (existing.skip_holidays !== undefined)
    body.skip_holidays = existing.skip_holidays;

  const response = await fetch(`/api/v1/emailer_schedules/${id}`, {
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
 * Delete a sending schedule.
 */
export async function deleteSequenceSchedule(opts: {
  id: string;
}): Promise<DeleteSequenceScheduleOutput> {
  const { id } = opts;

  if (!id) throw new Validation('id is required');

  const response = await fetch(`/api/v1/emailer_schedules/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  return { success: true };
}

/**
 * Activate/approve a sequence to start sending emails.
 */
export async function activateSequence(opts: {
  sequenceId: string;
}): Promise<ActivateSequenceOutput> {
  const { sequenceId } = opts;
  if (!sequenceId) throw new Validation('sequenceId is required');

  // First, get the sequence to find unapproved touches
  const seqResponse = await fetch(`/api/v1/emailer_campaigns/${sequenceId}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (seqResponse.ok) {
    const seqData = await seqResponse.json();
    const touches = seqData.emailer_campaign?.emailer_touches || [];

    // Approve all unapproved email touches
    for (const touch of touches) {
      if (touch.status === 'to_be_reviewed') {
        await fetch(`/api/v1/emailer_touches/${touch.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });
      }
    }
  }

  // Then activate the sequence
  const response = await fetch(
    `/api/v1/emailer_campaigns/${sequenceId}/approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    },
  );

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}

/**
 * Deactivate/pause a sequence.
 */
export async function deactivateSequence(opts: {
  sequenceId: string;
}): Promise<DeactivateSequenceOutput> {
  const { sequenceId } = opts;
  if (!sequenceId) throw new Validation('sequenceId is required');

  const response = await fetch(
    `/api/v1/emailer_campaigns/${sequenceId}/abort`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    },
  );

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}
