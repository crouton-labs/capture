/**
 * Salesforce Context Extraction
 *
 * Extracts authentication context from the Salesforce Lightning page.
 * Must be called first before any other operations.
 */

import { Validation, Unauthenticated } from '@vallum/_runtime';
import type { AuraContext } from './aura';
import { auraAction, captureAuraContext, DESCRIPTORS } from './aura';

export interface SalesforceContext {
  auraToken: string;
  auraContext: string;
  orgDomain: string;
  instanceUrl: string;
  lightningUrl: string;
  setupOrgOrigin?: string;
  vfDomain?: string;
  defaultServerDomain?: string;
  isNetworksEnabled?: boolean;
  nonce?: string;
}

interface HostConfigResult {
  defaultOrgDomain: string;
  defaultOrgOrigin: string;
  lightningOrgOrigin: string;
  setupOrgOrigin?: string;
  vfDomain?: string;
  defaultServerDomain?: string;
  isNetworksEnabled?: boolean;
  nonce?: string;
}

/**
 * Extract Salesforce authentication context from the current page.
 * Must be on a Salesforce Lightning page (*.lightning.force.com).
 */
export async function getContext(): Promise<SalesforceContext> {
  const hostname = window.location.hostname;
  if (
    !hostname.includes('lightning.force.com') &&
    !hostname.includes('salesforce.com') &&
    !hostname.includes('salesforce-setup.com')
  ) {
    throw new Validation(
      `Not on a Salesforce page. Current URL: ${window.location.href}. Navigate to your Salesforce org first.`,
    );
  }

  // Detect login page; user is logged out
  if (/\blogin\b/i.test(document.title)) {
    throw new Unauthenticated(
      'Salesforce login page detected. User is not logged in. Stop and instruct the user to log in at https://welcome.salesforce.com/.',
    );
  }

  // Capture the Aura token by intercepting framework XHR
  const aura = await captureAuraContext();

  // Get the org domain and instance URL from host config
  const configResult = (await auraAction(
    aura,
    DESCRIPTORS.getConfigData,
  )) as HostConfigResult;

  return {
    auraToken: aura.token,
    auraContext: aura.context,
    orgDomain: configResult.defaultOrgDomain,
    instanceUrl: configResult.defaultOrgOrigin,
    lightningUrl: configResult.lightningOrgOrigin ?? window.location.origin,
    setupOrgOrigin: configResult.setupOrgOrigin,
    vfDomain: configResult.vfDomain,
    defaultServerDomain: configResult.defaultServerDomain,
    isNetworksEnabled: configResult.isNetworksEnabled,
    nonce: configResult.nonce,
  };
}

/**
 * Build an AuraContext object from a SalesforceContext for use with aura helpers.
 */
export function toAuraContext(ctx: SalesforceContext): AuraContext {
  return {
    token: ctx.auraToken,
    context: ctx.auraContext,
  };
}
