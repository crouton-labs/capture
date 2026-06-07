/**
 * Shared Clay API client and interfaces
 */

export const API_BASE = 'https://api.clay.com/v3';

/**
 * Clay API client using XMLHttpRequest.
 * fetch() with credentials:'include' fails to send cross-origin cookies
 * in some browser contexts (cookie partitioning). XHR with withCredentials
 * reliably sends cookies for api.clay.com from app.clay.com.
 */
export async function clayFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const url = `${API_BASE}${path}`;

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.withCredentials = true;
    xhr.timeout = 30000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.onload = function () {
      if (xhr.status >= 400) {
        reject(
          new Error(
            `Clay API error ${xhr.status}: ${xhr.responseText.slice(0, 200)}`,
          ),
        );
        return;
      }
      const text = xhr.responseText;
      if (!text) {
        resolve(undefined as T);
        return;
      }
      try {
        resolve(JSON.parse(text) as T);
      } catch {
        reject(
          new Error(
            `Clay API parse error for ${method} ${path}: ${text.slice(0, 200)}`,
          ),
        );
      }
    };

    xhr.onerror = function () {
      reject(new Error(`Clay API network error for ${method} ${path}`));
    };

    xhr.ontimeout = function () {
      reject(new Error(`Clay API timeout for ${method} ${path} (30s)`));
    };

    xhr.send(options.body != null ? String(options.body) : null);
  });
}

export async function fetchFieldMappings(tableId: string): Promise<{
  nameToId: Record<string, string>;
  idToName: Record<string, string>;
}> {
  const data = await clayFetch<TableResponse>(`/tables/${tableId}`);
  const fields = data.table.fields ?? [];
  const nameToId: Record<string, string> = {};
  const idToName: Record<string, string> = {};
  for (const f of fields) {
    nameToId[f.name] = f.id;
    idToName[f.id] = f.name;
  }
  return { nameToId, idToName };
}

// Shared interfaces used by multiple modules
export interface TableFieldData {
  id: string;
  tableId?: string;
  name: string;
  type: string;
  description?: string | null;
  isLocked?: boolean;
  isSortable?: boolean;
  groupId?: string | null;
  typeSettings?: Record<string, unknown>;
  lockSettings?: {
    lockDelete?: boolean;
    lockUpdateCells?: boolean;
    lockUpdateSettings?: boolean;
  };
  isExtractedField?: boolean;
  extractedField?: unknown;
  supportedFilterOperators?: Array<{
    operator: string;
    needsValue: boolean;
  }>;
}

export interface TableViewData {
  id: string;
  tableId: string;
  name: string;
  description?: string | null;
  order?: string;
  fields?: Record<
    string,
    { order?: string; width?: number; isVisible?: boolean }
  >;
  sort?: {
    items: Array<{ fieldId: string; direction: 'ASC' | 'DESC' }>;
  } | null;
  filter?: {
    items: Array<{ type: string; fieldId: string; value?: unknown }>;
    combinationMode: 'AND' | 'OR';
  } | null;
  limit?: number | null;
  offset?: number | null;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  typeSettings?: {
    isPreconfigured?: boolean;
    preconfiguredType?: string;
  };
}

export interface TableData {
  id: string;
  workspaceId: number;
  name: string;
  description?: string;
  type?: string;
  firstViewId?: string;
  fields?: TableFieldData[];
  createdAt: string;
  updatedAt: string;
  workbookId?: string;
  createdByUserId?: string;
  ownerId?: string;
  owner?: {
    id: number;
    username: string;
    email: string;
    name: string;
    fullName?: string;
    profilePicture?: string | null;
  };
  icon?: { emoji?: string; url?: string } | null;
  parentFolderId?: string | null;
  tableSettings?: Record<string, unknown>;
  fieldGroupMap?: Record<string, unknown>;
  defaultAccess?: string;
  isSandbox?: boolean;
  isHiddenFromNavigation?: boolean;
  deletedAt?: string | null;
  abilities?: {
    canUpdate?: boolean;
    canDelete?: boolean;
    canManageAccess?: boolean;
    canUpdateFromSandbox?: boolean;
  };
  views?: TableViewData[];
}

export interface TableResponse {
  table: TableData;
}

export interface CellData {
  value: unknown;
  metadata?: {
    status?: string;
    isCoerced?: boolean;
    isPreview?: boolean;
    isStale?: boolean;
    isOverwrite?: boolean;
    imagePreview?: string;
  };
}

export interface RecordData {
  id: string;
  tableId: string;
  cells: Record<string, CellData>;
}

export interface BulkFetchResponse {
  results: RecordData[];
}

export interface CreateRecordsResponse {
  records: Array<{
    id: string;
    tableId: string;
    cells: Record<string, CellData>;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface MeResponse {
  id: number;
  username: string;
  email: string;
  name: string;
  fullName: string;
  profilePicture?: string | null;
  role: string;
  apiToken?: string;
  emailVerified: boolean;
  onboardingStep?: string;
  features?: Record<string, boolean>;
  authStrategy?: string;
  sessionState?: {
    last_workspace_visited_id?: string;
    new_onboarding_step?: number;
    onboarding_completed?: boolean;
  };
  createdAt: string;
  updatedAt: string;
  rewardfulAffiliateId?: string | null;
  rewardfulReferralId?: string | null;
  accountRiskStatus?: string;
  isImpersonated?: boolean;
  adminUser?: unknown | null;
  intercomHash?: string;
}

export interface RunEnrichmentResponse {
  result: {
    people?: PersonResult[];
    companies?: CompanyResult[];
    peopleCount?: number;
    companyCount?: number;
    result_count?: number;
  };
  metadata?: {
    taskId?: string;
  };
  taskId?: string;
}

export interface PersonResult {
  profile_id: string;
  name: string;
  first_name?: string;
  last_name?: string;
  url?: string;
  latest_experience_company?: string;
  latest_experience_title?: string;
  latest_experience_start_date?: string;
  location_name?: string;
  domain?: string;
  company_first_slug?: string;
}

export interface CompanyResult {
  clay_company_id: string;
  linkedin_company_id?: string;
  name: string;
  type?: string;
  size?: string;
  industry?: string;
  industries?: string[];
  country?: string;
  location?: string;
  domain?: string;
  linkedin_url?: string;
  description?: string;
  total_funding_amount_range_usd?: string;
  annual_revenue?: string;
  derived_datapoints?: Record<string, unknown>;
}
