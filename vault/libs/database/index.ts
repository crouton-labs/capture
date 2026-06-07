/**
 * Northlight Database Library - Workspace SQLite (Turso) access
 *
 * This library runs in the browser and uses the vallum.db API
 * injected by the Northlight agent to execute SQL queries.
 */

// Re-export schemas for documentation
export * from './schemas';

import type { ExecuteInput, ExecuteOutput } from './schemas';
import { Validation } from '@vallum/_runtime';

declare global {
  interface Window {
    vallum?: {
      db?: {
        execute(
          sql: string,
          params?: Array<string | number | boolean | null>,
        ): Promise<ExecuteOutput>;
      };
    };
  }
}

function getDbApi() {
  if (typeof window === 'undefined' || !window.vallum?.db) {
    throw new Validation(
      'Northlight database API not available. Ensure the workspace has a database provisioned and the agent is connected.',
    );
  }
  return window.vallum.db;
}

/**
 * Execute a SQL query against the workspace database.
 */
export async function execute(params: ExecuteInput): Promise<ExecuteOutput> {
  return getDbApi().execute(params.sql, params.params);
}
