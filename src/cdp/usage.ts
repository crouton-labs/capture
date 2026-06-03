export const CDP_USAGE = `CDP — browser automation via exec, a11y interactions, and screenshots.

Commands:
  exec <code>         Execute JavaScript in a browser tab
  exec --file <path>  Execute JS from file
  detect              Detect CDP port (prioritizes default browser)
  list                List all browser tabs
  open <url>          Open URL in browser (returns tab ID)
  reset-tab <url>     Abandon stuck tab, open fresh one (updates session)
  screenshot          Capture screenshot
  click "name"        Click element by accessible name
  type "text"         Type text into focused element
  a11y                Get accessibility tree
  record              Passive HAR recording
  navigate <url>      Navigate to URL and record HAR
  network <offline|online>  Toggle network (simulate disconnect)
  har create          Create a HAR recording (returns id)
  har read [id]       Read accumulated HAR entries (id optional in active session)
  har delete <id>     Delete a HAR recording

Options:
  --port <port>       Override CDP port
  --target <tabId>    Target tab by exact ID (preferred, parallel-safe)
  --new               Force new tab (open)
  --record            Enable HAR recording (exec)
  --har <id>          Append traffic to a HAR recording
  --har-out <path>    HAR output path
  --file <path>       Read JS from file (exec)
  --duration <secs>   Recording duration (record, default: 10)
  --settle <ms>       Settle time override (navigate, click, type)
  --filter-url <pat>  Filter HAR entries by URL substring/regex (har read)
  --filter-status <s> Filter HAR by status: code, prefix (4), or range (400-499)
  --filter-method <m> Filter HAR by HTTP method (har read)
  --limit <N>         Return only first N matching HAR entries (har read)
  --out <path>        Output path (screenshot)
  --viewport <preset> Viewport preset: desktop-wide|desktop|tablet|mobile (default: desktop)
  --height <px>       Override viewport height (screenshot)
  --full-page         Capture entire scrollable page (screenshot)
  --json              JSON output (a11y)
  --interactive       Interactive elements only (a11y)
  --role <role>       ARIA role filter (click)
  --into "field"      Target field by name (type)
  --no-screenshot     Skip auto-screenshot (click, type)

Console output (errors, warnings) is always captured and printed to stderr.

Examples:
  capture detect
  capture list
  capture open "https://app.example.com" --new
  capture exec "document.title" --target <id>
  capture exec "document.querySelector('.btn').click()" --target <id>
  capture exec "fetch('/api/data').then(r=>r.json())" --target <id> --record
  capture exec --file /tmp/scrape.js --target <id>
  capture screenshot --target <id> --out /tmp/shot.png
  capture a11y --target <id> --interactive
  capture record --target <id> --duration 15
  capture navigate "https://app.example.com/dashboard"
  capture har create
  capture exec "document.querySelector('form').submit()" --target <id> --har <id>
  capture har read <id>
`;
