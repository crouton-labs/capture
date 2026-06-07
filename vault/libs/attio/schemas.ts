// Root schema barrel; imports from domain schemas, exports allSchemas + library metadata

// Context
import { getContextSchema } from './context/schemas';
export { getContextSchema, EntityDefinitionSchema } from './context/schemas';
export type { EntityDefinition, GetContextOutput } from './context/schemas';

// People
import {
  listPeopleSchema,
  getPersonSchema,
  createPersonSchema,
  updatePersonSchema,
  deletePersonSchema,
} from './people/schemas';
export {
  listPeopleSchema,
  getPersonSchema,
  createPersonSchema,
  updatePersonSchema,
  deletePersonSchema,
  PersonSchema,
} from './people/schemas';
export type {
  Person,
  ListPeopleOutput,
  GetPersonOutput,
  CreatePersonOutput,
  UpdatePersonOutput,
  DeletePersonOutput,
} from './people/schemas';

// Companies
import {
  listCompaniesSchema,
  getCompanySchema,
  createCompanySchema,
  updateCompanySchema,
  deleteCompanySchema,
} from './companies/schemas';
export {
  listCompaniesSchema,
  getCompanySchema,
  createCompanySchema,
  updateCompanySchema,
  deleteCompanySchema,
  CompanySchema,
  CompanyLocationSchema,
  CompanySocialMediaSchema,
} from './companies/schemas';
export type {
  Company,
  ListCompaniesOutput,
  GetCompanyOutput,
  CreateCompanyOutput,
  UpdateCompanyOutput,
  DeleteCompanyOutput,
} from './companies/schemas';

// Deals
import {
  listDealsSchema,
  getDealSchema,
  createDealSchema,
  updateDealSchema,
  deleteDealSchema,
} from './deals/schemas';
export {
  listDealsSchema,
  getDealSchema,
  createDealSchema,
  updateDealSchema,
  deleteDealSchema,
  DealSchema,
} from './deals/schemas';
export type {
  Deal,
  ListDealsOutput,
  GetDealOutput,
  CreateDealOutput,
  UpdateDealOutput,
  DeleteDealOutput,
} from './deals/schemas';

// Tasks
import {
  listTasksSchema,
  getTaskSchema,
  createTaskSchema,
  updateTaskSchema,
  deleteTaskSchema,
} from './tasks/schemas';
export {
  listTasksSchema,
  getTaskSchema,
  createTaskSchema,
  updateTaskSchema,
  deleteTaskSchema,
  TaskSchema,
} from './tasks/schemas';
export type {
  Task,
  CreateTaskOutput,
  ListTasksOutput,
  GetTaskOutput,
  UpdateTaskOutput,
  DeleteTaskOutput,
} from './tasks/schemas';

// Notes
import {
  listNotesSchema,
  createNoteSchema,
  updateNoteSchema,
  deleteNoteSchema,
} from './notes/schemas';
export {
  listNotesSchema,
  createNoteSchema,
  updateNoteSchema,
  deleteNoteSchema,
  NoteListItemSchema,
} from './notes/schemas';
export type {
  NoteListItem,
  CreateNoteOutput,
  ListNotesOutput,
  UpdateNoteOutput,
  DeleteNoteOutput,
} from './notes/schemas';

// Meta & Search
import {
  listObjectsSchema,
  listUsersSchema,
  listListsSchema,
  searchRecordsSchema,
} from './meta/schemas';
export {
  listObjectsSchema,
  listUsersSchema,
  listListsSchema,
  searchRecordsSchema,
  ObjectTypeSchema,
  AttributeDefinitionSchema,
  UserSchema,
  ListSchema,
  SearchResultSchema,
} from './meta/schemas';
export type {
  ListObjectsOutput,
  ListUsersOutput,
  ListListsOutput,
  SearchRecordsOutput,
} from './meta/schemas';

// ============================================================================
// Library Metadata
// ============================================================================

export const libraryDescription =
  'Attio CRM operations via internal web app APIs';

export const libraryIcon = '/icons/libs/attio.ico';
export const loginUrl = 'https://app.attio.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://app.attio.com\`
2. Call \`getContext()\` to get \`{ slug, workspaceId, userId, entityDefinitions }\`
3. Use \`slug\` in all subsequent calls
4. Use entity definition IDs for record operations (IDs are workspace-specific, always fetch dynamically)

## Key Concepts

- **Workspace slug**: First path segment in all API URLs and all Attio URLs. Extract from \`window.ATTIO_DEHYDRATED_WORKSPACES[0].slug\`
- **Entity definitions**: Dynamic types (Companies, People, custom objects) returned by \`getContext()\`. IDs vary per workspace; never hardcode. Use the \`slug\` field (e.g. "companies", "people") to identify the right definition.
- **Record IDs**: All entity records use UUIDs. Obtain via list/search functions. IDs are stable within a workspace.
- **Pagination**: Use \`limit\` param on list functions (default: 100). No cursor; list functions return all records up to the limit.
- **Tasks**: Standalone only. Record linking is not supported. Visibility must be "public" or "private".
- **Notes**: Note creation is title-only. Content body is not supported via this library.
- **Pipeline stages**: Stage names for deals (and other custom objects) are workspace-specific. Use \`listObjects()\` to discover available attribute definitions including valid stage options before setting a stage.
- **Eventual consistency**: List functions use a record-index API that may not reflect records just created. If a newly-created record is not found via list, use \`searchRecords()\` or the get-by-ID function instead.
`;

// ============================================================================
// All Schemas (agent discovery)
// ============================================================================

export const allSchemas = [
  // Context
  getContextSchema,
  // People
  listPeopleSchema,
  getPersonSchema,
  createPersonSchema,
  updatePersonSchema,
  deletePersonSchema,
  // Companies
  listCompaniesSchema,
  getCompanySchema,
  createCompanySchema,
  updateCompanySchema,
  deleteCompanySchema,
  // Deals
  listDealsSchema,
  getDealSchema,
  createDealSchema,
  updateDealSchema,
  deleteDealSchema,
  // Tasks
  listTasksSchema,
  getTaskSchema,
  createTaskSchema,
  updateTaskSchema,
  deleteTaskSchema,
  // Notes
  listNotesSchema,
  createNoteSchema,
  updateNoteSchema,
  deleteNoteSchema,
  // Meta & Search
  listObjectsSchema,
  listUsersSchema,
  listListsSchema,
  searchRecordsSchema,
];
