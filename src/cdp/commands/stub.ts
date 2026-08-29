import { captureError } from '../../errors.js';
import { type ParsedArgs } from '../types.js';

export function runStub(parsed: ParsedArgs, help: string, command: string): void {
  if (parsed.help) {
    console.log(help);
    return;
  }
  throw captureError('precondition', 'not_implemented', `capture ${command} is not yet implemented.`);
}
