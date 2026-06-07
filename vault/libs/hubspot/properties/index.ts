/**
 * HubSpot Property Operations
 *
 * Property definitions and mappings.
 */

import type {
  GetPropertyMappingsInput,
  GetPropertyMappingsOutput,
  GetPropertyOptionsInput,
  GetPropertyOptionsOutput,
  CreatePropertyInput,
  CreatePropertyOutput,
  UpdatePropertyInput,
  UpdatePropertyOutput,
  DeletePropertyInput,
  DeletePropertyOutput,
} from '../schemas';
import { NotFound, Validation, throwForStatus } from '@vallum/_runtime';

const OBJECT_TYPE_IDS: Record<string, string> = {
  contacts: '0-1',
  companies: '0-2',
  deals: '0-3',
  tickets: '0-5',
  products: '0-7',
  line_items: '0-8',
};

const OBJECT_TYPE_V1_PATHS: Record<string, string> = {
  '0-1': 'contacts',
  '0-2': 'companies',
  '0-3': 'deals',
  '0-5': 'tickets',
  '0-7': 'products',
  '0-8': 'line_items',
};

const DEFAULT_GROUP: Record<string, string> = {
  contacts: 'contactinformation',
  companies: 'companyinformation',
  deals: 'dealinformation',
  tickets: 'ticketinformation',
  products: 'productinformation',
  line_items: 'lineiteminformation',
};

export async function getPropertyMappings(
  opts: GetPropertyMappingsInput,
): Promise<GetPropertyMappingsOutput> {
  const objectTypeId = OBJECT_TYPE_IDS[opts.objectType];
  if (!objectTypeId) {
    throw new Validation(`Invalid objectType: ${opts.objectType}`);
  }

  const url = new URL(
    `${window.location.origin}/api/properties/v4/groups/${objectTypeId}/properties`,
  );
  url.searchParams.set('includeFieldLevelPermission', 'true');
  url.searchParams.set('showHighlySensitiveProperties', 'true');
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) {
    throwForStatus(response.status, response.statusText || undefined);
  }

  const data = await response.json();

  interface RawOption {
    value: string;
    label: string;
    displayOrder?: number;
    hidden?: boolean;
  }

  interface RawProperty {
    name: string;
    label: string;
    type: string;
    fieldType: string;
    groupName: string;
    hidden?: boolean;
    hubspotDefined?: boolean;
    options?: RawOption[];
  }

  interface RawPropertyDef {
    property: RawProperty;
  }

  interface RawGroup {
    name: string;
    propertyDefinitions?: RawPropertyDef[];
  }

  const properties: GetPropertyMappingsOutput['properties'] = [];
  const renamedOptions: GetPropertyMappingsOutput['renamedOptions'] = [];

  // API returns { results: [...] }
  const groups = (data.results || data) as RawGroup[];

  for (const group of groups) {
    for (const propDef of group.propertyDefinitions || []) {
      const prop = propDef.property;

      const mapping: GetPropertyMappingsOutput['properties'][0] = {
        name: prop.name,
        label: prop.label,
        type: prop.type,
        fieldType: prop.fieldType,
        groupName: prop.groupName,
        hidden: prop.hidden || false,
        hubspotDefined: prop.hubspotDefined || false,
      };

      if (prop.options && prop.options.length > 0) {
        mapping.options = prop.options.map((opt) => ({
          value: opt.value,
          label: opt.label,
          displayOrder: opt.displayOrder || 0,
          hidden: opt.hidden || false,
        }));

        // Identify options where label differs from value (renamed)
        for (const opt of prop.options) {
          const normalizedValue = opt.value
            .toLowerCase()
            .replace(/[_\s-]/g, '');
          const normalizedLabel = opt.label
            .toLowerCase()
            .replace(/[_\s-]/g, '');

          if (normalizedValue !== normalizedLabel) {
            renamedOptions.push({
              propertyName: prop.name,
              propertyLabel: prop.label,
              value: opt.value,
              label: opt.label,
            });
          }
        }
      }

      properties.push(mapping);
    }
  }

  return {
    objectType: opts.objectType,
    properties,
    renamedOptions,
  };
}

/**
 * Quickly get internal/external name mappings for a specific property.
 * Much faster than getPropertyMappings() because it only fetches the single property.
 *
 * For properties with external options (like lifecycle stage), automatically fetches
 * the external option labels via the pagedFetch endpoint.
 */
export async function getPropertyOptions(
  opts: GetPropertyOptionsInput,
): Promise<GetPropertyOptionsOutput> {
  const objectTypeId = OBJECT_TYPE_IDS[opts.objectType];
  if (!objectTypeId) {
    throw new Validation(`Invalid objectType: ${opts.objectType}`);
  }

  // Fetch all properties for this object type (API doesn't support single property fetch)
  const url = new URL(
    `${window.location.origin}/api/properties/v4/groups/${objectTypeId}/properties`,
  );
  url.searchParams.set('includeFieldLevelPermission', 'true');
  url.searchParams.set('showHighlySensitiveProperties', 'true');
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) {
    throwForStatus(response.status, response.statusText || undefined);
  }

  const data = await response.json();

  interface RawOption {
    value: string;
    label: string;
  }

  interface RawProperty {
    name: string;
    label: string;
    type: string;
    fieldType: string;
    options?: RawOption[];
    externalOptionsReferenceType?: string;
  }

  interface RawPropertyDef {
    property: RawProperty;
  }

  interface RawGroup {
    propertyDefinitions?: RawPropertyDef[];
  }

  // Find the requested property
  const groups = (data.results || data) as RawGroup[];
  let foundProp: RawProperty | null = null;

  for (const group of groups) {
    for (const propDef of group.propertyDefinitions || []) {
      if (propDef.property.name === opts.propertyName) {
        foundProp = propDef.property;
        break;
      }
    }
    if (foundProp) break;
  }

  if (!foundProp) {
    throw new NotFound(
      `Property "${opts.propertyName}" not found on ${opts.objectType}`,
    );
  }

  // Check if this property uses external options (like lifecycle stage)
  const externalRef = foundProp.externalOptionsReferenceType;
  let options: GetPropertyOptionsOutput['options'] = [];

  if (externalRef) {
    // Fetch external options via pagedFetch endpoint
    const externalUrl = new URL(
      `${window.location.origin}/api/external-options/v3/pagedFetch/${externalRef}`,
    );
    externalUrl.searchParams.set('portalId', opts.portalId);
    externalUrl.searchParams.set('clienttimeout', '14000');

    const externalResp = await fetch(externalUrl.toString(), {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-hubspot-csrf-hubspotapi': opts.csrf,
      },
      body: JSON.stringify({
        referenceType: externalRef,
        limit: 100,
        searchQuery: '',
        offset: '0',
        portalId: parseInt(opts.portalId, 10),
        includeDeleted: false,
        useIndexOffset: false,
        formatLabel: true,
        objectType: objectTypeId,
      }),
    });

    if (externalResp.ok) {
      const externalData = await externalResp.json();
      interface ExternalOption {
        id: string;
        label: string;
      }
      options = (externalData.results || []).map((opt: ExternalOption) => ({
        internal: opt.id,
        external: opt.label,
      }));
    }
  } else if (foundProp.options && foundProp.options.length > 0) {
    // Use inline options
    options = foundProp.options.map((opt) => ({
      internal: opt.value,
      external: opt.label,
    }));
  }

  return {
    propertyName: foundProp.name,
    propertyLabel: foundProp.label,
    objectType: opts.objectType,
    type: foundProp.type,
    fieldType: foundProp.fieldType,
    options,
    externalOptionsReferenceType: externalRef,
  };
}

export async function createProperty(
  opts: CreatePropertyInput,
): Promise<CreatePropertyOutput> {
  const objectTypeId = OBJECT_TYPE_IDS[opts.objectType];
  if (!objectTypeId) {
    throw new Validation(`Invalid objectType: ${opts.objectType}`);
  }

  const name =
    opts.name ??
    opts.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

  const url = new URL(`${window.location.origin}/api/properties-writes/v4`);
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');

  const groupName =
    opts.groupName ?? DEFAULT_GROUP[opts.objectType] ?? 'contactinformation';
  const type = opts.type ?? 'string';
  const fieldType = opts.fieldType ?? 'text';
  const description = opts.description ?? '';
  const formField = opts.formField ?? true;
  const hasUniqueValue = opts.hasUniqueValue ?? false;

  const body = {
    property: {
      dataSensitivity: 'none',
      description,
      formField,
      groupName,
      hasUniqueValue,
      label: opts.label,
      name,
      searchableInGlobalSearch: false,
      sensitiveDataCategories: [],
      type,
      fieldType,
      ...(opts.options
        ? { options: opts.options }
        : type === 'bool'
          ? {
              options: [
                { label: 'Yes', value: 'true', displayOrder: 0, hidden: false },
                { label: 'No', value: 'false', displayOrder: 1, hidden: false },
              ],
            }
          : {}),
    },
    objectTypeId,
  };

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      'x-properties-source': 'CRM_UI',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  const data = await response.json();
  const prop = data.property as {
    name: string;
    label: string;
    type: string;
    fieldType: string;
    description: string;
    groupName: string;
    formField: boolean;
    hasUniqueValue: boolean;
    options: Array<{
      label: string;
      value: string;
      displayOrder: number;
      hidden: boolean;
    }>;
  };

  return {
    name: prop.name,
    label: prop.label,
    type: prop.type,
    fieldType: prop.fieldType,
    description: prop.description,
    groupName: prop.groupName,
    formField: prop.formField,
    hasUniqueValue: prop.hasUniqueValue,
    options: prop.options,
  };
}

export async function updateProperty(
  opts: UpdatePropertyInput,
): Promise<UpdatePropertyOutput> {
  const objectTypeId = OBJECT_TYPE_IDS[opts.objectType];
  if (!objectTypeId) {
    throw new Validation(`Invalid objectType: ${opts.objectType}`);
  }

  const v1Path = OBJECT_TYPE_V1_PATHS[objectTypeId];
  const propertyUrl = `${window.location.origin}/api/properties/v1/${v1Path}/properties/named/${opts.propertyName}?portalId=${opts.portalId}`;

  const getResponse = await fetch(propertyUrl, {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!getResponse.ok) {
    const text = await getResponse.text();
    throwForStatus(getResponse.status, text || undefined);
  }

  const existing = await getResponse.json();

  const merged = {
    ...existing,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    ...(opts.description !== undefined
      ? { description: opts.description }
      : {}),
    ...(opts.groupName !== undefined ? { groupName: opts.groupName } : {}),
    ...(opts.formField !== undefined ? { formField: opts.formField } : {}),
    ...(opts.options !== undefined ? { options: opts.options } : {}),
  };

  const putResponse = await fetch(propertyUrl, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      'x-properties-source': 'CRM_UI',
    },
    body: JSON.stringify(merged),
  });

  if (!putResponse.ok) {
    const text = await putResponse.text();
    throwForStatus(putResponse.status, text || undefined);
  }

  const prop = (await putResponse.json()) as {
    name: string;
    label: string;
    type: string;
    fieldType: string;
    description: string;
    groupName: string;
    formField: boolean;
    hasUniqueValue: boolean;
    options: Array<{
      label: string;
      value: string;
      displayOrder: number;
      hidden: boolean;
    }>;
  };

  return {
    name: prop.name,
    label: prop.label,
    type: prop.type,
    fieldType: prop.fieldType,
    description: prop.description,
    groupName: prop.groupName,
    formField: prop.formField,
    hasUniqueValue: prop.hasUniqueValue,
    options: prop.options,
  };
}

export async function deleteProperty(
  opts: DeletePropertyInput,
): Promise<DeletePropertyOutput> {
  const objectTypeId = OBJECT_TYPE_IDS[opts.objectType];
  if (!objectTypeId) {
    throw new Validation(`Invalid objectType: ${opts.objectType}`);
  }

  const v1Path = OBJECT_TYPE_V1_PATHS[objectTypeId];
  const url = `${window.location.origin}/api/properties/v1/${v1Path}/properties/named/${opts.propertyName}?portalId=${opts.portalId}`;

  const response = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      'x-properties-source': 'CRM_UI',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  return { success: true, propertyName: opts.propertyName };
}
