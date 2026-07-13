export interface CDPTarget {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

export interface ParsedArgs {
  command: string;
  positional: string[];
  port?: number;
  out?: string;
  json?: boolean;
  duration?: number;
  settle?: number;
  file?: string;
  /** Session-filled internal slot: NOT CLI-settable (no --har flag, no env
   * var). Auto-filled from the active session's harId so withConnection()
   * can auto-append recorded traffic to the session HAR. */
  har?: string;
  new?: boolean;
  target?: string;
  /** Where `target` was assigned from: an actual `--target` flag, active-session
   * autofill, or the ambient `CDP_TARGET` env var. Recorded at the assignment
   * point — browser-scope CDP (`cdp --browser`) attaches a flattened target
   * session only when this is `'flag'`; provenance is never inferred later by
   * comparing final strings. */
  targetSource?: 'flag' | 'session' | 'env';
  url?: string;
  into?: string;
  noScreenshot?: boolean;
  viewport?: string;
  fullPage?: boolean;
  help?: boolean;
  /** `--all` — boolean scope-widener (per-leaf semantics). */
  all?: boolean;
  /** `--session <id>` — explicit session id override (per-leaf semantics). */
  session?: string;
  /** `session start --hold` — hold one CDP browser connection open for the session's lifetime. */
  hold?: boolean;
  /** `session view --filter <section>` — show only one bundle-manifest section. */
  filter?: string;
  /** `session log --name <label>` */
  name?: string;
  filterUrl?: string;
  filterStatus?: string;
  filterMethod?: string;
  limit?: number;
  browser?: boolean;
  params?: string;
  waitEvent?: string;
  timeoutMs?: number;
  socket?: string;

  // -- measure/motion branch flags (settled in the capture measure+motion
  // build plan's U02) -- every leaf under `capture measure`/`capture motion`
  // parses these from the shared global parser instead of re-parsing argv
  // itself.
  /** `snap --freeze-animations` — pause CSS/WAAPI animation before capture. */
  freezeAnimations?: boolean;
  /** `snap --settle-timeout <ms>` — override the default 5000ms settle wait. */
  settleTimeout?: number;
  /** `snap --capture-unsettled` — write full substrate despite non-settlement. */
  captureUnsettled?: boolean;
  /** `snap|diff|mask --pixels` — include raster crop/diff facts. */
  pixels?: boolean;
  /** `snap --state <state[:selector]>` — repeatable; one entry per occurrence. */
  state?: string[];
  /** `check --for <list>` — comma-separated check names or categories. */
  for?: string;
  /** `diff --before <snap>` */
  before?: string;
  /** `diff --after <snap>` */
  after?: string;
  /** `diff --full` — expand to the complete state-matrix/per-element diff. */
  full?: boolean;
  /** `check|diff --gate` — exit 2 on findings/changes instead of 0. */
  gate?: boolean;
  /** `census --snap <id>` — repeatable; one entry per occurrence. */
  snap?: string[];
  /** `census --url <url>` — repeatable accumulator alongside the existing
   * single-value `url` field above (which stays last-wins for every
   * existing command's target-matching semantics). */
  urls?: string[];
  /** `census --set-file <path>` */
  setFile?: string;
  /** `census|sweep --axis <axis>` */
  axis?: string;
  /** `sweep --from <val>` — raw string; axis units vary (px/dpr/zoom). */
  from?: string;
  /** `sweep --to <val>` — raw string; axis units vary (px/dpr/zoom). */
  to?: string;
  /** `sweep --viewport-height <val>` — raw string for the viewport-height sweep axis. */
  viewportHeight?: string;
  /** `motion rec --stop --rec-id <id>` — explicit recording id override. */
  recId?: string;
  /** `check|snap|census --viewport WxH` — repeatable accumulator alongside
   * the existing single-value `viewport` field above (last-wins, unchanged). */
  viewports?: string[];
  /** `explain|map focus|... --selector <sel>` */
  selector?: string;
  /** `explain --size` — include size/layout provenance detail. */
  size?: boolean;
  /** `explain --text` — include text/line-box detail. */
  text?: boolean;
  /** `explain --form` — include form/caret/autofill detail. */
  form?: boolean;
  /** `motion rec --start` — arm the composed recorder. */
  start?: boolean;
  /** `motion rec --stop` — finalize the composed recorder. */
  stop?: boolean;
  /** `motion rec --do <action>` — one-shot scripted action. */
  do?: string;
  /** `motion timeline --element <sel>` */
  element?: string;
  /** `motion timeline --prop <name>` */
  prop?: string;
  /** `motion response --action <action>` */
  action?: string;
  /** `motion response --occurrence <n>` — 1-based occurrence of a repeated action label. */
  occurrence?: number;
}
