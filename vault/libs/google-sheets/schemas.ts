import { z } from 'zod';

export const libraryDescription =
  'Google Sheets spreadsheet management via internal Drive v2 APIs';

export const libraryIcon = '/icons/libs/google-sheets.png';
export const loginUrl = 'https://docs.google.com/spreadsheets/';

export const libraryNotes = `
## Workflow

1. Navigate to any Google Sheets URL (\`/spreadsheets/\`, \`/spreadsheets/u/{N}/\`, or an open sheet \`/spreadsheets/d/{id}/edit\`)
2. Call \`getContext()\` to get \`{ account, email, displayName }\`
3. Pass \`account\` to \`createSheet\`; \`writeCell\` and \`readRange\` use same-origin cookies and don't need it

## Key Concepts

- **account**: 0-indexed account number. Google supports multi-account sessions; \`account\` selects which one for Drive-level operations like \`createSheet\`.
- **spreadsheetId**: Unique ID in the sheet URL \`/spreadsheets/d/{spreadsheetId}/edit\`. Pass this to future functions that read/write the sheet.
- New sheets land in the user's Drive (root "My Drive" by default). Pass \`parentFolderId\` to place the sheet in a specific Drive folder.

## Finding Existing Sheets

- If the user has a sheet open in the browser, call \`getCurrentSheet()\` — returns the spreadsheetId of the currently viewed sheet without an API call.
- To search all sheets by name, use \`google-drive.listFiles\` with \`mimeType: 'application/vnd.google-apps.spreadsheet'\` and a \`query\`.
`;

// ============================================================================
// Shared Parameter Schemas
// ============================================================================

export const AccountParam = z
  .number()
  .int()
  .min(0)
  .describe(
    'Account number from URL /u/{N}/ (0-indexed). Get from getContext.',
  );

// ============================================================================
// Function Schemas
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get authentication context and user info for Google Sheets. Call first before any other function.',
  notes: '',
  input: z.object({}),
  output: z.object({
    account: z.number().describe('Account index (0-indexed) from URL /u/{N}/'),
    email: z.string().describe('User email address'),
    displayName: z.string().describe('User display name'),
  }),
};

export type GetContextOutput = z.infer<typeof getContextSchema.output>;

export const createSheetSchema = {
  name: 'createSheet',
  description:
    'Create a new blank Google Sheet. Returns the spreadsheetId and URL.',
  notes: '',
  input: z.object({
    account: AccountParam,
    title: z.string().describe('Title for the new spreadsheet'),
    parentFolderId: z
      .string()
      .optional()
      .describe(
        'Drive folder ID to create the sheet in. Omit to create in root "My Drive".',
      ),
  }),
  output: z.object({
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID'),
    title: z.string().describe('Title of the created sheet'),
    url: z
      .string()
      .describe(
        'URL to open the sheet in a browser (/spreadsheets/d/{id}/edit)',
      ),
    createdDate: z.string().describe('ISO 8601 creation timestamp'),
  }),
};

export type CreateSheetInput = z.infer<typeof createSheetSchema.input>;
export type CreateSheetOutput = z.infer<typeof createSheetSchema.output>;

export const addSheetSchema = {
  name: 'addSheet',
  description:
    'Add a new tab (sheet page) to an existing Google Sheets spreadsheet. Returns the new tab name, gid, and index.',
  notes:
    'Tab titles must be unique within a spreadsheet. Throws if a tab with the same title already exists. New tab is appended after existing tabs.',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z
      .string()
      .describe(
        'Google Sheets spreadsheet ID. Get from createSheet, getCurrentSheet, or google-drive.listFiles.',
      ),
    title: z.string().describe('Title for the new tab.'),
    rowCount: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Initial row count for the new tab. Default 1000.'),
    columnCount: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Initial column count for the new tab. Default 26.'),
  }),
  output: z.object({
    spreadsheetId: z.string().describe('Spreadsheet the tab was added to'),
    title: z.string().describe('Title of the new tab'),
    gid: z
      .number()
      .describe('Persistent tab ID (used in sheet URLs as #gid=N)'),
    index: z.number().describe('0-indexed position of the new tab'),
  }),
};

export type AddSheetInput = z.infer<typeof addSheetSchema.input>;
export type AddSheetOutput = z.infer<typeof addSheetSchema.output>;

export const deleteSheetSchema = {
  name: 'deleteSheet',
  description: 'Delete a tab from a Google Sheets spreadsheet.',
  notes:
    'Throws when attempting to delete the only remaining tab (spreadsheets must have at least one tab).',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
    sheetName: z.string().describe('Name of the tab to delete.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    deletedSheetName: z.string(),
    deletedGid: z.number(),
  }),
};

export type DeleteSheetInput = z.infer<typeof deleteSheetSchema.input>;
export type DeleteSheetOutput = z.infer<typeof deleteSheetSchema.output>;

export const renameSheetSchema = {
  name: 'renameSheet',
  description: 'Rename a tab in a Google Sheets spreadsheet.',
  notes:
    'Tab titles must be unique within a spreadsheet. Throws if another tab already has the new title.',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
    sheetName: z.string().describe('Current name of the tab.'),
    newTitle: z.string().describe('New title for the tab.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    oldTitle: z.string(),
    newTitle: z.string(),
    gid: z.number(),
  }),
};

export type RenameSheetInput = z.infer<typeof renameSheetSchema.input>;
export type RenameSheetOutput = z.infer<typeof renameSheetSchema.output>;

export const moveSheetSchema = {
  name: 'moveSheet',
  description: 'Move a tab to a different position in the tab order.',
  notes:
    'toIndex is the final desired 0-indexed position (0 = first tab, N-1 = last tab). Out-of-range values are clamped to valid positions.',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
    sheetName: z.string().describe('Name of the tab to move.'),
    toIndex: z
      .number()
      .int()
      .min(0)
      .describe('Final 0-indexed position after the move.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    sheetName: z.string(),
    fromIndex: z.number(),
    toIndex: z.number(),
  }),
};

export type MoveSheetInput = z.infer<typeof moveSheetSchema.input>;
export type MoveSheetOutput = z.infer<typeof moveSheetSchema.output>;

export const duplicateSheetSchema = {
  name: 'duplicateSheet',
  description:
    "Duplicate a tab: create a new tab containing copies of the source tab's values. Returns the new tab's gid and index.",
  notes:
    'Only cell values are copied. Formatting (bold, colors, merges, data validation, conditional formatting) does NOT transfer — the new tab uses default formatting. Default new title is "Copy of {sourceTab}"; override with newTitle.',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
    sheetName: z.string().describe('Name of the tab to duplicate.'),
    newTitle: z
      .string()
      .optional()
      .describe(
        'Title for the duplicate tab. Defaults to "Copy of {sheetName}".',
      ),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    sourceSheetName: z.string(),
    newSheetName: z.string(),
    newGid: z.number(),
    newIndex: z.number(),
    copiedCells: z.number(),
  }),
};

export type DuplicateSheetInput = z.infer<typeof duplicateSheetSchema.input>;
export type DuplicateSheetOutput = z.infer<typeof duplicateSheetSchema.output>;

export const HorizontalAlignEnum = z.enum(['LEFT', 'CENTER', 'RIGHT']);

export const formatRangeSchema = {
  name: 'formatRange',
  description:
    'Apply formatting to a range of cells. Multiple properties can be set in one call.',
  notes:
    'Only specified properties are applied; omitted properties leave existing formatting unchanged. Colors are hex strings like "#FF0000" (red) or "#0000FF" (blue). numberFormat uses Sheets patterns like "#,##0.00" (number), "$#,##0.00" (currency), "0.00%" (percent), "yyyy-mm-dd" (date).',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
    range: z
      .string()
      .describe(
        'A1 range like "A1", "A1:C10", or "Sheet2!B2:D5". Formatting applies to every cell in the range.',
      ),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    fontFamily: z
      .string()
      .optional()
      .describe('Font name, e.g. "Arial", "Roboto", "Caveat".'),
    fontSize: z.number().int().min(1).optional(),
    textColor: z.string().optional().describe('Hex color like "#FF0000".'),
    backgroundColor: z
      .string()
      .optional()
      .describe('Hex color like "#0000FF".'),
    horizontalAlign: HorizontalAlignEnum.optional(),
    numberFormat: z
      .string()
      .optional()
      .describe('Format pattern, e.g. "#,##0.00", "$#,##0.00", "0.00%".'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    updatedRange: z.string(),
    appliedProperties: z
      .array(z.string())
      .describe('Names of the format properties that were applied.'),
  }),
};

export type FormatRangeInput = z.infer<typeof formatRangeSchema.input>;
export type FormatRangeOutput = z.infer<typeof formatRangeSchema.output>;

const StructuralSharedInput = {
  account: AccountParam,
  spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
  sheetName: z.string().describe('Name of the tab to modify.'),
};

export const insertRowsSchema = {
  name: 'insertRows',
  description: 'Insert blank rows into a tab, pushing existing rows down.',
  notes: '',
  input: z.object({
    ...StructuralSharedInput,
    startIndex: z
      .number()
      .int()
      .min(0)
      .describe(
        '0-indexed position. Existing row at this index and below is shifted down by `count` rows.',
      ),
    count: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Number of rows to insert. Default 1.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    sheetName: z.string(),
    insertedAt: z.number(),
    count: z.number(),
  }),
};
export type InsertRowsInput = z.infer<typeof insertRowsSchema.input>;
export type InsertRowsOutput = z.infer<typeof insertRowsSchema.output>;

export const insertColumnsSchema = {
  name: 'insertColumns',
  description:
    'Insert blank columns into a tab, pushing existing columns right.',
  notes: '',
  input: z.object({
    ...StructuralSharedInput,
    startIndex: z
      .number()
      .int()
      .min(0)
      .describe('0-indexed position (A=0, B=1, C=2, ...).'),
    count: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Number of columns to insert. Default 1.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    sheetName: z.string(),
    insertedAt: z.number(),
    count: z.number(),
  }),
};
export type InsertColumnsInput = z.infer<typeof insertColumnsSchema.input>;
export type InsertColumnsOutput = z.infer<typeof insertColumnsSchema.output>;

export const deleteRowsSchema = {
  name: 'deleteRows',
  description: 'Delete rows from a tab. Rows below shift up.',
  notes: '',
  input: z.object({
    ...StructuralSharedInput,
    startIndex: z
      .number()
      .int()
      .min(0)
      .describe('0-indexed position of the first row to delete.'),
    count: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Number of rows to delete. Default 1.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    sheetName: z.string(),
    deletedAt: z.number(),
    count: z.number(),
  }),
};
export type DeleteRowsInput = z.infer<typeof deleteRowsSchema.input>;
export type DeleteRowsOutput = z.infer<typeof deleteRowsSchema.output>;

export const deleteColumnsSchema = {
  name: 'deleteColumns',
  description: 'Delete columns from a tab. Columns to the right shift left.',
  notes: '',
  input: z.object({
    ...StructuralSharedInput,
    startIndex: z
      .number()
      .int()
      .min(0)
      .describe(
        '0-indexed position (A=0, B=1, ...) of the first column to delete.',
      ),
    count: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Number of columns to delete. Default 1.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    sheetName: z.string(),
    deletedAt: z.number(),
    count: z.number(),
  }),
};
export type DeleteColumnsInput = z.infer<typeof deleteColumnsSchema.input>;
export type DeleteColumnsOutput = z.infer<typeof deleteColumnsSchema.output>;

export const resizeRowsSchema = {
  name: 'resizeRows',
  description: 'Set the pixel height of one or more rows.',
  notes: '',
  input: z.object({
    ...StructuralSharedInput,
    startIndex: z.number().int().min(0),
    count: z.number().int().min(1).optional(),
    pixelHeight: z
      .number()
      .int()
      .min(1)
      .describe('Row height in pixels. Default row height is 21.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    sheetName: z.string(),
    resizedRows: z.number(),
    pixelHeight: z.number(),
  }),
};
export type ResizeRowsInput = z.infer<typeof resizeRowsSchema.input>;
export type ResizeRowsOutput = z.infer<typeof resizeRowsSchema.output>;

export const resizeColumnsSchema = {
  name: 'resizeColumns',
  description: 'Set the pixel width of one or more columns.',
  notes: '',
  input: z.object({
    ...StructuralSharedInput,
    startIndex: z.number().int().min(0),
    count: z.number().int().min(1).optional(),
    pixelWidth: z
      .number()
      .int()
      .min(1)
      .describe('Column width in pixels. Default column width is 100.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    sheetName: z.string(),
    resizedColumns: z.number(),
    pixelWidth: z.number(),
  }),
};
export type ResizeColumnsInput = z.infer<typeof resizeColumnsSchema.input>;
export type ResizeColumnsOutput = z.infer<typeof resizeColumnsSchema.output>;

export const setRowsVisibilitySchema = {
  name: 'setRowsVisibility',
  description: 'Hide or unhide a range of rows.',
  notes: '',
  input: z.object({
    ...StructuralSharedInput,
    startIndex: z.number().int().min(0),
    count: z.number().int().min(1).optional(),
    hidden: z.boolean().describe('true to hide, false to unhide.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    sheetName: z.string(),
    hidden: z.boolean(),
    rangeStart: z.number(),
    rangeEnd: z.number(),
  }),
};
export type SetRowsVisibilityInput = z.infer<
  typeof setRowsVisibilitySchema.input
>;
export type SetRowsVisibilityOutput = z.infer<
  typeof setRowsVisibilitySchema.output
>;

export const setColumnsVisibilitySchema = {
  name: 'setColumnsVisibility',
  description: 'Hide or unhide a range of columns.',
  notes: '',
  input: z.object({
    ...StructuralSharedInput,
    startIndex: z.number().int().min(0),
    count: z.number().int().min(1).optional(),
    hidden: z.boolean().describe('true to hide, false to unhide.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    sheetName: z.string(),
    hidden: z.boolean(),
    rangeStart: z.number(),
    rangeEnd: z.number(),
  }),
};
export type SetColumnsVisibilityInput = z.infer<
  typeof setColumnsVisibilitySchema.input
>;
export type SetColumnsVisibilityOutput = z.infer<
  typeof setColumnsVisibilitySchema.output
>;

export const freezeRowsSchema = {
  name: 'freezeRows',
  description:
    'Freeze the top N rows of a tab so they stay visible while scrolling. Pass count=0 to unfreeze.',
  notes: '',
  input: z.object({
    ...StructuralSharedInput,
    count: z
      .number()
      .int()
      .min(0)
      .describe('Number of rows to freeze from the top. 0 unfreezes.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    sheetName: z.string(),
    frozenRows: z.number(),
  }),
};
export type FreezeRowsInput = z.infer<typeof freezeRowsSchema.input>;
export type FreezeRowsOutput = z.infer<typeof freezeRowsSchema.output>;

export const clearRangeSchema = {
  name: 'clearRange',
  description: 'Clear values from a range of cells. Formatting is preserved.',
  notes: '',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
    range: z.string().describe('A1 range, e.g. "A1:C10" or "Sheet2!B2:D5".'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    clearedRange: z.string(),
  }),
};
export type ClearRangeInput = z.infer<typeof clearRangeSchema.input>;
export type ClearRangeOutput = z.infer<typeof clearRangeSchema.output>;

export const mergeCellsSchema = {
  name: 'mergeCells',
  description: 'Merge a range of cells into one.',
  notes:
    "Only the top-left cell's value is preserved; other values in the range are discarded.",
  input: z.object({
    account: AccountParam,
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
    range: z.string().describe('A1 range to merge, e.g. "A1:C1".'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    mergedRange: z.string(),
  }),
};
export type MergeCellsInput = z.infer<typeof mergeCellsSchema.input>;
export type MergeCellsOutput = z.infer<typeof mergeCellsSchema.output>;

export const unmergeCellsSchema = {
  name: 'unmergeCells',
  description: 'Split previously merged cells back into individual cells.',
  notes: '',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
    range: z
      .string()
      .describe('A1 range containing the merged cells to split.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    unmergedRange: z.string(),
  }),
};
export type UnmergeCellsInput = z.infer<typeof unmergeCellsSchema.input>;
export type UnmergeCellsOutput = z.infer<typeof unmergeCellsSchema.output>;

export const setCellNoteSchema = {
  name: 'setCellNote',
  description:
    'Attach a plain-text note to a single cell (the yellow triangle indicator). Pass an empty string to clear.',
  notes: '',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
    cell: z.string().describe('A1 notation for a single cell, e.g. "A1".'),
    note: z.string().describe('Note text. Empty string clears the note.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    cell: z.string(),
    note: z.string(),
  }),
};
export type SetCellNoteInput = z.infer<typeof setCellNoteSchema.input>;
export type SetCellNoteOutput = z.infer<typeof setCellNoteSchema.output>;

export const setHyperlinkSchema = {
  name: 'setHyperlink',
  description: 'Turn a single cell into a clickable hyperlink.',
  notes:
    'displayText is what the user sees; url is where the link points. If displayText is omitted it defaults to the url.',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
    cell: z.string().describe('A1 notation for a single cell, e.g. "A1".'),
    url: z.string().describe('Target URL, e.g. "https://example.com".'),
    displayText: z
      .string()
      .optional()
      .describe('Link text shown in the cell. Defaults to url.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    cell: z.string(),
    url: z.string(),
    displayText: z.string(),
  }),
};
export type SetHyperlinkInput = z.infer<typeof setHyperlinkSchema.input>;
export type SetHyperlinkOutput = z.infer<typeof setHyperlinkSchema.output>;

export const findAndReplaceSchema = {
  name: 'findAndReplace',
  description:
    'Find all cells matching a string and replace matches with new text. Scans the specified tab or every tab.',
  notes:
    'Runs against current cell values (as the user sees them). Replaced cells are rewritten; formulas are NOT evaluated, only their text is matched.',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
    find: z.string().describe('Text to search for.'),
    replace: z.string().describe('Replacement text.'),
    sheetName: z
      .string()
      .optional()
      .describe('Limit the search to a single tab. Omit to search every tab.'),
    matchCase: z
      .boolean()
      .optional()
      .describe('true for case-sensitive match. Default false.'),
    matchEntireCell: z
      .boolean()
      .optional()
      .describe(
        'true requires the entire cell to equal `find`. false replaces substrings. Default false.',
      ),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    replacements: z.number().describe('Number of cells that were changed.'),
  }),
};
export type FindAndReplaceInput = z.infer<typeof findAndReplaceSchema.input>;
export type FindAndReplaceOutput = z.infer<typeof findAndReplaceSchema.output>;

export const createBasicFilterSchema = {
  name: 'createBasicFilter',
  description:
    'Create a basic filter on a range. Users can then sort and filter columns within that range.',
  notes:
    'A tab can only have one basic filter at a time. Returns a filterId used to remove the filter later.',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
    range: z.string().describe('A1 range the filter covers, e.g. "A1:D100".'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    filterId: z
      .number()
      .describe('Filter ID; pass to removeBasicFilter to tear it down.'),
    range: z.string(),
  }),
};
export type CreateBasicFilterInput = z.infer<
  typeof createBasicFilterSchema.input
>;
export type CreateBasicFilterOutput = z.infer<
  typeof createBasicFilterSchema.output
>;

export const removeBasicFilterSchema = {
  name: 'removeBasicFilter',
  description: 'Remove a basic filter from a tab.',
  notes: '',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID.'),
    sheetName: z.string().describe('Name of the tab whose filter to remove.'),
    filterId: z.number().describe('Filter ID returned by createBasicFilter.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    sheetName: z.string(),
    removedFilterId: z.number(),
  }),
};
export type RemoveBasicFilterInput = z.infer<
  typeof removeBasicFilterSchema.input
>;
export type RemoveBasicFilterOutput = z.infer<
  typeof removeBasicFilterSchema.output
>;

export const getCurrentSheetSchema = {
  name: 'getCurrentSheet',
  description:
    'Get the spreadsheetId of the sheet currently open in the browser. Use when the user refers to "this sheet" or "the one I have open".',
  notes:
    'Reads window.location and document.title — no API call. Throws if the user is not viewing a specific sheet (e.g., on sheets home or a non-sheets page).',
  input: z.object({}),
  output: z.object({
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID'),
    title: z
      .string()
      .describe(
        'Sheet title from the browser tab. Pass spreadsheetId to google-drive.getFile for authoritative metadata.',
      ),
    url: z.string().describe('Full URL of the sheet'),
  }),
};

export type GetCurrentSheetOutput = z.infer<
  typeof getCurrentSheetSchema.output
>;

export const writeCellSchema = {
  name: 'writeCell',
  description: 'Write a value to a single cell in a Google Sheet.',
  notes:
    'Uses USER_ENTERED input mode: values are parsed as if typed in the UI. Strings starting with "=" become formulas; "10%" becomes 0.1; "$5" is formatted as currency.',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z
      .string()
      .describe(
        'Google Sheets spreadsheet ID. Get from createSheet, getCurrentSheet, or google-drive.listFiles.',
      ),
    cell: z
      .string()
      .describe(
        'A1 notation for the cell. "A1" targets the first tab; prefix with tab name for others (e.g., "Sheet2!A1" or "\'My Tab\'!B5").',
      ),
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .describe('Value to write. Strings starting with "=" become formulas.'),
  }),
  output: z.object({
    spreadsheetId: z.string().describe('Sheet that was updated'),
    updatedRange: z
      .string()
      .describe(
        'Fully-qualified A1 range that was updated (e.g., "Sheet1!A1")',
      ),
    updatedCells: z
      .number()
      .describe('Number of cells updated (always 1 for writeCell)'),
  }),
};

export type WriteCellInput = z.infer<typeof writeCellSchema.input>;
export type WriteCellOutput = z.infer<typeof writeCellSchema.output>;

export const writeRangeSchema = {
  name: 'writeRange',
  description:
    'Write a 2D array of values to a range of cells in a single request. More efficient than repeated writeCell calls.',
  notes:
    'Values are written in row-major order starting at the top-left of the range. Pass range as "A1" (top-left, size inferred from values) or "A1:C3" (top-left determines position; extents derived from values dimensions). Null/undefined cells in values are skipped (existing cell content unchanged). Uses USER_ENTERED parsing: strings starting with "=" become formulas; "10%" becomes 0.1.',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z
      .string()
      .describe(
        'Google Sheets spreadsheet ID. Get from createSheet, getCurrentSheet, or google-drive.listFiles.',
      ),
    range: z
      .string()
      .describe(
        'A1 notation for the top-left anchor. Examples: "A1", "A1:C3", "Sheet2!B2", "\'My Tab\'!B2". Dimensions are derived from values.',
      ),
    values: z
      .array(
        z.array(
          z
            .union([z.string(), z.number(), z.boolean()])
            .nullable()
            .describe(
              'Cell value. null/undefined skips the cell (leaves existing content unchanged).',
            ),
        ),
      )
      .describe(
        'Row-major 2D array. All rows must have the same length. Empty values array throws.',
      ),
  }),
  output: z.object({
    spreadsheetId: z.string().describe('Sheet that was updated'),
    updatedRange: z
      .string()
      .describe(
        'Fully-qualified A1 range spanning the written cells (e.g., "Sheet1!A1:C3")',
      ),
    updatedCells: z
      .number()
      .describe('Number of non-null cells that were written.'),
  }),
};

export type WriteRangeInput = z.infer<typeof writeRangeSchema.input>;
export type WriteRangeOutput = z.infer<typeof writeRangeSchema.output>;

export const readRangeSchema = {
  name: 'readRange',
  description:
    'Read values from a Google Sheet. Accepts a single cell, a range, or a whole tab.',
  notes:
    'Trailing empty rows/columns are omitted from the response — the values array may be shorter than the requested range. To read a whole tab, pass the tab name with no cell reference (e.g., "Sheet1"). For a single cell, pass "A1" (first tab) or "Sheet2!A1".',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z
      .string()
      .describe(
        'Google Sheets spreadsheet ID. Get from createSheet, getCurrentSheet, or google-drive.listFiles.',
      ),
    range: z
      .string()
      .describe(
        'A1 notation. Examples: "A1" (one cell), "A1:C10" (rectangle), "Sheet2!B2:D5" (range on named tab), "Sheet1" (entire tab).',
      ),
    renderOption: z
      .enum(['FORMATTED_VALUE', 'UNFORMATTED_VALUE'])
      .optional()
      .describe(
        'How to render values. FORMATTED_VALUE (default): displayed text like "$5.00". UNFORMATTED_VALUE: raw typed value (numbers as numbers, booleans as booleans).',
      ),
  }),
  output: z.object({
    range: z
      .string()
      .describe(
        'Fully-qualified A1 range that was read (e.g., "Sheet1!A1:C10")',
      ),
    values: z
      .array(z.array(z.union([z.string(), z.number(), z.boolean()])))
      .describe(
        'Row-major 2D array of cell values. Trailing empty cells/rows are omitted. Empty tab returns [].',
      ),
  }),
};

export type ReadRangeInput = z.infer<typeof readRangeSchema.input>;
export type ReadRangeOutput = z.infer<typeof readRangeSchema.output>;

export const readSheetSchema = {
  name: 'readSheet',
  description:
    'Get a structured summary of an entire spreadsheet: title, list of tabs, and cell contents per tab (truncated). Use for unfamiliar sheets or to confirm what was written.',
  notes:
    'Returns formatted cell values (what the user sees, not raw numbers). For raw values or a specific range, use readRange instead. Per-tab row cap is maxRows (default 50) — tabs exceeding it set truncated=true so the caller knows more data exists.',
  input: z.object({
    account: AccountParam,
    spreadsheetId: z
      .string()
      .describe(
        'Google Sheets spreadsheet ID. Get from createSheet, getCurrentSheet, or google-drive.listFiles.',
      ),
    sheetName: z
      .string()
      .optional()
      .describe(
        'Restrict summary to a single tab by name. Omit to summarize every tab in the spreadsheet.',
      ),
    maxRows: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Per-tab row cap for the returned values array. Default 50. Tabs with more rows set truncated=true.',
      ),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    title: z.string().describe('Spreadsheet title'),
    tabs: z
      .array(
        z.object({
          name: z.string().describe('Tab name'),
          gid: z
            .number()
            .describe('Tab persistent ID (used in sheet URLs as #gid=N)'),
          rowCount: z
            .number()
            .describe('Total rows containing data in this tab'),
          columnCount: z
            .number()
            .describe('Total columns in the returned table'),
          values: z
            .array(
              z.array(
                z
                  .union([z.string(), z.number(), z.boolean()])
                  .nullable()
                  .describe('null indicates an empty cell'),
              ),
            )
            .describe(
              'Row-major 2D array of formatted values, capped at maxRows rows.',
            ),
          truncated: z
            .boolean()
            .describe('True when rowCount exceeds maxRows; values is sliced.'),
        }),
      )
      .describe(
        'One entry per tab (or a single entry if sheetName was provided).',
      ),
  }),
};

export type ReadSheetInput = z.infer<typeof readSheetSchema.input>;
export type ReadSheetOutput = z.infer<typeof readSheetSchema.output>;

export const batchUpdateCommandSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('writeCell'),
    cell: z
      .string()
      .describe(
        'A1 notation for the cell. "A1" targets the first tab; prefix with tab name for others (e.g., "Sheet2!A1" or "\'My Tab\'!B5").',
      ),
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .describe('Value to write. Strings starting with "=" become formulas.'),
  }),
  z.object({
    op: z.literal('addSheet'),
    title: z.string(),
    rowCount: z.number().int().min(1).optional(),
    columnCount: z.number().int().min(1).optional(),
  }),
  z.object({
    op: z.literal('deleteSheet'),
    sheetName: z.string(),
  }),
  z.object({
    op: z.literal('renameSheet'),
    sheetName: z.string(),
    newTitle: z.string(),
  }),
  z.object({
    op: z.literal('moveSheet'),
    sheetName: z.string(),
    toIndex: z.number().int().min(0),
  }),
  z.object({
    op: z.literal('formatRange'),
    range: z.string(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    fontFamily: z.string().optional(),
    fontSize: z.number().int().min(1).optional(),
    textColor: z.string().optional(),
    backgroundColor: z.string().optional(),
    horizontalAlign: HorizontalAlignEnum.optional(),
    numberFormat: z.string().optional(),
  }),
  z.object({
    op: z.literal('insertRows'),
    sheetName: z.string(),
    startIndex: z.number().int().min(0),
    count: z.number().int().min(1).optional(),
  }),
  z.object({
    op: z.literal('insertColumns'),
    sheetName: z.string(),
    startIndex: z.number().int().min(0),
    count: z.number().int().min(1).optional(),
  }),
  z.object({
    op: z.literal('deleteRows'),
    sheetName: z.string(),
    startIndex: z.number().int().min(0),
    count: z.number().int().min(1).optional(),
  }),
  z.object({
    op: z.literal('deleteColumns'),
    sheetName: z.string(),
    startIndex: z.number().int().min(0),
    count: z.number().int().min(1).optional(),
  }),
  z.object({
    op: z.literal('resizeRows'),
    sheetName: z.string(),
    startIndex: z.number().int().min(0),
    count: z.number().int().min(1).optional(),
    pixelHeight: z.number().int().min(1),
  }),
  z.object({
    op: z.literal('resizeColumns'),
    sheetName: z.string(),
    startIndex: z.number().int().min(0),
    count: z.number().int().min(1).optional(),
    pixelWidth: z.number().int().min(1),
  }),
  z.object({
    op: z.literal('setRowsVisibility'),
    sheetName: z.string(),
    startIndex: z.number().int().min(0),
    count: z.number().int().min(1).optional(),
    hidden: z.boolean(),
  }),
  z.object({
    op: z.literal('setColumnsVisibility'),
    sheetName: z.string(),
    startIndex: z.number().int().min(0),
    count: z.number().int().min(1).optional(),
    hidden: z.boolean(),
  }),
  z.object({
    op: z.literal('freezeRows'),
    sheetName: z.string(),
    count: z.number().int().min(0),
  }),
  z.object({
    op: z.literal('clearRange'),
    range: z.string(),
  }),
  z.object({
    op: z.literal('mergeCells'),
    range: z.string(),
  }),
  z.object({
    op: z.literal('unmergeCells'),
    range: z.string(),
  }),
  z.object({
    op: z.literal('setCellNote'),
    cell: z.string(),
    note: z.string(),
  }),
  z.object({
    op: z.literal('setHyperlink'),
    cell: z.string(),
    url: z.string(),
    displayText: z.string().optional(),
  }),
]);

export const batchUpdateSchema = {
  name: 'batchUpdate',
  description:
    'Apply multiple sheet operations in a single atomic request. All commands succeed or fail together, producing one spreadsheet revision.',
  notes:
    "Commands apply in array order; later commands see earlier commands' effects. Use this when scattered cells or mixed-tab writes must be atomic. For a rectangular region prefer writeRange; for one cell prefer writeCell.",
  input: z.object({
    account: AccountParam,
    spreadsheetId: z
      .string()
      .describe(
        'Google Sheets spreadsheet ID. Get from createSheet, getCurrentSheet, or google-drive.listFiles.',
      ),
    commands: z
      .array(batchUpdateCommandSchema)
      .min(1)
      .describe('Commands to apply atomically, in order.'),
  }),
  output: z.object({
    spreadsheetId: z.string(),
    appliedCommands: z.number().describe('Number of commands applied.'),
    revision: z
      .number()
      .describe('Spreadsheet revision after the batch completes.'),
  }),
};

export type BatchUpdateCommand = z.infer<typeof batchUpdateCommandSchema>;
export type BatchUpdateInput = z.infer<typeof batchUpdateSchema.input>;
export type BatchUpdateOutput = z.infer<typeof batchUpdateSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  getCurrentSheetSchema,
  createSheetSchema,
  addSheetSchema,
  deleteSheetSchema,
  renameSheetSchema,
  moveSheetSchema,
  duplicateSheetSchema,
  writeCellSchema,
  writeRangeSchema,
  readRangeSchema,
  readSheetSchema,
  formatRangeSchema,
  insertRowsSchema,
  insertColumnsSchema,
  deleteRowsSchema,
  deleteColumnsSchema,
  resizeRowsSchema,
  resizeColumnsSchema,
  setRowsVisibilitySchema,
  setColumnsVisibilitySchema,
  freezeRowsSchema,
  clearRangeSchema,
  mergeCellsSchema,
  unmergeCellsSchema,
  setCellNoteSchema,
  setHyperlinkSchema,
  findAndReplaceSchema,
  createBasicFilterSchema,
  removeBasicFilterSchema,
  batchUpdateSchema,
];
