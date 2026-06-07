import type { GetContextOutput } from './schemas';
import { ContractDrift, Unauthenticated } from '@vallum/_runtime';

interface SmartLeadLocalStorageState {
  auth: {
    token: string;
    unsubToken: string;
  };
  applicant: {
    user: {
      id: number;
      uuid: string;
      email: string;
      name: string;
      role: string;
      api_key: string;
      timezone_preferences: string;
      region: string;
      company_url: string | null;
      allow_api_access: boolean;
      smart_senders_api_key: string | null;
    };
    currentPlan: {
      plan_type: string;
      trial_end_date: string | null;
      email_credits: number;
      email_credits_used: number;
      lead_credits: number;
      lead_credits_used: number;
      lead_search_credits: number;
      lead_search_credits_used: number;
      sequence_credits: number;
      sequence_credits_used: number;
      sender_credits: number;
      email_verification_credits: number;
      email_verification_credit_used: number;
      monitor_credits: number;
      monitor_credits_used: number;
      no_of_linkedin_cookies: number;
      new_feature_access: Record<string, boolean>;
    };
  };
}

/**
 * Extract SmartLead auth token and user metadata from the browser session.
 * Must be called before any other SmartLead function.
 */
export async function getContext(): Promise<GetContextOutput> {
  const raw = localStorage.getItem('smartlead');
  if (!raw) {
    throw new Unauthenticated(
      `SmartLead auth not found in localStorage. Ensure you are logged in at app.smartlead.ai. URL: ${window.location.href}`,
    );
  }

  let parsed: SmartLeadLocalStorageState;
  try {
    parsed = JSON.parse(
      JSON.parse(atob(raw)) as string,
    ) as SmartLeadLocalStorageState;
  } catch {
    throw new ContractDrift(
      `Failed to decode SmartLead localStorage token. Raw length: ${raw.length}. URL: ${window.location.href}`,
    );
  }

  if (!parsed.auth || typeof parsed.auth.token !== 'string') {
    throw new Unauthenticated(
      `SmartLead auth.token not found in decoded localStorage state. URL: ${window.location.href}`,
    );
  }

  if (!parsed.applicant?.user) {
    throw new Unauthenticated(
      `SmartLead applicant.user not found in decoded localStorage state. URL: ${window.location.href}`,
    );
  }

  const { token } = parsed.auth;
  const { user, currentPlan } = parsed.applicant;

  return {
    token,
    userId: user.id,
    userUuid: user.uuid,
    email: user.email,
    name: user.name,
    role: user.role,
    apiKey: user.api_key,
    timezonePreferences: user.timezone_preferences,
    region: user.region,
    companyUrl: user.company_url,
    allowApiAccess: user.allow_api_access,
    planName: currentPlan.plan_type,
    trialEndDate: currentPlan.trial_end_date,
    emailCredits: currentPlan.email_credits,
    emailCreditsUsed: currentPlan.email_credits_used,
    leadCredits: currentPlan.lead_credits,
    leadCreditsUsed: currentPlan.lead_credits_used,
    leadSearchCredits: currentPlan.lead_search_credits,
    leadSearchCreditsUsed: currentPlan.lead_search_credits_used,
    sequenceCredits: currentPlan.sequence_credits,
    sequenceCreditsUsed: currentPlan.sequence_credits_used,
    senderCredits: currentPlan.sender_credits,
    emailVerificationCredits: currentPlan.email_verification_credits,
    emailVerificationCreditsUsed: currentPlan.email_verification_credit_used,
    monitorCredits: currentPlan.monitor_credits,
    monitorCreditsUsed: currentPlan.monitor_credits_used,
    noOfLinkedinCookies: currentPlan.no_of_linkedin_cookies,
    newFeatureAccess: currentPlan.new_feature_access,
    smartSendersApiKey: user.smart_senders_api_key,
  };
}
