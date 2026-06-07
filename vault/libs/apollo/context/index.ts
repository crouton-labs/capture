/**
 * Apollo Context Operations
 */

import type { GetContextOutput } from '../schemas';

interface AuthCheckResponse {
  is_logged_in: boolean;
  bootstrapped_data?: {
    current_user_id?: string;
    current_team_id?: string;
    is_core?: boolean;
    feature_flags?: Record<string, unknown>;
    assistant_flags?: {
      enabled?: boolean;
    };
  };
}

/**
 * Get Apollo session context and user information.
 * Call this FIRST before any Apollo operations.
 */
export async function getContext(): Promise<GetContextOutput> {
  try {
    const base = window.location.origin;
    const response = await fetch(`${base}/api/v1/auth/check`, {
      credentials: 'include',
    });
    const authData: AuthCheckResponse = await response.json();

    if (!authData.is_logged_in) {
      return {
        success: true,
        isLoggedIn: false,
        currentUrl: window.location.href,
        error: 'User not logged in',
      };
    }

    const data = authData.bootstrapped_data || {};

    return {
      success: true,
      isLoggedIn: true,
      currentUrl: window.location.href,
      userId: data.current_user_id,
      teamId: data.current_team_id,
      isCore: data.is_core,
      featureFlagCount: data.feature_flags
        ? Object.keys(data.feature_flags).length
        : 0,
      assistantEnabled: data.assistant_flags?.enabled || false,
    };
  } catch (err) {
    return {
      success: false,
      isLoggedIn: false,
      error: (err as Error).message,
      currentUrl: window.location.href,
    };
  }
}
