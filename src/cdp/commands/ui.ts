import * as fs from 'fs';
import { withConnection } from '../connection.js';
import { captureScreenshot, autoScreenshot } from '../screenshot.js';
import { getAccessibilityTree, flattenA11yTree } from '../a11y.js';
import { clickByName, typeText, focusAndType } from '../../interact.js';
import { nextStepPath } from '../../session-context.js';
import { assertUnderCaptureRoot, writeBinaryPrivate } from '../../session/artifacts.js';
import { type ParsedArgs } from '../types.js';

/**
 * Writes a screenshot PNG privately (0600) when it lands under CAPTURE_ROOT
 * (auto-generated session paths), and with a plain write when the user gave
 * an explicit `--out` outside the capture tree (a user-chosen destination
 * whose permissions are the user's to decide).
 */
function writeScreenshot(outPath: string, png: Buffer): void {
  try {
    assertUnderCaptureRoot(outPath);
  } catch {
    fs.writeFileSync(outPath, png);
    return;
  }
  writeBinaryPrivate(outPath, png);
}

export async function cmdScreenshot(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture screenshot [--target <id> | --url <pattern>] [--out <path>] [--viewport <preset>] [--height <px>] [--full-page]\n\n' +
        'Capture a screenshot of the targeted tab. Saves to --out or auto-generates a path.\n\n' +
        'Options:\n' +
        '  --viewport <preset>  Viewport preset (default: desktop)\n' +
        '                       desktop-wide  1920x1080\n' +
        '                       desktop       1280x800\n' +
        '                       tablet        768x1024\n' +
        '                       mobile        390x844\n' +
        '  --height <px>        Override viewport height (e.g. 1600)\n' +
        '  --full-page          Capture the entire scrollable page',
    );
    process.exit(0);
  }
  const VIEWPORTS: Record<string, { width: number; height: number }> = {
    'desktop-wide': { width: 1920, height: 1080 },
    'desktop': { width: 1280, height: 800 },
    'tablet': { width: 768, height: 1024 },
    'mobile': { width: 390, height: 844 },
  };
  const viewportName = parsed.viewport ?? 'desktop';
  const viewport = VIEWPORTS[viewportName];
  if (!viewport) {
    console.error(`Unknown viewport "${viewportName}". Options: ${Object.keys(VIEWPORTS).join(', ')}`);
    process.exit(1);
  }
  // Allow --height to override the viewport preset height
  if (parsed.height) {
    viewport.height = parsed.height;
  }
  const result = await withConnection(
    parsed,
    async (client) => {
      const png = await captureScreenshot(client, viewport, { fullPage: parsed.fullPage });
      const outPath = parsed.out
        ? parsed.out
        : (nextStepPath('screenshot', 'manual') ?? `/tmp/capture-screenshot-${Date.now()}.png`);
      writeScreenshot(outPath, png);
      return { path: outPath, bytes: png.length };
    },
    { settle: 0 },
  );
  console.log(JSON.stringify(result, null, 2));
  return;
}

export async function cmdClick(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture click "name" [--role button|link|...] [--no-screenshot]\n\n' +
        'Click an element by its accessible name. Auto-captures a screenshot after clicking.',
    );
    process.exit(0);
  }
  const name = parsed.positional[0];
  if (!name) {
    console.error('Usage: capture click "name" [--role button|link|...] [--no-screenshot]');
    process.exit(1);
  }
  const clickSettle = parsed.settle !== undefined ? parsed.settle : (parsed.har ? 2500 : 1000);
  const result = await withConnection(
    parsed,
    async (client) => {
      const clickResult = await clickByName(client, name, parsed.role);
      const screenshot = await autoScreenshot(client, 'click', name, parsed.noScreenshot);
      return { ...clickResult, screenshot };
    },
    { settle: clickSettle },
  );
  console.log(JSON.stringify(result, null, 2));
  return;
}

export async function cmdType(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture type "text" [--into "field name"] [--no-screenshot]\n\n' +
        'Type text into the focused element, or into a named field with --into.',
    );
    process.exit(0);
  }
  const text = parsed.positional[0];
  if (!text) {
    console.error('Usage: capture type "text" [--into "field name"] [--no-screenshot]');
    process.exit(1);
  }
  const result = await withConnection(
    parsed,
    async (client) => {
      let field: string | null = null;
      if (parsed.into) {
        await focusAndType(client, parsed.into, text, parsed.role);
        field = parsed.into;
      } else {
        await typeText(client, text);
      }
      const label = field ?? text;
      const screenshot = await autoScreenshot(client, 'type', label, parsed.noScreenshot);
      return { typed: text, field, screenshot };
    },
    { settle: parsed.settle !== undefined ? parsed.settle : (parsed.har ? 1500 : 500) },
  );
  console.log(JSON.stringify(result, null, 2));
  return;
}

export async function cmdA11y(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture a11y [--target <id>] [--json] [--interactive]\n\n' +
        'Get the accessibility tree. Use --interactive for interactive elements only.\n' +
        'Use --json for structured JSON output.',
    );
    process.exit(0);
  }
  const result = await withConnection(
    parsed,
    async (client) => {
      const tree = await getAccessibilityTree(client);

      if (parsed.json) {
        return tree;
      }

      // Flat text output
      const lines = flattenA11yTree(tree, {
        interactive: parsed.interactive,
      });
      return lines.join('\n');
    },
    { settle: 0 },
  );

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result);
  }

  // Hint when a11y tree is sparse
  if (!parsed.json) {
    const lineCount = typeof result === 'string' ? result.split('\n').filter(Boolean).length : 0;
    if (lineCount === 0) {
      console.error(
        '\nNo elements found.' +
        (parsed.interactive ? ' Try without --interactive to see all nodes.' : '') +
        '\n\nIf this page is part of your project, consider adding ARIA attributes:\n' +
        '  - role="button|link|textbox" on interactive elements\n' +
        '  - aria-label="..." on elements without visible text\n' +
        '  - Semantic HTML (<button>, <input>, <nav>) provides roles automatically',
      );
    } else if (parsed.interactive && lineCount < 5) {
      console.error(
        `\nOnly ${lineCount} interactive element${lineCount === 1 ? '' : 's'} found. ` +
        'If this seems low, the page may lack ARIA markup.\n' +
        'Consider adding role and aria-label attributes to interactive elements in your frontend code.',
      );
    }
  }

  return;
}
