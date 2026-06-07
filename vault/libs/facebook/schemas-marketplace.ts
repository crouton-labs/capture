import { z } from 'zod';

const MPOutput = z.object({ data: z.unknown() }).passthrough();

const BuyLocation = z
  .object({ latitude: z.number(), longitude: z.number() })
  .describe('Geo center used to rank local listings.');

export const listMarketplaceFeedSchema = {
  name: 'listMarketplaceFeed',
  description:
    'List the Marketplace browse feed for a geographic center and radius.',
  notes:
    'Paginated with an opaque `cursor` returned by each response. `radius` is in meters; defaults match the UI default of ~65 km.',
  input: z.object({
    buyLocation: BuyLocation,
    count: z.number().optional().default(24),
    cursor: z.string().nullable().optional(),
    radius: z.number().optional().default(65000),
  }),
  output: MPOutput,
};

export const getMarketplaceListingSchema = {
  name: 'getMarketplaceListing',
  description: 'Get full detail for a single Marketplace listing by id.',
  notes: '',
  input: z.object({
    targetId: z.string().describe('Marketplace listing id (numeric string).'),
  }),
  output: MPOutput,
};

export const getMarketplaceListingImagesSchema = {
  name: 'getMarketplaceListingImages',
  description:
    'Get the gallery media (images) for a single Marketplace listing.',
  notes: '',
  input: z.object({ targetId: z.string() }),
  output: MPOutput,
};

export const saveMarketplaceListingSchema = {
  name: 'saveMarketplaceListing',
  description: "Save a Marketplace listing to the viewer's Saved collection.",
  notes:
    '`storyId` is the base64-ish story token (format `UzpfSTxxx:VK:yyy`) returned inside the PDP response, not the numeric listing id.',
  input: z.object({
    storyId: z
      .string()
      .describe('Story token for the listing (from the PDP response).'),
  }),
  output: MPOutput,
};

export const unsaveMarketplaceListingSchema = {
  name: 'unsaveMarketplaceListing',
  description:
    "Remove a previously saved Marketplace listing from the viewer's Saved collection.",
  notes: '',
  input: z.object({ storyId: z.string() }),
  output: MPOutput,
};

export const listMarketplaceNotificationsSchema = {
  name: 'listMarketplaceNotifications',
  description:
    'List Marketplace notifications (price drops, saved-seller updates).',
  notes: '',
  input: z.object({}),
  output: MPOutput,
};

export const getMarketplaceCategoriesSchema = {
  name: 'getMarketplaceCategories',
  description: 'Get the Marketplace left-rail category tree.',
  notes: '',
  input: z.object({ buyLocation: BuyLocation }),
  output: MPOutput,
};

export const getMarketplaceBadgeCountSchema = {
  name: 'getMarketplaceBadgeCount',
  description: 'Get the unseen Marketplace badge count for the viewer.',
  notes: '',
  input: z.object({}),
  output: MPOutput,
};

export type ListMarketplaceFeedInput = z.infer<
  typeof listMarketplaceFeedSchema.input
>;
export type GetMarketplaceListingInput = z.infer<
  typeof getMarketplaceListingSchema.input
>;
export type GetMarketplaceListingImagesInput = z.infer<
  typeof getMarketplaceListingImagesSchema.input
>;
export type SaveMarketplaceListingInput = z.infer<
  typeof saveMarketplaceListingSchema.input
>;
export type UnsaveMarketplaceListingInput = z.infer<
  typeof unsaveMarketplaceListingSchema.input
>;
export type ListMarketplaceNotificationsInput = z.infer<
  typeof listMarketplaceNotificationsSchema.input
>;
export type GetMarketplaceCategoriesInput = z.infer<
  typeof getMarketplaceCategoriesSchema.input
>;
export type GetMarketplaceBadgeCountInput = z.infer<
  typeof getMarketplaceBadgeCountSchema.input
>;
export type MarketplaceResponse = z.infer<typeof MPOutput>;
