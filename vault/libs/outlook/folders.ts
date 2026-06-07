/**
 * Outlook Folder Operations
 *
 * listFolders, getFolder, createFolder via internal EWS-over-JSON APIs.
 */

import type {
  FolderSummary,
  ListFoldersInput,
  ListFoldersOutput,
  GetFolderInput,
  GetFolderOutput,
  CreateFolderInput,
  CreateFolderOutput,
  DeleteFolderInput,
  DeleteFolderOutput,
  RenameFolderInput,
  RenameFolderOutput,
} from './schemas';
import { buildHeaders, buildEwsHeader } from './helpers';
import { Validation, ContractDrift, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Local Helpers
// ============================================================================

/**
 * Wrap a resolved FolderId in a TargetFolderId envelope.
 * Required for operations that accept a destination folder (CreateFolder ParentFolderId,
 * MoveItem ToFolderId, etc.). Using a bare FolderId causes OwaSerializationException.
 */
function resolveTargetFolderId(folderId: string): {
  __type: string;
  BaseFolderId: { __type: string; Id: string };
} {
  return {
    __type: 'TargetFolderId:#Exchange',
    BaseFolderId: resolveFolderId(folderId),
  };
}

/**
 * Resolve a folder name or ID into an EWS FolderId object for use in requests.
 * Unlike resolveDistinguishedFolderId, this always returns an object and supports
 * additional well-known names (msgfolderroot, archivemsgfolderroot).
 */
function resolveFolderId(folderId: string): { __type: string; Id: string } {
  const wellKnown: Record<string, string> = {
    inbox: 'inbox',
    drafts: 'drafts',
    sentitems: 'sentitems',
    deleteditems: 'deleteditems',
    junkemail: 'junkemail',
    archive: 'archivemsgfolderroot',
    msgfolderroot: 'msgfolderroot',
    archivemsgfolderroot: 'archivemsgfolderroot',
  };

  const lower = folderId.toLowerCase();
  if (wellKnown[lower]) {
    return { __type: 'DistinguishedFolderId:#Exchange', Id: wellKnown[lower] };
  }

  // Raw immutable folder ID
  return { __type: 'FolderId:#Exchange', Id: folderId };
}

/**
 * Parse an EWS folder object into our FolderSummary shape.
 */
function parseFolder(folder: Record<string, unknown>): FolderSummary {
  const folderIdObj = folder.FolderId as Record<string, string> | undefined;
  const folderId = folderIdObj?.Id;
  if (!folderId) {
    throw new ContractDrift(
      `parseFolder: EWS response missing FolderId.Id for folder: ${JSON.stringify(folder).slice(0, 200)}`,
    );
  }
  return {
    folderId,
    displayName:
      typeof folder.DisplayName === 'string' ? folder.DisplayName : '',
    unreadCount:
      typeof folder.UnreadCount === 'number' ? folder.UnreadCount : 0,
    totalCount: typeof folder.TotalCount === 'number' ? folder.TotalCount : 0,
    childFolderCount:
      typeof folder.ChildFolderCount === 'number' ? folder.ChildFolderCount : 0,
    folderClass:
      typeof folder.FolderClass === 'string' ? folder.FolderClass : '',
  };
}

const FOLDER_ADDITIONAL_PROPERTIES = [
  { __type: 'PropertyUri:#Exchange', FieldURI: 'folder:DisplayName' },
  { __type: 'PropertyUri:#Exchange', FieldURI: 'folder:UnreadCount' },
  { __type: 'PropertyUri:#Exchange', FieldURI: 'folder:TotalCount' },
  { __type: 'PropertyUri:#Exchange', FieldURI: 'folder:ChildFolderCount' },
  { __type: 'PropertyUri:#Exchange', FieldURI: 'folder:FolderClass' },
];

// ============================================================================
// listFolders
// ============================================================================

/**
 * List mail folders and their hierarchy.
 */
export async function listFolders(
  params: ListFoldersInput,
): Promise<ListFoldersOutput> {
  const {
    auth,
    parentFolderId = 'msgfolderroot',
    traversal = 'Shallow',
    offset = 0,
    maxCount = 100,
    searchQuery,
    folderClassFilter,
    returnParentFolder,
  } = params;

  const findFolderBody: Record<string, unknown> = {
    __type: 'FindFolderRequest:#Exchange',
    FolderShape: {
      __type: 'FolderResponseShape:#Exchange',
      BaseShape: 'IdOnly',
      AdditionalProperties: FOLDER_ADDITIONAL_PROPERTIES,
    },
    Paging: {
      __type: 'IndexedPageView:#Exchange',
      BasePoint: 'Beginning',
      Offset: offset,
      MaxEntriesReturned: maxCount,
    },
    ParentFolderIds: [resolveFolderId(parentFolderId)],
    Traversal: traversal,
  };

  // Build Restriction from searchQuery and/or folderClassFilter
  const restrictionItems: Array<Record<string, unknown>> = [];

  if (searchQuery) {
    restrictionItems.push({
      __type: 'Contains:#Exchange',
      ContainmentMode: 'Substring',
      ContainmentComparison: 'IgnoreCase',
      Item: {
        __type: 'PropertyUri:#Exchange',
        FieldURI: 'folder:DisplayName',
      },
      Constant: {
        __type: 'ConstantValueType:#Exchange',
        Value: searchQuery,
      },
    });
  }

  if (folderClassFilter) {
    restrictionItems.push({
      __type: 'Contains:#Exchange',
      ContainmentMode: 'Prefixed',
      ContainmentComparison: 'IgnoreCase',
      Item: {
        __type: 'PropertyUri:#Exchange',
        FieldURI: 'folder:FolderClass',
      },
      Constant: {
        __type: 'ConstantValueType:#Exchange',
        Value: folderClassFilter,
      },
    });
  }

  if (restrictionItems.length === 1) {
    findFolderBody.Restriction = {
      __type: 'RestrictionType:#Exchange',
      Item: restrictionItems[0],
    };
  } else if (restrictionItems.length > 1) {
    findFolderBody.Restriction = {
      __type: 'RestrictionType:#Exchange',
      Item: {
        __type: 'And:#Exchange',
        Items: restrictionItems,
      },
    };
  }

  if (returnParentFolder != null) {
    findFolderBody.ReturnParentFolder = returnParentFolder;
  }

  const body: Record<string, unknown> = {
    __type: 'FindFolderJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: findFolderBody,
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=FindFolder&app=Mail`;
  const headers = buildHeaders(auth, 'FindFolder');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(responseItems) || responseItems.length === 0) {
    return { folders: [], totalCount: 0, moreAvailable: false };
  }

  const result = responseItems[0];
  if (result.ResponseClass === 'Error') {
    const msg =
      typeof result.MessageText === 'string' ? result.MessageText : 'Unknown';
    throw new ContractDrift(`FindFolder error: ${result.ResponseCode} - ${msg}`);
  }

  const rootFolder = result.RootFolder;
  const rawFolders: Array<Record<string, unknown>> = Array.isArray(
    rootFolder?.Folders,
  )
    ? (rootFolder.Folders as Array<Record<string, unknown>>)
    : [];
  const totalItemsInView =
    typeof rootFolder?.TotalItemsInView === 'number'
      ? rootFolder.TotalItemsInView
      : 0;
  const includesLastItem =
    typeof rootFolder?.IncludesLastItemInRange === 'boolean'
      ? rootFolder.IncludesLastItemInRange
      : true;

  const output: ListFoldersOutput = {
    folders: rawFolders.map(parseFolder),
    totalCount: totalItemsInView,
    moreAvailable: !includesLastItem,
  };

  // Include parent folder details when requested
  const parentFolderData = rootFolder?.ParentFolder as
    | Record<string, unknown>
    | undefined;
  if (parentFolderData) {
    const pfId = parentFolderData.FolderId as
      | Record<string, string>
      | undefined;
    output.parentFolder = {
      folderId: pfId?.Id || '',
      displayName:
        typeof parentFolderData.DisplayName === 'string'
          ? parentFolderData.DisplayName
          : '',
    };
  }

  return output;
}

// ============================================================================
// getFolder
// ============================================================================

/**
 * Get details for a specific mail folder by ID or well-known name.
 */
export async function getFolder(
  params: GetFolderInput,
): Promise<GetFolderOutput> {
  const {
    auth,
    folderId,
    includeParentFolder,
    includePermissions,
    includeDistinguishedFolderId,
  } = params;

  // Build AdditionalProperties: start with baseline, add optional extras
  const additionalProperties = [...FOLDER_ADDITIONAL_PROPERTIES];

  if (includeParentFolder) {
    additionalProperties.push({
      __type: 'PropertyUri:#Exchange',
      FieldURI: 'folder:ParentFolderId',
    });
  }
  if (includePermissions) {
    additionalProperties.push({
      __type: 'PropertyUri:#Exchange',
      FieldURI: 'folder:EffectiveRights',
    });
  }
  if (includeDistinguishedFolderId) {
    additionalProperties.push({
      __type: 'PropertyUri:#Exchange',
      FieldURI: 'folder:DistinguishedFolderId',
    });
  }

  const body: Record<string, unknown> = {
    __type: 'GetFolderJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'GetFolderRequest:#Exchange',
      FolderShape: {
        __type: 'FolderResponseShape:#Exchange',
        BaseShape: 'IdOnly',
        AdditionalProperties: additionalProperties,
      },
      FolderIds: [resolveFolderId(folderId)],
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=GetFolder&app=Mail`;
  const headers = buildHeaders(auth, 'GetFolder');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(responseItems) || responseItems.length === 0) {
    throw new ContractDrift(`GetFolder returned no items for ID: ${folderId}`);
  }

  const result = responseItems[0];
  if (result.ResponseClass === 'Error') {
    const msg =
      typeof result.MessageText === 'string' ? result.MessageText : 'Unknown';
    throw new ContractDrift(`GetFolder error: ${result.ResponseCode} - ${msg}`);
  }

  const folders: Array<Record<string, unknown>> = Array.isArray(result.Folders)
    ? (result.Folders as Array<Record<string, unknown>>)
    : [];
  if (folders.length === 0) {
    throw new ContractDrift(
      `GetFolder returned empty Folders array for ID: ${folderId}`,
    );
  }

  const folder = folders[0];
  const output: GetFolderOutput = parseFolder(folder);

  // Attach optional fields when requested
  if (includeParentFolder) {
    const parentId = folder.ParentFolderId as
      | Record<string, string>
      | undefined;
    if (parentId?.Id) {
      output.parentFolderId = parentId.Id;
    }
  }

  if (includePermissions) {
    const rights = folder.EffectiveRights as
      | Record<string, boolean>
      | undefined;
    if (rights) {
      output.effectiveRights = {
        createAssociated: !!rights.CreateAssociated,
        createContents: !!rights.CreateContents,
        createHierarchy: !!rights.CreateHierarchy,
        delete: !!rights.Delete,
        modify: !!rights.Modify,
        read: !!rights.Read,
        viewPrivateItems: !!rights.ViewPrivateItems,
      };
    }
  }

  if (includeDistinguishedFolderId) {
    const distinguished = folder.DistinguishedFolderId;
    if (typeof distinguished === 'string') {
      output.distinguishedFolderId = distinguished;
    }
  }

  return output;
}

// ============================================================================
// createFolder
// ============================================================================

/**
 * Create a new mail folder under a specified parent folder.
 */
export async function createFolder(
  params: CreateFolderInput,
): Promise<CreateFolderOutput> {
  const {
    auth,
    parentFolderId,
    displayName,
    folderType,
    searchFilter,
    searchBaseFolderIds,
    searchTraversal,
    folderClass,
    policyTag,
    archiveTag,
    retentionTag,
    color,
    hidden,
    description,
  } = params;

  if (!parentFolderId) {
    throw new Validation(
      'createFolder: parentFolderId is required. Use "inbox" to create under Inbox, "msgfolderroot" for a top-level folder, or a raw folder ID from listFolders.',
    );
  }

  if (!displayName) {
    throw new Validation(
      'createFolder: displayName is required. Provide a name for the new folder.',
    );
  }

  // Map folderType to EWS __type discriminator
  const typeMap: Record<string, string> = {
    Folder: 'Folder:#Exchange',
    SearchFolder: 'SearchFolder:#Exchange',
    ContactsFolder: 'ContactsFolder:#Exchange',
    CalendarFolder: 'CalendarFolder:#Exchange',
    TasksFolder: 'TasksFolder:#Exchange',
  };

  const folderObj: Record<string, unknown> = {
    __type: typeMap[folderType || 'Folder'],
    DisplayName: displayName,
  };

  // SearchFolder requires SearchParameters
  if (folderType === 'SearchFolder' && searchFilter) {
    folderObj.SearchParameters = {
      __type: 'SearchParameters:#Exchange',
      Traversal: searchTraversal || 'Deep',
      SearchFilter: searchFilter,
      BaseFolderIds: (searchBaseFolderIds || ['msgfolderroot']).map(
        (id: string) => resolveFolderId(id),
      ),
    };
  }

  if (folderClass) {
    folderObj.FolderClass = folderClass;
  }

  if (policyTag) {
    folderObj.PolicyTag = {
      __type: 'RetentionTagType:#Exchange',
      IsExplicit: true,
      Value: policyTag,
    };
  }

  if (archiveTag) {
    folderObj.ArchiveTag = {
      __type: 'RetentionTagType:#Exchange',
      IsExplicit: true,
      Value: archiveTag,
    };
  }

  if (retentionTag) {
    folderObj.RetentionTag = {
      __type: 'RetentionTagType:#Exchange',
      IsExplicit: true,
      Value: retentionTag,
    };
  }

  const extendedProps: Array<Record<string, unknown>> = [];

  if (color) {
    const colorMap: Record<string, number> = {
      Cranberry: 0,
      Peach: 1,
      Gold: 2,
      Bronze: 3,
      Lime: 4,
      DarkGreen: 5,
      LightTeal: 6,
      DarkTeal: 7,
      LightBlue: 8,
      DarkBlue: 9,
      Lavender: 10,
      DarkPurple: 11,
      Pink: 12,
      Magenta: 13,
      Silver: 14,
    };
    extendedProps.push({
      __type: 'ExtendedPropertyType:#Exchange',
      ExtendedFieldURI: {
        __type: 'ExtendedPropertyUri:#Exchange',
        DistinguishedPropertySetId: 'PublicStrings',
        PropertyName:
          'http://schemas.microsoft.com/outlookservices/model/color',
        PropertyType: 'Integer',
      },
      Value: String(colorMap[color]),
    });
  }

  if (hidden != null) {
    extendedProps.push({
      __type: 'ExtendedPropertyType:#Exchange',
      ExtendedFieldURI: {
        __type: 'ExtendedPropertyUri:#Exchange',
        PropertyTag: '0x10f4',
        PropertyType: 'Boolean',
      },
      Value: String(hidden),
    });
  }

  if (description) {
    extendedProps.push({
      __type: 'ExtendedPropertyType:#Exchange',
      ExtendedFieldURI: {
        __type: 'ExtendedPropertyUri:#Exchange',
        PropertyTag: '0x3004',
        PropertyType: 'String',
      },
      Value: description,
    });
  }

  if (extendedProps.length > 0) {
    folderObj.ExtendedProperty = extendedProps;
  }

  const body: Record<string, unknown> = {
    __type: 'CreateFolderJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'CreateFolderRequest:#Exchange',
      ParentFolderId: resolveTargetFolderId(parentFolderId),
      Folders: [folderObj],
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=CreateFolder&app=Mail`;
  const headers = buildHeaders(auth, 'CreateFolder');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(responseItems) || responseItems.length === 0) {
    throw new ContractDrift(
      `CreateFolder returned no items for displayName: ${displayName}`,
    );
  }

  const result = responseItems[0];
  if (result.ResponseClass === 'Error') {
    const msg =
      typeof result.MessageText === 'string' ? result.MessageText : 'Unknown';
    throw new ContractDrift(`CreateFolder error: ${result.ResponseCode} - ${msg}`);
  }

  const folders: Array<Record<string, unknown>> = Array.isArray(result.Folders)
    ? (result.Folders as Array<Record<string, unknown>>)
    : [];
  if (folders.length === 0) {
    throw new ContractDrift(
      `CreateFolder returned empty Folders array for displayName: ${displayName}`,
    );
  }

  const created = folders[0];
  const createdIdObj = created.FolderId as Record<string, string> | undefined;
  const createdId = createdIdObj?.Id;
  if (!createdId) {
    throw new ContractDrift(
      `CreateFolder: EWS response missing FolderId.Id for new folder "${displayName}"`,
    );
  }

  return {
    folderId: createdId,
    displayName:
      typeof created.DisplayName === 'string'
        ? created.DisplayName
        : displayName,
  };
}

// ============================================================================
// deleteFolder
// ============================================================================

/**
 * Delete a mail folder via the EWS DeleteFolder action.
 */
export async function deleteFolder(
  params: DeleteFolderInput,
): Promise<DeleteFolderOutput> {
  const { auth, folderId, deleteType = 'MoveToDeletedItems' } = params;

  if (!folderId) {
    throw new Validation(
      'deleteFolder: folderId is required. Use a raw folder ID from listFolders to identify the folder to delete.',
    );
  }

  const body: Record<string, unknown> = {
    __type: 'DeleteFolderJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'DeleteFolderRequest:#Exchange',
      FolderIds: [resolveFolderId(folderId)],
      DeleteType: deleteType,
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=DeleteFolder&app=Mail`;
  const headers = buildHeaders(auth, 'DeleteFolder');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(responseItems) || responseItems.length === 0) {
    throw new ContractDrift(
      `DeleteFolder returned no items for folder ID: ${folderId}`,
    );
  }

  const result = responseItems[0];
  if (result.ResponseClass === 'Error') {
    const msg =
      typeof result.MessageText === 'string' ? result.MessageText : 'Unknown';
    throw new ContractDrift(`DeleteFolder error: ${result.ResponseCode} - ${msg}`);
  }

  return { success: true };
}

// ============================================================================
// renameFolder
// ============================================================================

/**
 * Rename a mail folder via the EWS UpdateFolder action.
 */
export async function renameFolder(
  params: RenameFolderInput,
): Promise<RenameFolderOutput> {
  const { auth, folderId, displayName, policyTag, archiveTag } = params;

  if (!folderId) {
    throw new Validation(
      'renameFolder: folderId is required. Use a raw folder ID from listFolders or a well-known name like "inbox".',
    );
  }

  const updates: Array<Record<string, unknown>> = [
    {
      __type: 'SetFolderField:#Exchange',
      Path: {
        __type: 'PropertyUri:#Exchange',
        FieldURI: 'folder:DisplayName',
      },
      Folder: {
        __type: 'Folder:#Exchange',
        DisplayName: displayName,
      },
    },
  ];

  if (policyTag) {
    updates.push({
      __type: 'SetFolderField:#Exchange',
      Path: {
        __type: 'PropertyUri:#Exchange',
        FieldURI: 'folder:PolicyTag',
      },
      Folder: {
        __type: 'Folder:#Exchange',
        PolicyTag: {
          __type: 'RetentionTagType:#Exchange',
          IsExplicit: true,
          Value: policyTag,
        },
      },
    });
  }

  if (archiveTag) {
    updates.push({
      __type: 'SetFolderField:#Exchange',
      Path: {
        __type: 'PropertyUri:#Exchange',
        FieldURI: 'folder:ArchiveTag',
      },
      Folder: {
        __type: 'Folder:#Exchange',
        ArchiveTag: {
          __type: 'RetentionTagType:#Exchange',
          IsExplicit: true,
          Value: archiveTag,
        },
      },
    });
  }

  const body: Record<string, unknown> = {
    __type: 'UpdateFolderJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'UpdateFolderRequest:#Exchange',
      FolderChanges: [
        {
          __type: 'FolderChange:#Exchange',
          FolderId: resolveFolderId(folderId),
          Updates: updates,
        },
      ],
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=UpdateFolder&app=Mail`;
  const headers = buildHeaders(auth, 'UpdateFolder');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(responseItems) || responseItems.length === 0) {
    throw new ContractDrift(
      `UpdateFolder returned no items for folder ID: ${folderId}`,
    );
  }

  const result = responseItems[0];
  if (result.ResponseClass === 'Error') {
    const msg =
      typeof result.MessageText === 'string' ? result.MessageText : 'Unknown';
    throw new ContractDrift(`UpdateFolder error: ${result.ResponseCode} - ${msg}`);
  }

  const folders: Array<Record<string, unknown>> = Array.isArray(result.Folders)
    ? (result.Folders as Array<Record<string, unknown>>)
    : [];

  if (folders.length > 0) {
    const updated = folders[0];
    const updatedIdObj = updated.FolderId as Record<string, string> | undefined;
    return {
      folderId: updatedIdObj?.Id ?? folderId,
      displayName:
        typeof updated.DisplayName === 'string'
          ? updated.DisplayName
          : displayName,
    };
  }

  return { folderId, displayName };
}
