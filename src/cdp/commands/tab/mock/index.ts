import { invalidInput } from '../../../../errors.js';
import { type ParsedArgs } from '../../../types.js';
import { cmdTabMockStart } from './start.js';
import { cmdTabMockStop } from './stop.js';

export const MOCK_USAGE = `<command name="mock" description="network response mocking">
<model>Mocking changes what the tab's requests do and records what it did; it is not a measurement. Rules are an ordered document, first match wins, replaced only by stopping and starting again.</model>
<subcommand name="start" description="install a mock rule document on the tab" whenToUse="Use before the navigation or interaction whose requests you want answered from rules."/>
<subcommand name="stop" description="remove the mock rules and finalize their record" whenToUse="Use to return the tab to real network behavior and get the record of what was mocked."/>
</command>`;

export async function tabMockMain(parsed: ParsedArgs, _args: string[]): Promise<void> {
  const leaf = parsed.positional[0];
  const rest: ParsedArgs = { ...parsed, positional: parsed.positional.slice(1) };
  switch (leaf) {
    case 'start': return cmdTabMockStart(rest);
    case 'stop': return cmdTabMockStop(rest);
    case undefined:
      console.log(MOCK_USAGE);
      return;
    default:
      throw invalidInput(`Unknown tab mock leaf: ${leaf}.`, 'unknown_command');
  }
}
