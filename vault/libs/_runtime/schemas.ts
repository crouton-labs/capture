// _runtime is an internal lib with no public AI-callable functions.
// generateDocs() (which calls validateSchemas()) is skipped for _* services in build-libs.ts:buildService.
// Metadata exports below satisfy generic tooling that imports schemas.ts.

export const libraryDescription =
  'Internal Vallum runtime — error taxonomy and call wrapper. Not user-facing.';
export const libraryIcon = '';
export const loginUrl = null;
export const libraryVisibility = 'hidden' as const;
export const libraryNotes = '';
export const allSchemas: never[] = [];
