/**
 * Slack Internal Helpers
 *
 * Shared utilities for Slack API operations.
 */
import { Unauthenticated, PermissionDenied, RateLimited, NotFound, UpstreamError, throwForStatus } from '@vallum/_runtime';

interface SlackResponse {
  ok: boolean;
  error?: string;
  response_metadata?: {
    next_cursor?: string;
  };
  [key: string]: unknown;
}

export async function slackApi<T>(
  method: string,
  token: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  // Use relative path to avoid CORS issues when running from Slack page
  const url = `/api/${method}`;

  // Build form-urlencoded body with token
  const body = new URLSearchParams();
  body.append('token', token);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  const data = (await response.json()) as SlackResponse;

  if (!data.ok) {
    if (!data.error) {
      throw new UpstreamError(
        `Slack API ${method} failed with ok=false but no error message`,
      );
    }
    const err = data.error;
    if (err === 'not_authed' || err === 'invalid_auth' || err === 'token_revoked') {
      throw new Unauthenticated(`Slack API ${method}: ${err}`);
    }
    if (err === 'missing_scope' || err === 'not_allowed_token_type') {
      throw new PermissionDenied(`Slack API ${method}: ${err}`);
    }
    if (err === 'ratelimited') {
      throw new RateLimited(`Slack API ${method}: ${err}`);
    }
    if (err.endsWith('_not_found')) {
      throw new NotFound(`Slack API ${method}: ${err}`);
    }
    throw new UpstreamError(`Slack API ${method}: ${err}`);
  }

  return data as T;
}
