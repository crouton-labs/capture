import { z } from 'zod';

// ============================================================================
// Shared output shapes
// ============================================================================

export const SubscriptionActionItemSchema = z
  .object({
    entryId: z
      .string()
      .optional()
      .describe('Contentful entry id for this action card.'),
    name: z
      .string()
      .optional()
      .describe(
        'Display name for this action card (e.g. "Payment Profile"). The action code is in ctaAction.name and ctaAction.actionJson.type.',
      ),
    cardType: z
      .string()
      .optional()
      .describe('UI card type (e.g. "paymentCard"). Treat as opaque.'),
    ctaText: z
      .string()
      .optional()
      .describe('Call-to-action button label (e.g. "Renew Now").'),
    borderColor: z.string().optional().describe('UI border color token.'),
    eidPrefix: z.string().optional().describe('Analytics event ID prefix.'),
    buttonDesign: z
      .string()
      .optional()
      .describe('Button design variant (e.g. "primary").'),
    ctaAction: z
      .object({
        entryId: z.string().optional(),
        name: z
          .string()
          .optional()
          .describe(
            'Action type name (e.g. "paymentProfile", "autoRenew", "cancel").',
          ),
        actionJson: z
          .object({ type: z.string().optional() })
          .passthrough()
          .optional()
          .describe('Structured action payload. `type` is the action code.'),
      })
      .passthrough()
      .optional()
      .describe('Action to execute when the CTA is triggered.'),
  })
  .passthrough()
  .describe('A single available billing action card for a subscription.');

export const SubscriptionActionEvaluationSchema = z
  .object({
    subscriptionId: z
      .string()
      .describe('Subscription this evaluation applies to.'),
    subscriptionActions: z
      .array(SubscriptionActionItemSchema)
      .describe(
        'Available billing action cards for this subscription. Each item represents an actionable UI card (e.g. update payment method, toggle auto-renew). The `ctaAction.actionJson.type` field identifies the action code. Empty array means no actions are currently available.',
      ),
  })
  .passthrough()
  .describe(
    'Per-subscription evaluation of which billing actions are currently permitted.',
  );

// ============================================================================
// renewSubscription
// ============================================================================

export const renewSubscriptionSchema = {
  name: 'renewSubscription',
  description:
    'Renew one or more subscriptions immediately ("renew now"), extending their paid-through date by another term.',
  notes:
    "⚠ Incurs a real charge — confirm with the user before calling. Charges the subscription's payment method on file; use updateSubscriptionPayment first if the method is missing or wrong. Renews exactly the subscription ids you pass.",
  input: z.object({
    subscriptionIds: z
      .array(z.string())
      .min(1)
      .describe(
        'One or more subscription ids to renew now (from listSubscriptions).',
      ),
    itc: z
      .string()
      .optional()
      .describe(
        'Impression tracking code sent to the renew endpoint for analytics attribution. The UI sends "account_myrenewals_single" for a single-card renew. Omit to send no tracking code.',
      ),
  }),
  output: z.object({
    renewed: z
      .array(z.string())
      .describe('Subscription ids the renewal was accepted for.'),
  }),
};

// ============================================================================
// updateSubscriptionPayment
// ============================================================================

export const updateSubscriptionPaymentSchema = {
  name: 'updateSubscriptionPayment',
  description:
    'Change the payment method (payment profile) used to renew one or more subscriptions.',
  notes:
    "No charge — repoints future renewals at a different saved payment profile. Changes billing setup, so confirm with the user before calling. paymentProfileId comes from the account's saved payment profiles (see listPaymentProfiles). FREEMIUM subscriptions cannot have a payment method assigned and will throw an error. Requires at least one saved payment profile on the account.",
  input: z.object({
    subscriptionIds: z
      .array(z.string())
      .min(1)
      .describe(
        'One or more subscription ids to repoint (from listSubscriptions).',
      ),
    paymentProfileId: z
      .string()
      .describe(
        'Saved payment profile id to bill future renewals against (from listPaymentProfiles).',
      ),
  }),
  output: z.object({
    updated: z
      .array(
        z.object({
          subscriptionId: z
            .string()
            .describe('Subscription whose payment method changed.'),
          paymentProfileId: z
            .string()
            .describe('Payment profile now set for renewals.'),
        }),
      )
      .describe('Subscriptions whose renewal payment method was changed.'),
  }),
};

// ============================================================================
// cancelSubscription
// ============================================================================

export const cancelSubscriptionSchema = {
  name: 'cancelSubscription',
  description:
    'Cancel (delete) one or more subscriptions, stopping all future renewals for them.',
  notes:
    '⚠ Destructive — confirm with the user before calling. Cancelling stops renewals and can end the underlying service (domains, hosting, email, etc.); it is not a refund request.',
  input: z.object({
    subscriptionIds: z
      .array(z.string())
      .min(1)
      .describe(
        'One or more subscription ids to cancel (from listSubscriptions).',
      ),
  }),
  output: z.object({
    cancelled: z
      .array(z.string())
      .describe('Subscription ids the cancellation was accepted for.'),
  }),
};

// ============================================================================
// checkSubscriptionActions
// ============================================================================

export const checkSubscriptionActionsSchema = {
  name: 'checkSubscriptionActions',
  description:
    'Evaluate which billing actions (renew, cancel, change payment, toggle auto-renew) are currently permitted for one or more subscriptions.',
  notes:
    'Read-only; no charge. Uses the renewals management surface — pass subscriptionIds from listSubscriptions or listRenewals. Each evaluation always returns a `subscriptionActions` array; an empty array means no actions are currently available. Call before renewSubscription, cancelSubscription, updateSubscriptionPayment, or setSubscriptionAutoRenew to confirm the action is allowed. Action type codes (in `ctaAction.actionJson.type`) are backend-defined — treat as opaque.',
  input: z.object({
    subscriptionIds: z
      .array(z.string())
      .min(1)
      .describe(
        'One or more subscription ids to evaluate (from listSubscriptions).',
      ),
    autoRenew: z
      .boolean()
      .optional()
      .describe(
        "The target auto-renew state to evaluate actions for. Pass the desired auto-renew intent; the API may return different action sets based on this value and the subscription's current billing state. Omit to default to false.",
      ),
  }),
  output: z.object({
    evaluations: z
      .array(SubscriptionActionEvaluationSchema)
      .describe(
        'One evaluation per subscription. Each entry has `subscriptionId` and `subscriptionActions` (always present; empty array if no actions available).',
      ),
  }),
};

// ============================================================================
// Registry + inferred output types
// ============================================================================

export const billingWriteSchemas = [
  renewSubscriptionSchema,
  updateSubscriptionPaymentSchema,
  cancelSubscriptionSchema,
  checkSubscriptionActionsSchema,
];

export type RenewSubscriptionOutput = z.infer<
  typeof renewSubscriptionSchema.output
>;
export type UpdateSubscriptionPaymentOutput = z.infer<
  typeof updateSubscriptionPaymentSchema.output
>;
export type CancelSubscriptionOutput = z.infer<
  typeof cancelSubscriptionSchema.output
>;
export type CheckSubscriptionActionsOutput = z.infer<
  typeof checkSubscriptionActionsSchema.output
>;
