/**
 * HubSpot Library
 *
 * Browser-executable HubSpot operations via internal APIs.
 * Covers CRM, Marketing, Sales, Service, Commerce, Reporting, and Account management.
 * Requires user to be logged into HubSpot.
 */

// Re-export types from associations module
export type { AssociationLabel } from './associations';

export type { Pipeline, PipelineStage } from './pipelines';

export type { Owner } from './owners';

export type { CrmTask } from './tasks';

// Lists module does not export ContactList or ListContactsOutput
// Use types from schemas.ts instead via './lists' which imports them

export type { Form, FormSubmission } from './forms';

export type { Workflow } from './workflows';

export type {
  SubscriptionInfo,
  HubAccess,
  HubAccessEntry,
  HubTier,
  FeatureFlags,
  CreditUsage,
} from './account';

export type { MarketingEmail, EmailStats } from './marketing-email';

export type { ImportRecord } from './imports';

export type { Dashboard } from './reporting';

export type { Snippet, MeetingLink } from './sales-tools';

export type {
  ListReportsInput,
  ListReportsOutput,
  GetReportInput,
  GetReportOutput,
  RunReportInput,
  RunReportOutput,
} from './schemas';

export type {
  ListSequencesOutput,
  GetSequenceOutput,
  CreateSequenceOutput,
  UpdateSequenceOutput,
  DeleteSequenceOutput,
  ListTemplatesOutput,
  GetTemplateOutput,
  CreateTemplateOutput,
  UpdateTemplateOutput,
  DeleteTemplateOutput,
  EnrollContactOutput,
  GetEnrollmentStateOutput,
  SequenceUsageOutput,
  ListEnrollmentsOutput,
  GetSequencePerformanceOutput,
  UnenrollContactOutput,
} from './schemas';

// Context operations
export { getContext, getAccounts } from './context';

// Search operations
export { globalSearch } from './search';

// Contact operations
export {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
} from './contacts';

// Company operations
export {
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
} from './companies';

// Deal operations
export {
  listDeals,
  getDeal,
  createDeal,
  updateDeal,
  deleteDeal,
} from './deals';

// Ticket operations
export {
  listTickets,
  getTicket,
  createTicket,
  updateTicket,
  deleteTicket,
} from './tickets';

// Engagement operations
export {
  listEngagements,
  createEngagement,
  updateEngagement,
  deleteEngagement,
} from './engagements';

// Activity & Property History
export { getTimeline, getPropertyHistory } from './activity';

// Property operations
export {
  getPropertyMappings,
  getPropertyOptions,
  createProperty,
  updateProperty,
  deleteProperty,
} from './properties';

// Query & Generic CRUD
export {
  queryCrm,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
} from './query';

// Merge operations
export { mergeCompanies, mergeContacts } from './merge';

// Duplicate detection
export { findDuplicateCompanies, findDuplicateContacts } from './duplicates';

// Association operations
export {
  getAssociations,
  getAssociationLabels,
  createAssociation,
  deleteAssociation,
} from './associations';

// Pipeline operations
export {
  listPipelines,
  getPipeline,
  createPipeline,
  updatePipeline,
  deletePipeline,
  createPipelineStage,
  updatePipelineStage,
  deletePipelineStage,
} from './pipelines';

// Owner operations
export { listOwners } from './owners';

// Task operations
export { listTasks, createTask, updateTask, deleteTask } from './tasks';

// List operations
export {
  listLists,
  getList,
  getListContacts,
  createList,
  updateList,
  deleteList,
  addToList,
  removeFromList,
} from './lists';

// Form operations
export { listForms, getForm, getFormSubmissions } from './forms';

// Workflow operations
export { listWorkflows, getWorkflow } from './workflows';

// Account & Plan detection
export {
  getSubscriptionInfo,
  getHubAccess,
  getFeatureFlags,
  getCreditUsage,
} from './account';

// Marketing Email operations
export {
  listMarketingEmails,
  getMarketingEmail,
  getEmailStats,
} from './marketing-email';

// Commerce operations (Products, Quotes, Line Items)
export {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  listQuotes,
  getQuote,
  listLineItems,
} from './commerce';

// Import operations
export { listImports, getImport } from './imports';

// Reporting operations
export {
  listDashboards,
  getDashboard,
  listReports,
  getReport,
  runReport,
  createReport,
  updateReport,
  deleteReport,
} from './reporting';

// Sales tools operations
export { listSnippets, listMeetingLinks } from './sales-tools';

// Sequences operations
export {
  listSequences,
  getSequence,
  createSequence,
  updateSequence,
  deleteSequence,
  addSequenceStep,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  enrollContact,
  getEnrollmentState,
  getSequenceUsage,
  listEnrollments,
  getSequencePerformance,
  unenrollContact,
} from './sequences';

// View operations
export {
  listViews,
  getView,
  createView,
  updateView,
  deleteView,
} from './views';

// Pinned Properties operations
export {
  getPinnedProperties,
  updatePinnedProperties,
  resetPinnedProperties,
} from './pinned-properties';
