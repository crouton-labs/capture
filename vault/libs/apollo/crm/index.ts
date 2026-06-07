/**
 * Apollo CRM Operations (Disabled)
 *
 * Deal, Task, and Note operations (currently commented out).
 * These were disabled because CRM functions are not needed for the prospecting/sequencing workflow.
 */

// ============================================================================
// Deals (Opportunities) - COMMENTED OUT: CRM functions not needed
// ============================================================================

// COMMENTED OUT: CRM functions not needed for prospecting/sequencing workflow
// /* disabled */ async function searchDeals(opts: {
//   page?: number;
//   perPage?: number;
//   sortByField?: string;
//   sortAscending?: boolean;
// }): Promise<SearchDealsOutput> {
//   const { page = 1, perPage = 25, sortByField, sortAscending } = opts;
//
//   const body: Record<string, unknown> = {
//     page,
//     per_page: perPage,
//   };
//
//   if (sortByField !== undefined) {
//     body.sort_by_field = sortByField;
//   }
//   if (sortAscending !== undefined) {
//     body.sort_ascending = sortAscending;
//   }
//
//   const response = await fetch(
//     `${window.location.origin}/api/v1/opportunities/search`,
//     {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       credentials: 'include',
//       body: JSON.stringify(body),
//     },
//   );
//
//   if (!response.ok) throw new Error(`searchDeals failed: ${response.status}`);
//
//   return await response.json();
// }
//
// /**
//  * View a single deal/opportunity by ID.
//  */
// /* disabled */ async function viewDeal(opts: { id: string }): Promise<ViewDealOutput> {
//   const { id } = opts;
//
//   if (!id) throw new Error('id is required');
//
//   const response = await fetch(`/api/v1/opportunities/${id}`, {
//     method: 'GET',
//     credentials: 'include',
//   });
//
//   if (!response.ok) throw new Error(`viewDeal failed: ${response.status}`);
//
//   return await response.json();
// }
//
// /**
//  * Create a new deal/opportunity.
//  */
// /* disabled */ async function createDeal(opts: {
//   name: string;
//   opportunity_stage_id?: string;
//   amount?: number;
//   account_id?: string;
//   owner_id?: string;
//   closed_date?: string;
//   description?: string;
//   source?: string;
// }): Promise<CreateDealOutput> {
//   const {
//     name,
//     opportunity_stage_id,
//     amount,
//     account_id,
//     owner_id,
//     closed_date,
//     description,
//     source,
//   } = opts;
//
//   if (!name) throw new Error('name is required');
//
//   const body: Record<string, unknown> = {
//     name,
//   };
//
//   if (opportunity_stage_id !== undefined)
//     body.opportunity_stage_id = opportunity_stage_id;
//
//   if (amount !== undefined) body.amount = amount;
//   if (account_id !== undefined) body.account_id = account_id;
//   if (owner_id !== undefined) body.owner_id = owner_id;
//   if (closed_date !== undefined) body.closed_date = closed_date;
//   if (description !== undefined) body.description = description;
//   if (source !== undefined) body.source = source;
//
//   const response = await fetch(
//     `${window.location.origin}/api/v1/opportunities`,
//     {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       credentials: 'include',
//       body: JSON.stringify(body),
//     },
//   );
//
//   if (!response.ok) throw new Error(`createDeal failed: ${response.status}`);
//
//   return await response.json();
// }
//
// /**
//  * Update an existing deal/opportunity.
//  */
// /* disabled */ async function updateDeal(opts: {
//   id: string;
//   name?: string;
//   amount?: number;
//   closed_date?: string;
//   account_id?: string;
//   description?: string;
//   is_closed?: boolean;
//   is_won?: boolean;
//   stage_name?: string;
//   opportunity_stage_id?: string;
//   source?: string;
//   owner_id?: string;
//   next_step?: string;
//   next_step_date?: string;
//   closed_lost_reason?: string;
//   closed_won_reason?: string;
//   forecast_category?: string;
//   deal_probability?: number;
//   probability?: number;
//   opportunity_pipeline_id?: string;
//   currency?: string;
// }): Promise<UpdateDealOutput> {
//   const { id, ...fields } = opts;
//
//   if (!id) throw new Error('id is required');
//
//   const body: Record<string, unknown> = {};
//   for (const [key, value] of Object.entries(fields)) {
//     if (value !== undefined) {
//       body[key] = value;
//     }
//   }
//
//   const response = await fetch(`/api/v1/opportunities/${id}`, {
//     method: 'PUT',
//     headers: { 'Content-Type': 'application/json' },
//     credentials: 'include',
//     body: JSON.stringify(body),
//   });
//
//   if (!response.ok) throw new Error(`updateDeal failed: ${response.status}`);
//
//   return await response.json();
// }
//
// /**
//  * Delete a deal/opportunity by ID.
//  */
// /* disabled */ async function deleteDeal(opts: {
//   id: string;
// }): Promise<DeleteDealOutput> {
//   const { id } = opts;
//
//   if (!id) throw new Error('id is required');
//
//   const base = window.location.origin;
//   const response = await fetch(`${base}/api/v1/opportunities/bulk_destroy`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     credentials: 'include',
//     body: JSON.stringify({ ids: [id] }),
//   });
//
//   if (!response.ok) throw new Error(`deleteDeal failed: ${response.status}`);
//
//   return { success: true };
// }
//
// // ============================================================================
// // Stages & Pipelines
// // ============================================================================
//
// /**
//  * List all deal/opportunity stages.
//  */
// /* disabled */ async function listDealStages(): Promise<ListDealStagesOutput> {
//   const base = window.location.origin;
//   const response = await fetch(`${base}/api/v1/opportunity_stages`, {
//     method: 'GET',
//     credentials: 'include',
//   });
//
//   if (!response.ok)
//     throw new Error(`listDealStages failed: ${response.status}`);
//
//   return await response.json();
// }
//
// /**
//  * List all deal/opportunity pipelines.
//  */
// /* disabled */ async function listDealPipelines(): Promise<ListDealPipelinesOutput> {
//   const base = window.location.origin;
//   const response = await fetch(`${base}/api/v1/opportunity_pipelines`, {
//     method: 'GET',
//     credentials: 'include',
//   });
//
//   if (!response.ok)
//     throw new Error(`listDealPipelines failed: ${response.status}`);
//
//   return await response.json();
// }
//
// // ============================================================================
// // Tasks - COMMENTED OUT: CRM functions not needed
// // ============================================================================
//
// /* COMMENTED OUT: CRM functions not needed
// /* disabled */ async function searchTasks(opts: {
//   page?: number;
//   perPage?: number;
//   sortByField?: string;
//   sortAscending?: boolean;
// }): Promise<SearchTasksOutput> {
//   const { page = 1, perPage = 25, sortByField, sortAscending } = opts;
//
//   const body: Record<string, unknown> = {
//     page,
//     per_page: perPage,
//   };
//
//   if (sortByField !== undefined) {
//     body.sort_by_field = sortByField;
//   }
//   if (sortAscending !== undefined) {
//     body.sort_ascending = sortAscending;
//   }
//
//   const base = window.location.origin;
//   const response = await fetch(`${base}/api/v1/tasks/search`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     credentials: 'include',
//     body: JSON.stringify(body),
//   });
//
//   if (!response.ok) throw new Error(`searchTasks failed: ${response.status}`);
//
//   return await response.json();
// }
//
// /**
//  * Create a new task.
//  */
// /* disabled */ async function createTask(opts: {
//   type: 'action_item' | 'call' | 'linkedin' | 'email';
//   priority: 'high' | 'medium' | 'low';
//   note: string;
//   status: 'scheduled' | 'complete';
//   user_id: string;
//   contact_ids?: string[];
//   account_id?: string;
//   opportunity_id?: string;
//   due_at?: string;
// }): Promise<CreateTaskOutput> {
//   const {
//     type,
//     priority,
//     note,
//     status,
//     user_id,
//     contact_ids,
//     account_id,
//     opportunity_id,
//     due_at,
//   } = opts;
//
//   if (!type) throw new Error('type is required');
//   if (!priority) throw new Error('priority is required');
//   if (!note) throw new Error('note is required');
//   if (!status) throw new Error('status is required');
//   if (!user_id)
//     throw new Error('user_id is required - get it from getContext()');
//
//   const body: Record<string, unknown> = {
//     type,
//     priority,
//     note,
//     status,
//     user_id,
//   };
//
//   if (contact_ids !== undefined) body.contact_ids = contact_ids;
//   if (account_id !== undefined) body.account_id = account_id;
//   if (opportunity_id !== undefined) body.opportunity_id = opportunity_id;
//   if (due_at !== undefined) body.due_at = due_at;
//
//   const base = window.location.origin;
//   const response = await fetch(`${base}/api/v1/tasks`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     credentials: 'include',
//     body: JSON.stringify(body),
//   });
//
//   if (!response.ok) throw new Error(`createTask failed: ${response.status}`);
//
//   return await response.json();
// }
//
// /**
//  * Update an existing task.
//  */
// /* disabled */ async function updateTask(opts: {
//   id: string;
//   status?: 'scheduled' | 'complete';
//   priority?: 'high' | 'medium' | 'low';
//   note?: string;
//   due_at?: string;
// }): Promise<UpdateTaskOutput> {
//   const { id, ...fields } = opts;
//
//   if (!id) throw new Error('id is required');
//
//   const body: Record<string, unknown> = {};
//   for (const [key, value] of Object.entries(fields)) {
//     if (value !== undefined) {
//       body[key] = value;
//     }
//   }
//
//   const response = await fetch(`/api/v1/tasks/${id}`, {
//     method: 'PUT',
//     headers: { 'Content-Type': 'application/json' },
//     credentials: 'include',
//     body: JSON.stringify(body),
//   });
//
//   if (!response.ok) throw new Error(`updateTask failed: ${response.status}`);
//
//   return await response.json();
// }
//
// /**
//  * Mark a task as complete.
//  * Convenience wrapper around updateTask.
//  */
// /* disabled */ async function completeTask(opts: {
//   id: string;
// }): Promise<CompleteTaskOutput> {
//   const { id } = opts;
//
//   if (!id) throw new Error('id is required');
//
//   const response = await fetch(`/api/v1/tasks/${id}`, {
//     method: 'PUT',
//     headers: { 'Content-Type': 'application/json' },
//     credentials: 'include',
//     body: JSON.stringify({ status: 'complete' }),
//   });
//
//   if (!response.ok) throw new Error(`completeTask failed: ${response.status}`);
//
//   return await response.json();
// }
//
// // ============================================================================
// // Notes - COMMENTED OUT: CRM functions not needed
// // ============================================================================
//
// /* COMMENTED OUT: CRM functions not needed
// /* disabled */ async function createNote(opts: {
//   body: string;
//   contact_id?: string;
//   account_id?: string;
//   opportunity_id?: string;
// }): Promise<CreateNoteOutput> {
//   const { body: noteBody, contact_id, account_id, opportunity_id } = opts;
//
//   if (!noteBody) throw new Error('body is required');
//
//   const requestBody: Record<string, unknown> = {
//     body: noteBody,
//   };
//
//   if (contact_id !== undefined) requestBody.contact_id = contact_id;
//   if (account_id !== undefined) requestBody.account_id = account_id;
//   if (opportunity_id !== undefined) requestBody.opportunity_id = opportunity_id;
//
//   const base = window.location.origin;
//   const response = await fetch(`${base}/api/v1/notes`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     credentials: 'include',
//     body: JSON.stringify(requestBody),
//   });
//
//   if (!response.ok) throw new Error(`createNote failed: ${response.status}`);
//
//   return await response.json();
// }
//
// /**
//  * Update an existing note.
//  */
// /* disabled */ async function updateNote(opts: {
//   id: string;
//   body?: string;
// }): Promise<UpdateNoteOutput> {
//   const { id, body: noteBody } = opts;
//
//   if (!id) throw new Error('id is required');
//
//   const requestBody: Record<string, unknown> = {};
//   if (noteBody !== undefined) requestBody.body = noteBody;
//
//   const response = await fetch(`/api/v1/notes/${id}`, {
//     method: 'PUT',
//     headers: { 'Content-Type': 'application/json' },
//     credentials: 'include',
//     body: JSON.stringify(requestBody),
//   });
//
//   if (!response.ok) throw new Error(`updateNote failed: ${response.status}`);
//
//   return await response.json();
// }
//
// /**
//  * Delete a note by ID.
//  */
// /* disabled */ async function deleteNote(opts: {
//   id: string;
// }): Promise<DeleteNoteOutput> {
//   const { id } = opts;
//
//   if (!id) throw new Error('id is required');
//
//   const response = await fetch(`/api/v1/notes/${id}`, {
//     method: 'DELETE',
//     credentials: 'include',
//   });
//
//   if (!response.ok) throw new Error(`deleteNote failed: ${response.status}`);
//
//   return { success: true };
// }
