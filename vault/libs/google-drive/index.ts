/**
 * Google Drive Library
 *
 * Browser-executable file management via Google Drive internal v2 APIs.
 */

import { Validation, ContractDrift, UpstreamError, throwForStatus } from '@vallum/_runtime';

import type {
  GetContextOutput,
  ListFilesInput,
  ListFilesOutput,
  GetFileInput,
  GetFileOutput,
  SearchFilesInput,
  SearchFilesOutput,
  UploadFileInput,
  UploadFileOutput,
  DownloadFileInput,
  DownloadFileOutput,
  CreateFolderInput,
  CreateFolderOutput,
  MoveFileInput,
  MoveFileOutput,
  RenameFileInput,
  RenameFileOutput,
  CopyFileInput,
  CopyFileOutput,
  TrashFileInput,
  TrashFileOutput,
  DeleteFileInput,
  EmptyTrashInput,
  ShareFileInput,
  ShareFileOutput,
  ListSharedDrivesInput,
  ListSharedDrivesOutput,
  UploadFolderInput,
  UploadFolderOutput,
  FolderEntry,
  DriveFile,
} from './schemas';
import type { FileRef } from '../files/schemas';

// ============================================================================
// Internal Types
// ============================================================================

interface DriveApiFileResponse {
  id: string;
  title: string;
  mimeType: string;
  fileSize?: string;
  shared?: boolean;
  createdDate?: string;
  modifiedDate?: string;
  parents?: Array<{ id: string }>;
  owners?: Array<{ emailAddressFromAccount?: string; displayName?: string }>;
  labels?: { starred?: boolean; trashed?: boolean };
  webViewLink?: string;
  webContentLink?: string;
  capabilities?: {
    canEdit?: boolean;
    canDelete?: boolean;
    canShare?: boolean;
    canCopy?: boolean;
    canDownload?: boolean;
    canTrash?: boolean;
    canRename?: boolean;
  };
}

interface DriveApiListResponse {
  items?: DriveApiFileResponse[];
  nextPageToken?: string;
}

interface DriveApiAboutResponse {
  user?: { emailAddress?: string; displayName?: string };
  rootFolderId?: string;
}

// ============================================================================
// Internal Helpers
// ============================================================================

const V2_BASE = 'https://clients6.google.com';

const FILE_FIELDS = [
  'id',
  'title',
  'mimeType',
  'fileSize',
  'shared',
  'createdDate',
  'modifiedDate',
  'parents(id)',
  'owners(emailAddressFromAccount,displayName)',
  'labels(starred,trashed)',
  'webViewLink',
  'webContentLink',
  'capabilities(canEdit,canDelete,canShare,canCopy,canDownload,canTrash,canRename)',
].join(',');

/** Google API key required for all v2internal API calls */
const API_KEY = 'AIzaSyD_InbmSFufIEps5UAt2NmB_3LvBH3Sz_8';

/**
 * Get auth header via Google's internal gapi library.
 * Google uses a proprietary SHA-1 implementation (not Web Crypto API),
 * so we must use their function rather than computing SAPISIDHASH ourselves.
 */
function getAuthHeader(): string {
  if (
    typeof gapi === 'undefined' ||
    !gapi.auth?.getAuthHeaderValueForFirstParty
  ) {
    throw new UpstreamError(
      `gapi.auth not available. Ensure Google Drive page is fully loaded. URL: ${window.location.href}`,
    );
  }
  return gapi.auth.getAuthHeaderValueForFirstParty();
}

function getAccountFromUrl(): number {
  const match = window.location.pathname.match(/\/u\/(\d+)/);
  if (!match) {
    throw new Validation(
      `Account number not found in URL. URL: ${window.location.href}. Navigate to drive.google.com/drive/u/{N}/`,
    );
  }
  return parseInt(match[1], 10);
}

async function driveGet<T>(
  path: string,
  account: number,
  params: Record<string, string> = {},
): Promise<T> {
  const authHeader = getAuthHeader();
  const searchParams = new URLSearchParams({ ...params, key: API_KEY });
  const url = `${V2_BASE}${path}?${searchParams.toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      authorization: authHeader,
      'x-goog-authuser': String(account),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    throwForStatus(res.status, text);
  }
  return res.json() as Promise<T>;
}

async function drivePost<T>(
  path: string,
  account: number,
  body: Record<string, unknown>,
  params: Record<string, string> = {},
): Promise<T> {
  const authHeader = getAuthHeader();
  const searchParams = new URLSearchParams({ ...params, key: API_KEY });
  const url = `${V2_BASE}${path}?${searchParams.toString()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: authHeader,
      'x-goog-authuser': String(account),
      'content-type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    throwForStatus(res.status, text);
  }
  return res.json() as Promise<T>;
}

async function _drivePut<T>(
  path: string,
  account: number,
  body: Record<string, unknown>,
  params: Record<string, string> = {},
): Promise<T> {
  const authHeader = getAuthHeader();
  const searchParams = new URLSearchParams({ ...params, key: API_KEY });
  const url = `${V2_BASE}${path}?${searchParams.toString()}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      authorization: authHeader,
      'x-goog-authuser': String(account),
      'content-type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    throwForStatus(res.status, text);
  }
  return res.json() as Promise<T>;
}

async function drivePatch<T>(
  path: string,
  account: number,
  body: Record<string, unknown>,
  params: Record<string, string> = {},
): Promise<T> {
  const authHeader = getAuthHeader();
  const searchParams = new URLSearchParams({ ...params, key: API_KEY });
  const url = `${V2_BASE}${path}?${searchParams.toString()}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      authorization: authHeader,
      'x-goog-authuser': String(account),
      'content-type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    throwForStatus(res.status, text);
  }
  return res.json() as Promise<T>;
}

async function driveDelete(
  path: string,
  account: number,
  params: Record<string, string> = {},
): Promise<void> {
  const authHeader = getAuthHeader();
  const searchParams = new URLSearchParams({ ...params, key: API_KEY });
  const url = `${V2_BASE}${path}?${searchParams.toString()}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      authorization: authHeader,
      'x-goog-authuser': String(account),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    throwForStatus(res.status, text);
  }
}

function mapFileObject(item: DriveApiFileResponse): DriveFile {
  return {
    id: item.id,
    title: item.title,
    mimeType: item.mimeType,
    fileSize: item.fileSize ? parseInt(item.fileSize, 10) : undefined,
    shared: item.shared ?? false,
    createdDate: item.createdDate ?? '',
    modifiedDate: item.modifiedDate ?? '',
    parentId: item.parents?.[0]?.id,
    ownerEmail: item.owners?.[0]?.emailAddressFromAccount,
    ownerName: item.owners?.[0]?.displayName,
    starred: item.labels?.starred,
    trashed: item.labels?.trashed,
    webViewLink: item.webViewLink,
    canEdit: item.capabilities?.canEdit,
    canDelete: item.capabilities?.canDelete,
    canShare: item.capabilities?.canShare,
    canDownload: item.capabilities?.canDownload,
  };
}

function getDefaultExportFormat(mimeType: string): string {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
      return 'pdf';
    case 'application/vnd.google-apps.spreadsheet':
      return 'xlsx';
    case 'application/vnd.google-apps.presentation':
      return 'pptx';
    case 'application/vnd.google-apps.drawing':
      return 'png';
    default:
      return 'pdf';
  }
}

function getExportMimeType(format: string): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv',
    txt: 'text/plain',
    png: 'image/png',
    svg: 'image/svg+xml',
  };
  const result = map[format];
  if (!result) {
    throw new Validation(
      `Unsupported export format: ${format}. Valid formats: ${Object.keys(map).join(', ')}`,
    );
  }
  return result;
}

async function authenticatedFetch(
  url: string,
  account: number,
): Promise<Response> {
  const authHeader = getAuthHeader();
  const separator = url.includes('?') ? '&' : '?';
  const urlWithKey = `${url}${separator}key=${API_KEY}`;
  const res = await fetch(urlWithKey, {
    headers: {
      authorization: authHeader,
      'x-goog-authuser': String(account),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    throwForStatus(res.status, text);
  }
  return res;
}

// ============================================================================
// Exported Functions
// ============================================================================

export async function getContext(): Promise<GetContextOutput> {
  if (!window.location.hostname.includes('drive.google.com')) {
    throw new Validation(
      `Not on Google Drive. Current URL: ${window.location.href}. Navigate to drive.google.com first.`,
    );
  }

  const account = getAccountFromUrl();

  const data = await driveGet<DriveApiAboutResponse>(
    '/drive/v2internal/about',
    account,
    { fields: 'user(emailAddress,displayName),rootFolderId' },
  );

  if (!data.user?.emailAddress) {
    throw new ContractDrift(
      `Could not retrieve user info. Auth may have failed. URL: ${window.location.href}`,
    );
  }

  if (!data.rootFolderId) {
    throw new ContractDrift(
      `Could not retrieve root folder ID. URL: ${window.location.href}`,
    );
  }

  return {
    account,
    email: data.user.emailAddress,
    displayName: data.user.displayName ?? data.user.emailAddress,
    rootFolderId: data.rootFolderId,
  };
}

export async function listFiles(
  params: ListFilesInput,
): Promise<ListFilesOutput> {
  const { account, folderId, mimeType, query, maxResults = 100 } = params;

  const queryParts: string[] = ['trashed = false'];
  if (folderId) {
    queryParts.push(`'${folderId}' in parents`);
  }
  if (mimeType) {
    queryParts.push(`mimeType = '${mimeType}'`);
  }
  if (query) {
    queryParts.push(`title contains '${query}'`);
  }
  const q = queryParts.join(' and ');

  const allItems: DriveApiFileResponse[] = [];
  let pageToken: string | undefined;

  do {
    const requestParams: Record<string, string> = {
      q,
      fields: `items(${FILE_FIELDS}),nextPageToken`,
      maxResults: String(Math.min(maxResults - allItems.length, 100)),
      supportsTeamDrives: 'true',
    };
    if (pageToken) {
      requestParams.pageToken = pageToken;
    }

    const data = await driveGet<DriveApiListResponse>(
      '/drive/v2internal/files',
      account,
      requestParams,
    );

    if (data.items) {
      allItems.push(...data.items);
    }
    pageToken = data.nextPageToken;
  } while (pageToken && allItems.length < maxResults);

  return {
    files: allItems.map(mapFileObject),
    totalCount: allItems.length,
  };
}

export async function uploadFile(
  params: UploadFileInput,
): Promise<UploadFileOutput> {
  const { account, filename, mimeType, parentFolderId, fileRef, content } =
    params;

  if (!fileRef && !content) {
    throw new Validation('Either fileRef or content must be provided for upload.');
  }

  let fileBytes: Uint8Array;

  if (fileRef) {
    if (!window.__vallum_files) {
      throw new UpstreamError(
        'Northlight files API not available. Cannot read fileRef without agent file access.',
      );
    }
    const buffer = await window.__vallum_files.read(fileRef);
    fileBytes = new Uint8Array(buffer);
  } else {
    fileBytes = new TextEncoder().encode(content!);
  }

  const fileMimeType = mimeType ?? 'application/octet-stream';

  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2)}`;

  const metadata = JSON.stringify({
    title: filename,
    mimeType: fileMimeType,
    parents: parentFolderId ? [{ id: parentFolderId }] : [],
  });

  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
  const filePartHeader = `--${boundary}\r\nContent-Type: ${fileMimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;

  const encoder = new TextEncoder();
  const metadataBytes = encoder.encode(metadataPart);
  const headerBytes = encoder.encode(filePartHeader);
  const closingBytes = encoder.encode(closing);

  const totalLength =
    metadataBytes.length +
    headerBytes.length +
    fileBytes.length +
    closingBytes.length;
  const body = new Uint8Array(totalLength);
  let offset = 0;
  body.set(metadataBytes, offset);
  offset += metadataBytes.length;
  body.set(headerBytes, offset);
  offset += headerBytes.length;
  body.set(fileBytes, offset);
  offset += fileBytes.length;
  body.set(closingBytes, offset);

  const authHeader = getAuthHeader();

  const res = await fetch(
    `${V2_BASE}/upload/drive/v2internal/files?uploadType=multipart&fields=${FILE_FIELDS}&supportsTeamDrives=true&key=${API_KEY}`,
    {
      method: 'POST',
      headers: {
        authorization: authHeader,
        'x-goog-authuser': String(account),
        'content-type': `multipart/related; boundary=${boundary}`,
      },
      credentials: 'include',
      body: body.buffer,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => undefined);
    throwForStatus(res.status, text);
  }

  const data: DriveApiFileResponse = await res.json();
  return mapFileObject(data);
}

export async function downloadFile(
  params: DownloadFileInput,
): Promise<DownloadFileOutput> {
  const { account, fileId, exportFormat, saveAs } = params;

  if (!window.__vallum_files) {
    throw new UpstreamError(
      'Northlight files API not available. Cannot save files without agent file access.',
    );
  }

  const file = await driveGet<DriveApiFileResponse>(
    `/drive/v2internal/files/${fileId}`,
    account,
    { fields: 'id,title,mimeType,fileSize' },
  );

  const isGoogleFormat = file.mimeType?.startsWith(
    'application/vnd.google-apps.',
  );

  if (isGoogleFormat) {
    const format = exportFormat ?? getDefaultExportFormat(file.mimeType);
    const downloadMimeType = getExportMimeType(format);

    const exportParams = new URLSearchParams({ mimeType: downloadMimeType });
    const res = await authenticatedFetch(
      `${V2_BASE}/drive/v2internal/files/${fileId}/export?${exportParams.toString()}`,
      account,
    );

    const buffer = await res.arrayBuffer();
    const saveName = saveAs ?? `${file.title}.${format}`;
    const fileRefResult = await window.__vallum_files.write(saveName, buffer);

    return {
      filename: saveName,
      fileRef: fileRefResult,
      mimeType: downloadMimeType,
      size: buffer.byteLength,
    };
  }

  // Native file: download via alt=media
  const res = await authenticatedFetch(
    `${V2_BASE}/drive/v2internal/files/${fileId}?alt=media`,
    account,
  );

  const buffer = await res.arrayBuffer();
  const saveName = saveAs ?? file.title;
  const fileRefResult = await window.__vallum_files.write(saveName, buffer);

  return {
    filename: saveName,
    fileRef: fileRefResult,
    mimeType: file.mimeType,
    size: buffer.byteLength,
  };
}

export async function getFile(params: GetFileInput): Promise<GetFileOutput> {
  const { account, fileId } = params;
  const data = await driveGet<DriveApiFileResponse>(
    `/drive/v2internal/files/${fileId}`,
    account,
    { fields: FILE_FIELDS, supportsTeamDrives: 'true' },
  );
  return mapFileObject(data);
}

export async function searchFiles(
  params: SearchFilesInput,
): Promise<SearchFilesOutput> {
  const { account, query, mimeType, folderId, maxResults = 100 } = params;

  const queryParts: string[] = ['trashed = false'];
  queryParts.push(`fullText contains '${query}'`);
  if (folderId) {
    queryParts.push(`'${folderId}' in parents`);
  }
  if (mimeType) {
    queryParts.push(`mimeType = '${mimeType}'`);
  }
  const q = queryParts.join(' and ');

  const allItems: DriveApiFileResponse[] = [];
  let pageToken: string | undefined;

  do {
    const requestParams: Record<string, string> = {
      q,
      fields: `items(${FILE_FIELDS}),nextPageToken`,
      maxResults: String(Math.min(maxResults - allItems.length, 100)),
      supportsTeamDrives: 'true',
    };
    if (pageToken) {
      requestParams.pageToken = pageToken;
    }

    const data = await driveGet<DriveApiListResponse>(
      '/drive/v2internal/files',
      account,
      requestParams,
    );

    if (data.items) {
      allItems.push(...data.items);
    }
    pageToken = data.nextPageToken;
  } while (pageToken && allItems.length < maxResults);

  return {
    files: allItems.map(mapFileObject),
    totalCount: allItems.length,
  };
}

export async function createFolder(
  params: CreateFolderInput,
): Promise<CreateFolderOutput> {
  const { account, name, parentFolderId } = params;
  const body: Record<string, unknown> = {
    title: name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentFolderId) {
    body.parents = [{ id: parentFolderId }];
  }
  const data = await drivePost<DriveApiFileResponse>(
    '/drive/v2internal/files',
    account,
    body,
    { fields: FILE_FIELDS, supportsTeamDrives: 'true' },
  );
  return mapFileObject(data);
}

export async function moveFile(params: MoveFileInput): Promise<MoveFileOutput> {
  const { account, fileId, newParentFolderId } = params;
  const data = await drivePatch<DriveApiFileResponse>(
    `/drive/v2internal/files/${fileId}`,
    account,
    { parents: [{ id: newParentFolderId }] },
    { fields: FILE_FIELDS, supportsTeamDrives: 'true' },
  );
  return mapFileObject(data);
}

export async function renameFile(
  params: RenameFileInput,
): Promise<RenameFileOutput> {
  const { account, fileId, newName } = params;
  const data = await drivePatch<DriveApiFileResponse>(
    `/drive/v2internal/files/${fileId}`,
    account,
    { title: newName },
    { fields: FILE_FIELDS, supportsTeamDrives: 'true' },
  );
  return mapFileObject(data);
}

export async function copyFile(params: CopyFileInput): Promise<CopyFileOutput> {
  const { account, fileId, newName, destinationFolderId } = params;
  const body: Record<string, unknown> = {};
  if (newName) {
    body.title = newName;
  }
  if (destinationFolderId) {
    body.parents = [{ id: destinationFolderId }];
  }
  const data = await drivePost<DriveApiFileResponse>(
    `/drive/v2internal/files/${fileId}/copy`,
    account,
    body,
    { fields: FILE_FIELDS, supportsTeamDrives: 'true' },
  );
  return mapFileObject(data);
}

export async function trashFile(
  params: TrashFileInput,
): Promise<TrashFileOutput> {
  const { account, fileId } = params;
  const data = await drivePost<DriveApiFileResponse>(
    `/drive/v2internal/files/${fileId}/trash`,
    account,
    {},
    { fields: FILE_FIELDS, supportsTeamDrives: 'true' },
  );
  return mapFileObject(data);
}

export async function deleteFile(params: DeleteFileInput): Promise<void> {
  const { account, fileId } = params;
  await driveDelete(`/drive/v2internal/files/${fileId}`, account, {
    supportsTeamDrives: 'true',
  });
}

export async function emptyTrash(params: EmptyTrashInput): Promise<void> {
  const { account } = params;
  await driveDelete('/drive/v2internal/files/trash', account);
}

export async function shareFile(
  params: ShareFileInput,
): Promise<ShareFileOutput> {
  const { account, fileId, email, role } = params;
  const data = await drivePost<{
    id: string;
    type: string;
    role: string;
    emailAddress: string;
  }>(
    `/drive/v2internal/files/${fileId}/permissions`,
    account,
    {
      type: 'user',
      role,
      value: email,
    },
    { sendNotificationEmails: 'false', supportsTeamDrives: 'true' },
  );
  return {
    permissionId: data.id,
    type: data.type,
    role: data.role,
    email: data.emailAddress,
  };
}

export async function listSharedDrives(
  params: ListSharedDrivesInput,
): Promise<ListSharedDrivesOutput> {
  const { account, maxResults = 100 } = params;
  const data = await driveGet<{
    items?: Array<{
      id: string;
      name: string;
      capabilities?: {
        canAddChildren?: boolean;
        canManageMembers?: boolean;
      };
    }>;
  }>('/drive/v2internal/teamdrives', account, {
    maxResults: String(maxResults),
  });

  return {
    drives: (data.items ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      canAddChildren: d.capabilities?.canAddChildren ?? false,
      canManageMembers: d.capabilities?.canManageMembers ?? false,
    })),
    totalCount: data.items?.length ?? 0,
  };
}

export async function uploadFolder(
  params: UploadFolderInput,
): Promise<UploadFolderOutput> {
  const { account, folderName, parentFolderId, entries } = params;

  let foldersCreated = 0;
  let filesUploaded = 0;
  const errors: Array<{ path: string; error: string }> = [];

  // Create root folder
  const rootFolder = await createFolder({
    account,
    name: folderName,
    parentFolderId,
  });
  foldersCreated++;

  // Process entries incrementally: create folder → upload its files → recurse into subfolders
  async function processEntries(
    items: FolderEntry[],
    parentId: string,
    pathPrefix: string,
  ): Promise<void> {
    for (const entry of items) {
      const entryPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;

      if (entry.type === 'folder') {
        try {
          const folder = await createFolder({
            account,
            name: entry.name,
            parentFolderId: parentId,
          });
          foldersCreated++;

          if (entry.children && entry.children.length > 0) {
            await processEntries(entry.children, folder.id, entryPath);
          }
        } catch (err) {
          errors.push({
            path: entryPath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        try {
          await uploadFile({
            account,
            filename: entry.name,
            mimeType: entry.mimeType,
            parentFolderId: parentId,
            fileRef: entry.fileRef,
            content: entry.content,
          });
          filesUploaded++;
        } catch (err) {
          errors.push({
            path: entryPath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  await processEntries(entries, rootFolder.id, '');

  return {
    rootFolder,
    foldersCreated,
    filesUploaded,
    errors,
  };
}

// ============================================================================
// Window type augmentation for Vallum files API
// ============================================================================

declare global {
  var gapi: {
    auth: {
      getAuthHeaderValueForFirstParty: () => string;
    };
  };

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
