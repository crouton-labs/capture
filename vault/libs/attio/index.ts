// Root barrel; re-exports from all domain modules

// Context
export { getContext } from './context';

// People
export {
  listPeople,
  getPerson,
  createPerson,
  updatePerson,
  deletePerson,
} from './people';

// Companies
export {
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
} from './companies';

// Deals
export {
  listDeals,
  getDeal,
  createDeal,
  updateDeal,
  deleteDeal,
} from './deals';

// Tasks
export {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
} from './tasks';

// Notes
export { listNotes, createNote, updateNote, deleteNote } from './notes';

// Meta & Search
export { listObjects, listUsers, listLists, searchRecords } from './meta';
