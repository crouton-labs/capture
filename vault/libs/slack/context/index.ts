/**
 * Slack Context Operations
 *
 * Authentication context extraction and workspace management.
 */

import type {
  GetWorkspacesInput,
  GetWorkspacesOutput,
  GetContextInput,
  GetContextOutput,
} from '../schemas';
import { NotFound, Unauthenticated, Validation } from '@vallum/_runtime';

// Slack stores team configuration in localStorage
interface SlackLocalConfig {
  teams: Record<
    string,
    {
      id: string;
      name: string;
      token: string;
      user_id: string;
      url: string;
      domain: string;
    }
  >;
}

/**
 * List available Slack workspaces the user is logged into.
 * Works from ANY Slack page including the workspace picker.
 * Use this to get workspace IDs before navigating.
 */
export async function getWorkspaces(
  _params?: GetWorkspacesInput,
): Promise<GetWorkspacesOutput> {
  const configStr = localStorage.getItem('localConfig_v2');
  if (!configStr) {
    throw new Unauthenticated(
      'localConfig_v2 not found. Ensure you are logged into Slack at app.slack.com',
    );
  }

  const config = JSON.parse(configStr) as SlackLocalConfig;
  return Object.values(config.teams).map((team) => ({
    teamId: team.id,
    teamName: team.name,
    domain: team.domain,
    url: `https://app.slack.com/client/${team.id}`,
    userId: team.user_id,
  }));
}

/**
 * Extract Slack authentication context from current session.
 * Must be called from a workspace page (/client/TEAM_ID/...).
 *
 * If not on a workspace page, call getWorkspaces() first and navigate to the desired workspace URL.
 */
export async function getContext(
  _params: GetContextInput,
): Promise<GetContextOutput> {
  // Extract current team ID from URL (/client/TEAM_ID/...)
  const teamMatch = window.location.href.match(/\/client\/([A-Z0-9]+)/);
  if (!teamMatch) {
    // Provide helpful error with available workspaces
    const configStr = localStorage.getItem('localConfig_v2');
    if (configStr) {
      const config = JSON.parse(configStr) as SlackLocalConfig;
      const teams = Object.values(config.teams);
      if (teams.length > 0) {
        const teamList = teams
          .map((t) => `${t.name}: https://app.slack.com/client/${t.id}`)
          .join(', ');
        throw new Validation(
          `Not on a Slack workspace page. Navigate to one of: ${teamList}`,
        );
      }
    }
    throw new Validation(
      `Not on a Slack workspace page. URL must contain /client/TEAM_ID. Current: ${window.location.href}`,
    );
  }
  const currentTeamId = teamMatch[1];

  // Get config from localStorage (modern Slack web client)
  const configStr = localStorage.getItem('localConfig_v2');
  if (!configStr) {
    throw new Unauthenticated(
      'localConfig_v2 not found in localStorage. Ensure you are logged into Slack at app.slack.com',
    );
  }

  const config = JSON.parse(configStr) as SlackLocalConfig;
  const team = config.teams[currentTeamId];
  if (!team) {
    throw new NotFound(
      `Team ${currentTeamId} not found in localConfig_v2. Available teams: ${Object.keys(config.teams).join(', ')}`,
    );
  }

  if (!team.token) {
    throw new Unauthenticated(`No token found for team ${currentTeamId}`);
  }

  return {
    token: team.token,
    teamId: currentTeamId,
    userId: team.user_id,
    teamName: team.name,
  };
}
