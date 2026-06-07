/**
 * HubSpot Sequences
 *
 * Sequence and email template operations for automated outreach.
 * Requires Sales Professional or higher.
 */

import type {
  ListSequencesInput,
  ListSequencesOutput,
  GetSequenceInput,
  GetSequenceOutput,
  CreateSequenceInput,
  CreateSequenceOutput,
  UpdateSequenceInput,
  UpdateSequenceOutput,
  DeleteSequenceInput,
  DeleteSequenceOutput,
  AddSequenceStepInput,
  AddSequenceStepOutput,
  ListTemplatesInput,
  ListTemplatesOutput,
  GetTemplateInput,
  GetTemplateOutput,
  CreateTemplateInput,
  CreateTemplateOutput,
  UpdateTemplateInput,
  UpdateTemplateOutput,
  DeleteTemplateInput,
  DeleteTemplateOutput,
  EnrollContactInput,
  EnrollContactOutput,
  GetEnrollmentStateInput,
  GetEnrollmentStateOutput,
  SequenceUsageInput,
  SequenceUsageOutput,
  ListEnrollmentsInput,
  ListEnrollmentsOutput,
  GetSequencePerformanceInput,
  GetSequencePerformanceOutput,
  UnenrollContactInput,
  UnenrollContactOutput,
} from '../schemas';
import { ContractDrift, NotFound, throwForStatus } from '@vallum/_runtime';

export async function listSequences(
  opts: ListSequencesInput,
): Promise<ListSequencesOutput> {
  const url = new URL(
    `${window.location.origin}/api/salescontentsearch/v2/search/early`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const offset = opts.offset !== undefined ? opts.offset : 0;
  const limit = opts.limit !== undefined ? opts.limit : 100;

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      offset,
      limit,
      sortProperty: 'hs_updated_at',
      sortDirection: 'DESC',
      contentTypeName: 'SEQUENCE',
      query: '',
    }),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!data || typeof data !== 'object') {
    throw new ContractDrift('Invalid response format');
  }

  // Filter to only SEQUENCE type items
  const sequences = Array.isArray(data.results)
    ? data.results.filter(
        (r: { contentType?: string }) => r.contentType === 'SEQUENCE',
      )
    : [];

  return {
    results: sequences,
    hasMore: typeof data.hasMore === 'boolean' ? data.hasMore : false,
    offset: typeof data.offset === 'number' ? data.offset : 0,
    total: sequences.length,
  };
}

export async function getSequence(
  opts: GetSequenceInput,
): Promise<GetSequenceOutput> {
  const url = new URL(
    `${window.location.origin}/api/sequences/v2/sequences/${opts.sequenceId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!data || typeof data !== 'object') {
    throw new ContractDrift('Invalid response format');
  }

  return data;
}

export async function createSequence(
  opts: CreateSequenceInput,
): Promise<CreateSequenceOutput> {
  const url = new URL(`${window.location.origin}/api/sequences/v2/sequences`);
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');

  // Build steps array from input
  const inputSteps = opts.steps || [];
  const steps = inputSteps.map((step, index) => ({
    action: step.action,
    delay: step.delay !== undefined ? step.delay : 0,
    stepOrder: index,
    actionMeta: {
      templateMeta: {
        id: step.templateId,
      },
    },
    dependencies: [],
    variants: [],
    branchNumber: 0,
    dynamic: false,
  }));

  const threading =
    opts.useThreadedFollowUps !== undefined ? opts.useThreadedFollowUps : true;

  const body = {
    name: opts.name,
    steps,
    enableThreading: threading,
    sequenceSettings: {
      useThreadedFollowUps: threading,
      eligibleFollowUpDays:
        opts.eligibleFollowUpDays !== undefined
          ? opts.eligibleFollowUpDays
          : 'BUSINESS_DAYS',
      sellingStrategy:
        opts.sellingStrategy !== undefined
          ? opts.sellingStrategy
          : 'LEAD_BASED',
      sendingStrategy:
        opts.sendingStrategy !== undefined
          ? opts.sendingStrategy
          : 'TIME_RANGE',
      sendWindowStartsAtMin:
        opts.sendWindowStartsAtMin !== undefined
          ? opts.sendWindowStartsAtMin
          : 480,
      sendWindowEndsAtMin:
        opts.sendWindowEndsAtMin !== undefined
          ? opts.sendWindowEndsAtMin
          : 1020,
      timeZone: opts.timeZone !== undefined ? opts.timeZone : 'US/Eastern',
    },
  };

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!data || typeof data !== 'object') {
    throw new ContractDrift('Invalid response format');
  }

  return data;
}

export async function updateSequence(
  opts: UpdateSequenceInput,
): Promise<UpdateSequenceOutput> {
  // First get the current sequence
  const current = await getSequence({
    csrf: opts.csrf,
    portalId: opts.portalId,
    sequenceId: opts.sequenceId,
  });

  // Merge updates into current object
  const updated = {
    ...current,
    ...(opts.name && { name: opts.name }),
    ...(opts.steps && {
      steps: opts.steps.map((step, index) => ({
        action: step.action,
        delay: step.delay !== undefined ? step.delay : 0,
        stepOrder: index,
        actionMeta: {
          templateMeta: {
            id: step.templateId,
          },
        },
      })),
    }),
    ...(opts.sequenceSettings && {
      sequenceSettings: {
        ...current.sequenceSettings,
        ...opts.sequenceSettings,
      },
    }),
    // Sync top-level enableThreading with sequenceSettings
    ...(opts.sequenceSettings?.useThreadedFollowUps !== undefined && {
      enableThreading: opts.sequenceSettings.useThreadedFollowUps,
    }),
  };

  const url = new URL(
    `${window.location.origin}/api/sequences/v2/sequences/${opts.sequenceId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(updated),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throwForStatus(response.status, errorBody || undefined);
  }

  const data = await response.json();

  if (!data || typeof data !== 'object') {
    throw new ContractDrift('Invalid response format');
  }

  return data;
}

export async function addSequenceStep(
  opts: AddSequenceStepInput,
): Promise<AddSequenceStepOutput> {
  // Fetch the current sequence to get its full internal state
  const current = await getSequence({
    csrf: opts.csrf,
    portalId: opts.portalId,
    sequenceId: opts.sequenceId,
  });

  const existingSteps = Array.isArray(current.steps) ? current.steps : [];

  // Separate FINISH_ENROLLMENT from real steps; it must always be last
  const finishStep = existingSteps.find(
    (s: { action?: string }) => s.action === 'FINISH_ENROLLMENT',
  );
  const realSteps = existingSteps.filter(
    (s: { action?: string }) => s.action !== 'FINISH_ENROLLMENT',
  );

  const newStep = {
    action: opts.action,
    delay: opts.delay !== undefined ? opts.delay : 0,
    stepOrder: realSteps.length,
    actionMeta: {
      templateMeta: {
        id: opts.templateId,
      },
    },
    dependencies: [],
    variants: [],
    branchNumber: 0,
    dynamic: false,
  };

  // Insert new step before FINISH_ENROLLMENT and re-index stepOrders
  const updatedSteps = [
    ...realSteps,
    newStep,
    ...(finishStep ? [finishStep] : []),
  ].map((step, i) => ({ ...step, stepOrder: i }));

  const url = new URL(
    `${window.location.origin}/api/sequences/v2/sequences/${opts.sequenceId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...current,
      steps: updatedSteps,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throwForStatus(response.status, errorBody || undefined);
  }

  const data = await response.json();

  if (!data || typeof data !== 'object') {
    throw new ContractDrift('Invalid response format');
  }

  return data;
}

export async function deleteSequence(
  opts: DeleteSequenceInput,
): Promise<DeleteSequenceOutput> {
  const url = new URL(
    `${window.location.origin}/api/sequences/v2/sequences/batch`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');
  url.searchParams.set('overrideActiveEnrollmentCheck', 'true');

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ids: [opts.sequenceId] }),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return { deleted: true };
}

export async function listTemplates(
  opts: ListTemplatesInput,
): Promise<ListTemplatesOutput> {
  const limit = opts.limit !== undefined ? opts.limit : 100;
  const offset = opts.offset !== undefined ? opts.offset : 0;

  const url = new URL(
    `${window.location.origin}/api/sales-templates/v1/templates`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new ContractDrift('Invalid response: expected array');
  }

  return data;
}

export async function getTemplate(
  opts: GetTemplateInput,
): Promise<GetTemplateOutput> {
  const url = new URL(
    `${window.location.origin}/api/sales-templates/v1/templates/${opts.templateId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!data || typeof data !== 'object') {
    throw new ContractDrift('Invalid response format');
  }

  return data;
}

export async function createTemplate(
  opts: CreateTemplateInput,
): Promise<CreateTemplateOutput> {
  const url = new URL(
    `${window.location.origin}/api/sales-templates/v1/templates`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const body = {
    name: opts.name,
    subject: opts.subject,
    body: opts.body,
    folderId: opts.folderId !== undefined ? opts.folderId : null,
  };

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!data || typeof data !== 'object') {
    throw new ContractDrift('Invalid response format');
  }

  return data;
}

export async function updateTemplate(
  opts: UpdateTemplateInput,
): Promise<UpdateTemplateOutput> {
  // Fetch current template first (API requires full object on PUT)
  const current = await getTemplate({
    csrf: opts.csrf,
    portalId: opts.portalId,
    templateId: opts.templateId,
  });

  const body = {
    ...current,
    ...(opts.name !== undefined && { name: opts.name }),
    ...(opts.subject !== undefined && { subject: opts.subject }),
    ...(opts.body !== undefined && { body: opts.body }),
  };

  const url = new URL(
    `${window.location.origin}/api/sales-templates/v1/templates/${opts.templateId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!data || typeof data !== 'object') {
    throw new ContractDrift('Invalid response format');
  }

  return data;
}

export async function deleteTemplate(
  opts: DeleteTemplateInput,
): Promise<DeleteTemplateOutput> {
  const url = new URL(
    `${window.location.origin}/api/sales-templates/v1/templates/${opts.templateId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  if (response.status !== 204) throwForStatus(response.status, await response.text().catch(() => undefined));

  return undefined;
}

export async function enrollContact(
  opts: EnrollContactInput,
): Promise<EnrollContactOutput> {
  const url = new URL(
    `${window.location.origin}/api/automation/v4/sequences/enrollments`,
  );
  url.searchParams.set('userId', opts.userId);
  url.searchParams.set('portalId', opts.portalId);

  const body = {
    sequenceId: opts.sequenceId,
    contactId: opts.contactId,
    senderEmail: opts.senderEmail,
  };

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch((): null => null);
    throwForStatus(response.status, errorData?.message ?? undefined);
  }

  const data = await response.json();

  if (!data || typeof data !== 'object') {
    throw new ContractDrift('Invalid response format');
  }

  return data;
}

export async function getEnrollmentState(
  opts: GetEnrollmentStateInput,
): Promise<GetEnrollmentStateOutput> {
  const url = new URL(
    `${window.location.origin}/api/sequences/v2/enrollments/vid/${opts.contactId}/state`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!data || typeof data !== 'object') {
    throw new ContractDrift('Invalid response format');
  }

  return data;
}

export async function getSequenceUsage(
  opts: SequenceUsageInput,
): Promise<SequenceUsageOutput> {
  const url = new URL(
    `${window.location.origin}/api/sequences/v2/sequences/usage`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (!data || typeof data !== 'object') {
    throw new ContractDrift('Invalid response format');
  }

  if (typeof data.limit !== 'number' || typeof data.currentUsage !== 'number') {
    throw new ContractDrift('Invalid response: missing or invalid limit/currentUsage');
  }

  return {
    limit: data.limit,
    currentUsage: data.currentUsage,
  };
}

export async function listEnrollments(
  opts: ListEnrollmentsInput,
): Promise<ListEnrollmentsOutput> {
  const url = new URL(`${window.location.origin}/api/crm-search/search`);
  url.searchParams.set('portalId', opts.portalId);

  const filters: Array<Record<string, unknown>> = [];

  if (opts.sequenceId) {
    filters.push({
      property: 'hs_sequence_id',
      operator: 'IN',
      values: [opts.sequenceId],
    });
  }

  if (opts.status) {
    filters.push({
      property: 'hs_enrollment_status',
      operator: 'EQ',
      value: opts.status,
    });
  }

  const count = opts.limit !== undefined ? opts.limit : 25;
  const offset = opts.offset !== undefined ? opts.offset : 0;

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      objectTypeId: 'SEQUENCE_ENROLLMENT',
      requestOptions: { includeAllValues: true },
      count,
      offset,
      query: '',
      filterGroups: [{ filters }],
      sorts: [{ property: 'hs_enrolled_at', order: 'DESC' }],
    }),
  });

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];

  return {
    results: results.map(
      (r: {
        objectId: number;
        properties: Record<string, { value: string }>;
      }) => {
        const p = r.properties || {};
        return {
          enrollmentId: String(r.objectId),
          contactId: p.hs_contact_id?.value || null,
          contactEmail: p.hs_recipient_email?.value || null,
          contactName:
            [p.hs_first_name?.value, p.hs_last_name?.value]
              .filter(Boolean)
              .join(' ') || null,
          sequenceId: p.hs_sequence_id?.value || null,
          enrolledBy: p.hs_enrolled_by?.value || null,
          enrolledAt: p.hs_enrolled_at?.value || null,
          endedAt: p.hs_ended_at?.value || null,
          status: p.hs_enrollment_status?.value || null,
          lastAction: p.hs_enrollment_action?.value || null,
          emailsSent: Number(p.hs_email_sent_count?.value || 0),
          meetingsBooked: Number(p.hs_num_associated_meetings?.value || 0),
          dealsCreated: Number(p.hs_num_associated_deals?.value || 0),
          noResponse: Number(p.hs_ended_no_response_count?.value || 0),
          lastStepExecuted: Number(
            p.hs_last_executed_step_order_user_friendly?.value || 0,
          ),
          totalSteps: Number(p.hs_number_of_steps?.value || 0),
          errorCount: Number(p.hs_error_count?.value || 0),
        };
      },
    ),
    total: typeof data.total === 'number' ? data.total : results.length,
    hasMore: typeof data.hasMore === 'boolean' ? data.hasMore : false,
    offset: typeof data.offset === 'number' ? data.offset : 0,
  };
}

export async function getSequencePerformance(
  opts: GetSequencePerformanceInput,
): Promise<GetSequencePerformanceOutput> {
  const url = new URL(`${window.location.origin}/api/crm-search/report/multi`);
  url.searchParams.set('portalId', opts.portalId);

  const filters: Array<Record<string, unknown>> = [
    {
      property: 'hs_sequence_id',
      operator: 'EQ',
      value: opts.sequenceId,
    },
  ];

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify([
      {
        objectTypeId: 'SEQUENCE_ENROLLMENT',
        filterGroups: [{ filters }],
        metrics: [
          {
            property: 'hs_email_open_count',
            metricTypes: ['COUNT'],
            name: 'OPENED',
          },
          {
            property: 'hs_email_click_count',
            metricTypes: ['COUNT'],
            name: 'CLICKED',
          },
          {
            property: 'hs_email_reply_count',
            metricTypes: ['COUNT'],
            name: 'REPLIED',
          },
          {
            property: 'hs_email_bounce_count',
            metricTypes: ['COUNT'],
            name: 'BOUNCED',
          },
          {
            property: 'hs_contact_id',
            metricTypes: ['DISTINCT_APPROX'],
            name: 'CONTACTS',
          },
          {
            property: 'hs_unsubscribe_count',
            metricTypes: ['COUNT'],
            name: 'UNSUBSCRIBED',
          },
          {
            property: 'hs_ended_no_response_count',
            metricTypes: ['SUM'],
            name: 'NO_RESPONSE',
          },
          {
            property: 'hs_num_associated_meetings',
            metricTypes: ['SUM'],
            name: 'MEETINGS',
          },
          {
            property: 'hs_executing_count',
            metricTypes: ['SUM'],
            name: 'EXECUTING',
          },
          {
            property: 'hs_enrollment_id',
            metricTypes: ['COUNT'],
            name: 'TOTAL_ENROLLMENTS',
          },
        ],
      },
    ]),
  });

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  const data = await response.json();
  const report = Array.isArray(data) ? data[0] : data;

  const m = report?.metrics || {};

  return {
    totalEnrollments: report?.count || 0,
    emailsOpened: m.OPENED?.count || 0,
    emailsClicked: m.CLICKED?.count || 0,
    emailsReplied: m.REPLIED?.count || 0,
    emailsBounced: m.BOUNCED?.count || 0,
    uniqueContacts: m.CONTACTS?.distinctApprox || 0,
    unsubscribes: m.UNSUBSCRIBED?.count || 0,
    noResponse: m.NO_RESPONSE?.sum || 0,
    meetingsBooked: m.MEETINGS?.sum || 0,
    currentlyExecuting: m.EXECUTING?.sum || 0,
  };
}

export async function unenrollContact(
  opts: UnenrollContactInput,
): Promise<UnenrollContactOutput> {
  // Try the real-time v2 state endpoint first (CRM search can lag minutes behind)
  const stateUrl = new URL(
    `${window.location.origin}/api/sequences/v2/enrollments/vid/${opts.contactId}/state`,
  );
  stateUrl.searchParams.set('portalId', opts.portalId);

  const stateResp = await fetch(stateUrl.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  let enrollmentId: string | null = null;

  if (stateResp.ok) {
    const stateData = await stateResp.json();
    if (stateData.state === 'EXECUTING' && stateData.sequenceEnrollmentId) {
      enrollmentId = String(stateData.sequenceEnrollmentId);
    }
  }

  // Fall back to CRM search if v2 state didn't return an enrollment
  if (!enrollmentId) {
    const searchUrl = new URL(
      `${window.location.origin}/api/crm-search/search`,
    );
    searchUrl.searchParams.set('portalId', opts.portalId);

    const searchResp = await fetch(searchUrl.toString(), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'x-hubspot-csrf-hubspotapi': opts.csrf,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        objectTypeId: 'SEQUENCE_ENROLLMENT',
        requestOptions: { includeAllValues: true },
        count: 1,
        offset: 0,
        filterGroups: [
          {
            filters: [
              {
                property: 'hs_contact_id',
                operator: 'EQ',
                value: opts.contactId,
              },
              {
                property: 'hs_sequence_id',
                operator: 'EQ',
                value: opts.sequenceId,
              },
              {
                property: 'hs_enrollment_status',
                operator: 'EQ',
                value: 'EXECUTING',
              },
            ],
          },
        ],
        sorts: [{ property: 'hs_enrolled_at', order: 'DESC' }],
      }),
    });

    if (!searchResp.ok) {
      throwForStatus(searchResp.status, await searchResp.text().catch(() => undefined));
    }

    const searchData = await searchResp.json();
    const enrollment = searchData.results?.[0];

    if (!enrollment) {
      throw new NotFound(
        'No active enrollment found for this contact in this sequence',
      );
    }

    enrollmentId =
      enrollment.properties?.hs_enrollment_id?.value ||
      String(enrollment.objectId);
  }

  // Now unenroll using the v1 batch endpoint
  const unenrollUrl = new URL(
    `${window.location.origin}/api/sequences/v1/enrollment/unenroll/batch`,
  );
  unenrollUrl.searchParams.set('portalId', opts.portalId);

  const unenrollResp = await fetch(unenrollUrl.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ids: [enrollmentId] }),
  });

  if (!unenrollResp.ok) {
    throwForStatus(unenrollResp.status, await unenrollResp.text().catch(() => undefined));
  }

  return { unenrolled: true };
}
