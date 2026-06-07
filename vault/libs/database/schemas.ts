import { z } from 'zod';

export const libraryDescription =
  'Workspace database: private SQLite (Turso) for structured data storage';
export const libraryVisibility = 'chat' as const;

export const libraryNotes = `
## Overview

Each workspace has a private SQLite database (powered by Turso) for storing structured data.
Available when a workspace has a database provisioned.

## Two ways to reach this database

Both hit the same workspace DB and support SELECT/INSERT/UPDATE/DELETE with \`?\`
placeholders. Pick by what the step is already doing — neither is more "correct".

| Surface | Runs where | Use it for |
|---|---|---|
| \`vallum.db.execute(sql, params)\` | Inside \`executeJS\`, in a browser executor opened by a preceding \`createExecutor\` step (that binds the workspace). NOT available in a \`bash\` step, nor in \`executeJS\` with no executor. | Steps already driving a browser, or mixed browser + DB work. |
| \`nl sql query "..." --params '[...]'\` | Server-side CLI — works in a \`bash\` step and from the conversation. No browser/executor needed. | Pure DB reads/writes. Simplest for DB-only steps — nothing to spin up. |

## Usage inside executeJS (vallum.db)

\`\`\`javascript
const result = await vallum.db.execute('SELECT * FROM prospects WHERE stage = ?', ['pending']);
// result.columns = ['id', 'name', 'stage']
// result.rows = [[1, 'John', 'pending'], ...]

await vallum.db.execute('INSERT INTO prospects (name, stage) VALUES (?, ?)', ['Jane', 'new']);
await vallum.db.execute('UPDATE prospects SET stage = ? WHERE id = ?', ['contacted', 1]);
\`\`\`

\`vallum.db\` is injected at \`createExecutor\` time — call \`createExecutor\` first and
reference it from the \`executeJS\` step, or \`vallum.db\` will be undefined.

## Usage in a bash step (nl sql)

\`\`\`bash
nl sql query 'INSERT INTO prospects (name, stage) VALUES (?, ?)' --params '["Jane", "new"]'
\`\`\`

In a **saved script**, parameterize via inline \`$ref(params.field)\` / \`$ref(steps.stepId.field)\`
tokens in the command (they resolve to injection-safe \`\${__refN}\` env vars) — this is the
preferred way to pass values into a bash step. Never inline \`__params.x\`: that only
substitutes inside executeJS code, so in bash it is inserted as the literal text \`__params.x\`.
See \`nl sql -h\`.

## Result Shape

All queries return: \`{ columns, columnTypes, rows, rowsAffected, lastInsertRowid }\`
- \`columns\`: Array of column names
- \`columnTypes\`: Array of SQLite type names
- \`rows\`: Array of row arrays (values as string | number | null)
- \`rowsAffected\`: Number of rows affected by write operations
- \`lastInsertRowid\`: ID of last inserted row (string or null)

## Table Naming

Prefix tables with \`{purpose}_\` to namespace them (e.g., \`email_digest_seen\`, \`report_cache\`).
Use snake_case for all table and column names. The \`_logs\` table is reserved for the system.
`;

export const executeSchema = {
  name: 'execute',
  description: 'Execute a SQL query against the workspace database',
  notes:
    'Use ? placeholders with params array for parameterized queries. Available in executeJS scripts via vallum.db.execute().',
  input: z.object({
    sql: z.string().describe('SQL statement to execute'),
    params: z
      .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional()
      .describe('Optional positional parameters for ? placeholders'),
  }),
  output: z.object({
    columns: z.array(z.string()),
    columnTypes: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
    rowsAffected: z.number(),
    lastInsertRowid: z.union([z.string(), z.null()]),
  }),
};

export type ExecuteInput = z.infer<typeof executeSchema.input>;
export type ExecuteOutput = z.infer<typeof executeSchema.output>;

export const allSchemas = [executeSchema];
