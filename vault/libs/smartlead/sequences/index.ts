import { throwForStatus } from '@vallum/_runtime';
import { apiFetch } from '../helpers';
import type {
  GetSequencesInput,
  GetSequencesOutput,
  SaveSequencesInput,
  SaveSequencesOutput,
} from './schemas';

// ============================================================================
// Internal types (not exported — implementation detail)
// ============================================================================

interface RawSequenceVariant {
  id?: number;
  subject: string;
  email_body: string;
}

interface RawSequenceStep {
  id?: number;
  seq_number: number;
  seq_delay_details: { delay_in_days: number };
  subject: string;
  email_body: string;
  variants?: RawSequenceVariant[];
}

interface GetSequencesResponse {
  data: RawSequenceStep[];
}

interface SaveSequencesResponse {
  ok: boolean;
}

interface ApiSequenceVariant {
  subject: string;
  emailBody: string;
}

interface ApiSequenceStep {
  seqNumber: number;
  seqDelayDetails: { delayInDays: number };
  subject: string;
  emailBody: string;
  variants?: ApiSequenceVariant[];
}

// ============================================================================
// getSequences
// ============================================================================

/**
 * Get the email sequence steps for a campaign.
 */
export async function getSequences(
  params: GetSequencesInput,
): Promise<GetSequencesOutput> {
  const { token, campaignId } = params;

  const res = await apiFetch(
    token,
    `/api/email-campaigns/${campaignId}/sequences`,
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as GetSequencesResponse;
  const steps: RawSequenceStep[] = data.data ?? [];

  return {
    sequences: steps.map((step) => ({
      id: step.id,
      seq_number: step.seq_number,
      seq_delay_details: {
        delay_in_days: step.seq_delay_details.delay_in_days,
      },
      subject: step.subject,
      email_body: step.email_body,
      variants: step.variants?.map((v) => ({
        id: v.id,
        subject: v.subject,
        email_body: v.email_body,
      })),
    })),
  };
}

// ============================================================================
// saveSequences
// ============================================================================

/**
 * Save (overwrite) the email sequence steps for a campaign.
 */
export async function saveSequences(
  params: SaveSequencesInput,
): Promise<SaveSequencesOutput> {
  const { token, campaignId, sequences } = params;

  // API requires camelCase field names
  const apiSequences: ApiSequenceStep[] = sequences.map((step, i) => ({
    seqNumber: i + 1,
    seqDelayDetails: { delayInDays: step.seq_delay_details.delay_in_days },
    subject: step.subject,
    emailBody: step.email_body,
    variants: step.variants?.map((v) => ({
      subject: v.subject,
      emailBody: v.email_body,
    })),
  }));

  const res = await apiFetch(
    token,
    '/api/email-campaigns/add-sequence-list-to-campaign',
    {
      method: 'POST',
      body: JSON.stringify({ campaignId, sequences: apiSequences }),
    },
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as SaveSequencesResponse;
  return { ok: data.ok };
}
