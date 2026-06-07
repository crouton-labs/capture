/**
 * Slack File Operations
 *
 * File upload, download, and management.
 */

import type {
  FilesListInput,
  FilesListOutput,
  FilesInfoInput,
  FilesInfoOutput,
  FilesUploadInput,
  FilesUploadOutput,
  FilesDeleteInput,
  FilesDeleteOutput,
  FilesGetUploadURLExternalInput,
  FilesGetUploadURLExternalOutput,
  FilesCompleteUploadExternalInput,
  FilesCompleteUploadExternalOutput,
  UploadFileInput,
  UploadFileOutput,
} from '../schemas';
import { slackApi } from '../helpers';
import { UpstreamError, throwForStatus } from '@vallum/_runtime';

export async function filesList(
  params: FilesListInput,
): Promise<FilesListOutput> {
  return slackApi<FilesListOutput>('files.list', params.token, params);
}

export async function filesInfo(
  params: FilesInfoInput,
): Promise<FilesInfoOutput> {
  return slackApi<FilesInfoOutput>('files.info', params.token, params);
}

export async function filesUpload(
  params: FilesUploadInput,
): Promise<FilesUploadOutput> {
  return slackApi<FilesUploadOutput>('files.upload', params.token, params);
}

export async function filesDelete(
  params: FilesDeleteInput,
): Promise<FilesDeleteOutput> {
  return slackApi<FilesDeleteOutput>('files.delete', params.token, params);
}

export async function filesGetUploadURLExternal(
  params: FilesGetUploadURLExternalInput,
): Promise<FilesGetUploadURLExternalOutput> {
  return slackApi<FilesGetUploadURLExternalOutput>(
    'files.getUploadURLExternal',
    params.token,
    params,
  );
}

export async function filesCompleteUploadExternal(
  params: FilesCompleteUploadExternalInput,
): Promise<FilesCompleteUploadExternalOutput> {
  return slackApi<FilesCompleteUploadExternalOutput>(
    'files.completeUploadExternal',
    params.token,
    params,
  );
}

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  csv: 'text/csv',
  txt: 'text/plain',
  json: 'application/json',
  zip: 'application/zip',
};

function inferMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  return (ext && MIME_TYPES[ext]) || 'application/octet-stream';
}

export async function uploadFile(
  params: UploadFileInput,
): Promise<UploadFileOutput> {
  const { token, file_data, filename, channel_id, title, initial_comment } =
    params;

  // Convert file_data to Uint8Array (runtime accepts ArrayBuffer, Uint8Array, or base64 string)
  const rawData = file_data as unknown;
  let bytes: Uint8Array;
  if (rawData instanceof ArrayBuffer) {
    bytes = new Uint8Array(rawData);
  } else if (rawData instanceof Uint8Array) {
    bytes = rawData;
  } else {
    const binaryStr = atob(rawData as string);
    bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
  }

  const mimeType = inferMimeType(filename);
  const displayTitle = title || filename.replace(/\.[^.]+$/, '');

  // Step 1: get a one-time upload URL + file_id from Slack
  const step1 = await filesGetUploadURLExternal({
    token,
    filename,
    length: bytes.byteLength,
  });

  // Step 2: POST the binary data to the returned upload_url
  // Slack's external upload endpoint expects the file content in a
  // multipart/form-data 'file' field; fetch sets Content-Type with boundary automatically.
  const fileForm = new FormData();
  fileForm.append(
    'file',
    new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }),
    filename,
  );
  const putResponse = await fetch(step1.upload_url, {
    method: 'POST',
    body: fileForm,
  });
  if (!putResponse.ok) {
    const body = await putResponse.text().catch(() => undefined);
    throwForStatus(putResponse.status, body);
  }

  // Step 3: tell Slack the upload is done, optionally sharing to a channel
  // with a title and initial_comment. initial_comment lives on completeUploadExternal.
  const completeParams: Record<string, unknown> = {
    files: JSON.stringify([{ id: step1.file_id, title: displayTitle }]),
  };
  if (channel_id) completeParams.channel_id = channel_id;
  if (initial_comment) completeParams.initial_comment = initial_comment;

  const completion = await slackApi<{
    ok: boolean;
    files: UploadFileOutput['file'][];
  }>('files.completeUploadExternal', token, completeParams);

  const file = completion.files[0];
  if (!file) {
    throw new UpstreamError(
      'Slack file upload: completeUploadExternal returned no files',
    );
  }

  return { ok: true, file };
}
