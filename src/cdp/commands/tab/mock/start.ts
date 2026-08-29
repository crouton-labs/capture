import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { captureError } from '../../../../errors.js';
import { CAPTURE_ROOT, unlinkPrivateFile, writePrivateFile } from '../../../../session/artifacts.js';
import { emitResult, fact, formatArtifactList, text, type RenderableResult } from '../../../../output/render.js';
import { type ParsedArgs } from '../../../types.js';
import { parseMockRuleDocument } from '../../../host/collectors/intercept.js';
import { startMock } from './lifecycle.js';

const HELP = `capture tab mock start --rules <path> — intercept the tab's requests and answer them from a rule document

input:
  --rules <path>   required. Path to a JSON rule document (schema below). Requires an active session with a target; the rules live only as long as the mock, and \`capture tab mock stop\` removes them
output: <mock …> — the installed mock, its rule count, and the artifact directory holding the copy of exactly what was installed; --json mirrors
effects: changes what the tab's network does; spawns or joins the session's collector host, which holds the tab connection until the mock is stopped. Claims \`fetch-interception\`: refused while another mock is live, naming its holder. Composes with a live trace and with a live motion recording.

rule document:
{ "rules": [{ "url": "https://api.example.com/users*", "methods": ["GET"], "resourceTypes": ["XHR", "Fetch"], "fulfill": { "status": 200, "headers": { "content-type": "application/json" }, "body": "{\\"users\\":[]}" } }, { "url": "https://cdn.example.com/*.png", "fail": { "reason": "Failed" } }, { "url": "https://api.example.com/health", "passthrough": {} }, { "url": "https://api.example.com/*", "modify": { "headers": { "x-test": "1" } } }] }

- An ordered list; first match wins; there is no priority field, because order is the priority.
- \`url\` is a \`*\`-glob over the full URL — the same syntax CDP's own \`Fetch.enable\` patterns use. No regex in v1.
- \`methods\` and \`resourceTypes\` are optional narrowing sets. Omitted means "any".
- Exactly one action per rule: \`fulfill\`, \`fail\`, \`modify\`, or \`passthrough\`. \`passthrough\` exists so a specific request can shadow a later broad rule.
- There is no default rule and no way to configure one. An unmatched request is continued unmodified.
- \`fulfill\` bodies are inline (\`body\` string, or \`bodyBase64\`). File-referenced bodies are deferred.
- Load is all-or-nothing: an unparseable pattern, unknown action, or oversized body refuses the whole document and nothing is installed. \`Fetch.enable\` is never sent for a document that failed validation.`;

function stagedRulesPath(): string { return path.join(CAPTURE_ROOT, '.mock-inputs', `rules-${crypto.randomBytes(12).toString('hex')}.json`); }

function sourceFor(pathname: string): { source: Buffer; rules: number } {
  let source: Buffer;
  try { source = fs.readFileSync(pathname); }
  catch (error) { throw captureError('artifact', 'mock_rules_unreadable', `could not read mock rules at ${pathname}: ${error instanceof Error ? error.message : String(error)}`); }
  try { return { source, rules: parseMockRuleDocument(source).length }; }
  catch (error) { throw captureError('invocation', 'invalid_mock_rules', `received: ${pathname}\nexpected: a valid tab mock rule document\nfield: --rules\nreason: ${error instanceof Error ? error.message : String(error)}\nNext: Run \`capture tab mock start -h\` and read the rule-document schema before re-issuing.`); }
}

export function buildMockStartedResult(mock: { id: string; dir: string; rules: number; targetId: string }): RenderableResult {
  return {
    tag: 'mock',
    attrs: { mock: mock.id, path: mock.dir, state: 'live', rules: mock.rules, target: mock.targetId },
    summary: fact`Installed ${mock.rules} ordered mock rule(s) on the session tab. Requests are answered from the rule document copied to rules.json; first match wins.`,
    artifacts: formatArtifactList([{ name: 'rules.json', note: 'the exact installed rule document' }]),
    followUp: text`Stop and finalize this mock with \`capture tab mock stop\`.`,
  };
}

export async function cmdTabMockStart(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) {
    console.log(HELP);
    return;
  }
  const rulesPath = parsed.rules;
  if (!rulesPath) throw captureError('invocation', 'missing_rules', 'received: no rule document\nexpected: --rules <path>\nfield: --rules\nNext: Run `capture tab mock start -h` and read the schema before re-issuing.');
  const loaded = sourceFor(rulesPath);
  const staged = stagedRulesPath();
  writePrivateFile(staged, loaded.source);
  try {
    const mock = await startMock(staged, loaded.rules);
    emitResult(buildMockStartedResult(mock), { json: parsed.json });
  } finally {
    try { unlinkPrivateFile(staged); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
