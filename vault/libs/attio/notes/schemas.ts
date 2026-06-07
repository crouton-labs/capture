import { z } from 'zod';

const SlugParam = z.string().describe('Workspace slug from getContext()');

export const NoteListItemSchema = z.object({
  noteId: z.string().describe('Note UUID'),
  createdAt: z.string().describe('ISO creation timestamp'),
  createdByActorId: z.string().describe('Creator UUID'),
  parentEntityDefinitionId: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Entity definition UUID of the linked record type. Match against getContext() entityDefinitions to determine whether it is a company, person, etc.',
    ),
  parentEntityInstanceId: z
    .string()
    .nullable()
    .optional()
    .describe('UUID of the specific record this note is linked to'),
});

export const listNotesSchema = {
  name: 'listNotes',
  description:
    'List all notes in the workspace, optionally filtered by linked record type or specific record',
  notes:
    'To filter by record type, pass parentEntityDefinitionId from getContext() entityDefinitions. To filter by specific record, also pass parentEntityInstanceId.',
  input: z.object({
    slug: SlugParam,
    parentEntityDefinitionId: z
      .string()
      .optional()
      .describe(
        'Filter to notes linked to this entity definition UUID. Obtain from getContext() entityDefinitions.',
      ),
    parentEntityInstanceId: z
      .string()
      .optional()
      .describe(
        'Filter to notes linked to this specific record UUID. Requires parentEntityDefinitionId when provided.',
      ),
  }),
  output: z.object({
    notes: z.array(NoteListItemSchema).describe('Note metadata records'),
  }),
};

export const createNoteSchema = {
  name: 'createNote',
  description:
    'Create a note linked to a company, person, or other record type',
  notes:
    'Note content body is not supported (title only). Obtain entityDefinitionId from getContext() entityDefinitions; obtain recordId from list/search functions.',
  input: z.object({
    slug: SlugParam,
    entityDefinitionId: z
      .string()
      .describe(
        'Entity definition UUID for the parent record type. Obtain from getContext() entityDefinitions.',
      ),
    recordId: z
      .string()
      .describe(
        'UUID of the record to attach the note to. Obtain from listPeople(), listCompanies(), or searchRecords().',
      ),
    title: z
      .string()
      .describe('Note title (only text content supported, no body)'),
  }),
  output: z.object({
    noteId: z.string().describe('Note UUID'),
    title: z.string().describe('Note title'),
    createdAt: z.string().describe('ISO creation timestamp'),
    createdBy: z.string().describe('Creator user UUID'),
  }),
};

export const updateNoteSchema = {
  name: 'updateNote',
  description: 'Update the title of an existing note',
  notes: 'Obtain noteId from listNotes().',
  input: z.object({
    slug: SlugParam,
    noteId: z.string().describe('Note UUID'),
    title: z.string().describe('New note title'),
  }),
  output: z.object({
    noteId: z.string().describe('Note UUID'),
    title: z.string().describe('Updated note title'),
    createdAt: z.string().describe('ISO creation timestamp'),
  }),
};

export const deleteNoteSchema = {
  name: 'deleteNote',
  description: 'Permanently delete a note by UUID',
  notes: 'Obtain noteId from listNotes(). This operation is irreversible.',
  input: z.object({
    slug: SlugParam,
    noteId: z.string().describe('Note UUID'),
  }),
  output: z.object({
    success: z.boolean().describe('True if deleted successfully'),
  }),
};

export type NoteListItem = z.infer<typeof NoteListItemSchema>;
export type CreateNoteOutput = z.infer<typeof createNoteSchema.output>;
export type ListNotesOutput = z.infer<typeof listNotesSchema.output>;
export type UpdateNoteOutput = z.infer<typeof updateNoteSchema.output>;
export type DeleteNoteOutput = z.infer<typeof deleteNoteSchema.output>;
