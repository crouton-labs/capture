import { z } from 'zod';

export const libraryDescription =
  'Google Drive file management via internal v2 APIs';

export const libraryIcon = '/icons/libs/google-drive.png';
export const loginUrl = 'https://drive.google.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://drive.google.com\`
2. Call \`getContext()\` to get \`{ account, email, displayName, rootFolderId }\`
3. Pass \`account\` to every subsequent function

## Key Concepts

- **account**: 0-indexed account number from URL \`/u/{N}/\`. Required for all functions.
- **rootFolderId**: The ID of your "My Drive" root folder. Use as \`folderId\` to list top-level files.
- **Google format files** (Docs, Sheets, Slides) have no fileSize and must be exported (converted) when downloading.
- **Folders** have mimeType \`application/vnd.google-apps.folder\`.

## File Upload

Upload accepts either a \`fileRef\` (from Northlight files library) or raw \`content\` string.
- For binary files: use \`fileRef\` from a prior \`save()\` call
- For text content: pass \`content\` directly

## File Download

Download saves the file via Northlight files library and returns a \`fileRef\`.
- Native files (PDF, images): downloaded directly
- Google Docs/Sheets/Slides: exported to a standard format (PDF, XLSX, PPTX)

## Folder Upload (Large Directories)

Browser memory limits how many files can be uploaded in a single \`uploadFolder\` call. Exceeding ~20 files per call crashes the browser tab.

**Strategy for large directories:**
1. Call \`createFolder\` to create the root folder and any subfolders
2. Call \`uploadFolder\` in batches of ~15-20 files, each batch targeting the correct parent folder ID
3. Or for 100+ files: use \`createFolder\` for the tree, then \`uploadFile\` one file at a time

Never pre-load all files into a single \`uploadFolder\` call for directories with more than 20 files.

## Pagination

Auto-paginated. Set \`maxResults\` to control total items returned.
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
// Entity Schemas
// ============================================================================

export const DriveFileSchema = z.object({
  id: z.string().describe('Google Drive file ID'),
  title: z.string().describe('File or folder name'),
  mimeType: z
    .string()
    .describe('MIME type. Folders: application/vnd.google-apps.folder'),
  fileSize: z
    .number()
    .optional()
    .describe('File size in bytes. Undefined for Google Docs/Sheets/Slides.'),
  shared: z.boolean().describe('Whether file is shared with others'),
  createdDate: z.string().describe('ISO 8601 creation timestamp'),
  modifiedDate: z.string().describe('ISO 8601 last modification timestamp'),
  parentId: z.string().optional().describe('ID of parent folder'),
  ownerEmail: z.string().optional().describe('Email of file owner'),
  ownerName: z.string().optional().describe('Display name of file owner'),
  starred: z.boolean().optional().describe('Whether file is starred'),
  trashed: z.boolean().optional().describe('Whether file is in trash'),
  webViewLink: z.string().optional().describe('URL to view file in browser'),
  canEdit: z.boolean().optional().describe('Whether current user can edit'),
  canDelete: z.boolean().optional().describe('Whether current user can delete'),
  canShare: z.boolean().optional().describe('Whether current user can share'),
  canDownload: z
    .boolean()
    .optional()
    .describe('Whether current user can download'),
});

export type DriveFile = z.infer<typeof DriveFileSchema>;

// ============================================================================
// Function Schemas
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get authentication context and user info for Google Drive. Call first before any other function.',
  notes: '',
  input: z.object({}),
  output: z.object({
    account: z.number().describe('Account index (0-indexed) from URL /u/{N}/'),
    email: z.string().describe('User email address'),
    displayName: z.string().describe('User display name'),
    rootFolderId: z
      .string()
      .describe(
        'ID of the root "My Drive" folder. Use as folderId to list top-level files.',
      ),
  }),
};

export type GetContextOutput = z.infer<typeof getContextSchema.output>;

export const listFilesSchema = {
  name: 'listFiles',
  description:
    'List files and folders in Google Drive. Can filter by parent folder, MIME type, or search by name.',
  notes:
    'To list root folder contents, pass rootFolderId from getContext as folderId. To list only folders, set mimeType to "application/vnd.google-apps.folder".',
  input: z.object({
    account: AccountParam,
    folderId: z
      .string()
      .optional()
      .describe(
        'Parent folder ID to list contents of. Omit to search all files.',
      ),
    mimeType: z
      .string()
      .optional()
      .describe(
        'Filter by MIME type (e.g., "application/pdf", "application/vnd.google-apps.folder")',
      ),
    query: z
      .string()
      .optional()
      .describe('Search files by name (partial match)'),
    maxResults: z
      .number()
      .optional()
      .describe('Maximum files to return. Default 100.'),
  }),
  output: z.object({
    files: z.array(DriveFileSchema).describe('Array of file/folder objects'),
    totalCount: z.number().describe('Number of files returned'),
  }),
};

export type ListFilesInput = z.infer<typeof listFilesSchema.input>;
export type ListFilesOutput = z.infer<typeof listFilesSchema.output>;

export const uploadFileSchema = {
  name: 'uploadFile',
  description:
    'Upload a file to Google Drive. Provide either a fileRef (from Northlight files library) or raw text content.',
  notes:
    'For binary files, save them first with the files library, then pass the fileRef. For simple text, pass content directly.',
  input: z.object({
    account: AccountParam,
    filename: z.string().describe('Name for the file in Google Drive'),
    mimeType: z
      .string()
      .optional()
      .describe('MIME type of the file. Default: application/octet-stream'),
    parentFolderId: z
      .string()
      .optional()
      .describe('Folder ID to upload into. Omit for root folder.'),
    fileRef: z
      .string()
      .optional()
      .describe(
        'File reference from Northlight files library (from a prior save() call). Use for binary files.',
      ),
    content: z
      .string()
      .optional()
      .describe('Raw text content to upload. Use for simple text files.'),
  }),
  output: DriveFileSchema,
};

export type UploadFileInput = z.infer<typeof uploadFileSchema.input>;
export type UploadFileOutput = z.infer<typeof uploadFileSchema.output>;

export const downloadFileSchema = {
  name: 'downloadFile',
  description:
    'Download a file from Google Drive and save it via Northlight files library. For Google Docs/Sheets/Slides, exports to a standard format.',
  notes:
    'Google Docs → PDF (default), Sheets → XLSX, Slides → PPTX. Override with exportFormat parameter.',
  input: z.object({
    account: AccountParam,
    fileId: z.string().describe('Google Drive file ID to download'),
    exportFormat: z
      .string()
      .optional()
      .describe(
        'Export format for Google Docs/Sheets/Slides (e.g., "pdf", "docx", "xlsx", "pptx", "csv"). Ignored for native files.',
      ),
    saveAs: z
      .string()
      .optional()
      .describe('Filename to save as. Defaults to the file title in Drive.'),
  }),
  output: z.object({
    filename: z.string().describe('Name the file was saved as'),
    fileRef: z
      .any()
      .describe(
        'File reference from Northlight files library. Pass to load() to read.',
      ),
    mimeType: z.string().describe('MIME type of the downloaded file'),
    size: z.number().describe('File size in bytes'),
  }),
};

export type DownloadFileInput = z.infer<typeof downloadFileSchema.input>;
export type DownloadFileOutput = z.infer<typeof downloadFileSchema.output>;

export const getFileSchema = {
  name: 'getFile',
  description: 'Get detailed metadata for a single file or folder by ID.',
  notes: '',
  input: z.object({
    account: AccountParam,
    fileId: z.string().describe('Google Drive file ID'),
  }),
  output: DriveFileSchema,
};

export type GetFileInput = z.infer<typeof getFileSchema.input>;
export type GetFileOutput = z.infer<typeof getFileSchema.output>;

export const searchFilesSchema = {
  name: 'searchFiles',
  description:
    'Search files by content or name using full-text search. More powerful than listFiles query parameter.',
  notes:
    'Uses fullText search which searches file names AND content. For name-only search, use listFiles with query parameter instead.',
  input: z.object({
    account: AccountParam,
    query: z
      .string()
      .describe('Search query (searches file names and content)'),
    mimeType: z.string().optional().describe('Filter by MIME type'),
    folderId: z
      .string()
      .optional()
      .describe('Restrict search to a specific folder'),
    maxResults: z
      .number()
      .optional()
      .describe('Maximum files to return. Default 100.'),
  }),
  output: z.object({
    files: z.array(DriveFileSchema).describe('Matching files'),
    totalCount: z.number().describe('Number of files returned'),
  }),
};

export type SearchFilesInput = z.infer<typeof searchFilesSchema.input>;
export type SearchFilesOutput = z.infer<typeof searchFilesSchema.output>;

export const createFolderSchema = {
  name: 'createFolder',
  description: 'Create a new folder in Google Drive.',
  notes: '',
  input: z.object({
    account: AccountParam,
    name: z.string().describe('Folder name'),
    parentFolderId: z
      .string()
      .optional()
      .describe('Parent folder ID. Omit to create in root "My Drive".'),
  }),
  output: DriveFileSchema,
};

export type CreateFolderInput = z.infer<typeof createFolderSchema.input>;
export type CreateFolderOutput = z.infer<typeof createFolderSchema.output>;

export const moveFileSchema = {
  name: 'moveFile',
  description: 'Move a file or folder to a different parent folder.',
  notes: '',
  input: z.object({
    account: AccountParam,
    fileId: z.string().describe('ID of the file or folder to move'),
    newParentFolderId: z.string().describe('ID of the destination folder'),
  }),
  output: DriveFileSchema,
};

export type MoveFileInput = z.infer<typeof moveFileSchema.input>;
export type MoveFileOutput = z.infer<typeof moveFileSchema.output>;

export const renameFileSchema = {
  name: 'renameFile',
  description: 'Rename a file or folder.',
  notes: '',
  input: z.object({
    account: AccountParam,
    fileId: z.string().describe('ID of the file or folder to rename'),
    newName: z.string().describe('New name for the file or folder'),
  }),
  output: DriveFileSchema,
};

export type RenameFileInput = z.infer<typeof renameFileSchema.input>;
export type RenameFileOutput = z.infer<typeof renameFileSchema.output>;

export const copyFileSchema = {
  name: 'copyFile',
  description: 'Copy a file. Cannot copy folders.',
  notes: '',
  input: z.object({
    account: AccountParam,
    fileId: z.string().describe('ID of the file to copy'),
    newName: z
      .string()
      .optional()
      .describe('Name for the copy. Defaults to "Copy of {original name}".'),
    destinationFolderId: z
      .string()
      .optional()
      .describe(
        'Folder to place the copy in. Defaults to same folder as original.',
      ),
  }),
  output: DriveFileSchema,
};

export type CopyFileInput = z.infer<typeof copyFileSchema.input>;
export type CopyFileOutput = z.infer<typeof copyFileSchema.output>;

export const trashFileSchema = {
  name: 'trashFile',
  description: 'Move a file or folder to trash (reversible).',
  notes: '',
  input: z.object({
    account: AccountParam,
    fileId: z.string().describe('ID of the file or folder to trash'),
  }),
  output: DriveFileSchema,
};

export type TrashFileInput = z.infer<typeof trashFileSchema.input>;
export type TrashFileOutput = z.infer<typeof trashFileSchema.output>;

export const deleteFileSchema = {
  name: 'deleteFile',
  description:
    'Permanently delete a file or folder. Irreversible. Use trashFile for reversible deletion.',
  notes: 'This permanently deletes the file. It cannot be recovered.',
  input: z.object({
    account: AccountParam,
    fileId: z
      .string()
      .describe('ID of the file or folder to permanently delete'),
  }),
  output: z.object({}),
};

export type DeleteFileInput = z.infer<typeof deleteFileSchema.input>;

export const emptyTrashSchema = {
  name: 'emptyTrash',
  description: 'Empty the entire trash. Permanently deletes all trashed files.',
  notes: 'This permanently deletes all files in trash. Cannot be undone.',
  input: z.object({
    account: AccountParam,
  }),
  output: z.object({}),
};

export type EmptyTrashInput = z.infer<typeof emptyTrashSchema.input>;

export const shareFileSchema = {
  name: 'shareFile',
  description: 'Share a file or folder with another user by email.',
  notes: '',
  input: z.object({
    account: AccountParam,
    fileId: z.string().describe('ID of the file or folder to share'),
    email: z.string().describe('Email address of the person to share with'),
    role: z
      .enum(['reader', 'writer', 'commenter'])
      .describe(
        'Permission role: reader (view only), writer (can edit), commenter (can comment)',
      ),
  }),
  output: z.object({
    permissionId: z.string().describe('ID of the created permission'),
    type: z.string().describe('Permission type (user)'),
    role: z.string().describe('Granted role'),
    email: z.string().describe('Email the file was shared with'),
  }),
};

export type ShareFileInput = z.infer<typeof shareFileSchema.input>;
export type ShareFileOutput = z.infer<typeof shareFileSchema.output>;

export const listSharedDrivesSchema = {
  name: 'listSharedDrives',
  description: 'List all shared/team drives the user has access to.',
  notes: '',
  input: z.object({
    account: AccountParam,
    maxResults: z
      .number()
      .optional()
      .describe('Maximum drives to return. Default 100.'),
  }),
  output: z.object({
    drives: z
      .array(
        z.object({
          id: z.string().describe('Shared drive ID'),
          name: z.string().describe('Shared drive name'),
          canAddChildren: z.boolean().describe('Whether user can add files'),
          canManageMembers: z
            .boolean()
            .describe('Whether user can manage members'),
        }),
      )
      .describe('Array of shared drives'),
    totalCount: z.number().describe('Number of drives returned'),
  }),
};

export type ListSharedDrivesInput = z.infer<
  typeof listSharedDrivesSchema.input
>;
export type ListSharedDrivesOutput = z.infer<
  typeof listSharedDrivesSchema.output
>;

// ============================================================================
// Folder Upload Schema
// ============================================================================

const FolderEntrySchema: z.ZodType<FolderEntry> = z.lazy(() =>
  z.object({
    name: z.string().describe('File or folder name'),
    type: z
      .enum(['file', 'folder'])
      .describe('"file" for files, "folder" for directories'),
    mimeType: z
      .string()
      .optional()
      .describe(
        'MIME type for files (e.g., "text/markdown", "application/pdf"). Ignored for folders.',
      ),
    fileRef: z
      .string()
      .optional()
      .describe(
        'File reference from Northlight files library (from a prior save() call). For binary files.',
      ),
    content: z
      .string()
      .optional()
      .describe(
        'Raw text content for text files. Use fileRef for binary files.',
      ),
    children: z
      .array(z.lazy(() => FolderEntrySchema))
      .optional()
      .describe(
        'Child entries (files and subfolders). Only valid for type "folder".',
      ),
  }),
);

export interface FolderEntry {
  name: string;
  type: 'file' | 'folder';
  mimeType?: string;
  fileRef?: string;
  content?: string;
  children?: FolderEntry[];
}

export const uploadFolderSchema = {
  name: 'uploadFolder',
  description:
    'Upload a folder structure with files to Google Drive. Creates all folders and uploads all files, preserving the directory hierarchy.',
  notes:
    'MEMORY LIMIT: Each file entry with content/fileRef is held in browser memory simultaneously. Keep each call to ~20 files max or the browser tab will crash. For directories with more than 20 files: (1) call createFolder once for the root, (2) call uploadFolder multiple times in batches of ~20 files, passing the root folder ID as parentFolderId. For very large directories (100+ files), use createFolder to build the folder tree first, then upload files individually with uploadFile in sequential calls. Each entry is either a file (with fileRef or content) or a folder (with children).',
  input: z.object({
    account: AccountParam,
    folderName: z.string().describe('Name for the root folder in Google Drive'),
    parentFolderId: z
      .string()
      .optional()
      .describe(
        'Parent folder ID to create the root folder in. Omit for root "My Drive".',
      ),
    entries: z
      .array(FolderEntrySchema)
      .describe(
        'Array of files and subfolders to upload. Max ~20 file entries per call (browser memory limit; more will crash the tab). Each entry has name, type ("file" or "folder"), and either fileRef/content (for files) or children (for folders). Folder entries with children count their descendant files toward the limit.',
      ),
  }),
  output: z.object({
    rootFolder: DriveFileSchema.describe('The created root folder'),
    foldersCreated: z
      .number()
      .describe('Total number of folders created (including root)'),
    filesUploaded: z.number().describe('Total number of files uploaded'),
    errors: z
      .array(
        z.object({
          path: z
            .string()
            .describe('Path of the failed item (e.g., "subfolder/file.txt")'),
          error: z.string().describe('Error message'),
        }),
      )
      .describe('Any files or folders that failed to upload'),
  }),
};

export type UploadFolderInput = z.infer<typeof uploadFolderSchema.input>;
export type UploadFolderOutput = {
  rootFolder: DriveFile;
  foldersCreated: number;
  filesUploaded: number;
  errors: Array<{ path: string; error: string }>;
};

// ============================================================================
// All Schemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listFilesSchema,
  getFileSchema,
  searchFilesSchema,
  uploadFileSchema,
  downloadFileSchema,
  createFolderSchema,
  moveFileSchema,
  renameFileSchema,
  copyFileSchema,
  trashFileSchema,
  deleteFileSchema,
  emptyTrashSchema,
  shareFileSchema,
  listSharedDrivesSchema,
  uploadFolderSchema,
];
