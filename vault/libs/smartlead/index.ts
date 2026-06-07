/**
 * SmartLead Library
 *
 * Browser-executable SmartLead operations via internal APIs.
 * Requires user to be logged into SmartLead at app.smartlead.ai.
 */

export type { GetContextOutput } from './schemas';
export type {
  ListCampaignsInput,
  ListCampaignsOutput,
  CreateCampaignInput,
  CreateCampaignOutput,
  GetCampaignInput,
  GetCampaignOutput,
  DeleteCampaignInput,
  DeleteCampaignOutput,
  ResumeCampaignInput,
  ResumeCampaignOutput,
  GetCampaignAnalyticsInput,
  GetCampaignAnalyticsOutput,
  PauseCampaignInput,
  PauseCampaignOutput,
  UpdateCampaignInput,
  UpdateCampaignOutput,
} from './campaigns/schemas';
export type {
  GetSequencesInput,
  GetSequencesOutput,
  SaveSequencesInput,
  SaveSequencesOutput,
} from './sequences/schemas';
export type {
  AddLeadsToCampaignInput,
  AddLeadsToCampaignOutput,
  ListCampaignLeadsInput,
  ListCampaignLeadsOutput,
  UpdateLeadCategoryInput,
  UpdateLeadCategoryOutput,
  PauseLeadInput,
  PauseLeadOutput,
  ResumeLeadInput,
  ResumeLeadOutput,
  DeleteLeadInput,
  DeleteLeadOutput,
  ExportLeadsInput,
  ExportLeadsOutput,
} from './leads/schemas';
export type {
  ListCampaignEmailAccountsInput,
  ListCampaignEmailAccountsOutput,
  AddEmailAccountsToCampaignInput,
  AddEmailAccountsToCampaignOutput,
  RemoveEmailAccountFromCampaignInput,
  RemoveEmailAccountFromCampaignOutput,
} from './campaign-accounts/schemas';
export type {
  ListEmailAccountsInput,
  ListEmailAccountsOutput,
  GetEmailAccountInput,
  GetEmailAccountOutput,
  CreateEmailAccountInput,
  CreateEmailAccountOutput,
  UpdateEmailAccountInput,
  UpdateEmailAccountOutput,
  DeleteEmailAccountInput,
  DeleteEmailAccountOutput,
  GetWarmupStatusInput,
  GetWarmupStatusOutput,
  UpdateWarmupSettingsInput,
  UpdateWarmupSettingsOutput,
} from './email-accounts/schemas';
export type {
  ListAllLeadsInput,
  ListAllLeadsOutput,
  GetLeadCountsByTypeInput,
  GetLeadCountsByTypeOutput,
  ListLeadListsInput,
  ListLeadListsOutput,
} from './crm/schemas';
export type {
  SearchProspectsInput,
  SearchProspectsOutput,
  ListSavedSearchesInput,
  ListSavedSearchesOutput,
  ListRecentSearchesInput,
  ListRecentSearchesOutput,
} from './prospect/schemas';
export type {
  GetCampaignPerformanceInput,
  GetCampaignPerformanceOutput,
} from './analytics/schemas';
export type {
  ListTeamMembersInput,
  ListTeamMembersOutput,
  ListWebhooksInput,
  ListWebhooksOutput,
  ListTagsInput,
  ListTagsOutput,
  ListLeadCategoriesInput,
  ListLeadCategoriesOutput,
} from './settings/schemas';

export { getContext } from './context';
export {
  listCampaigns,
  createCampaign,
  getCampaign,
  deleteCampaign,
  resumeCampaign,
  getCampaignAnalytics,
  pauseCampaign,
  updateCampaign,
} from './campaigns';
export { getSequences, saveSequences } from './sequences';
export {
  addLeadsToCampaign,
  listCampaignLeads,
  updateLeadCategory,
  pauseLead,
  resumeLead,
  deleteLead,
  exportLeads,
} from './leads';
export {
  listCampaignEmailAccounts,
  addEmailAccountsToCampaign,
  removeEmailAccountFromCampaign,
} from './campaign-accounts';
export {
  listEmailAccounts,
  getEmailAccount,
  createEmailAccount,
  updateEmailAccount,
  deleteEmailAccount,
  getWarmupStatus,
  updateWarmupSettings,
} from './email-accounts';
export { listAllLeads, getLeadCountsByType, listLeadLists } from './crm';
export {
  searchProspects,
  listSavedSearches,
  listRecentSearches,
} from './prospect';
export { getCampaignPerformance } from './analytics';
export {
  listTeamMembers,
  listWebhooks,
  listTags,
  listLeadCategories,
} from './settings';
