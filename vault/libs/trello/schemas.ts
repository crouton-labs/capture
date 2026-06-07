export const libraryDescription =
  'Trello operations: boards, lists, cards, labels, members, comments, checklists, and search';

export const libraryIcon = '/icons/libs/trello.png';
export const loginUrl = 'https://trello.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://trello.com\`
2. Call \`getContext()\` to get \`{ dsc, memberId, username, fullName }\`
3. Use \`dsc\` as a required body field in every write operation (POST/PUT/DELETE)
4. Use \`memberId\` to scope member-based queries

## Auth Pattern

Trello uses cookie-based session auth with a \`dsc\` CSRF token sent in the **request body** of all mutations. This is the Double Submit Cookie pattern; the token is NOT sent in a header. Call \`getContext()\` before any write operation to obtain the current \`dsc\` value.

## Key Concepts

- **Board**: Top-level container with lists and cards. Identified by \`id\` or \`shortLink\` (URL slug).
- **List**: A column on a board. Cards belong to lists.
- **Card**: The atomic work unit. Has name, description, due date, members, labels, checklists, comments.
- **Label**: Color-coded tag defined per board. Must exist on a board before being added to a card.
- **Member**: A Trello user. Board-level and card-level assignment are separate.

## Rate Limits

100 requests per 10 seconds per token. Bulk operations must loop single-item endpoints; pace with delays to avoid 429s.

## Pagination

Offset-based for most list endpoints: \`limit\` param (max ~1000). Cursor-based for activity/actions endpoints: \`before\` param (last action ID).

## Plan Constraints

Custom Fields require Standard+ plan. Requests to \`/1/boards/:id/customFields\` return 403 on free boards.
`;

// Re-export all shared params and entity schemas from params.ts
export {
  DscParam,
  BoardIdParam,
  ListIdParam,
  CardIdParam,
  MemberIdParam,
  LabelIdParam,
  BoardSchema,
  OrganizationSchema,
  ListSchema,
  LabelSchema,
  CardMemberSchema,
  CardLabelSchema,
  CardSchema,
  AttachmentSchema,
} from './params';

// ============================================================================
// All Schemas: assembled here so build-libs.ts can import schemas.allSchemas
// ============================================================================

import { membersSchemas } from './members/schemas';
import { boardsSchemas } from './boards/schemas';
import { listsSchemas } from './lists/schemas';
import { cardsSchemas } from './cards/schemas';
import { labelsSchemas } from './labels/schemas';
import { commentsSchemas } from './comments/schemas';
import { checklistsSchemas } from './checklists/schemas';
import { miscSchemas } from './misc/schemas';

export const allSchemas = [
  ...membersSchemas,
  ...boardsSchemas,
  ...listsSchemas,
  ...cardsSchemas,
  ...labelsSchemas,
  ...commentsSchemas,
  ...checklistsSchemas,
  ...miscSchemas,
];
