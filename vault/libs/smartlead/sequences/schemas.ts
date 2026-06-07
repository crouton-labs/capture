import { z } from 'zod';

export const SequenceVariantSchema = z.object({
  subject: z.string().describe('Email subject line for this variant'),
  email_body: z
    .string()
    .describe('HTML or plain-text email body for this variant'),
  id: z.number().optional().describe('Variant ID (assigned by the API)'),
});

export const SequenceStepSchema = z.object({
  id: z.number().optional().describe('Sequence step ID (assigned by the API)'),
  seq_number: z.number().describe('Step index in the sequence, 1-based'),
  seq_delay_details: z
    .object({
      delay_in_days: z
        .number()
        .describe('Days to wait before sending this step'),
    })
    .describe('Delay configuration before this step is sent'),
  subject: z
    .string()
    .describe('Email subject line (used when no A/B variants)'),
  email_body: z.string().describe('Email body (used when no A/B variants)'),
  variants: z
    .array(SequenceVariantSchema)
    .optional()
    .describe(
      'A/B test variants for this step. When present, overrides subject/email_body.',
    ),
});

export const getSequencesSchema = {
  name: 'getSequences',
  description:
    'Get the email sequence steps for a campaign. Returns each step with subject, body, delay days, and A/B variant configurations.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    campaignId: z.number().describe('Campaign ID'),
  }),
  output: z.object({
    sequences: z
      .array(SequenceStepSchema)
      .describe('Ordered list of sequence steps'),
  }),
};

export type GetSequencesInput = z.infer<typeof getSequencesSchema.input>;
export type GetSequencesOutput = z.infer<typeof getSequencesSchema.output>;

export const SaveSequenceStepSchema = z.object({
  subject: z.string().describe('Email subject line for this step'),
  email_body: z.string().describe('HTML or plain-text email body'),
  seq_delay_details: z
    .object({
      delay_in_days: z
        .number()
        .describe('Days to wait before sending this step'),
    })
    .describe('Delay before this step is sent'),
  variants: z
    .array(
      z.object({
        subject: z.string().describe('Variant subject line'),
        email_body: z.string().describe('Variant email body'),
      }),
    )
    .optional()
    .describe(
      'A/B test variants. When provided, overrides subject/email_body.',
    ),
});

export const saveSequencesSchema = {
  name: 'saveSequences',
  description:
    'Save (overwrite) the email sequence steps for a campaign. Replaces all existing steps with the provided array.',
  notes:
    'This overwrites the full sequence. Retrieve first with getSequences if you want to preserve existing steps.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    campaignId: z.number().describe('Campaign ID'),
    sequences: z
      .array(SaveSequenceStepSchema)
      .describe('Full ordered list of sequence steps to save'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the save succeeded'),
  }),
};

export type SaveSequencesInput = z.infer<typeof saveSequencesSchema.input>;
export type SaveSequencesOutput = z.infer<typeof saveSequencesSchema.output>;

export const sequenceSchemas = [getSequencesSchema, saveSequencesSchema];
