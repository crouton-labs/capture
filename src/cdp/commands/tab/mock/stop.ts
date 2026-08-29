import { type ParsedArgs } from '../../../types.js';
import { runStub } from '../../stub.js';

const HELP = `capture tab mock stop — remove the mock rules and finalize the record of what was mocked

input:
  (none)   the session's one live mock is selected without an id
output: <mock …> — how many requests paused, how many matched each rule, how many were released unmatched at teardown, and the mock's completion state; --json mirrors
effects: returns the tab to real network behavior; releases the collector host's \`fetch-interception\` claim and exits the host when nothing else is collecting`;

export function cmdTabMockStop(parsed: ParsedArgs): void {
  runStub(parsed, HELP, 'tab mock stop');
}
