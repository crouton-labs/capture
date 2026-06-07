import { z } from 'zod';
import {
  DscParam,
  BoardIdParam,
  CardIdParam,
  LabelIdParam,
  LabelSchema,
} from '../params';

// ============================================================================
// Local Params
// ============================================================================

const LabelColorParam = z
  .enum([
    'yellow',
    'purple',
    'blue',
    'red',
    'green',
    'orange',
    'black',
    'sky',
    'pink',
    'lime',
    'yellow_light',
    'purple_light',
    'blue_light',
    'red_light',
    'green_light',
    'orange_light',
    'black_light',
    'sky_light',
    'pink_light',
    'lime_light',
    'yellow_dark',
    'purple_dark',
    'blue_dark',
    'red_dark',
    'green_dark',
    'orange_dark',
    'black_dark',
    'sky_dark',
    'pink_dark',
    'lime_dark',
    'null',
  ])
  .nullable()
  .describe(
    'Label color. Standard: yellow, purple, blue, red, green, orange, black, sky, pink, lime. Subtle (lighter): append _light (e.g. green_light). Bold (darker): append _dark (e.g. green_dark). Or null for no color.',
  );

// ============================================================================
// Function Schemas
// ============================================================================

export const listLabelsSchema = {
  name: 'listLabels',
  description: 'List all labels defined on a board.',
  notes: '',
  input: z.object({
    boardId: BoardIdParam,
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Maximum number of labels to return. Must be >= 1. Omit to return all labels on the board.',
      ),
    fields: z
      .string()
      .optional()
      .describe(
        "Comma-separated list of label fields to return, or 'all' for all fields. Default fields: id, idBoard, name, color, uses. No additional fields are returned for 'all'; the API does not expose extra label fields.",
      ),
  }),
  output: z.object({
    labels: z.array(LabelSchema).describe('Labels defined on the board'),
  }),
};

export type ListLabelsInput = z.infer<typeof listLabelsSchema.input>;
export type ListLabelsOutput = z.infer<typeof listLabelsSchema.output>;

export const addLabelToCardSchema = {
  name: 'addLabelToCard',
  description: 'Add an existing board label to a card.',
  notes: 'The label must already exist on the board that contains the card.',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
    labelId: LabelIdParam,
  }),
  output: z.object({
    labelIds: z
      .array(z.string())
      .describe(
        'All label IDs currently applied to the card after the operation',
      ),
  }),
};

export type AddLabelToCardInput = z.infer<typeof addLabelToCardSchema.input>;
export type AddLabelToCardOutput = z.infer<typeof addLabelToCardSchema.output>;

export const createLabelSchema = {
  name: 'createLabel',
  description:
    'Create a new label on a board. The label can then be added to cards on that board.',
  notes:
    'Use listLabels to check existing labels before creating duplicates. Label names can be empty string.',
  input: z.object({
    dsc: DscParam,
    idBoard: BoardIdParam.describe(
      'Board ID. Must be the 24-char hex ID (e.g. "69bda4b55fba1e0392ebbe06"). Short link slugs (e.g. "JRX8Zj2a") are NOT accepted by this endpoint and return 400; use listBoards or getBoard to look up the full hex ID.',
    ),
    name: z
      .string()
      .describe('Label display name. Can be empty string for unnamed labels.'),
    color: LabelColorParam.optional().describe(
      'Label color. Standard: yellow, purple, blue, red, green, orange, black, sky, pink, lime. Subtle (lighter): append _light (e.g. green_light). Bold (darker): append _dark (e.g. green_dark). Omit or pass null for no color.',
    ),
  }),
  output: z.object({
    label: z.object({
      id: LabelIdParam,
      name: z.string().describe('Label display name'),
      color: z
        .string()
        .nullable()
        .describe('Label color, or null if no color assigned'),
      idBoard: BoardIdParam,
      uses: z
        .number()
        .describe(
          'Number of cards currently using this label (always 0 on create)',
        ),
    }),
  }),
};

export type CreateLabelInput = z.infer<typeof createLabelSchema.input>;
export type CreateLabelOutput = z.infer<typeof createLabelSchema.output>;

export const updateLabelSchema = {
  name: 'updateLabel',
  description: "Update a label's name or color.",
  notes:
    'Color cannot be removed from an existing label via this endpoint; Trello does not support unsetting a label color. To create a colorless label, use createLabel with color: null.',
  input: z.object({
    dsc: DscParam,
    labelId: LabelIdParam,
    name: z.string().optional().describe('New label display name'),
    color: z
      .enum([
        'yellow',
        'purple',
        'blue',
        'red',
        'green',
        'orange',
        'black',
        'sky',
        'pink',
        'lime',
        'yellow_light',
        'purple_light',
        'blue_light',
        'red_light',
        'green_light',
        'orange_light',
        'black_light',
        'sky_light',
        'pink_light',
        'lime_light',
        'yellow_dark',
        'purple_dark',
        'blue_dark',
        'red_dark',
        'green_dark',
        'orange_dark',
        'black_dark',
        'sky_dark',
        'pink_dark',
        'lime_dark',
      ])
      .optional()
      .describe(
        'New label color. Standard: yellow, purple, blue, red, green, orange, black, sky, pink, lime. Subtle (lighter): append _light (e.g. green_light). Bold (darker): append _dark (e.g. green_dark). Cannot be set to null; color removal is not supported by the API.',
      ),
  }),
  output: z.object({
    label: z.object({
      id: LabelIdParam,
      name: z.string().describe('Label display name after update'),
      color: z
        .string()
        .nullable()
        .describe('Label color after update, or null if no color'),
      idBoard: BoardIdParam,
      uses: z.number().describe('Number of cards using this label'),
    }),
  }),
};

export type UpdateLabelInput = z.infer<typeof updateLabelSchema.input>;
export type UpdateLabelOutput = z.infer<typeof updateLabelSchema.output>;

export const deleteLabelSchema = {
  name: 'deleteLabel',
  description:
    'Permanently delete a label from a board. Removes the label from all cards that have it.',
  notes:
    'This action is irreversible. The label will be removed from every card on the board.',
  input: z.object({
    dsc: DscParam,
    labelId: LabelIdParam,
  }),
  output: z.object({
    success: z.boolean().describe('True if the label was deleted successfully'),
  }),
};

export type DeleteLabelInput = z.infer<typeof deleteLabelSchema.input>;
export type DeleteLabelOutput = z.infer<typeof deleteLabelSchema.output>;

export const removeLabelFromCardSchema = {
  name: 'removeLabelFromCard',
  description: 'Remove a label from a specific card.',
  notes:
    'Only removes the label from this card; the label definition on the board is unaffected. Use deleteLabel to remove the label from all cards and the board.',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
    labelId: LabelIdParam,
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True if the label was removed from the card successfully'),
  }),
};

export type RemoveLabelFromCardInput = z.infer<
  typeof removeLabelFromCardSchema.input
>;
export type RemoveLabelFromCardOutput = z.infer<
  typeof removeLabelFromCardSchema.output
>;

// ============================================================================
// Domain Schema Array
// ============================================================================

export const labelsSchemas = [
  listLabelsSchema,
  addLabelToCardSchema,
  createLabelSchema,
  updateLabelSchema,
  deleteLabelSchema,
  removeLabelFromCardSchema,
];
