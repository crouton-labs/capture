/**
 * Opcodes and query constants captured from the Sheets /save endpoint.
 *
 * Origin: HAR capture, x-build: editors.spreadsheets-frontend_20260420.00_p3
 *
 * When writeCell fails with an opcode-mismatch response, re-capture the /save
 * request via the proof runner and update these values. Watchtower pattern-
 * matches the "Re-capture HAR" error string to surface this to the fix pipeline.
 */

export const WRITE_VALUE_OP = 25813757;
export const FORMAT_CELL_OP = 21299578;
export const LEGACY_STRING_VALUE_OP = 132274236;

export const RENAME_SHEET_OP = 26812461;
export const SET_SHEET_PROPERTIES_OP = 26812461;
export const MOVE_SHEET_OP = 31997291;
export const DELETE_SHEET_OP = 29396799;
export const BATCH_WRAPPER_OP = 4444216;
export const ADD_SHEET_SUB_OP = 21350203;
export const ADD_SHEET_SELECT_SUB_OP = 28950036;

export const INSERT_DIMENSION_OP = 24502104;
export const DELETE_DIMENSION_OP = 25037233;
export const DIMENSION_PROPERTIES_OP = 29921628;
export const MERGE_CELLS_OP = 27911206;
export const UNMERGE_CELLS_OP = 27911481;
export const HYPERLINK_VALUE_OP = 132143164;

export const CREATE_FILTER_OP = 34070425;
export const ASSOCIATE_FILTER_OP = 39390250;
export const DELETE_FILTER_OP = 34076932;
export const UPDATE_FILTER_OP = 34075073;

export const DIMENSION = {
  ROW: 0,
  COLUMN: 1,
} as const;

export const SHEET_PROPERTY_FIELD = {
  TITLE: 0,
  FROZEN_ROWS: 4,
} as const;

export const DIMENSION_FIELD = {
  SIZE: 0,
  HIDDEN: 1,
} as const;

export const CELL_NOTE_FLAG = 262144;

export const VALUE_TYPE = {
  STRING: 2,
  NUMBER: 3,
  BOOL: 4,
} as const;

export const FORMAT_CATEGORY = {
  NUMBER: 2,
  DATE: 5,
} as const;

export const FORMAT_FLAG = {
  NUMBER_FORMAT: 1,
  HORIZONTAL_ALIGN: 64,
  TEXT_COLOR: 2048,
  FONT_FAMILY: 4096,
  FONT_SIZE: 8192,
  BOLD: 16384,
  ITALIC: 32768,
  UNDERLINE: 327680,
  BACKGROUND_COLOR: 33554432,
} as const;

export const HORIZONTAL_ALIGN = {
  LEFT: 0,
  CENTER: 1,
  RIGHT: 2,
} as const;

export const SAVE_QUERY_CONSTANTS =
  'vc=1&c=1&w=1&flr=0&smv=2147483647&smb=%5B2147483647%2C%20APwr%5D&includes_info_params=true&usp=sheets_home&cros_files=false&nded=false';
