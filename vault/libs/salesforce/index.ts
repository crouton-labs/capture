/**
 * Salesforce Library
 *
 * Browser-executable Salesforce CRM operations via internal Aura framework API.
 * Requires user to be logged into Salesforce Lightning.
 */

// Types
export type { SalesforceContext } from './context';

// Context operations
export { getContext } from './context';

// Account operations
export {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
} from './accounts';

// Contact operations
export {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
} from './contacts';

// Opportunity operations
export {
  listOpportunities,
  getOpportunity,
  createOpportunity,
  updateOpportunity,
  deleteOpportunity,
  listOpportunityLineItems,
  addOpportunityLineItem,
  removeOpportunityLineItem,
  listOpportunityContactRoles,
  addOpportunityContactRole,
  removeOpportunityContactRole,
} from './opportunities';

// Lead operations
export {
  listLeads,
  getLead,
  createLead,
  updateLead,
  deleteLead,
} from './leads';

// Case operations
export {
  listCases,
  getCase,
  createCase,
  updateCase,
  deleteCase,
  listCaseComments,
  addCaseComment,
} from './cases';

// Campaign operations
export {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  listCampaignMembers,
  addCampaignMember,
  removeCampaignMember,
} from './campaigns';

// Product operations
export {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} from './products';

// Search operations
export {
  globalSearch,
  searchRecords,
  listRecords,
  getRecord,
  executeGraphQL,
} from './search';

// Task and Note operations
export {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  createNote,
} from './tasks';

// Event and Activity operations
// ContentDocumentLink (link notes to records)
export {
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  logCall,
  logEmail,
  linkNoteToRecord,
} from './activities';

// User operations (read-only)
export { listUsers, getUser } from './users';

// Report and Dashboard operations
export {
  listReports,
  listDashboards,
  getReport,
  runReport,
  getDashboard,
  listReportFolders,
  listDashboardFolders,
} from './reports';

// Commerce operations
export {
  listCommerceChannels,
  getCommerceChannel,
  listCommerceProducts,
  listProductCategories,
  listOrderSummaries,
  getOrderSummary,
  listPromotions,
  getPromotion,
} from './commerce';

// Quick Text operations
export {
  listQuickText,
  getQuickText,
  createQuickText,
  updateQuickText,
  deleteQuickText,
} from './quicktext';

// Segments & Marketing operations
export {
  listSegments,
  convertLead,
  listConsentImports,
  listSubscriptions,
  getSegment,
  createSegment,
  updateSegment,
  deleteSegment,
} from './segments';

// Schema & Metadata operations
export {
  listCustomObjects,
  getObjectInfo,
  listObjectFields,
  getPicklistValues,
  listValidationRules,
  getObjectProperties,
} from './schema';

// Flow operations
export { listFlows, activateFlow, deactivateFlow } from './flows';

// Security & Admin operations
export { getCompanyInfo, getSecurityHealthCheck } from './security';

// Record Utilities (Sales Core Extensions)
export {
  getRelatedLists,
  getMergeCandidates,
  getActivities,
  mergeRecords,
} from './record-utils';

// Change Data Capture operations
export { listCDCEntities, enableCDC, getAvailableCDCEntities } from './cdc';

// Contract operations
export {
  listContracts,
  getContract,
  createContract,
  updateContract,
  deleteContract,
} from './contracts';

// Order operations
export {
  listOrders,
  getOrder,
  createOrder,
  updateOrder,
  deleteOrder,
} from './orders';

// Asset operations
export {
  listAssets,
  getAsset,
  createAsset,
  updateAsset,
  deleteAsset,
} from './assets';

// Pricebook operations
export {
  listPricebooks,
  getPricebook,
  listPricebookEntries,
  createPricebookEntry,
} from './pricebooks';

// Knowledge operations
export { listArticles, getArticle } from './knowledge';

// Email Template operations
export { listEmailTemplates, getEmailTemplate } from './email-templates';

// Chatter operations
export {
  listFeedItems,
  createFeedItem,
  listFeedComments,
  createFeedComment,
} from './chatter';

// File operations
export { listFiles, getFile, deleteFile } from './files';

// Approval operations
export {
  listPendingApprovals,
  submitForApproval,
  approveOrReject,
} from './approvals';

// List View operations
export {
  listListViews,
  getListView,
  getListViewRecords,
  createListView,
  updateListView,
  deleteListView,
} from './list-views';

// Relationship & Association Management
export {
  getRelatedRecords,
  createRelationship,
  removeRelationship,
  listRelationshipTypes,
  getAccountHierarchy,
  getAssociatedRecords,
} from './relationships';

// Duplicate Detection & Management
export { findDuplicates, listDuplicateRules } from './duplicates';

// Pipeline & Stage Management
export {
  listOpportunityStages,
  listSalesProcesses,
  getSalesProcess,
  updateOpportunityStage,
  getOpportunityHistory,
  listForecastCategories,
  getOpportunityStagePath,
} from './pipeline';

// Custom Field Inspection (read-only, Aura-based)
export { listCustomFields, getFieldDependencies } from './fields';
