// Single source of truth for the "you must be on a page that loads LinkedIn's
// GraphQL query registry" guidance. Imported by the thrown runtime error
// (helpers/index.ts, browser-bundled) AND by schemas.ts (agent-facing docs).
// Keep this module dependency-free (no zod, no @vallum/_runtime, no browser
// globals) so it stays safe to bundle into browser-executable code.

// Recovery sentence appended to the thrown error when the registry is missing.
export const AMD_PAGE_GUIDANCE =
  "This function needs LinkedIn's GraphQL query registry, which only loads on " +
  'certain pages. Navigate to https://www.linkedin.com/notifications/ then ' +
  'retry. Does NOT work on profile pages (/in/<name>/), the /feed/ home page, ' +
  'or /search/results/*.';

// Same precondition phrased as a fact for schema `notes` / `libraryNotes`,
// which the agent reads BEFORE calling so it navigates correctly up front.
export const AMD_PAGE_NOTE =
  "Requires LinkedIn's GraphQL query registry. Be on " +
  'https://www.linkedin.com/notifications/ before calling. The registry does ' +
  'NOT load on profile pages (/in/<name>/), the /feed/ home page, or ' +
  '/search/results/*.';
