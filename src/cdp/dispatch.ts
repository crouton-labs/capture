import { parseCliArgs } from './args.js';
import { CDP_USAGE } from './usage.js';
import { cmdDetect, cmdList, cmdOpen, cmdResetTab } from './commands/tabs.js';
import { cmdExec } from './commands/exec.js';
import { cmdScreenshot, cmdClick, cmdType, cmdA11y } from './commands/ui.js';
import { cmdRecord, cmdNavigate, cmdNetwork } from './commands/traffic.js';
import { cmdHar } from './commands/har.js';

export async function cdpMain(): Promise<void> {
  const args = process.argv.slice(2);
  const parsed = parseCliArgs(args);

  switch (parsed.command) {
    case 'detect': return cmdDetect(parsed, args);
    case 'list': return cmdList(parsed, args);
    case 'open': return cmdOpen(parsed, args);
    case 'reset-tab': return cmdResetTab(parsed, args);
    case 'exec': return cmdExec(parsed, args);
    case 'screenshot': return cmdScreenshot(parsed, args);
    case 'click': return cmdClick(parsed, args);
    case 'type': return cmdType(parsed, args);
    case 'a11y': return cmdA11y(parsed, args);
    case 'record': return cmdRecord(parsed, args);
    case 'navigate': return cmdNavigate(parsed, args);
    case 'network': return cmdNetwork(parsed, args);
    case 'har': return cmdHar(parsed, args);
    default:
      console.log(CDP_USAGE);
  }
}
