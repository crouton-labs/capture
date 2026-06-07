/**
 * Northlight Files Library - File storage operations via Northlight agent
 *
 * This library runs in the browser and uses the __vallum_files API
 * injected by the Northlight agent to store and retrieve files.
 */

// Re-export schemas for documentation
export * from './schemas';

import type { FileRef } from './schemas';
import { Validation, ContractDrift } from '@vallum/_runtime';

// Declare the global __vallum_files API injected by the agent
declare global {
  interface Window {
    __vallum_files?: {
      read(identifier: string | { path: string }): Promise<ArrayBuffer>;
      write(
        name: string,
        data: string | ArrayBuffer | Uint8Array | Blob,
      ): Promise<FileRef>;
      download(params: {
        url: string;
        filename?: string;
        path?: string;
        pageOrigin?: string;
      }): Promise<FileRef>;
      setFileInput(
        ref: FileRef,
        input: string | HTMLInputElement,
      ): Promise<void>;
    };
  }
}

function getFilesApi() {
  if (typeof window === 'undefined' || !window.__vallum_files) {
    throw new Validation(
      "Northlight files API not available — this build can't save files to disk. This is a hard limit of an out-of-date app, not a transient error — do not retry other save methods (bash writes, browser downloads, data: URLs). Tell the user to update their Northlight app to save files, then offer the content inline.",
    );
  }
  return window.__vallum_files;
}

/**
 * Save content to storage and get a reference.
 *
 * Binary content (images, PDFs, archives) is best passed as Uint8Array or
 * ArrayBuffer. A base64-encoded string is also accepted; the runtime infers
 * the content type from the filename and decodes the string before writing.
 * To fetch a URL into a file, use download() — never fetch + base64 + save.
 */
export async function save({
  filename,
  content,
}: {
  filename: string;
  content: string | ArrayBuffer | Uint8Array;
}): Promise<FileRef> {
  if (!filename || typeof filename !== 'string') {
    throw new Validation('filename is required and must be a non-empty string');
  }
  if (content === undefined || content === null) {
    throw new Validation('content is required');
  }
  return getFilesApi().write(filename, content);
}

/**
 * Load file content from a reference.
 */
export async function load({
  fileRef,
}: {
  fileRef: FileRef | string;
}): Promise<ArrayBuffer> {
  if (!fileRef) {
    throw new Validation(
      'fileRef is required. Pass a FileRef object or a string path.',
    );
  }
  const result = await getFilesApi().read(fileRef as string | { path: string });
  if (!result || (result instanceof ArrayBuffer && result.byteLength === 0)) {
    const refDesc =
      typeof fileRef === 'string' ? fileRef : (fileRef as FileRef).path;
    throw new ContractDrift(
      `File loaded but content is empty (0 bytes). Reference: "${refDesc}". ` +
        'If loading a file created in bash (/tmp/...), note that browser executors cannot access the bash sandbox filesystem. ' +
        'Use a real device path (e.g., ~/Downloads/) or pass file content directly as a string into executeJS.',
    );
  }
  return result;
}

/**
 * Set a file input element's value from a file reference.
 */
export async function setFileInput({
  selector,
  fileRef,
}: {
  selector: string;
  fileRef: FileRef;
}): Promise<void> {
  return getFilesApi().setFileInput(fileRef, selector);
}

/**
 * Download a file from a URL and save to device storage.
 * Bypasses CORS; fetches via the Northlight agent using the browser's session cookies.
 */
export async function download({
  url,
  filename,
  path,
}: {
  url: string;
  filename?: string;
  path?: string;
}): Promise<FileRef> {
  return getFilesApi().download({ url, filename, path });
}
