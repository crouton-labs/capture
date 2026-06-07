/**
 * HubSpot Marketing Email Operations
 *
 * Retrieve and manage HubSpot marketing emails and performance statistics.
 */

import { ContractDrift, NotFound, throwForStatus } from '@vallum/_runtime';

export interface MarketingEmail {
  id: number;
  name: string;
  subject: string;
  currentState: string;
  emailType: string;
  subcategory: string;
  archived: boolean;
  created: number;
  authorName: string;
}

export interface EmailStats {
  emailId: number;
  counters: {
    sent: number;
    delivered: number;
    open: number;
    click: number;
    unsubscribed: number;
    spamreport: number;
    reply: number;
    selected: number;
    pending: number;
    contactslost: number;
    notsent: number;
  };
  ratios: {
    openratio: number;
    clickratio: number;
    clickthroughratio: number;
    deliveredratio: number;
    unsubscribedratio: number;
    bounceratio: number;
    replyratio: number;
  };
}

/** Subcategories that are system-generated, not user-created marketing emails. */
const EXCLUDED_SUBCATEGORIES = new Set([
  'automated_for_leadflow',
  'automated_for_ticket',
  'ticket_closed_kickback_email',
  'ticket_opened_kickback_email',
  'ticket_pipeline_automated',
  'blog_email_child',
  'rss_to_email_child',
  'optin_email',
  'optin_followup_email',
  'manage_preferences_email',
]);

export async function listMarketingEmails(opts: {
  csrf: string;
  portalId: string;
  limit?: number;
  offset?: number;
  state?: string;
  includeSystemEmails?: boolean;
}): Promise<MarketingEmail[]> {
  const limit = opts.limit ?? 10;
  const offset = opts.offset ?? 0;

  const url = new URL(`${window.location.origin}/api/cosemail/v1/emails`);
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  if (opts.state) {
    url.searchParams.set('state', opts.state);
  }

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

  if (!Array.isArray(data.objects)) {
    throw new ContractDrift('Expected objects array in response');
  }

  const emails = data.objects as MarketingEmail[];

  if (opts.includeSystemEmails) {
    return emails;
  }

  return emails.filter((e) => !EXCLUDED_SUBCATEGORIES.has(e.subcategory));
}

export async function getMarketingEmail(opts: {
  csrf: string;
  portalId: string;
  emailId: number;
}): Promise<MarketingEmail> {
  const url = new URL(
    `${window.location.origin}/api/cosemail/v1/emails/${opts.emailId}`,
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

  if (!data.id) {
    throw new ContractDrift('Expected marketing email object with id in response');
  }

  return data as MarketingEmail;
}

export async function getEmailStats(opts: {
  csrf: string;
  portalId: string;
  emailId: number;
}): Promise<EmailStats> {
  const url = new URL(
    `${window.location.origin}/api/cosemail-stats/v1/details/${opts.emailId}/minimal-performance`,
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

  if (!response.ok) {
    if (response.status === 404) {
      throw new NotFound(
        `No stats available for email ${opts.emailId}. Stats are only available for sent marketing emails, not automated/transactional emails.`,
      );
    }
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  const data = await response.json();
  const agg = data.aggregate;

  if (!agg || !agg.counters) {
    throw new ContractDrift('Expected aggregate.counters in stats response');
  }

  return {
    emailId: opts.emailId,
    counters: agg.counters,
    ratios: agg.ratios ?? {},
  } as EmailStats;
}
