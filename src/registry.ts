/** Static, pure descriptor tree; unreachable from the legacy launcher until U15. */
import {
  EXACT_RAW_LEAF_PAYLOADS, EXPECTED_LEAF_PATHS, MAX_BOUNDED_BYTES, NO_EFFECTS,
  PAGINATED_LEAF_PATHS, type BranchDescriptor, type FlagSpec, type LeafDescriptor,
  type PositionalSpec, type RouteDescriptor, type RouteEffects, combine, fail,
  validateBranchDescriptor, validateLeafDescriptor, validateRegistry, type ValidationResult,
} from './contracts/index.js';
import {
  exactRawJsonRejection, type LeafOutputMode, type LeafOutputOwner, validateLeafOutputOwners,
} from './output/exact-raw.js';

export interface HelpContent {
  readonly description: string;
  readonly whenToUse: string;
  readonly rubric: string;
  readonly followUp: string;
  readonly constraints: string;
  readonly orderedOutput: string;
  readonly artifactOwnership: string;
  readonly model?: string;
  readonly globals?: string;
  readonly ioContract?: string;
}
export interface RegistryBranch extends BranchDescriptor {
  readonly visibility: 'public' | 'internal'; readonly help: HelpContent;
  readonly children: readonly RegistryNode[]; readonly aliases?: readonly string[];
}
export interface RegistryLeaf extends LeafDescriptor {
  readonly visibility: 'public' | 'internal'; readonly help: HelpContent;
  readonly recovery: string; readonly outputMode: LeafOutputMode; readonly aliases?: readonly string[];
}
export type RegistryNode = RegistryBranch | RegistryLeaf;

type LeafOptions = {
  readonly positionals?: readonly PositionalSpec[]; readonly flags?: readonly FlagSpec[];
  readonly mutualExclusions?: readonly (readonly string[])[]; readonly effects?: RouteEffects;
  readonly growing?: boolean; readonly stderr?: 'empty-on-success' | 'declared-progress';
  readonly constraints?: string; readonly orderedOutput?: string; readonly artifactOwnership?: string;
  readonly recovery?: string;
};
const effects = (browser = false, session = false, artifact = false, environment = false): RouteEffects => ({ browser, session, artifact, environment });
const positional = (name: string, grammar: string, required = true): PositionalSpec => ({ name, grammar, required });
const bool = (name: string): FlagSpec => ({ name, grammar: 'boolean' });
const value = (name: string, grammar: string, values?: readonly string[], defaultValue?: string | number, units?: string): FlagSpec => ({ name, grammar, ...(values ? { values } : {}), ...(defaultValue !== undefined ? { default: defaultValue } : {}), ...(units ? { units } : {}) });
const requiredValue = (name: string, grammar: string, values?: readonly string[]): FlagSpec => ({ name, grammar, required: true, ...(values ? { values } : {}) });
const repeatableValue = (name: string, grammar: string, required = false): FlagSpec => ({ name, grammar, repeatable: true, ...(required ? { required: true } : {}) });
const port = (required = false) => ({ ...value('--port', '1..65535', undefined, undefined, 'tcp-port'), ...(required ? { required: true } : {}) });
const timeout = (name: '--navigation-timeout' | '--settle-timeout') => value(name, '1..60000', undefined, name === '--navigation-timeout' ? 10000 : 5000, 'ms');
const limit = () => value('--limit', '1..20', undefined, 20, 'records');
const bounded = (path: string) => ({ kind: 'bounded' as const, domain: path.replaceAll(' ', '-'), schema: `${path.replaceAll(' ', '-')}-v1` });

function leaf(path: string, description: string, options: LeafOptions = {}): RegistryLeaf {
  const payload = EXACT_RAW_LEAF_PAYLOADS[path];
  const raw = payload !== undefined;
  const paginated = PAGINATED_LEAF_PATHS.includes(path);
  const constraints = options.constraints ?? 'Singleton value flags accept one grammar-valid value; unknown options and unexpected positionals fail before effects.';
  return {
    kind: 'leaf', path, summary: description, visibility: 'public', positionals: options.positionals ?? [], flags: options.flags ?? [], mutualExclusions: options.mutualExclusions ?? [], effects: options.effects ?? NO_EFFECTS,
    result: raw ? { kind: 'exact-raw', payload } : bounded(path), outputMode: raw ? 'exact-raw-json-rejected' : 'structured-json-capable',
    ...(raw ? {} : { bounds: { maxBytes: MAX_BOUNDED_BYTES, maxRecords: 20, growing: options.growing ?? paginated, paginated } }),
    stderr: options.stderr ?? 'empty-on-success', exits: [0, 2, 3], handler: path.replaceAll(' ', '.'),
    help: {
      description, whenToUse: `Choose this when you need ${description.toLowerCase()}`,
      rubric: raw ? `Exact raw ${payload}; size unbounded. --json rejects before effects with code=output_mode_unsupported, field=--json, expected=omit --json for exact raw output, and next_action=run ${path} -h.` : `Structured ${path.replaceAll(' ', '-')}-v1 result, bounded independently to ${MAX_BOUNDED_BYTES} UTF-8 bytes in prose and JSON.`,
      constraints,
      orderedOutput: options.orderedOutput ?? (raw ? `Handler stdout is ${payload} exactly as produced, including final-newline presence; it is never parsed, wrapped, normalized, or reserialized.` : 'Identity and attestation; fixed summary and scope; source coverage; leaf-owned evidence access; omission metadata; bounded records; static follow-up.'),
      artifactOwnership: options.artifactOwnership ?? (options.effects?.artifact ? 'Creates or reuses only this leaf’s declared artifact; stdout carries its absolute access locator.' : 'Reads declared evidence only and creates no projection-owned artifact.'),
      followUp: `run capture ${path} -h`,
    },
    recovery: options.recovery ?? `Correct the reported input and run capture ${path} -h.`,
  };
}
function branch(path: string, description: string, children: readonly RegistryNode[], model?: string, root = false): RegistryBranch {
  return { kind: 'branch', path, summary: description, visibility: 'public', children, help: {
    description, whenToUse: `Choose this when working with ${description.toLowerCase()}`,
    rubric: model ?? `${path || 'Capture'} command family.`, constraints: 'Choose an exact canonical child; old names and aliases are not accepted.', orderedOutput: 'Branch help only; branches perform no effects.', artifactOwnership: 'Branch help creates no artifact.', followUp: `run capture${path ? ` ${path}` : ''} -h`,
    ...(root ? {
      model: 'Commands divide browser lifecycle, current-page work, rendered structure, time, traffic, endpoint control, and site-service APIs. Select evidence by modality: page owns semantics and pixels; measure owns rendered structure; motion owns time; traffic owns requests.',
      globals: '-h resolves the deepest command then renders help with zero effects; --json requests JSON only from structured leaves; --version is root-only and precedes path resolution.',
      ioContract: 'Leaf-declared flags and positionals are input. Structured leaves emit factual prose or JSON; exact-raw leaves emit declared bytes/text. Diagnostics are stderr; exit 0 is success and nonzero is failure.',
    } : {}),
  }};
}
const snapStates = ['normal', 'hover', 'focus', 'active', 'checked', 'open', 'disabled', 'invalid', 'all'];
const families = ['viewport-box-position', 'element-scroll-extent', 'native-control-and-anchor-box-size', 'computed-color-pair-contrast', 'sampled-hit-reception', 'text-inline-extent', 'form-control-state', 'media-state', 'animation-state', 'opaque-background-sibling-box-intersection', 'css-overflow-visible-box-intersection'];
const ref = 'css:<selector> | backend:<id> | axid:<id> | ax:<name> | text:<text>';

export const CAPTURE_REGISTRY: RegistryBranch = branch('', 'Capture — browser evidence and automation over CDP.', [
  branch('session', 'persistent browser-work lifecycle and artifact bundles.', [
    leaf('session start', 'start a fresh persistent capture session.', { flags: [requiredValue('--url', 'absolute-http(s)-url'), port()], effects: effects(true, true, true), constraints: 'Required singleton --url <absolute-http(s)-url>; optional singleton --port <1..65535>. No target, prefix, positional URL, or ambient CDP selection.', orderedOutput: 'Exact session ID; open lifecycle; full target ID; endpoint; observed URL; target_live=true; scope key; active generation.', artifactOwnership: 'Exclusively allocates the session directory and atomically publishes the canonical session record before its scoped pointer.' }),
    leaf('session stop', 'stop and bundle one exact capture session.', { positionals: [positional('session-id', 'exact-session-id')], effects: effects(true, true, true), constraints: 'One exact case-sensitive session ID; no prefixes. Only matching open/stopping/completed lifecycle records are accepted before bundle effects.', orderedOutput: 'Exact ID; stop-operation ID; stopped lifecycle; final bundle access; pointer outcome deleted|absent|superseded.', artifactOwnership: 'Resumes the recorded operation and owns bundle staging/publication; never rolls lifecycle back to open.', recovery: 'session_stop_state_invalid: inspect capture session view <exact-session-id> and preserve the session directory; never delete or allocate a new stop. session_stop_staging_cleanup_failed: correct access at the reported staging path and retry the identical capture session stop <exact-session-id>. session_stop_bundle_failed: correct the reported bundle/filesystem cause and retry that identical command. Both retries resume the recorded operation.' }),
    leaf('session list', 'list same-user host capture sessions.', { effects: effects(false, true), constraints: 'No target/session filters or ambient defaults.', orderedOutput: 'Rows sorted by exact session ID: ID, lifecycle, active_in_current_scope, full target ID or null, endpoint or null, target_live.' }),
    leaf('session view', 'view one exact capture session.', { positionals: [positional('session-id', 'exact-session-id')], effects: effects(false, true), constraints: 'One exact case-sensitive session ID; no prefix.' }),
    leaf('session log', 'read recorded session log bytes.', { positionals: [positional('path', 'session-log-path')], effects: effects(false, true), constraints: 'One declared session-log path; no global JSON.', recovery: 'Use the exact session log path and run capture session log -h.' }),
  ]),
  branch('page', 'semantic/pixel orientation and actions on the selected page.', [
    leaf('page a11y', 'read the full accessibility tree.', { effects: effects(true), constraints: 'No global JSON; reads the selected page accessibility tree.' }),
    leaf('page screenshot', 'capture screenshot pixel evidence.', { flags: [value('--out', 'absolute-output-path'), bool('--full-page')], effects: effects(true, false, true), constraints: 'Optional singleton --out path and --full-page; pixel evidence does not establish structural causality.' }),
    leaf('page click', 'click an accessible page element.', { positionals: [positional('name', 'accessible-name')], flags: [value('--role', 'aria-role')], effects: effects(true), constraints: 'One accessible-name positional; optional singleton --role.' }),
    leaf('page type', 'type text into a page control.', { positionals: [positional('text', 'text')], flags: [value('--into', 'accessible-name-or-selector')], effects: effects(true), constraints: 'One text positional and optional singleton --into target.' }),
    leaf('page navigate', 'navigate the selected page.', { positionals: [positional('url', 'absolute-http(s)-url')], flags: [timeout('--settle-timeout')], effects: effects(true), constraints: 'One absolute HTTP(S) URL; optional settle timeout.' }),
    leaf('page exec', 'evaluate handler-owned page code.', { positionals: [positional('code', 'javascript-source')], flags: [value('--file', 'absolute-source-path')], effects: effects(true), constraints: 'One source positional or declared --file source; no global JSON.' }),
  ]),
  branch('measure', 'immutable snapshots and factual rendered-structure reads.', [
    leaf('measure snap', 'acquire one immutable structural snapshot.', { positionals: [positional('url', 'absolute-http(s)-url', false)], flags: [value('--session', 'exact-session-id'), value('--target', 'target-token'), port(), timeout('--navigation-timeout'), timeout('--settle-timeout'), bool('--freeze-animations'), bool('--capture-unsettled'), bool('--pixels'), repeatableValue('--state', `name[:css-selector], name ∈ ${snapStates.join('|')}`), value('--viewport', '<width>x<height>')], mutualExclusions: [['--session', '--target'], ['--session', '--port']], effects: effects(true, true, true), constraints: 'Exactly one target mode: [url] with optional port, --session with no port, --target with optional port, or active session. At most one URL; navigation timeout only with fresh URL; --state repeats, all conflicts with other states.', orderedOutput: 'Snapshot ID and absolute directory; target attestation; request/timing; viewport and content provenance; source coverage; facets; pixels/crops; immutable source-manifest access.', artifactOwnership: 'Creates one immutable snapshot source tree and atomically publishes its global ID only after restoration and closure gates.', recovery: 'snapshot_target_required: run capture measure snap <url> [--port <port>], or start a persistent session, or select an exact target from capture browser list. snapshot_target_conflict: keep exactly one target-mode row. duplicate_option: remove the repeated option. unexpected_positional: keep one absolute HTTP(S) URL or none. port_requires_url_or_target: add URL/--target or remove port. port_conflicts_with_session: remove port. navigation_timeout_requires_fresh_url: remove it or select fresh URL. session_unavailable: run capture session list and use an exact open live row. target_unavailable: run capture browser list and retry exact displayed port/full ID. browser_endpoint_unavailable: run capture browser detect or capture browser list. navigation_failed: correct URL/connectivity or raise navigation timeout. temporary_target_cleanup_unconfirmed: inspect exact port with capture browser list and close the full target via browser cdp. capture_restoration_unconfirmed: re-establish page state and reacquire. artifact_path_too_long: shorten Capture root or snapshot path.' }),
    leaf('measure check', 'inventory one measurement family or detail.', { positionals: [positional('snapshot', 'snapshot-id-or-absolute-directory')], flags: [value('--family', 'canonical-family', families), value('--detail', 'fact-id'), limit()], mutualExclusions: [['--family', '--detail'], ['--detail', '--limit']], effects: effects(false, false, true), constraints: `One snapshot; optional --family is one of ${families.join(', ')}; --detail and --family conflict; --limit applies only to summary/family mode.`, orderedOutput: 'Attestation; scope; viewport/content facts; canonical family directory or bounded detail; collector coverage; one derived manifest and exhaustive fact locator; omission metadata; static follow-up.', artifactOwnership: 'Always creates or reuses the deterministic derived read and its exhaustive fact artifact.', recovery: 'Correct snapshot/family/detail/limit input before effects; broad reads return to capture measure check -h, while focused facts use their returned fact ID detail form.' }),
    leaf('measure geometry', 'measure nominal relation between two subjects.', { positionals: [positional('snapshot', 'snapshot-id-or-absolute-directory')], flags: [requiredValue('--first', ref), requiredValue('--second', ref)], effects: NO_EFFECTS, constraints: 'One explicit snapshot and required singleton --first and --second ordered element references.', orderedOutput: 'Attestation; ordered identities; page-css-v1 comparability; border AABBs; deltas; separation/distance; nominal intersection; coverage; immutable source access.', artifactOwnership: 'Reads immutable snapshot artifacts only; creates no derived read, crop, browser mutation, or session mutation.' }),
    branch('measure map', 'page-wide focus, scroll/container, or paint/layer topology.', [
      leaf('measure map focus', 'map keyboard traversal and focus movement.', { positionals: [positional('snapshot', 'snapshot-id-or-absolute-directory')], flags: [value('--detail', 'focus-id'), limit()], mutualExclusions: [['--detail', '--limit']], effects: effects(false, false, true), constraints: 'One snapshot; --detail or summary --limit <1..20>, never both.', orderedOutput: 'Attestation; traversal/source coverage; exact counts; derived manifest and focus artifact; bounded forward/reverse topology or one detail; omissions and follow-up.', artifactOwnership: 'Always creates or reuses one deterministic focus-topology derived read.', recovery: 'Correct snapshot, detail, or limit selection and rerun capture measure map focus -h.' }),
      leaf('measure map scroll', 'map scroll topology and container extents.', { positionals: [positional('snapshot', 'snapshot-id-or-absolute-directory')], flags: [value('--detail', 'container-id'), limit()], mutualExclusions: [['--detail', '--limit']], effects: effects(false, false, true), constraints: 'One snapshot; --detail or summary --limit <1..20>, never both.', orderedOutput: 'Attestation; viewport/content authority; coverage/counts; derived manifest/scroll artifact; root then source-ordered rows; omissions.', artifactOwnership: 'Always creates or reuses one deterministic scroll-topology derived read.' }),
      leaf('measure map layers', 'map paint, stacking, and compositor topology.', { positionals: [positional('snapshot', 'snapshot-id-or-absolute-directory')], flags: [value('--detail', 'subject-or-layer-id'), limit()], mutualExclusions: [['--detail', '--limit']], effects: effects(false, false, true), constraints: 'One snapshot; --detail or summary --limit <1..20>, never both.', orderedOutput: 'Attestation; paint/layer coverage and counts; derived manifest/layer artifact; bounded topology with nominal border bounds or exact unavailability, paint rank, membership, compositing reasons, provenance, and omissions.', artifactOwnership: 'Always creates or reuses one deterministic layer-topology derived read.', recovery: 'Correct snapshot, detail, or limit selection and rerun capture measure map layers -h.' }),
    ], 'Map children partition one snapshot by keyboard traversal, overflow/scroll containment, and paint/compositor structure; they never infer quality, intent, or pixel coverage.'),
    leaf('measure explain', 'read one subject’s structural provenance.', { positionals: [positional('snapshot', 'snapshot-id-or-absolute-directory')], flags: [requiredValue('--subject', ref), bool('--size'), bool('--text'), bool('--form')], effects: NO_EFFECTS, constraints: 'One snapshot and required singleton --subject element reference; requested sections are bounded.', artifactOwnership: 'Reads one immutable snapshot root and fixed manifest locator; creates no artifact.' }),
    branch('measure variation', 'compare states, distributions, or controlled environments.', [
      leaf('measure variation diff', 'compare two immutable snapshots.', { flags: [requiredValue('--before', 'snapshot-id-or-absolute-directory'), requiredValue('--after', 'snapshot-id-or-absolute-directory'), bool('--pixels'), limit()], effects: effects(false, false, true), constraints: 'Exactly one ordered --before and --after; snapshots differ; optional --pixels and --limit <1..20>; no positionals.', orderedOutput: 'Ordered pair attestation; normalized diff scope; exact source/change coverage; derived manifest and exhaustive diff artifact; requested raster artifact/coverage; bounded changed records and omissions.', artifactOwnership: 'Creates or reuses one deterministic ordered-pair diff read and exhaustive diff/raster artifacts.', recovery: 'Correct the ordered before/after pair, pixels mode, or limit and rerun capture measure variation diff -h.' }),
      leaf('measure variation census', 'summarize variation across snapshots.', { flags: [repeatableValue('--snapshot', 'snapshot-id-or-absolute-directory', true), requiredValue('--axis', 'viewport|geometry|styles|scroll|focus|layers', ['viewport', 'geometry', 'styles', 'scroll', 'focus', 'layers']), limit()], effects: effects(false, false, true), constraints: 'Repeat --snapshot 2..64 times in caller order; exactly one case-sensitive --axis; no duplicates or positionals.', orderedOutput: 'Ordered-set attestation; axis population definition; exact per-source coverage and nearest-rank distributions/state counts; derived manifest/census artifact; bounded records and omissions.', artifactOwnership: 'Creates or reuses one deterministic census read and exhaustive census artifact.', recovery: 'Correct ordered snapshot membership, axis, or limit and rerun capture measure variation census -h.' }),
      leaf('measure variation sweep', 'acquire a controlled variation sweep.', { flags: [value('--session', 'exact-session-id'), value('--target', 'target-token'), port(), requiredValue('--axis', 'viewport-width|viewport-height', ['viewport-width', 'viewport-height']), requiredValue('--from', '1..16384'), requiredValue('--to', '1..16384'), value('--samples', '2..64', undefined, 5), value('--viewport-width', '1..16384'), value('--viewport-height', '1..16384'), bool('--freeze-animations'), timeout('--settle-timeout'), bool('--capture-unsettled'), bool('--pixels')], mutualExclusions: [['--session', '--target'], ['--session', '--port']], effects: effects(true, true, true), constraints: 'Existing --session, --target [--port], or active session selects target; --port only accompanies --target. Required axis/from/to; width requires viewport height and height requires viewport width.', orderedOutput: 'Endpoint/session attestation; exact axis/range/sample values; immutable observation manifest; ascending sampled snapshot IDs/directories; transitions/uncertainties; coverage; bounded rows/omissions; restoration state.', artifactOwnership: 'Creates immutable sampled snapshots and one observation/recovery manifest, never a derived read.', recovery: 'For port/session or navigation-timeout selection errors use the matching snap recovery; a failed sample points to its recovery manifest with every finalized partial snapshot.' }),
    ], 'Variation children select ordered pair comparison, ordered-set distribution, or controlled target sampling; direct reads own facts within one snapshot.'),
  ], 'A snapshot is an immutable explicit observation. snap acquires it; check, geometry, map, and explain read one explicit snapshot; variation owns cross-state work. Choose by fact resolution, not fixed sequence.'),
  branch('motion', 'recorded temporal behavior and frame-change measurements.', [
    leaf('motion rec', 'record page motion.', { effects: effects(true, false, true) }),
    leaf('motion mask', 'record motion masking evidence.', { positionals: [positional('recording-id', 'recording-id')], effects: effects(false, false, true) }),
    leaf('motion timeline', 'read a motion timeline.', { positionals: [positional('recording-id', 'recording-id')] }),
    leaf('motion jank', 'read frame timing measurements.', { positionals: [positional('recording-id', 'recording-id')] }),
    leaf('motion response', 'read motion response measurements.', { positionals: [positional('recording-id', 'recording-id')] }),
  ]),
  branch('traffic', 'network recording and HAR reads.', [
    leaf('traffic record', 'record network traffic.', { flags: [value('--duration', 'positive-ms', undefined, undefined, 'ms')], effects: effects(true, false, true) }),
    branch('traffic har', 'HAR artifact lifecycle.', [
      leaf('traffic har create', 'create a HAR recording.', { effects: effects(true, false, true) }),
      leaf('traffic har read', 'read stored HAR bytes.', { positionals: [positional('har-id', 'exact-har-id')], constraints: 'One exact HAR ID; no global JSON.' }),
      leaf('traffic har delete', 'delete a HAR recording.', { positionals: [positional('har-id', 'exact-har-id')], effects: effects(false, false, true) }),
    ]),
  ]),
  branch('browser', 'CDP endpoints, tabs, connectivity, and raw protocol access.', [
    leaf('browser detect', 'detect browser endpoints.', { growing: true, effects: effects(true, false, false, true), constraints: 'No target/port input or ambient CDP selection.', orderedOutput: 'Selected endpoint; preference class; deterministically numeric-port-sorted endpoint rows; availability.' }),
    leaf('browser list', 'list attachable browser page targets.', { flags: [port()], growing: true, effects: effects(true), constraints: 'Optional singleton --port <1..65535>; duplicate or invalid port fails before probes.', orderedOutput: 'Only attachable page rows with full target ID, endpoint, observed URL, title, attachability, sorted by (port, fullTargetId).' }),
    leaf('browser open', 'open a fresh browser page.', { flags: [requiredValue('--url', 'absolute-http(s)-url'), port(), timeout('--navigation-timeout')], effects: effects(true), constraints: 'Required singleton --url; optional --port and navigation timeout; no positional URL, target, or --new.', orderedOutput: 'Full endpoint-qualified target identity and observed URL after navigation.' }),
    leaf('browser reset', 'reset a browser page.', { positionals: [positional('url', 'absolute-http(s)-url')], effects: effects(true) }),
    leaf('browser network', 'set selected page network state.', { positionals: [positional('state', 'network-state')], effects: effects(true) }),
    leaf('browser cdp', 'send one raw CDP request.', { positionals: [positional('method', '^[A-Za-z][A-Za-z0-9]*\\.[A-Za-z][A-Za-z0-9]*$'), positional('params-json-object', 'JSON-object', false)], flags: [port(true)], effects: effects(true), constraints: 'Required singleton --port <1..65535>, one required method, and at most one JSON-object params positional (omitted means {}). No ambient endpoint, session, target, URL, stdin, or duplicate options.', orderedOutput: 'Exactly the matching CDP response text-frame bytes, including byte order and final-newline absence; unrelated events are omitted.', artifactOwnership: 'Creates no artifact. Exactly one CDP request is sent only after all validation and endpoint connection succeed.', recovery: 'Input failures: run capture browser cdp -h. Endpoint/transport failures: run capture browser list --port <port>; command failure: correct method or params from exact stdout response.' }),
  ]),
  branch('library', 'catalog and schemas for bundled site-service functions.', [
    leaf('library list', 'list bundled libraries.', { growing: true }),
    leaf('library search', 'search bundled library functions.', { positionals: [positional('query', 'text')], growing: true }),
    leaf('library show', 'show a bundled library.', { positionals: [positional('library', 'library-name')], growing: true }),
    leaf('library read', 'read bundled function source bytes.', { positionals: [positional('library', 'library-name')], effects: effects(false, false, false, true), constraints: 'One declared library name; no global JSON.' }),
  ]),
  { kind: 'leaf', path: '__bridge-serve', summary: 'internal bridge server.', visibility: 'internal', positionals: [], flags: [], mutualExclusions: [], effects: effects(false, false, false, true), result: bounded('__bridge-serve'), outputMode: 'structured-json-capable', bounds: { maxBytes: MAX_BOUNDED_BYTES, maxRecords: 0, growing: false, paginated: false }, stderr: 'empty-on-success', exits: [0, 2, 3], handler: '__bridge.serve', help: { description: 'internal bridge server.', whenToUse: 'Internal runtime bridge only.', rubric: 'Not a public command.', constraints: 'Exact internal path only.', orderedOutput: 'Internal structured status.', artifactOwnership: 'No public artifact contract.', followUp: 'internal only.' }, recovery: 'Internal runtime recovery only.' },
], undefined, true);

export function flattenRegistry(node: RegistryNode = CAPTURE_REGISTRY): readonly RouteDescriptor[] {
  if (node.kind === 'leaf') return [node];
  return [...(node.path ? [node] : []), ...node.children.flatMap((child) => flattenRegistry(child))];
}
function outputOwner(leaf: RegistryLeaf): LeafOutputOwner {
  if (leaf.outputMode === 'structured-json-capable') return { mode: leaf.outputMode, canonicalPath: leaf.path };
  return { mode: leaf.outputMode, canonicalPath: leaf.path, payloadType: (leaf.result.kind === 'exact-raw' ? leaf.result.payload : ''), size: 'unbounded' };
}

/** Validates public census/output projection and internal entries independently. */
export function validateCaptureRegistry(root: RegistryBranch = CAPTURE_REGISTRY): ValidationResult {
  const all = flattenRegistry(root) as readonly RegistryNode[];
  const publicNodes = all.filter((node) => node.visibility === 'public');
  const internalNodes = all.filter((node) => node.visibility === 'internal');
  const errors: ValidationResult[] = [validateRegistry(publicNodes), validateLeafOutputOwners(publicNodes.filter((node): node is RegistryLeaf => node.kind === 'leaf').map(outputOwner))];
  const publicPaths = new Set(['', ...publicNodes.map((node) => node.path)]);
  const validateFollowUp = (node: RegistryNode): void => {
    if (node.visibility !== 'public') return;
    const match = /^run capture(?: (.*))? -h$/.exec(node.help.followUp);
    if (!match || !publicPaths.has(match[1] ?? '')) errors.push(fail(`route ${node.path || 'root'} follow-up does not resolve to a public canonical help path`));
  };
  const visit = (node: RegistryNode, parent?: RegistryBranch): void => {
    const h = node.help;
    if (!h.description || !h.whenToUse || !h.rubric || !h.followUp || !h.constraints || !h.orderedOutput || !h.artifactOwnership) errors.push(fail(`route ${node.path || 'root'} missing help contract`));
    if (node.aliases?.length) errors.push(fail(`route ${node.path || 'root'} declares aliases; canonical paths have no aliases`));
    validateFollowUp(node);
    if (node.kind === 'leaf') {
      errors.push(validateLeafDescriptor(node));
      if (!node.recovery) errors.push(fail(`leaf ${node.path} missing recovery`));
      if (node.outputMode === 'exact-raw-json-rejected') {
        if (node.result.kind !== 'exact-raw') errors.push(fail(`leaf ${node.path} exact-raw output mode needs exact-raw result`));
        const rejection = exactRawJsonRejection(node.path);
        if (node.visibility === 'public' && ![rejection.code, rejection.field, rejection.expected, rejection.next_action].every((field) => node.help.rubric.includes(field))) {
          errors.push(fail(`exact-raw leaf ${node.path} help must declare the full ${rejection.code} diagnostic`));
        }
      } else if (node.result.kind !== 'bounded') errors.push(fail(`leaf ${node.path} structured output mode needs bounded result`));
    } else {
      if (node.path) errors.push(validateBranchDescriptor(node));
      const publicChildren = node.children.filter((child) => child.visibility === 'public');
      if (publicChildren.length > 7) errors.push(fail(`branch ${node.path || 'root'} has ${publicChildren.length} public children; maximum is 7`));
      const names = new Set<string>();
      for (const child of node.children) {
        const name = child.path.split(' ').at(-1)!;
        if (names.has(name)) errors.push(fail(`branch ${node.path || 'root'} has duplicate child ${name}`));
        names.add(name);
        if (child.path !== `${node.path}${node.path ? ' ' : ''}${name}`) errors.push(fail(`child ${child.path} is not canonical beneath ${node.path || 'root'}`));
        visit(child, node);
      }
    }
    if (parent && !node.path) errors.push(fail('child missing canonical path'));
  };
  visit(root);
  for (const internal of internalNodes) if (internal.visibility !== 'internal') errors.push(fail(`internal route ${internal.path} leaked public`));
  const expected = new Set(EXPECTED_LEAF_PATHS);
  if (publicNodes.filter((node): node is RegistryLeaf => node.kind === 'leaf').some((leaf) => !expected.has(leaf.path))) errors.push(fail('registry contains a public leaf outside the canonical census'));
  return combine(...errors);
}
