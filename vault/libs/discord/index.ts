/**
 * Discord Library
 *
 * Browser-executable Discord operations via the internal v9 REST API.
 * Requires user to be logged into Discord at https://discord.com/channels/@me.
 */

// Entity & I/O types from schemas
export type {
  // Entities
  User,
  Attachment,
  Embed,
  Message,
  Application,
  Entitlement,
  Guild,
  MutualGuild,
  GuildMember,
  MemberListGroup,
  MemberListOp,
  ConnectedAccount,
  UserProfile,
  Channel,
  Invite,
  Sticker,
  StickerPack,
  Integration,
  GuildPowerup,
  StoreSkuListing,
  PaymentSource,
  Subscription,
  // Context
  DiscordContext,
  GetContextInput,
  GetContextOutput,
  GetSurfacePreferenceInput,
  GetSurfacePreferenceOutput,
  SetSurfacePreferenceInput,
  SetSurfacePreferenceOutput,
  // Messages
  ListMessagesInput,
  ListMessagesOutput,
  SendMessageInput,
  SendMessageOutput,
  SendTypingInput,
  SendTypingOutput,
  MarkChannelReadInput,
  MarkChannelReadOutput,
  GreetChannelInput,
  GreetChannelOutput,
  CreateDMFriendInput,
  CreateDMFriendOutput,
  CreateDMDesktopDOMInput,
  CreateDMDesktopDOMOutput,
  GetStickerInput,
  GetStickerOutput,
  GetStickerPackInput,
  GetStickerPackOutput,
  // Relationships
  Relationship,
  ListRelationshipsInput,
  ListRelationshipsOutput,
  AddFriendInput,
  AddFriendOutput,
  AddFriendByIdInput,
  AddFriendByIdOutput,
  // Guilds
  ListGuildsInput,
  ListGuildsOutput,
  ListGuildMembersInput,
  ListGuildMembersOutput,
  SearchGuildMembersInput,
  SearchGuildMembersOutput,
  CreateGuildInput,
  CreateGuildOutput,
  CreateChannelInviteInput,
  CreateChannelInviteOutput,
  ListGuildIntegrationsInput,
  ListGuildIntegrationsOutput,
  ListGuildEntitlementsInput,
  ListGuildEntitlementsOutput,
  ListGuildPowerupsInput,
  ListGuildPowerupsOutput,
  // Users
  GetUserProfileInput,
  GetUserProfileOutput,
  GetInboxInput,
  GetInboxOutput,
  ListMfaCredentialsInput,
  ListMfaCredentialsOutput,
  GetReferralEligibilityInput,
  GetReferralEligibilityOutput,
  GetUserSettingsInput,
  GetUserSettingsOutput,
  UpdateUserSettingsInput,
  UpdateUserSettingsOutput,
  ListUnclaimedGamesInput,
  ListUnclaimedGamesOutput,
  ListPaymentSourcesInput,
  ListPaymentSourcesOutput,
  ListBillingSubscriptionsInput,
  ListBillingSubscriptionsOutput,
  // Applications
  ListApplicationsInput,
  ListApplicationsOutput,
  ListOauthTokensInput,
  ListOauthTokensOutput,
  ListApplicationEntitlementsInput,
  ListApplicationEntitlementsOutput,
  ListEntitlementsInput,
  ListEntitlementsOutput,
  ListGamesInput,
  ListGamesOutput,
  ListGameExclusionsInput,
  ListGameExclusionsOutput,
  // Commerce
  ListPromotionsInput,
  ListPromotionsOutput,
  ListCollectiblesMarketingInput,
  ListCollectiblesMarketingOutput,
  GetCheckoutRecoveryInput,
  GetCheckoutRecoveryOutput,
  CreateUserOfferInput,
  CreateUserOfferOutput,
  GetStorefrontConfigInput,
  GetStorefrontConfigOutput,
  GetStorefrontEligibilityInput,
  GetStorefrontEligibilityOutput,
  ListGuildStoreSkusInput,
  ListGuildStoreSkusOutput,
  // Quests
  ListQuestsInput,
  ListQuestsOutput,
  GetQuestPlacementInput,
  GetQuestPlacementOutput,
  RecordQuestDecisionInput,
  RecordQuestDecisionOutput,
} from './schemas';

// Tier 1: context + messaging
export {
  getContext,
  getSurfacePreference,
  setSurfacePreference,
} from './context';
export {
  listMessages,
  sendMessage,
  sendTyping,
  greetChannel,
  markChannelRead,
  createDMFriend,
  createDMDesktopDOM,
  sendMessageDesktopDOM,
  getSticker,
  getStickerPack,
} from './messages';

// Navigation (SPA channel-switch via Discord's own router)
export { selectChannel } from './gateway';
export type { SelectChannelInput } from './gateway';

// Guilds
export {
  listGuilds,
  listGuildMembers,
  searchGuildMembers,
  createGuild,
  createChannelInvite,
  listGuildIntegrations,
  listGuildEntitlements,
  listGuildPowerups,
} from './guilds';

// Relationships (friends, blocks, requests)
export { listRelationships, addFriend, addFriendById } from './relationships';

// Tier 2: users + settings + inbox
export {
  getUserProfile,
  getInbox,
  listMfaCredentials,
  getReferralEligibility,
  getUserSettings,
  updateUserSettings,
  listUnclaimedGames,
  listPaymentSources,
  listBillingSubscriptions,
} from './users';

// Tier 3: applications + entitlements + games
export {
  listApplications,
  listOauthTokens,
  listApplicationEntitlements,
  listEntitlements,
  listGames,
  listGameExclusions,
} from './applications';

// Tier 4: commerce / promotions / store
export {
  listPromotions,
  listCollectiblesMarketing,
  getCheckoutRecovery,
  createUserOffer,
  getStorefrontConfig,
  getStorefrontEligibility,
  listGuildStoreSkus,
} from './commerce';

// Tier 5: quests
export { listQuests, getQuestPlacement, recordQuestDecision } from './quests';
