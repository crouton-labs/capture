/**
 * Context Acquisition
 */

import { UpstreamError } from '@vallum/_runtime';
import { clayFetch, type MeResponse } from './shared';
import type { GetContextOutput } from './schemas';

/**
 * Get Clay session context and user information.
 * Call this FIRST before any Clay operations.
 */
export async function getContext(): Promise<GetContextOutput> {
  try {
    const userData = await clayFetch<MeResponse>('/me');

    return {
      success: true,
      isLoggedIn: true,
      currentUrl: window.location.href,
      workspaceId:
        userData.sessionState?.last_workspace_visited_id ?? undefined,
      user: {
        id: userData.id,
        username: userData.username,
        email: userData.email,
        name: userData.name,
        fullName: userData.fullName,
        profilePicture: userData.profilePicture,
        role: userData.role,
        apiToken: userData.apiToken,
        emailVerified: userData.emailVerified,
        onboardingStep: userData.onboardingStep,
        features: userData.features,
        authStrategy: userData.authStrategy,
        sessionState: userData.sessionState,
        createdAt: userData.createdAt,
        updatedAt: userData.updatedAt,
        rewardfulAffiliateId: userData.rewardfulAffiliateId,
        rewardfulReferralId: userData.rewardfulReferralId,
        accountRiskStatus: userData.accountRiskStatus,
        isImpersonated: userData.isImpersonated,
        adminUser: userData.adminUser as
          | Record<string, unknown>
          | null
          | undefined,
        intercomHash: userData.intercomHash,
      },
    };
  } catch (err) {
    const message = (err as Error).message;

    // Auth errors are expected; return not-logged-in status
    if (message.includes('401') || message.includes('403')) {
      return {
        success: true,
        isLoggedIn: false,
        currentUrl: window.location.href,
        error: 'User not logged in to Clay',
      };
    }

    throw new UpstreamError(`getContext: ${message}`);
  }
}
