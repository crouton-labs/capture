/**
 * Vamo Library
 *
 * Browser-executable Vamo (vamotalent.com) operations:
 * GitHub-developer search by skills / username / repo, plus
 * profile, synopsis, interests, and contact-reveal endpoints.
 *
 * Auth is cookie-based (HttpOnly). Functions assume the user is
 * logged into Vamo and the active tab is on a project page so that
 * `getContext()` can extract the project UUID from the URL.
 */

export { getContext } from './context';

export { searchBySkills, searchByUsername, searchByRepo } from './search';

export {
  getDeveloperProfile,
  getDeveloperSynopsis,
  getDeveloperInterests,
  revealDeveloperContacts,
  getDeveloperTopRepo,
  getMatchReason,
  getDeveloperContributions,
} from './profile';

export { listSearchHistory } from './history';
