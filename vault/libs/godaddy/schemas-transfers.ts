import { z } from 'zod';

// ============================================================================
// Shared entity shapes
// ============================================================================

export const TransferSummarySchema = z
  .object({
    jobID: z
      .string()
      .optional()
      .describe(
        'Transfer job id. Pass to getTransferStatus or use domain names to cancel with cancelDomainTransfer.',
      ),
    domainName: z
      .string()
      .optional()
      .describe('Domain being transferred, when the entry is per-domain.'),
    status: z
      .string()
      .optional()
      .describe('Current registrar-transfer status. Treat as opaque text.'),
    transferType: z
      .string()
      .optional()
      .describe('Transfer type/category, when present.'),
    domainCount: z
      .number()
      .optional()
      .describe('Number of domains in this transfer batch, when reported.'),
    createDate: z
      .string()
      .optional()
      .describe('When the transfer was initiated (ISO string), when present.'),
  })
  .passthrough()
  .describe(
    'An in-progress incoming domain transfer (or transfer batch) into this GoDaddy account.',
  );

export const TransferDomainSchema = z
  .object({
    domainName: z.string().optional().describe('The domain name.'),
    displayName: z
      .string()
      .optional()
      .describe('Display name for the domain, when present.'),
    status: z
      .string()
      .optional()
      .describe('Per-domain transfer status. Treat as opaque text.'),
    statusCode: z
      .enum([
        'BAD_STATUS',
        'MISSING_AUTHCODE',
        'INVALID_AUTHCODE',
        'TRANSFER_DENIED',
      ])
      .optional()
      .describe(
        'Machine-readable status code indicating why a transfer is blocked or failing, when present.',
      ),
    jobID: z
      .string()
      .optional()
      .describe('Transfer job id this domain belongs to, when present.'),
    transferType: z
      .string()
      .optional()
      .describe('Transfer type/category, when present.'),
    expirationDate: z
      .string()
      .optional()
      .describe('Domain expiration date (ISO string), when present.'),
    losingRegistrar: z
      .string()
      .optional()
      .describe(
        'The registrar the domain is transferring away from, when present.',
      ),
    currentRegistrar: z
      .string()
      .optional()
      .describe(
        'Current registrar holding the domain (same as losingRegistrar), when present.',
      ),
    initiateDate: z
      .string()
      .optional()
      .describe('ISO date when the transfer was initiated, when present.'),
    modifyDate: z
      .string()
      .optional()
      .describe('ISO date of the last status update, when present.'),
    isLocked: z
      .boolean()
      .optional()
      .describe(
        'Whether the domain is registrar-locked, blocking the transfer.',
      ),
    reason: z
      .string()
      .optional()
      .describe(
        'Ineligibility or block reason code when the domain cannot be transferred (e.g. "TRANSFER_BLOCKED"). Present when status is BLOCKED or UNAVAILABLE.',
      ),
  })
  .passthrough()
  .describe('Per-domain status within an incoming domain transfer.');

export const TransferEligibilitySchema = z
  .object({
    domainName: z.string().describe('The domain name checked.'),
    eligible: z
      .boolean()
      .optional()
      .describe(
        'Whether the domain can currently be transferred into GoDaddy. true = AVAILABLE, false = UNAVAILABLE or BLOCKED.',
      ),
    status: z
      .enum(['AVAILABLE', 'UNAVAILABLE', 'BLOCKED'])
      .optional()
      .describe(
        'Transfer eligibility category. AVAILABLE = can transfer in (has pricing). UNAVAILABLE = ineligible (e.g. too new, already at GoDaddy, TLD not supported). BLOCKED = restricted by GoDaddy policy.',
      ),
    price: z
      .number()
      .optional()
      .describe(
        'Transfer-in sale price in micro-units (divide by 1,000,000 for the currency amount). Present only for AVAILABLE domains.',
      ),
    currency: z
      .string()
      .optional()
      .describe(
        'ISO currency code for pricing fields (e.g. "USD"). Present only for AVAILABLE domains.',
      ),
    reason: z
      .string()
      .optional()
      .describe(
        'Ineligibility reason code when status is UNAVAILABLE or BLOCKED (e.g. "CAN_REGISTER", "TLD_NOT_SUPPORTED").',
      ),
    transferInListPrice: z
      .number()
      .optional()
      .describe(
        'Transfer-in list (non-sale) price in micro-units. Present only for AVAILABLE domains.',
      ),
    transferInSalePrice: z
      .number()
      .optional()
      .describe(
        'Transfer-in sale price in micro-units (same as `price`). Present only for AVAILABLE domains.',
      ),
    transferInPfid: z
      .string()
      .optional()
      .describe(
        'GoDaddy product/pricing id for the transfer-in order. Present only for AVAILABLE domains.',
      ),
    transferInTerm: z
      .number()
      .optional()
      .describe(
        'Number of term units the transfer-in includes (typically 1). Present only for AVAILABLE domains.',
      ),
    transferInTermUnit: z
      .string()
      .optional()
      .describe(
        'Term unit for the transfer-in (e.g. "YEAR"). Present only for AVAILABLE domains.',
      ),
    extendListPrice: z
      .number()
      .optional()
      .describe(
        'List price in micro-units for the optional 1-year extension on top of the transfer. Present only for AVAILABLE domains.',
      ),
    extendSalePrice: z
      .number()
      .optional()
      .describe(
        'Sale price in micro-units for the optional 1-year extension. Present only for AVAILABLE domains.',
      ),
    extendTerm: z
      .number()
      .optional()
      .describe(
        'Number of term units for the extension (typically 1). Present only for AVAILABLE domains.',
      ),
    extendTermUnit: z
      .string()
      .optional()
      .describe(
        'Term unit for the extension (e.g. "YEAR"). Present only for AVAILABLE domains.',
      ),
  })
  .passthrough()
  .describe(
    'Per-domain transfer-in eligibility, pricing, and status category.',
  );

// ============================================================================
// listIncomingTransfers
// ============================================================================

export const listIncomingTransfersSchema = {
  name: 'listIncomingTransfers',
  description:
    'List in-progress incoming domain transfers — domains being transferred INTO this GoDaddy account from another registrar — with each job id and current status.',
  notes:
    'Returns an empty list when no incoming transfers are in progress. "Incoming" means transfers into this account; stop one with cancelDomainTransfer using direction "incoming".',
  input: z.object({}),
  output: z.object({
    transfers: z
      .array(TransferSummarySchema)
      .describe('In-progress incoming transfers.'),
    total: z.number().describe('Number of incoming transfers returned.'),
  }),
};

// ============================================================================
// getTransferStatus
// ============================================================================

export const getTransferStatusSchema = {
  name: 'getTransferStatus',
  description:
    'Get the detailed status of an incoming domain transfer, by transfer job id and/or domain name, including the per-domain transfer state.',
  notes:
    'Provide jobID (from listIncomingTransfers) and/or domainName; at least one is required. Change-of-account (COA) transfers between GoDaddy accounts are keyed by a guid, not a jobID.',
  input: z.object({
    jobID: z
      .string()
      .optional()
      .describe('Transfer job id from listIncomingTransfers.'),
    domainName: z
      .string()
      .optional()
      .describe('A single domain to scope the status to.'),
    domainNames: z
      .array(z.string())
      .optional()
      .describe(
        'Multiple domains to scope the status to. Use instead of domainName when checking several domains at once.',
      ),
  }),
  output: z.object({
    domains: z
      .array(TransferDomainSchema)
      .describe('Per-domain transfer status for the matched transfer.'),
    total: z.number().describe('Number of domains in the transfer.'),
  }),
};

// ============================================================================
// checkTransferEligibility
// ============================================================================

export const checkTransferEligibilitySchema = {
  name: 'checkTransferEligibility',
  description:
    'Check whether one or more domains are eligible to transfer into GoDaddy and get the transfer-in price for each. Does not start a transfer.',
  notes:
    'A domain must be unlocked at its current registrar and past the 60-day post-registration / post-transfer lock to be eligible. Returns per-domain eligibility (AVAILABLE / UNAVAILABLE / BLOCKED) plus pricing for eligible domains. Prices are micro-units — divide by 1,000,000 for the currency amount.',
  input: z.object({
    domainNames: z
      .array(z.string())
      .min(1)
      .describe('Domains to check for transfer-in eligibility and price.'),
    authCodes: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Optional map of domainName → auth/EPP code. Providing auth codes allows more precise eligibility validation. Keys must match entries in domainNames.',
      ),
  }),
  output: z.object({
    domains: z
      .array(TransferEligibilitySchema)
      .describe('Per-domain eligibility, status, and pricing.'),
    total: z.number().describe('Total number of domains returned.'),
    eligibleCount: z
      .number()
      .optional()
      .describe('Number of domains eligible for transfer (status AVAILABLE).'),
    unavailableCount: z
      .number()
      .optional()
      .describe(
        'Number of domains not eligible for transfer (status UNAVAILABLE).',
      ),
    blockedCount: z
      .number()
      .optional()
      .describe(
        'Number of domains blocked by GoDaddy policy (status BLOCKED).',
      ),
    totalTransferFee: z
      .number()
      .optional()
      .describe(
        'Sum of transfer-in list prices for all AVAILABLE domains, in micro-units.',
      ),
    totalTransferSalePrice: z
      .number()
      .optional()
      .describe(
        'Sum of transfer-in sale prices for all AVAILABLE domains, in micro-units.',
      ),
    totalExtensionFee: z
      .number()
      .optional()
      .describe(
        'Sum of extension list prices for all AVAILABLE domains, in micro-units.',
      ),
    totalExtensionSalePrice: z
      .number()
      .optional()
      .describe(
        'Sum of extension sale prices for all AVAILABLE domains, in micro-units.',
      ),
  }),
};

// ============================================================================
// startDomainTransferIn
// ============================================================================

export const startDomainTransferInSchema = {
  name: 'startDomainTransferIn',
  description:
    'Start transferring one or more domains INTO this GoDaddy account by submitting each domain’s authorization (EPP/auth) code.',
  notes:
    '⚠ Incurs a real charge — each transfer-in is a paid order (the transfer fee typically includes one year of registration). Confirm with the user before calling with dryRun=false; use dryRun=true to validate without charging or submitting. Each domain must be unlocked at its current registrar with a valid auth/EPP code and past the 60-day transfer lock. Check eligibility first with checkTransferEligibility.',
  input: z.object({
    domains: z
      .array(
        z.object({
          domainName: z.string().describe('The domain to transfer in.'),
          authCode: z
            .string()
            .describe(
              'Authorization/EPP code obtained from the current registrar.',
            ),
        }),
      )
      .min(1)
      .describe('Domain + auth code pairs to transfer in.'),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate the transfer without submitting or charging. Defaults to false.',
      ),
  }),
  output: z.object({
    jobID: z
      .string()
      .optional()
      .describe('Transfer job id for the submitted batch, when returned.'),
    domains: z
      .array(TransferDomainSchema)
      .describe('Per-domain submission result.'),
    dryRun: z
      .boolean()
      .describe('Whether this was a dry run (no charge / no submission).'),
  }),
};

// ============================================================================
// prepareDomainForTransferOut
// ============================================================================

export const prepareDomainForTransferOutSchema = {
  name: 'prepareDomainForTransferOut',
  description:
    'Prepare a domain to be transferred out to another registrar: unlock it and retrieve its authorization (EPP/auth) code.',
  notes:
    'Returns the auth/EPP code to give the gaining registrar, when the TLD exposes one. Use dryRun=true to validate without applying changes. The domain must be unlocked and past the 60-day transfer lock for the transfer to proceed at the other registrar.',
  input: z.object({
    domainName: z.string().describe('The domain to prepare for transfer out.'),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate without applying changes. Defaults to false.',
      ),
  }),
  output: z.object({
    domainName: z.string().describe('The domain prepared.'),
    authCode: z
      .string()
      .optional()
      .describe(
        'The authorization/EPP code to hand to the gaining registrar, when exposed.',
      ),
    status: z
      .string()
      .optional()
      .describe(
        'Resulting state of the prepare-for-transfer-out request, when present.',
      ),
    dryRun: z.boolean().describe('Whether this was a dry run.'),
  }),
};

// ============================================================================
// transferDomainToAccount
// ============================================================================

export const transferDomainToAccountSchema = {
  name: 'transferDomainToAccount',
  description:
    'Transfer ownership of one or more domains to another GoDaddy account (change-of-account / COA push). The recipient must accept the transfer.',
  notes:
    'COA moves domains between GoDaddy accounts — DNS stays with the domain by default, but connected products (email/website) do NOT move. The recipient accepts via acceptDomainTransfer using the returned guid. Use dryRun=true to validate without initiating.',
  input: z.object({
    domainNames: z
      .array(z.string())
      .min(1)
      .describe('Domains to push to the recipient account.'),
    recipient: z
      .string()
      .describe(
        'Receiving GoDaddy account email address (gainingShopperEmail).',
      ),
    recipientShopperId: z
      .string()
      .optional()
      .describe(
        'Numeric shopper ID of the receiving GoDaddy account. Providing this alongside recipient email reduces the chance of misrouted transfers.',
      ),
    allowCurrentContacts: z
      .boolean()
      .optional()
      .describe(
        "When true, keep the domain's existing registrant/admin contacts after the transfer instead of using the recipient account's defaults. Defaults to false.",
      ),
    isCancellable: z
      .boolean()
      .optional()
      .describe(
        'Whether the transfer can be cancelled after initiation. Defaults to true.',
      ),
    migrateDNS: z
      .boolean()
      .optional()
      .describe(
        'Whether DNS zone settings should migrate to the receiving account along with the domain. Defaults to true.',
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate without initiating the transfer. Defaults to false.',
      ),
  }),
  output: z.object({
    guid: z
      .string()
      .optional()
      .describe(
        'Account-change guid for the initiated transfer. Pass to acceptDomainTransfer / cancelDomainTransfer.',
      ),
    domains: z
      .array(z.string())
      .describe('Domains included in the transfer request.'),
    dryRun: z.boolean().describe('Whether this was a dry run.'),
  }),
};

// ============================================================================
// acceptDomainTransfer
// ============================================================================

export const acceptDomainTransferSchema = {
  name: 'acceptDomainTransfer',
  description:
    'Accept a pending incoming domain transfer — a registrar transfer (by auth codes) or a change-of-account transfer from another GoDaddy account (by guid).',
  notes:
    'For registrar transfers: provide codes (array of { authorizationCode, domainName } pairs). For change-of-account transfers: provide guid (from transferDomainToAccount run by the sender). Provide exactly one of codes or guid.',
  input: z.object({
    codes: z
      .array(
        z.object({
          authorizationCode: z
            .string()
            .describe(
              'The EPP/authorization code for the domain, obtained from the current registrar.',
            ),
          domainName: z
            .string()
            .describe('The domain name being transferred in.'),
        }),
      )
      .optional()
      .describe(
        'Auth-code pairs for accepting incoming registrar transfers. Each entry pairs a domain name with its EPP/authorization code. Use for registrar-to-GoDaddy transfers; obtain auth codes from the current registrar.',
      ),
    guid: z
      .string()
      .optional()
      .describe('Change-of-account transfer guid to accept.'),
  }),
  output: z.object({
    accepted: z
      .boolean()
      .describe('Whether the accept request was submitted successfully.'),
    guid: z
      .string()
      .optional()
      .describe('Echo of the accepted account-change guid, when provided.'),
  }),
};

// ============================================================================
// cancelDomainTransfer
// ============================================================================

export const cancelDomainTransferSchema = {
  name: 'cancelDomainTransfer',
  description:
    'Cancel in-progress domain transfers — registrar transfers (domain moving between registrars) or change-of-account/ownership transfers (domain moving between GoDaddy accounts) — in the given direction.',
  notes:
    'The API cancels by domain name filter, not by a specific transfer ID. Use domainNames + selectionType to cancel specific domains; omit to cancel all matching transfers. statuses applies to registrar transfers only. direction is "incoming" (transfer INTO this account) or "outgoing" (transfer OUT of this account). transferKind is "registrar" (a registrar-to-registrar transfer initiated via startDomainTransferIn or prepareDomainForTransferOut) or "ownership" (a GoDaddy change-of-account initiated via transferDomainToAccount).',
  input: z.object({
    transferKind: z
      .enum(['registrar', 'ownership'])
      .describe(
        '"registrar" = a registrar-to-registrar transfer (use for transfers initiated with startDomainTransferIn or prepareDomainForTransferOut); "ownership" = a change-of-account between GoDaddy accounts (use for transfers initiated with transferDomainToAccount).',
      ),
    direction: z
      .enum(['incoming', 'outgoing'])
      .describe(
        '"incoming" = transfer into this account; "outgoing" = transfer away from this account.',
      ),
    domainNames: z
      .array(z.string())
      .optional()
      .describe(
        'Specific domain names to cancel. Combined with selectionType. Omit to cancel all matching transfers in that direction.',
      ),
    selectionType: z
      .enum(['INCLUDE', 'EXCLUDE'])
      .optional()
      .describe(
        '"INCLUDE" = cancel only the listed domainNames; "EXCLUDE" = cancel all domains EXCEPT the listed ones. Defaults to "INCLUDE".',
      ),
    statuses: z
      .array(z.number())
      .optional()
      .describe(
        'Filter to only cancel registrar transfers with these numeric status IDs (registrar transfers only; ignored for ownership transfers). Known IDs: 5=initiated, 6=inprogress, 7=transferDenied, 17=invalidAuthcode, 18=failed, 22=transferPendWhois, 25=missingAuthcode, 57=badStatus, 67=sixtyDayLock, 172=registryLock, 206=transferPrivatePendWhois.',
      ),
  }),
  output: z.object({
    cancelled: z
      .boolean()
      .describe('Whether the cancel request was submitted successfully.'),
    direction: z
      .enum(['incoming', 'outgoing'])
      .describe('The direction that was cancelled.'),
    transferKind: z
      .enum(['registrar', 'ownership'])
      .describe('The transfer kind that was cancelled.'),
  }),
};

// ============================================================================
// Registry + inferred output types
// ============================================================================

export const transfersSchemas = [
  listIncomingTransfersSchema,
  getTransferStatusSchema,
  checkTransferEligibilitySchema,
  startDomainTransferInSchema,
  prepareDomainForTransferOutSchema,
  transferDomainToAccountSchema,
  acceptDomainTransferSchema,
  cancelDomainTransferSchema,
];

export type TransferSummary = z.infer<typeof TransferSummarySchema>;
export type TransferDomain = z.infer<typeof TransferDomainSchema>;
export type TransferEligibility = z.infer<typeof TransferEligibilitySchema>;

export type ListIncomingTransfersOutput = z.infer<
  typeof listIncomingTransfersSchema.output
>;
export type GetTransferStatusOutput = z.infer<
  typeof getTransferStatusSchema.output
>;
export type CheckTransferEligibilityOutput = z.infer<
  typeof checkTransferEligibilitySchema.output
>;
export type StartDomainTransferInOutput = z.infer<
  typeof startDomainTransferInSchema.output
>;
export type PrepareDomainForTransferOutOutput = z.infer<
  typeof prepareDomainForTransferOutSchema.output
>;
export type TransferDomainToAccountOutput = z.infer<
  typeof transferDomainToAccountSchema.output
>;
export type AcceptDomainTransferOutput = z.infer<
  typeof acceptDomainTransferSchema.output
>;
export type CancelDomainTransferOutput = z.infer<
  typeof cancelDomainTransferSchema.output
>;
