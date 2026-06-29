/**
 * Capture — unified CLI for session management and CDP browser automation.
 *
 * Session commands (namespaced):
 *   capture session start [--url <url>]
 *   capture session stop <session-id>
 *   capture session list
 *   capture session view <session-id> [--filter screenshots|har|a11y]
 *   capture log <path> [--name label]
 *
 * CDP commands (top-level):
 *   capture detect              Detect CDP port
 *   capture exec <code>         Execute JS in a tab
 *   capture list                List browser tabs
 *   capture open <url>          Open URL in browser
 *   capture screenshot          Capture screenshot
 *   capture a11y                Get accessibility tree
 *   capture record              Passive HAR recording
 *   capture navigate <url>      Navigate + record HAR
 *   capture har create|read|delete  Manage HAR recordings
 */

import * as fs from "fs";
import * as path from "path";
import { cdpMain } from "./cdp.js";
import { sessionMain, logCommand } from "./session/commands.js";

// ============================================================================
// CLI
// ============================================================================

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "--version" || command === "-v" || command === "version") {
    // Version is injected at build time via esbuild's --define flag.
    // Falls back to reading package.json at runtime if not injected.
    const declared = (globalThis as { __CAPTURE_VERSION__?: string }).__CAPTURE_VERSION__;
    if (declared) {
      console.log(declared);
      return;
    }
    try {
      const pkgPath = path.resolve(__dirname, "..", "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version: string };
      console.log(pkg.version);
    } catch {
      console.log("unknown");
    }
    return;
  }

  switch (command) {
    case "session":
      return sessionMain(args);

    case "log":
      return logCommand(args);

    // CDP commands — delegate to cdp.ts
    case "detect":
    case "exec":
    case "open":
    case "reset-tab":
    case "screenshot":
    case "click":
    case "type":
    case "a11y":
    case "record":
    case "navigate":
    case "har":
    case "lib":
    case "network":
    case "list":
      return cdpMain();

    default:
      console.log(`Capture — browser automation over CDP for validating UI features.

Most tasks start with a session. Once a session is active, every command
auto-fills --target (the tab) and --har (the recording) — don't thread
those flags yourself.

TYPICAL WORKFLOW

  1. Start a session (opens tab, starts HAR, marks it active):
       capture session start --url http://localhost:3000

  2. Interact — no --target / --har needed:
       capture a11y --interactive           See what's on the page
       capture click "Sign in"              Click by accessible name (auto-screenshots)
       capture type "hi@me.com" --into "Email"
       capture screenshot                   Save current state
       capture navigate https://...         Navigate within the session
       capture exec "document.title"        Run JS (expressions, return, await)
       capture har read --filter-url /api   Inspect recorded traffic

  3. Bundle and inspect:
       capture session stop  <session-id>
       capture session view  <session-id>

SESSION COMMANDS

  session start [--url <url>]              Start a session
  session stop  <session-id>               Finalize and bundle artifacts
  session list                             List active and stopped sessions
  session view  <id> [--filter section]    section = screenshots|har|a11y|logs
  log <path> [--name label]                Tail a log file into the active session

INTERACTION COMMANDS (work inside or outside a session)

  a11y [--interactive] [--json]            Accessibility tree (use this first to see elements)
  click "name" [--role <role>]             Click by accessible name
  type "text" [--into "Field"]             Type into focused element or named field
  screenshot [--out <path>] [--full-page]  Screenshot (viewport: desktop|desktop-wide|tablet|mobile)
  exec <code>  |  exec --file <path>       Evaluate JS; expressions, return, and await are supported
  navigate <url> [--settle <ms>]           Navigate the current tab + record HAR

DIAGNOSTICS & ONE-OFFS (no session needed)

  detect                                   Find running CDP endpoints
  list                                     List open tabs across endpoints
  open <url> [--new]                       Open a URL, return its tab id
  reset-tab <url>                          Abandon a stuck tab, open fresh (updates session)
  record [--duration <secs>]               Passive HAR recording; parallel-safe capture
  network <offline|online>                 Toggle connectivity for a tab
  har create | read [id] | delete <id>     Manage standalone HAR recordings

LIBRARY (vault libs — dev checkout only)

  lib list                                 List available libs
  lib search "<query>" [--limit N]          Fuzzy-search functions across libs
  lib show <name>                          Lib + function summaries
  lib read <name> [fn…]                    Full input/output schemas (+ .ts source path)
  exec "import {fn} from 'libs/<name>'; return await fn({…})"   Run a lib in the active tab

TARGETING (only when NOT in a session, or picking a parallel tab)

  CDP_PORT / CDP_TARGET  Orchestrators can pin the active browser + tab
  --target <tabId>       Exact id; a prefix of 8 chars is enough (preferred, parallel-safe)
  --url <pattern>        Fuzzy URL match against open tabs
                         NOTE: on \`session start\`, --url is a URL to OPEN, not a pattern.

HELP

  capture <command> --help       Per-command usage, e.g. capture click --help, capture har --help
  capture --version              Print version

PREREQ — a browser with CDP must be running:
  Arc                 enabled by default
  Chrome / Chromium   --remote-debugging-port=9222
  Electron apps       CDP exposed automatically
  Verify with:        capture detect`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
