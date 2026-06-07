import { z } from 'zod';

export const libraryDescription =
  'File storage operations via Northlight agent';
export const libraryVisibility = 'chat' as const;

export const libraryIcon = '/icons/libs/files.ico';

export const libraryNotes = `
# @vallum/files

Unified filesystem library for browser executors. All operations go through the user's real filesystem.

## One storage backend

There is no \`storage\` parameter. There is no cloud option. Everything writes to real files.

A bare filename resolves to \`~/Downloads/<filename>\`. An absolute or \`~/\` path resolves to that real path on the user's machine. \`~/Downloads\`, \`~/Desktop\`, and \`~/Documents\` are pre-approved; other directories trigger an approval modal the first time.

## Cross-executor file sharing (same conversation)

Executor A writes: \`save({ filename: 'export.csv', content })\`
Executor B reads:  \`load({ fileRef: 'export.csv' })\`

Both bare names resolve to \`~/Downloads/export.csv\`. Bash sees the same file via \`read('export.csv')\` (which also resolves to \`~/Downloads\`). No opaque keys.

## Functions

\`\`\`typescript
save({ filename, content }): Promise<FileRef>
// Writes to ~/Downloads (bare name) or real path (absolute/~/). Approval modal for unapproved dirs.
// content: string for text files; Uint8Array/ArrayBuffer for binary.
// Returns: { path, name, contentType, size }

load({ fileRef }): Promise<ArrayBuffer>
// Reads from ~/Downloads (bare name) or any path. fileRef can be a FileRef object or a path string.

download({ url, filename?, path? }): Promise<FileRef>
// Fetches via the user's authenticated session cookies. Use this whenever you need
// a URL on disk — never fetch + base64-encode + save() yourself.
// Default path: ~/Downloads. Pass path: '~/Documents' or any approved dir for persistent saves.
// Returns FileRef with absolute path — never returns raw bytes.

setFileInput({ selector, fileRef }): Promise<void>
// Sets a file input element for form upload.
\`\`\`

## Saving binary data

For URL → file, **always use download()**. It handles redirects, cookies, content-type, and binary writes in one call.

For binary content you generated in code (e.g., a generated PDF, an encoded image), pass a Uint8Array or ArrayBuffer to save(). Strings passed for binary filenames must be base64; non-base64 strings are rejected so you don't end up with text on disk under a .jpg/.png/.pdf name.

## FileRef type

\`\`\`typescript
type FileRef = { path: string; name: string; contentType: string; size: number }
\`\`\`

\`path\` is the resolved absolute path on the user's machine. Use it in \`load()\`, in bash \`read()\`, or in \`setFileInput()\`.

## Do not construct attachment paths

Binary chat attachments are written to disk at upload time. Their paths appear in the \`<attachments>\` block of the user message. Read from there — do not construct the path. (It includes a UUID prefix.)

## Cross-conversation reuse

\`~/Downloads\` files persist across conversations — last-write-wins on collisions. For files you want to reuse later, prefer descriptive filenames (timestamps, UUIDs) or pass an explicit \`path\` like \`~/Documents/report.csv\`.

## Limits

- Download timeout: 30s
- Max attachment size: enforced at upload time (not here)
`;

// ============================================================================
// Shared Schemas
// ============================================================================

export const FileRefSchema = z.object({
  path: z.string().describe("Absolute path on the user's machine"),
  name: z.string().describe('Filename'),
  contentType: z.string().describe('MIME type'),
  size: z.number().describe('File size in bytes'),
});
export type FileRef = z.infer<typeof FileRefSchema>;

// ============================================================================
// Function Schemas
// ============================================================================

export const saveSchema = {
  name: 'save',
  description: 'Save content to storage and get a file reference',
  notes: `Returns a FileRef with the absolute path where the file was saved. Content type is inferred from the filename extension. A bare filename (e.g., report.csv) saves to ~/Downloads. An absolute path (e.g., ~/Downloads/report.csv) saves to that location. Other directories trigger an approval modal the first time.

To fetch a file from a URL, use download() — do not fetch + base64-encode + save() manually.

Content types accepted at runtime (the Zod schema shows string for text use):
- Text files (.txt, .csv, .md, .json, ...): pass a plain string.
- Binary files (.jpg, .png, .pdf, .zip, ...): pass a Uint8Array or ArrayBuffer. A base64-encoded string is also accepted and decoded automatically; non-base64 strings are rejected to prevent corrupted writes.`,
  input: z.object({
    filename: z
      .string()
      .describe(
        'Filename or path. Use a bare name (e.g., "report.csv") for ~/Downloads. Use an absolute path (e.g., "~/Downloads/report.csv") to save to a specific location.',
      ),
    content: z
      .string()
      .describe(
        'File content. For text files, pass a string. For binary files (.jpg/.png/.pdf/.zip/...) prefer Uint8Array or ArrayBuffer at runtime; if you only have base64 bytes as a string, that is accepted (auto-decoded). To save a file from a URL, use download() instead.',
      ),
  }),
  output: FileRefSchema,
};

export const loadSchema = {
  name: 'load',
  description: 'Load file content from a file reference',
  notes: `
Returns the raw file content as an ArrayBuffer.
Convert as needed: new TextDecoder().decode(buffer) for text, JSON.parse(new TextDecoder().decode(buffer)) for JSON.
`,
  input: z.object({
    fileRef: z
      .union([FileRefSchema, z.string()])
      .describe(
        'FileRef from a previous save, or a string path or bare filename',
      ),
  }),
  output: z
    .unknown()
    .describe(
      'ArrayBuffer of file content. Convert with: new TextDecoder().decode(result) for text, JSON.parse(new TextDecoder().decode(result)) for JSON, new Uint8Array(result) for binary, new Blob([result]) for Blob.',
    ),
};

export const setFileInputSchema = {
  name: 'setFileInput',
  description: 'Set a file input element value from a file reference',
  notes: `Loads the file and sets it as the value of a file input element. Dispatches a change event so the page can react to the upload.`,
  input: z.object({
    selector: z.string().describe('CSS selector for the file input element'),
    fileRef: FileRefSchema.describe('FileRef to upload'),
  }),
  output: z.void().describe('No return value'),
};

export const downloadSchema = {
  name: 'download',
  description: 'Download a file from a URL and save to storage',
  notes:
    "Fetches the file using the browser's session cookies. Use this when a service library returns a file URL (e.g., export downloads, file attachments). Returns a FileRef with the absolute path — never returns raw bytes.",
  input: z.object({
    url: z.string().describe('URL to download'),
    filename: z
      .string()
      .optional()
      .describe(
        'Filename hint, used only when path is a directory or omitted. If path already includes a filename, this is ignored.',
      ),
    path: z
      .string()
      .optional()
      .describe(
        'Destination — either a directory (e.g. ~/Documents) or a full file path (e.g. ~/Downloads/report.pdf). Defaults to ~/Downloads. Supports ~ for home directory.',
      ),
  }),
  output: FileRefSchema,
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  saveSchema,
  loadSchema,
  setFileInputSchema,
  downloadSchema,
];
