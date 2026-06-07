import { z } from 'zod';
import { AuthParam, FolderSummarySchema } from './shared';

// ============================================================================
// listFolders
// ============================================================================

export const listFoldersSchema = {
  name: 'listFolders',
  description: 'List mail folders and their hierarchy',
  notes: '',
  input: z.object({
    auth: AuthParam,
    parentFolderId: z
      .string()
      .optional()
      .default('msgfolderroot')
      .describe(
        'Parent folder ID to list children of. Use "msgfolderroot" for the top-level root (default), or any well-known name: "inbox", "drafts", "sentitems", "deleteditems", "junkemail". Also accepts a raw folder ID from a previous listFolders call.',
      ),
    traversal: z
      .enum(['Shallow', 'Deep'])
      .optional()
      .default('Shallow')
      .describe(
        'Traversal depth. "Shallow" returns only immediate children; "Deep" returns all descendants recursively.',
      ),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (0-indexed)'),
    maxCount: z
      .number()
      .optional()
      .default(100)
      .describe('Maximum number of folders to return'),
    searchQuery: z
      .string()
      .optional()
      .describe(
        'Search folders by display name. Case-insensitive substring match. Example: "sent" matches "Sent Items". When set with traversal "Deep", searches all nested folders recursively.',
      ),
    folderClassFilter: z
      .string()
      .optional()
      .describe(
        'Filter folders by class using prefix matching. Common values: "IPF.Note" (mail folders), "IPF.Appointment" (calendar), "IPF.Contact" (contacts), "IPF.Task" (tasks), "IPF.StickyNote" (notes). Prefix-matched, so "IPF.Contact" also matches "IPF.Contact.GalContacts". Combine with traversal "Deep" to find all matching folders recursively.',
      ),
    returnParentFolder: z
      .boolean()
      .optional()
      .describe(
        'When true, includes the parent folder details (ID and display name) in the response. Useful for understanding folder hierarchy.',
      ),
  }),
  output: z.object({
    folders: z.array(FolderSummarySchema),
    totalCount: z
      .number()
      .describe('Total number of folders matching the query'),
    moreAvailable: z
      .boolean()
      .describe('Whether more folders exist beyond this page'),
    parentFolder: z
      .object({
        folderId: z.string().describe('Immutable parent folder ID'),
        displayName: z.string().describe('Parent folder display name'),
      })
      .optional()
      .describe(
        'Parent folder details. Only present when returnParentFolder is true.',
      ),
  }),
};

// ============================================================================
// getFolder
// ============================================================================

export const FolderEffectiveRightsSchema = z.object({
  createAssociated: z
    .boolean()
    .describe('Can create FAI (folder-associated information) items'),
  createContents: z.boolean().describe('Can create items in the folder'),
  createHierarchy: z.boolean().describe('Can create subfolders'),
  delete: z.boolean().describe('Can delete the folder'),
  modify: z.boolean().describe('Can modify folder properties'),
  read: z.boolean().describe('Can read items in the folder'),
  viewPrivateItems: z.boolean().describe('Can view items marked as private'),
});

export const getFolderSchema = {
  name: 'getFolder',
  description: 'Get details for a specific mail folder by ID',
  notes: '',
  input: z.object({
    auth: AuthParam,
    folderId: z
      .string()
      .describe(
        'Folder ID or well-known name: "inbox", "drafts", "sentitems", "deleteditems", "junkemail", "msgfolderroot". Use a raw ID from listFolders for custom folders.',
      ),
    includeParentFolder: z
      .boolean()
      .optional()
      .describe(
        'When true, includes the parent folder ID in the response. Useful for navigating folder hierarchy.',
      ),
    includePermissions: z
      .boolean()
      .optional()
      .describe(
        'When true, includes effective rights (create, delete, modify, read permissions) in the response.',
      ),
    includeDistinguishedFolderId: z
      .boolean()
      .optional()
      .describe(
        'When true, includes the well-known folder name (e.g. "inbox", "drafts") in the response. Only set for built-in folders; custom folders will not have this field.',
      ),
  }),
  output: FolderSummarySchema.extend({
    parentFolderId: z
      .string()
      .optional()
      .describe(
        'Immutable ID of the parent folder. Only present when includeParentFolder is true.',
      ),
    effectiveRights: FolderEffectiveRightsSchema.optional().describe(
      'Effective permissions for the current user. Only present when includePermissions is true.',
    ),
    distinguishedFolderId: z
      .string()
      .optional()
      .describe(
        'Well-known folder name (e.g. "inbox", "drafts", "sentitems"). Only present when includeDistinguishedFolderId is true and the folder is a built-in folder.',
      ),
  }),
};

// ============================================================================
// createFolder
// ============================================================================

export const createFolderSchema = {
  name: 'createFolder',
  description: 'Create a new mail folder under a specified parent folder',
  notes: '',
  input: z.object({
    auth: AuthParam,
    parentFolderId: z
      .string()
      .describe(
        'Parent folder ID. Use "inbox" to create under Inbox, "msgfolderroot" for a top-level folder, or a raw folder ID from listFolders.',
      ),
    displayName: z.string().describe('Display name for the new folder'),
    folderType: z
      .enum([
        'Folder',
        'SearchFolder',
        'ContactsFolder',
        'CalendarFolder',
        'TasksFolder',
      ])
      .optional()
      .describe(
        'EWS folder type to create. "Folder" (default) creates a standard mail folder. "SearchFolder" creates a virtual folder that dynamically shows messages matching a search filter (requires searchFilter and searchBaseFolderIds). "ContactsFolder", "CalendarFolder", and "TasksFolder" create typed folders for their respective item types.',
      ),
    searchFilter: z
      .object({})
      .passthrough()
      .optional()
      .describe(
        'EWS search restriction for SearchFolder type. Raw EWS filter object with __type discriminators. Example for subject substring match: {"__type":"Contains:#Exchange","ContainmentMode":"Substring","ContainmentComparison":"IgnoreCase","Item":{"__type":"PropertyUri:#Exchange","FieldURI":"item:Subject"},"Constant":{"__type":"ConstantValueType:#Exchange","Value":"important"}}. Supports Contains, IsEqualTo, IsGreaterThan, Exists, And, Or, Not filters. Only used when folderType is "SearchFolder".',
      ),
    searchBaseFolderIds: z
      .array(z.string())
      .optional()
      .describe(
        'Folder IDs or well-known names to search across when creating a SearchFolder. Accepts the same values as parentFolderId: "inbox", "sentitems", "drafts", "deleteditems", "junkemail", "msgfolderroot", or raw folder IDs. Only used when folderType is "SearchFolder".',
      ),
    searchTraversal: z
      .enum(['Shallow', 'Deep'])
      .optional()
      .describe(
        'Search traversal depth for SearchFolder. "Shallow" searches only the specified base folders; "Deep" searches base folders and all their subfolders recursively. Only used when folderType is "SearchFolder". Defaults to "Deep".',
      ),
    folderClass: z
      .string()
      .optional()
      .describe(
        'Folder class to assign. Common values: "IPF.Note" (mail, default if omitted), "IPF.Appointment" (calendar), "IPF.Contact" (contacts), "IPF.Task" (tasks), "IPF.StickyNote" (notes).',
      ),
    policyTag: z
      .string()
      .optional()
      .describe(
        'Retention policy tag GUID to apply to the folder. Only effective on org/Exchange accounts with Messaging Records Management (MRM) retention policies configured. The GUID must match an existing retention tag in the organization.',
      ),
    archiveTag: z
      .string()
      .optional()
      .describe(
        'Archive policy tag GUID to apply to the folder. Only effective on org/Exchange accounts with in-place archive enabled and archive policies configured. The GUID must match an existing archive tag in the organization.',
      ),
    retentionTag: z
      .string()
      .optional()
      .describe(
        'Retention tag GUID to apply to the folder. Distinct from policyTag and archiveTag; this is the default retention tag for items in the folder. Only effective on org/Exchange accounts with Messaging Records Management (MRM) retention policies configured. The GUID must match an existing retention tag in the organization.',
      ),
    color: z
      .enum([
        'Cranberry',
        'Peach',
        'Gold',
        'Bronze',
        'Lime',
        'DarkGreen',
        'LightTeal',
        'DarkTeal',
        'LightBlue',
        'DarkBlue',
        'Lavender',
        'DarkPurple',
        'Pink',
        'Magenta',
        'Silver',
      ])
      .optional()
      .describe(
        'Folder icon color displayed in the Outlook sidebar. Maps to the named extended property "http://schemas.microsoft.com/outlookservices/model/color" in the PublicStrings property set.',
      ),
    hidden: z
      .boolean()
      .optional()
      .describe(
        'When true, hides the folder from the default folder tree in Outlook. Sets the MAPI extended property PR_ATTR_HIDDEN (0x10F4). Hidden folders are still accessible via their folder ID.',
      ),
    description: z
      .string()
      .optional()
      .describe(
        'A text comment/description for the folder. Sets the MAPI extended property PR_COMMENT (0x3004). Not displayed in the Outlook UI but stored on the folder and readable via EWS/MAPI.',
      ),
  }),
  output: z.object({
    folderId: z.string().describe('Immutable ID of the newly created folder'),
    displayName: z
      .string()
      .describe('Display name of the newly created folder'),
  }),
};

// ============================================================================
// deleteFolder
// ============================================================================

export const deleteFolderSchema = {
  name: 'deleteFolder',
  description: 'Delete a mail folder',
  notes: '',
  input: z.object({
    auth: AuthParam,
    folderId: z
      .string()
      .describe(
        'Folder ID to delete. Use a raw ID from listFolders; well-known folders (inbox, drafts, etc.) cannot be deleted.',
      ),
    deleteType: z
      .enum(['MoveToDeletedItems', 'SoftDelete', 'HardDelete'])
      .optional()
      .default('MoveToDeletedItems')
      .describe(
        'How to delete: MoveToDeletedItems moves to trash (default), SoftDelete recoverable delete, HardDelete permanent.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the folder was successfully deleted'),
  }),
};

// ============================================================================
// renameFolder
// ============================================================================

export const renameFolderSchema = {
  name: 'renameFolder',
  description: 'Rename a mail folder',
  notes: '',
  input: z.object({
    auth: AuthParam,
    folderId: z
      .string()
      .describe(
        'Folder ID to rename. Use a raw ID from listFolders; well-known folders (inbox, drafts, etc.) cannot be renamed.',
      ),
    displayName: z.string().describe('New display name for the folder'),
    policyTag: z
      .string()
      .optional()
      .describe(
        'Retention policy tag GUID to set on the folder alongside the rename. Only effective on org/Exchange accounts with Messaging Records Management (MRM) retention policies configured. The GUID must match an existing retention tag in the organization.',
      ),
    archiveTag: z
      .string()
      .optional()
      .describe(
        'Archive policy tag GUID to set on the folder alongside the rename. Only effective on org/Exchange accounts with in-place archive enabled and archive policies configured. The GUID must match an existing archive tag in the organization.',
      ),
  }),
  output: z.object({
    folderId: z.string().describe('ID of the renamed folder'),
    displayName: z.string().describe('New display name of the folder'),
  }),
};

// ============================================================================
// Inferred Types
// ============================================================================

export type ListFoldersInput = z.infer<typeof listFoldersSchema.input>;
export type ListFoldersOutput = z.infer<typeof listFoldersSchema.output>;
export type GetFolderInput = z.infer<typeof getFolderSchema.input>;
export type GetFolderOutput = z.infer<typeof getFolderSchema.output>;
export type FolderEffectiveRights = z.infer<typeof FolderEffectiveRightsSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema.input>;
export type CreateFolderOutput = z.infer<typeof createFolderSchema.output>;
export type DeleteFolderInput = z.infer<typeof deleteFolderSchema.input>;
export type DeleteFolderOutput = z.infer<typeof deleteFolderSchema.output>;
export type RenameFolderInput = z.infer<typeof renameFolderSchema.input>;
export type RenameFolderOutput = z.infer<typeof renameFolderSchema.output>;
