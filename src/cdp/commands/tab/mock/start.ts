import { type ParsedArgs } from '../../../types.js';
import { runStub } from '../../stub.js';

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

export function cmdTabMockStart(parsed: ParsedArgs): void {
  runStub(parsed, HELP, 'tab mock start');
}
