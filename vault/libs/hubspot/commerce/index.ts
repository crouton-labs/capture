/**
 * HubSpot Commerce Operations
 *
 * CRUD operations for HubSpot products, quotes, and line items.
 */

import { ContractDrift, throwForStatus } from '@vallum/_runtime';

// Products (0-7)

export async function listProducts(opts: {
  csrf: string;
  portalId: string;
  count?: number;
  offset?: number;
}): Promise<{
  total: number;
  offset: number;
  count: number;
  products: Array<{
    id: string;
    [key: string]: string;
  }>;
}> {
  const count = opts.count ?? 25;
  const offset = opts.offset ?? 0;

  const url = new URL(`${window.location.origin}/api/graphql/crm`);
  url.searchParams.set('hs_static_app', 'crm-index-ui');
  url.searchParams.set('hs_static_app_version', '2.50992');
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({
      operationName: 'CrmObjectsSearchQuery',
      query: `query CrmObjectsSearchQuery($filterGroups:[FilterGroup!]!$sorts:[Sort!]$query:String$objectTypeId:String!$properties:[String!]!$count:Int$offset:Int){crmObjectsSearch(filterGroups:$filterGroups sorts:$sorts query:$query type:$objectTypeId count:$count offset:$offset){total offset results{id properties(names:$properties){name value}}}}`,
      variables: {
        filterGroups: [{ filters: [] }],
        objectTypeId: '0-7',
        query: '',
        properties: [
          'name',
          'description',
          'price',
          'hs_sku',
          'hs_recurring_billing_period',
          'createdate',
        ],
        sorts: [
          { property: 'createdate', order: 'DESC' },
          { property: 'hs_object_id', order: 'DESC' },
        ],
        count,
        offset,
      },
    }),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  const searchResult = data.data?.crmObjectsSearch;

  if (!searchResult) {
    throw new ContractDrift('No crmObjectsSearch data in response');
  }

  const products = (searchResult.results || []).map(
    (product: Record<string, unknown>) => {
      const props: Record<string, string> = {};
      (
        (product.properties as Array<{ name: string; value: string }>) || []
      ).forEach((p) => {
        props[p.name] = p.value;
      });
      return {
        id: product.id as string,
        ...props,
      };
    },
  );

  return {
    total: searchResult.total,
    offset: searchResult.offset,
    count: products.length,
    products,
  };
}

export async function getProduct(opts: {
  csrf: string;
  portalId: string;
  productId: string;
}): Promise<{
  id: string;
  objectTypeId: string;
  [key: string]: unknown;
}> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-7/${opts.productId}`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');
  url.searchParams.set('hs_static_app', 'crm-records-ui');
  url.searchParams.set('hs_static_app_version', '1.81335');
  url.searchParams.set('allPropertiesFetchMode', 'latest_version');

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  const props = data.properties || {};
  const product: Record<string, unknown> = {
    id: data.objectId || opts.productId,
    objectTypeId: data.objectTypeId,
  };

  for (const [key, val] of Object.entries(props)) {
    product[key] = (val as { value: unknown })?.value;
  }

  product.allProperties = props;
  return product as {
    id: string;
    objectTypeId: string;
    [key: string]: unknown;
  };
}

export async function createProduct(opts: {
  csrf: string;
  portalId: string;
  name: string;
  price?: string;
  description?: string;
  hs_sku?: string;
}): Promise<{ objectId: number; _rawResponse?: unknown }> {
  const url = new URL(
    `${window.location.origin}/api/chirp-frontend-app/v1/gateway/com.hubspot.crm.object.builder.rpc.ObjectBuilderRpc/createObjectAndAssociations`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '5000');
  url.searchParams.set('hs_static_app', 'object-builder-ui');
  url.searchParams.set('hs_static_app_version', '1.53263');

  const properties: Array<{ name: string; value: string; source: string }> = [
    { name: 'name', value: opts.name, source: 'CRM_UI' },
  ];

  if (opts.price != null)
    properties.push({
      name: 'price',
      value: String(opts.price),
      source: 'CRM_UI',
    });
  if (opts.description)
    properties.push({
      name: 'description',
      value: opts.description,
      source: 'CRM_UI',
    });
  if (opts.hs_sku)
    properties.push({ name: 'hs_sku', value: opts.hs_sku, source: 'CRM_UI' });

  properties.push({
    name: 'hs_all_assigned_business_unit_ids',
    value: '0',
    source: 'CRM_UI',
  });

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({
      createRequest: {
        objectTypeId: '0-7',
        properties,
        associations: [],
        lineItemFromProductCreateRequests: [],
        propertySource: 'CRM_UI',
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  const data = await response.json();

  const objectId =
    data.data?.result?.crmObject?.objectId ?? data.objectId ?? data.id;

  return {
    objectId: objectId as number,
    _rawResponse: data,
  };
}

export async function updateProduct(opts: {
  csrf: string;
  portalId: string;
  productId: string;
  properties: Record<string, string>;
}): Promise<{
  updated: true;
  productId: string;
  properties: Record<string, string>;
}> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-7`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');
  url.searchParams.set('hs_static_app', 'crm-records-ui');
  url.searchParams.set('hs_static_app_version', '1.81335');

  const propertyValues = Object.entries(opts.properties).map(
    ([name, value]) => ({
      name,
      value,
    }),
  );

  const response = await fetch(url.toString(), {
    method: 'PUT',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify([
      {
        objectId: opts.productId,
        propertyValues,
      },
    ]),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  return {
    updated: true,
    productId: opts.productId,
    properties: opts.properties,
  };
}

export async function deleteProduct(opts: {
  csrf: string;
  portalId: string;
  productId: string;
}): Promise<void> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-7/${opts.productId}`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');
  url.searchParams.set('hs_static_app', 'crm-records-ui');
  url.searchParams.set('hs_static_app_version', '1.81335');

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (response.status !== 204 && !response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }
}

// Quotes (0-14)

export async function listQuotes(opts: {
  csrf: string;
  portalId: string;
  count?: number;
  offset?: number;
}): Promise<{
  total: number;
  offset: number;
  count: number;
  quotes: Array<{
    id: string;
    [key: string]: string;
  }>;
}> {
  const count = opts.count ?? 25;
  const offset = opts.offset ?? 0;

  const url = new URL(`${window.location.origin}/api/graphql/crm`);
  url.searchParams.set('hs_static_app', 'crm-index-ui');
  url.searchParams.set('hs_static_app_version', '2.50992');
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({
      operationName: 'CrmObjectsSearchQuery',
      query: `query CrmObjectsSearchQuery($filterGroups:[FilterGroup!]!$sorts:[Sort!]$query:String$objectTypeId:String!$properties:[String!]!$count:Int$offset:Int){crmObjectsSearch(filterGroups:$filterGroups sorts:$sorts query:$query type:$objectTypeId count:$count offset:$offset){total offset results{id properties(names:$properties){name value}}}}`,
      variables: {
        filterGroups: [{ filters: [] }],
        objectTypeId: '0-14',
        query: '',
        properties: [
          'hs_title',
          'hs_expiration_date',
          'hs_status',
          'hs_quote_amount',
          'createdate',
          'hubspot_owner_id',
        ],
        sorts: [{ property: 'createdate', order: 'DESC' }],
        count,
        offset,
      },
    }),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  const searchResult = data.data?.crmObjectsSearch;

  if (!searchResult) {
    throw new ContractDrift('No crmObjectsSearch data in response');
  }

  const quotes = (searchResult.results || []).map(
    (quote: Record<string, unknown>) => {
      const props: Record<string, string> = {};
      (
        (quote.properties as Array<{ name: string; value: string }>) || []
      ).forEach((p) => {
        props[p.name] = p.value;
      });
      return { id: quote.id as string, ...props };
    },
  );

  return {
    total: searchResult.total,
    offset: searchResult.offset,
    count: quotes.length,
    quotes,
  };
}

export async function getQuote(opts: {
  csrf: string;
  portalId: string;
  quoteId: string;
}): Promise<{
  id: string;
  objectTypeId: string;
  [key: string]: unknown;
}> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-14/${opts.quoteId}`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');
  url.searchParams.set('hs_static_app', 'crm-records-ui');
  url.searchParams.set('hs_static_app_version', '1.81335');
  url.searchParams.set('allPropertiesFetchMode', 'latest_version');

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  const props = data.properties || {};

  const quote: Record<string, unknown> = {
    id: data.objectId || opts.quoteId,
    objectTypeId: data.objectTypeId,
  };

  for (const [key, val] of Object.entries(props)) {
    quote[key] = (val as { value: unknown })?.value;
  }

  quote.allProperties = props;
  return quote as { id: string; objectTypeId: string; [key: string]: unknown };
}

// Line Items (0-8)

export async function listLineItems(opts: {
  csrf: string;
  portalId: string;
  count?: number;
  offset?: number;
}): Promise<{
  total: number;
  offset: number;
  count: number;
  lineItems: Array<{
    id: string;
    [key: string]: string;
  }>;
}> {
  const count = opts.count ?? 25;
  const offset = opts.offset ?? 0;

  const url = new URL(`${window.location.origin}/api/graphql/crm`);
  url.searchParams.set('hs_static_app', 'crm-index-ui');
  url.searchParams.set('hs_static_app_version', '2.50992');
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({
      operationName: 'CrmObjectsSearchQuery',
      query: `query CrmObjectsSearchQuery($filterGroups:[FilterGroup!]!$sorts:[Sort!]$query:String$objectTypeId:String!$properties:[String!]!$count:Int$offset:Int){crmObjectsSearch(filterGroups:$filterGroups sorts:$sorts query:$query type:$objectTypeId count:$count offset:$offset){total offset results{id properties(names:$properties){name value}}}}`,
      variables: {
        filterGroups: [{ filters: [] }],
        objectTypeId: '0-8',
        query: '',
        properties: [
          'name',
          'quantity',
          'price',
          'amount',
          'hs_product_id',
          'createdate',
        ],
        sorts: [
          { property: 'createdate', order: 'DESC' },
          { property: 'hs_object_id', order: 'DESC' },
        ],
        count,
        offset,
      },
    }),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  const searchResult = data.data?.crmObjectsSearch;

  if (!searchResult) {
    throw new ContractDrift('No crmObjectsSearch data in response');
  }

  const lineItems = (searchResult.results || []).map(
    (item: Record<string, unknown>) => {
      const props: Record<string, string> = {};
      (
        (item.properties as Array<{ name: string; value: string }>) || []
      ).forEach((p) => {
        props[p.name] = p.value;
      });
      return {
        id: item.id as string,
        ...props,
      };
    },
  );

  return {
    total: searchResult.total,
    offset: searchResult.offset,
    count: lineItems.length,
    lineItems,
  };
}
