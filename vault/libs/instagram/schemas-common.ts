import { z } from 'zod';

// Shared parameter schemas used across all domain files
export const CsrfParam = z.string().describe('CSRF token from getContext');
