import { z } from 'zod';

// ============================================================================
// Shared Parameter Schemas
// ============================================================================

export const DscParam = z
  .string()
  .describe(
    'CSRF token from getContext().dsc. Required in body of all mutations (POST/PUT/DELETE). Do not construct manually; always use the value returned by getContext().',
  );

export const BoardIdParam = z
  .string()
  .describe(
    'Board ID. Accepts either the 24-char hex ID (e.g. "69bda4b55fba1e0392ebbe06") or the short link slug (e.g. "JRX8Zj2a"). Prefer the full ID when available.',
  );

export const ListIdParam = z
  .string()
  .describe('List ID (24-char hex string, e.g. "69bdb29d0c22c993d1baec71")');

export const CardIdParam = z
  .string()
  .describe(
    'Card ID. Accepts either the 24-char hex ID (e.g. "69bdcbdd4728655d7a90a2de") or the short link slug (e.g. "0LjYXtFD"). Prefer the full ID when available.',
  );

export const MemberIdParam = z
  .string()
  .describe('Member ID (24-char hex string, e.g. "69bda4368774f2a15baa5421")');

export const LabelIdParam = z
  .string()
  .describe('Label ID (24-char hex string, e.g. "69bda4b75fba1e0392ebc087")');

// ============================================================================
// Shared Entity Schemas
// ============================================================================

export const BoardSchema = z.object({
  id: BoardIdParam,
  name: z.string().describe('Board display name'),
  shortLink: z
    .string()
    .optional()
    .describe(
      'Short URL identifier used in board URLs (e.g. "JRX8Zj2a"). May be absent when fetched via member embed.',
    ),
  url: z
    .string()
    .optional()
    .describe(
      'Full URL of the board. May be absent when fetched via member embed.',
    ),
  closed: z.boolean().describe('Whether the board is archived'),
  idOrganization: z
    .string()
    .nullable()
    .describe('Workspace/organization ID the board belongs to'),
  starred: z
    .boolean()
    .describe('Whether the current member has starred this board'),
});

export const OrganizationSchema = z.object({
  id: z.string().describe('Organization/workspace ID'),
  displayName: z.string().describe('Human-readable workspace name'),
  name: z.string().describe('URL slug for the workspace'),
  url: z.string().optional().describe('URL of the workspace'),
});

export const ListSchema = z
  .object({
    id: ListIdParam,
    name: z.string().describe('List display name'),
    pos: z
      .number()
      .describe('Position of the list on the board (lower = further left)'),
    closed: z.boolean().describe('Whether the list is archived'),
    color: z.string().nullable().describe('List color label, or null if unset'),
    idBoard: BoardIdParam,
    subscribed: z
      .boolean()
      .describe('Whether the current member is subscribed to this list'),
    softLimit: z
      .number()
      .nullable()
      .describe('Soft card limit for the list, or null if not set'),
    type: z
      .string()
      .nullable()
      .describe('List type identifier, or null for standard lists'),
    datasource: z
      .object({ filter: z.boolean() })
      .describe('List datasource configuration'),
    cards: z
      .array(z.object({}).passthrough())
      .optional()
      .describe(
        'Embedded cards when the "cards" parameter is specified. Each element is a card object (same shape as CardSchema). Absent when the cards parameter is omitted.',
      ),
    board: z
      .object({})
      .passthrough()
      .optional()
      .describe(
        'Embedded parent board object when board=true is passed to getList. Fields depend on board_fields param; by default includes id, name, shortLink, url, closed, and other board fields.',
      ),
  })
  .passthrough();

export const LabelSchema = z.object({
  id: LabelIdParam,
  name: z
    .string()
    .describe('Label display name (may be empty string for unnamed labels)'),
  color: z
    .string()
    .nullable()
    .describe(
      'Label color. Values: yellow, purple, blue, red, green, orange, black, sky, pink, lime, or null',
    ),
  idBoard: BoardIdParam,
  uses: z.number().describe('Number of cards currently using this label'),
});

export const CardMemberSchema = z.object({
  id: MemberIdParam,
  username: z.string().describe('Member username'),
  fullName: z.string().describe('Member display name'),
  initials: z.string().describe('Member initials'),
  avatarUrl: z.string().nullable().describe('Avatar image URL'),
});

export const CardLabelSchema = z.object({
  id: LabelIdParam,
  idBoard: BoardIdParam,
  name: z.string().describe('Label name'),
  color: z.string().nullable().describe('Label color'),
});

export const CardSchema = z
  .object({
    id: CardIdParam,
    name: z.string().describe('Card title'),
    desc: z.string().describe('Card description (Markdown)'),
    idList: ListIdParam,
    idBoard: BoardIdParam,
    idMembers: z
      .array(z.string())
      .describe('Array of member IDs assigned to this card'),
    labels: z.array(CardLabelSchema).describe('Labels applied to this card'),
    due: z.string().nullable().describe('Due date as ISO 8601 string, or null'),
    dueComplete: z
      .boolean()
      .describe('Whether the due date is marked complete'),
    start: z
      .string()
      .nullable()
      .describe('Start date as ISO 8601 string, or null if not set'),
    pos: z.number().describe('Card position within its list'),
    closed: z.boolean().describe('Whether the card is archived'),
    shortLink: z.string().describe('Short URL identifier (e.g. "hBgYe85T")'),
    url: z.string().describe('Full card URL'),
    badges: z
      .object({
        checkItems: z.number().describe('Total checklist items'),
        checkItemsChecked: z.number().describe('Completed checklist items'),
        comments: z.number().describe('Comment count'),
        attachments: z.number().describe('Attachment count'),
      })
      .passthrough()
      .describe('Card badge counts'),
  })
  .passthrough();

export const AttachmentSchema = z.object({
  id: z.string().describe('Attachment ID'),
  name: z.string().describe('Attachment file name or URL title'),
  url: z.string().describe('Direct URL of the attachment resource'),
  mimeType: z
    .string()
    .describe('MIME type (e.g. "image/png"). Empty string if unknown.'),
  bytes: z
    .number()
    .nullable()
    .describe('File size in bytes, or null for URL-only links'),
  date: z.string().describe('Upload date as ISO 8601 string'),
  isUpload: z
    .boolean()
    .describe('True if this is a file upload; false for URL links'),
  edgeColor: z
    .string()
    .nullable()
    .describe('Dominant edge color for image previews, or null'),
  idMember: z.string().describe('ID of the member who added this attachment'),
  isMalicious: z
    .boolean()
    .describe('True if Trello flagged this attachment as malicious'),
  previews: z
    .array(z.object({}).passthrough())
    .describe(
      'Preview image variants (thumbnail, full-size, etc.); empty array if no previews available',
    ),
  sourceView: z.string().nullable().describe('Source view identifier, or null'),
  pos: z
    .number()
    .describe('Position of this attachment among card attachments'),
  fileName: z
    .string()
    .describe(
      'Original filename for uploaded files; extracted filename for URL attachments; empty string if not applicable',
    ),
});
