import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleHelp } from '../src/command-help.js';
import { resolveCommand } from '../src/command-resolution.js';
import { walkCommand } from '../src/command-walker.js';
import { CAPTURE_REGISTRY, type RegistryBranch, type RegistryLeaf, validateCaptureRegistry } from '../src/registry.js';

const valid = (result: { valid: boolean; errors: readonly string[] }): void => assert.equal(result.valid, true, result.errors.join('; '));
const findBranch = (path: string, root: RegistryBranch): RegistryBranch | undefined => {
  if (root.path === path) return root;
  for (const child of root.children) if (child.kind === 'branch') {
    const found = findBranch(path, child);
    if (found) return found;
  }
  return undefined;
};
const branch = (path: string, root = CAPTURE_REGISTRY): RegistryBranch => findBranch(path, root) ?? assert.fail(`missing branch ${path}`);
const leaf = (path: string): RegistryLeaf => {
  const resolved = walkCommand(path.split(' '));
  assert.equal(resolved.kind, 'resolved');
  return (resolved as { node: RegistryLeaf }).node;
};

test('the static registry is the exact seven-noun public topology with an internal non-discoverable bridge', () => {
  valid(validateCaptureRegistry());
  assert.deepEqual(CAPTURE_REGISTRY.children.filter((child) => child.visibility === 'public').map((child) => child.path), ['session', 'page', 'measure', 'motion', 'traffic', 'browser', 'library']);
  assert.equal(walkCommand(['__bridge-serve']).kind, 'resolved', 'internal paths remain exact-resolvable for runtime wiring');
  const rootHelp = assembleHelp(CAPTURE_REGISTRY);
  assert.doesNotMatch(rootHelp, /__bridge-serve/);
  assert.deepEqual(branch('traffic').children.map((child) => child.path), ['traffic record', 'traffic har']);
});

test('walker is canonical-only and resolves the deepest path before leaf validation/effects', () => {
  const resolved = walkCommand(['measure', 'map', 'scroll', '--not-a-real-option']);
  assert.equal(resolved.kind, 'resolved');
  if (resolved.kind === 'resolved') {
    assert.equal(resolved.node.path, 'measure map scroll');
    assert.deepEqual(resolved.remaining, ['--not-a-real-option']);
  }
  assert.equal(walkCommand(['measure', 'map']).kind, 'resolved');
  assert.equal(walkCommand(['a11y']).kind, 'unknown-path');
  assert.equal(walkCommand(['browser', 'reset-tab']).kind, 'unknown-path');
});

test('root-only version precedes walking, while nested version is an invalid leaf argument', () => {
  assert.deepEqual(resolveCommand(['--version', 'page', 'click', '--bad']), { kind: 'version' });
  const nested = resolveCommand(['page', 'click', '--version']);
  assert.equal(nested.kind, 'dispatch');
  if (nested.kind === 'dispatch') assert.deepEqual(nested.argv, ['--version']);
  const help = resolveCommand(['page', 'click', '--bad', '-h']);
  assert.equal(help.kind, 'help', 'help wins after path resolution without parsing bad argv');
});

test('descriptor help renders descriptor-owned measurement selection and recovery contracts', () => {
  const root = assembleHelp(CAPTURE_REGISTRY);
  const measure = assembleHelp(branch('measure'));
  const map = assembleHelp(branch('measure map'));
  const geometry = assembleHelp(leaf('measure geometry'));
  const explain = assembleHelp(leaf('measure explain'));
  const cdp = assembleHelp(leaf('browser cdp'));
  const scroll = assembleHelp(leaf('measure map scroll'));
  for (const section of [
    'capture\n\nCapture — browser evidence and automation over CDP.',
    'When to use: Choose this when working with capture — browser evidence and automation over cdp.',
    'Model: Commands divide browser lifecycle, current-page work, rendered structure, time, traffic, endpoint control, and site-service APIs. Select evidence by modality: page owns semantics and pixels; measure owns rendered structure; motion owns time; traffic owns requests.',
    'Globals:',
    '-h resolves the deepest command then renders help with zero effects; --json requests JSON only from structured leaves; --version is root-only and precedes path resolution.',
    'I/O contract: Leaf-declared flags and positionals are input. Structured leaves emit factual prose or JSON; exact-raw leaves emit declared bytes/text. Diagnostics are stderr; exit 0 is success and nonzero is failure.',
    'Commands:',
    '  session  persistent browser-work lifecycle and artifact bundles. When to use: Choose this when work spans multiple invocations or must bundle the selected tab and artifacts; use an evidence branch for work performed inside the session.',
    '  page  semantic/pixel orientation and actions on the selected page. When to use: Choose this when reading accessibility roles and names, capturing pixels, clicking, typing, navigating, or executing page JavaScript. For what pixels visibly appear covered, occluded, clipped, cropped, masked, or absent, screenshot is the pixel evidence; use measure only for separately named nominal geometry, captured CSS/ancestor clipping or overflow structure, stacking, paint order, computed style, or distance evidence. Capture does not infer rendered-pixel coverage.',
    '  measure  immutable snapshots and factual rendered-structure reads. When to use: Choose this when a claim depends on nominal geometry or intersection, captured CSS/ancestor clipping or overflow structure, scroll/container extents, stacking or paint order, computed style, sampled hit reception, or distance; screenshots and accessibility trees do not establish these structural facts. Measurement does not establish what pixels visibly appear covered, occluded, clipped, cropped, masked, or absent; use page screenshot for that separate pixel evidence.',
    '  motion  recorded temporal behavior and frame-change measurements. When to use: Choose this when measuring response timing, changed pixels over time, animation timelines, or frame/jank facts; use measure for one settled structural state.',
    '  traffic  network recording and HAR reads. When to use: Choose this when measuring requests, responses, status, timing, or payload metadata; use page for page state and browser for endpoint/connectivity control.',
    '  browser  CDP endpoints, tabs, connectivity, and raw protocol access. When to use: Choose this when selecting or repairing browser/tab infrastructure, opening a tab, changing network state, or invoking an otherwise-unwrapped CDP method; use a domain branch when Capture already exposes the needed evidence or action.',
    '  library  catalog and schemas for bundled site-service functions. When to use: Choose this when selecting or reading a bundled site API function before executing it through page exec; use traffic to inspect browser network evidence.',
    'Next action: run capture -h',
  ]) assert.ok(root.includes(section), section);
  for (const fallback of [
    'Choose this when working with persistent browser-work lifecycle and artifact bundles.',
    'Choose this when working with semantic/pixel orientation and actions on the selected page.',
    'Choose this when working with immutable snapshots and factual rendered-structure reads.',
    'Choose this when working with recorded temporal behavior and frame-change measurements.',
    'Choose this when working with network recording and HAR reads.',
    'Choose this when working with CDP endpoints, tabs, connectivity, and raw protocol access.',
    'Choose this when working with catalog and schemas for bundled site-service functions.',
  ]) assert.doesNotMatch(root, new RegExp(fallback.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const row of [
    'capture measure\n\nimmutable snapshots and factual rendered-structure reads.',
    'When to use: Choose this when a claim depends on nominal geometry or intersection, captured CSS/ancestor clipping or overflow structure, scroll/container extents, stacking or paint order, computed style, sampled hit reception, or distance; screenshots and accessibility trees do not establish these structural facts. Measurement does not establish what pixels visibly appear covered, occluded, clipped, cropped, masked, or absent; use page screenshot for that separate pixel evidence.',
    'Model: A snapshot is an immutable explicit observation. snap acquires it; check, geometry, map, and explain read one explicit snapshot; variation owns cross-state work. Choose by fact resolution, not fixed sequence.',
    'Next action: run capture measure -h',
    'Choose this when no suitable snapshot exists or a later page state must be recorded; every structural read takes the returned snapshot explicitly.',
    "Choose this for a known family's recorded population and distributions or a bounded all-family orientation; use geometry for an exact relation between two selected subjects, map for page-wide topology, and explain for one subject's causal provenance.",
    "Choose this for two-subject rectangles, edge/center deltas, nominal intersection, and pairwise distance; these are nominal boxes, not painted-pixel coverage. Use explain for one subject's captured clipping/style provenance, map layers for page-wide stacking/paint evidence, and page screenshot for what pixels visibly appear covered, occluded, clipped, cropped, masked, or absent.",
    'Choose this when the relationship is page-wide: traversal, container bounds and client/content extents, recorded overflow clipping and reachability, or stacking/paint/layer membership and order. Use geometry for one selected pair, explain for one selected subject, and page screenshot for what pixels visibly appear covered, occluded, clipped, cropped, masked, or absent; no map leaf infers rendered-pixel coverage.',
    "Choose this for one subject's cascade, containing/overflow-clip/scroll chain, stacking context, size, text, or form provenance; use geometry for distance or nominal intersection between two subjects and map for topology across the page.",
    'Choose this when the question spans snapshots or controlled environments rather than one settled state; use the direct read children for facts within one snapshot.',
  ]) assert.ok(measure.includes(row), row);
  for (const row of [
    'Choose this for forward/reverse focus order, unreached focusable subjects, focus-visible facts, and scroll movement caused by traversal; use scroll for container reachability independent of focus.',
    'Choose this for page-wide bounds, scroll containers, current/maximum offsets, client-versus-content size, overflow behavior on both axes, recorded ancestor overflow boundaries, sticky/fixed occupancy, snap points, and reachable content; use layers for stacking or paint order.',
    "Choose this for page-wide DOMSnapshot paint rank, stacking-context/layer membership, compositor bounds/reasons, and layer-affecting declaration provenance. These facts do not establish which rendered pixels occlude another subject; use page screenshot for observed pixel coverage, geometry for one pair's nominal box relation, and scroll for overflow containment.",
  ]) assert.ok(map.includes(row), row);
  for (const section of [
    'capture measure geometry\n\nmeasure nominal relation between two subjects.',
    'Parameters:\n  <snapshot>  snapshot-id-or-absolute-directory\n  --first <css:<selector> | backend:<id> | axid:<id> | ax:<name> | text:<text>> required\n  --second <css:<selector> | backend:<id> | axid:<id> | ax:<name> | text:<text>> required',
    'Output: Explicit snapshot; ordered --first and --second subject refs (css:, backend:, axid:, ax:, text:); attestation and ordered identities; page-css-v1 coordinate authority/comparability; each subject border_aabb availability/provenance; available border AABBs; corresponding-edge and center deltas (second - first); signed separations (positive gap, zero touch, negative overlap); minimum distance as the Euclidean norm of nonnegative gaps (zero for touching/intersecting boxes); exact intersection relation/AABB/area: positive-area, edge-touching, or disjoint with null intersection_aabb and zero area; source coverage; exactly one immutable snapshot root, fixed meta.json locator, bounded manifest keys; caveats. It makes no paint, clipping, or pixel-coverage claim; content_quads_union_aabb is separately named provenance and never satisfies a border field.',
    'Artifact ownership: Reads immutable snapshot artifacts only and creates no artifact, derived read, crop, browser mutation, or session mutation.',
    'Recovery: If the explicit snapshot or either ordered subject reference is unavailable, inspect its exact resolver reason and source availability, then retry with one available css:, backend:, axid:, ax:, or text: reference from that immutable snapshot. If either border_aabb is unavailable, pair scalars remain unavailable; reacquire a snapshot only when the required source evidence was not captured.',
  ]) assert.ok(geometry.includes(section), section);
  assert.doesNotMatch(geometry, /Identity and attestation; fixed summary and scope; source coverage; leaf-owned evidence access; omission metadata; bounded records; static follow-up\./);
  assert.doesNotMatch(geometry, /Reads declared evidence only and creates no projection-owned artifact\./);
  assert.doesNotMatch(geometry, /Correct the reported input and run capture measure geometry -h\./);
  for (const section of [
    'capture measure explain\n\nread one subject’s structural provenance.',
    'Constraints: One explicit snapshot and required singleton --subject element reference; optional bounded --size, --text, and --form sections.',
    'Output: Explicit snapshot and --subject; attestation/identity; cascade winners; containing block; stacking context; scroll/overflow chain; independently named normalized border_aabb, content_quads_union_aabb, and requested box/source bounds with availability; requested sections; source coverage; one immutable snapshot root, fixed meta.json locator, bounded manifest keys covering consulted and omitted retained arrays; omission metadata.',
    'Artifact ownership: Reads immutable snapshot artifacts only and creates no artifact, derived read, crop, browser mutation, or session mutation.',
    'Recovery: If the explicit snapshot or --subject is unavailable, inspect its exact resolver reason and source availability, then retry with one available css:, backend:, axid:, ax:, or text: reference from that immutable snapshot. Requested size, text, or form evidence remains unavailable when its captured source was omitted; reacquire only when that source evidence is required.',
  ]) assert.ok(explain.includes(section), section);
  assert.doesNotMatch(explain, /Identity and attestation; fixed summary and scope; source coverage; leaf-owned evidence access; omission metadata; bounded records; static follow-up\./);
  assert.doesNotMatch(explain, /Reads declared evidence only and creates no projection-owned artifact\./);
  assert.doesNotMatch(explain, /Correct the reported input and run capture measure explain -h\./);
  for (const section of [
    'capture browser cdp\n\nsend one raw CDP request.',
    'When to use: Choose this when you need send one raw cdp request.',
    'Model: Exact raw raw protocol response bytes; size unbounded. --json rejects before effects with code=output_mode_unsupported, field=--json, expected=omit --json for exact raw output, and next_action=run browser cdp -h.',
    'Parameters:\n  <method>  ^[A-Za-z][A-Za-z0-9]*\\.[A-Za-z][A-Za-z0-9]*$\n  [params-json-object]  JSON-object\n  --port <1..65535> required units=tcp-port',
    'Constraints: Required singleton --port <1..65535>, one required method, and at most one JSON-object params positional (omitted means {}). No ambient endpoint, session, target, URL, stdin, or duplicate options.',
    'Output: Exactly the matching CDP response text-frame bytes, including byte order and final-newline absence; unrelated events are omitted.',
    'Artifact ownership: Creates no artifact. Exactly one CDP request is sent only after all validation and endpoint connection succeed.',
    'Effects: browser=true, session=false, artifact=false, environment=false',
    'Recovery: browser_endpoint_unavailable and cdp_transport_failed: check the exact port with capture browser list --port <port> before retry. cdp_command_failed: use the exact stdout error response to correct the method or params before retry. Stable input failures (browser_cdp_port_required, invalid_port, browser_cdp_method_required, browser_cdp_method_invalid, browser_cdp_params_invalid, duplicate_option, unknown_option, unexpected_positional) recover through capture browser cdp -h.',
    'Next action: run capture browser cdp -h',
  ]) assert.ok(cdp.includes(section), section);
  for (const section of [
    'capture measure map scroll\n\nmap scroll topology and container extents.',
    'When to use: Choose this for page-wide bounds, scroll containers, current/maximum offsets, client-versus-content size, overflow behavior on both axes, recorded ancestor overflow boundaries, sticky/fixed occupancy, snap points, and reachable content; use layers for stacking or paint order.',
    'Parameters:\n  <snapshot>  snapshot-id-or-absolute-directory\n  --detail <container-id>\n  --limit <1..20> default=20 units=records',
    'Constraints: One snapshot; --detail or summary --limit <1..20>, never both.',
    'Output: Attestation; authoritative viewport and separate content extent; source coverage; exact complete relation counts/reasons and relation object key; derived manifest/scroll artifact; root then source-ordered container rows with both-axis client/content/excess/overflow; detail ancestry, boundaries, reachability, relations, provenance, and omissions.',
    'Artifact ownership: Always creates or reuses one deterministic scroll-topology derived read.',
    'Effects: browser=false, session=false, artifact=true, environment=false',
    'Recovery: Correct the snapshot, --detail container id, or summary --limit (mutually exclusive) and rerun capture measure map scroll -h; scroll owns viewport, containers, client/content extent, both-axis overflow, recorded overflow boundaries, and reachability from one deterministic scroll-topology derived read.',
    'Next action: run capture measure map scroll -h',
  ]) assert.ok(scroll.includes(section), section);
});

test('real grammar declarations include value flags, CDP method plus optional params, and exact pagination census', () => {
  const start = leaf('session start');
  assert.deepEqual(start.flags.map((flag) => [flag.name, flag.grammar, flag.required, flag.repeatable]), [['--url', 'absolute-http(s)-url', true, undefined], ['--port', '1..65535', undefined, undefined]]);
  const cdp = leaf('browser cdp');
  assert.deepEqual(cdp.positionals.map((arg) => [arg.name, arg.required]), [['method', true], ['params-json-object', false]]);
  assert.deepEqual(cdp.flags.map((flag) => [flag.name, flag.grammar, flag.required]), [['--port', '1..65535', true]]);
  const snap = leaf('measure snap');
  assert.equal(snap.flags.find((flag) => flag.name === '--state')?.repeatable, true);
  assert.equal(snap.flags.find((flag) => flag.name === '--state')?.values, undefined);
  const snapHelp = assembleHelp(snap);
  const snapConstraints = 'Constraints: Exactly one target mode from the four-row matrix: fresh-url = one absolute http(s) URL with optional --port; named-session = --session <exact-id> with no --port; explicit-target = --target <token> with optional --port; active-session = none of url/--session/--target. --port alone fails port_requires_url_or_target; --port with either session route fails port_conflicts_with_session; conflicting modes fail snapshot_target_conflict; more than one positional fails unexpected_positional. --navigation-timeout <1..60000> integer ms default 10000 is valid only in fresh-url mode (else navigation_timeout_requires_fresh_url). --settle-timeout <1..60000> integer ms default 5000. State and target tokens are case-sensitive. --state <name[:css-selector]> repeats; the nine names are normal, hover, focus, active, checked, open, disabled, invalid, all; all expands in that fixed order excluding normal and conflicts with every other state; the first colon splits name from a nonempty selector and later colons belong to the selector; duplicate normalized (state,selector) requests are rejected while distinct selectors for one state stay distinct. --viewport <width>x<height> with each dimension a base-10 safe integer 1..16384. CDP_PORT, CDP_TARGET, CDP_HAR_ID are ignored. Every syntax/mode error fails before endpoint probes, navigation, mutation, lock acquisition, or durable allocation.';
  const snapRecovery = `Recovery: snapshot_target_required: run capture measure snap <url> [--port <port>]; intentionally persistent work may instead run capture session start --url <url> [--port <port>] and retry without target arguments, or run capture browser list and use the exact target retry below. snapshot_target_conflict: keep exactly one row from the snap mode matrix; port may qualify only fresh URL or explicit target. duplicate_option: remove the repeated occurrence and rerun the same invocation. unexpected_positional: keep exactly one absolute HTTP(S) URL or no positional. port_requires_url_or_target: add one URL or --target <token>, or remove port to use the scoped active session. port_conflicts_with_session: remove port; session routes always use their recorded endpoint. navigation_timeout_requires_fresh_url: remove the option and reacquire the existing page state, or select fresh-url mode with one absolute HTTP(S) URL when navigation timing is required. session_unavailable: run capture session list; retry only with an exact row whose lifecycle is open and target_live=true, or run capture session start --url <url> [--port <port>]. target_unavailable: run capture browser list; retry exactly capture measure snap --port <displayed-port> --target <full-displayed-id>. browser_endpoint_unavailable: run capture browser detect or capture browser list, then rerun the URL with an available displayed port. navigation_failed: correct the URL/connectivity or raise the bounded navigation timeout and rerun the same URL invocation; no snapshot was retained. temporary_target_cleanup_unconfirmed: run capture browser list --port <reported-port>; if the full reported target remains, run capture browser cdp --port <reported-port> Target.closeTarget '{"targetId":"<full-reported-id>"}', then reacquire. No snapshot or ID index entry was published. capture_restoration_unconfirmed: re-establish the intended page state and reacquire explicitly; the failed snapshot is unavailable, incomplete artifacts were removed, and no ID index entry was published. artifact_path_too_long: use a shorter Capture root or snapshot path and rerun; no durable artifact was created for the failed invocation. snapshot_publication_owner_live: let the reported live publication finish or terminate that exact owner before retrying; no index entry was published. snapshot_index_recovery_failed: restore filesystem access for the reported final/quarantine paths and retry; no index entry was published.`;
  assert.ok(snapHelp.includes(snapConstraints), snapConstraints);
  assert.ok(snapHelp.includes('capture measure snap\n\nacquire one immutable structural snapshot.'), 'snap title and description');
  assert.ok(snapHelp.includes('Output: Snapshot ID and complete absolute directory; fixed target attestation {mode,session_id,session_source,target_id,endpoint,observed_url}; request metadata; settledness/timing; viewport provenance; content extent; source coverage; fixed facets; aggregate pixels/crops; immutable source-manifest access.'), 'snap output');
  assert.ok(snapHelp.includes('Artifact ownership: Creates one immutable snapshot source tree and atomically publishes its global ID only after restoration and closure gates.'), 'snap artifact ownership');
  assert.ok(snapHelp.includes('Effects: browser=true, session=true, artifact=true, environment=false'), 'snap effects');
  assert.ok(snapHelp.includes(snapRecovery), snapRecovery);
  const sweep = leaf('measure variation sweep');
  const navigationTimeout = sweep.flags.find((flag) => flag.name === '--navigation-timeout');
  assert.ok(navigationTimeout, 'navigation timeout is recognized before its mode error');
  assert.equal(navigationTimeout.default, undefined, 'recognized-but-invalid sweep navigation timeout has no default');
  const sweepHelp = assembleHelp(sweep);
  assert.ok(sweepHelp.includes('  --navigation-timeout <1..60000> units=ms'), 'rendered sweep navigation timeout is recognized without a default');
  assert.doesNotMatch(sweepHelp, /--navigation-timeout <1\.\.60000>[^\n]*default=/);
  const sweepConstraints = 'Constraints: Selects one existing target: --session <exact-id>, or --target <token> with optional --port, or scoped active-session omission. --port is accepted only with --target (with --session it fails port_conflicts_with_session; alone it fails sweep_port_requires_target). A positional URL is forbidden. --navigation-timeout is recognized but always fails sweep_navigation_timeout_forbidden (no fresh-url mode here). Raw selection ignores ambient CDP_PORT, CDP_TARGET, and CDP_HAR_ID; all selection failures precede probes, locks, mutation, and allocation; resolution/locking matches snap. Axis is exactly viewport-width or viewport-height. --from and --to are safe integers 1..16384 with from < to. --samples <2..64> default 5, and samples must be <= to-from+1. A width sweep requires singleton --viewport-height <1..16384>; a height sweep requires singleton --viewport-width <1..16384>. Snap acquisition flags allowed are --freeze-animations, --settle-timeout <1..60000> default 5000, --capture-unsettled, --pixels; state-mutation flags, legacy ranges/set-files/gates are rejected before probes, locks, mutation, allocation.';
  assert.ok(sweepHelp.includes(sweepConstraints), sweepConstraints);
  for (const recovery of ['sweep_port_requires_target: add --target <token>, or remove --port to use the scoped active session.', 'sweep_navigation_timeout_forbidden: remove --navigation-timeout and retry the same existing-target sweep.', 'snapshot_publication_owner_live: let the reported live publication finish or terminate that exact owner before retrying; no index entry was published.', 'snapshot_index_recovery_failed: restore filesystem access for the reported final/quarantine paths and retry; no index entry was published.']) assert.ok(sweepHelp.includes(recovery), recovery);
  assert.equal(leaf('measure variation census').flags.find((flag) => flag.name === '--snapshot')?.repeatable, true);
  for (const path of ['browser detect', 'browser list', 'library list', 'library search', 'library show']) assert.equal((leaf(path).bounds?.paginated), true, path);
  for (const path of ['session list', 'session view']) assert.equal((leaf(path).bounds?.paginated), false, path);
});

test('registry validation rejects aliases, child overflow, incomplete help, invalid bounds, unbounded lists, and output-mode drift', () => {
  const clone = structuredClone(CAPTURE_REGISTRY) as RegistryBranch;
  const page = branch('page', clone);
  (page as { aliases?: readonly string[] }).aliases = ['p'];
  (page.children[0] as { help: { followUp: string } }).help.followUp = 'run capture does-not-exist -h';
  (page as unknown as { children: unknown[] }).children = [...page.children, structuredClone(page.children[0]), structuredClone(page.children[0])];
  const screenshot = page.children.find((child): child is RegistryLeaf => child.kind === 'leaf' && child.path === 'page screenshot')!;
  (screenshot as unknown as { outputMode: string; result: unknown; bounds?: unknown }).outputMode = 'exact-raw-json-rejected';
  (screenshot as unknown as { result: unknown; bounds?: unknown }).result = { kind: 'exact-raw', payload: 'wrong payload' };
  delete (screenshot as unknown as { bounds?: unknown }).bounds;
  const sessions = branch('session', clone);
  const sessionList = sessions.children.find((child): child is RegistryLeaf => child.kind === 'leaf' && child.path === 'session list')!;
  (sessionList as unknown as { bounds: { growing: boolean; paginated: boolean; maxBytes: number } }).bounds = { ...sessionList.bounds!, growing: true, paginated: false, maxBytes: 1 };
  const result = validateCaptureRegistry(clone);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /aliases/);
  assert.match(result.errors.join('\n'), /maximum is 7/);
  assert.match(result.errors.join('\n'), /follow-up does not resolve/);
  assert.match(result.errors.join('\n'), /wrong output mode|not declared exact-raw|exact-raw output mode/);
  assert.match(result.errors.join('\n'), /maxBytes|growing bounded collection/);
  const raw = sessions.children.find((child): child is RegistryLeaf => child.kind === 'leaf' && child.path === 'session log')!;
  (raw as unknown as { help: { rubric: string } }).help.rubric = 'output_mode_unsupported';
  const rawResult = validateCaptureRegistry(clone);
  assert.equal(rawResult.valid, false);
  assert.match(rawResult.errors.join('\n'), /full output_mode_unsupported diagnostic/);
});

test('output ownership is total and inverse-classified: structured accepts JSON while raw rejects it before effects', () => {
  assert.equal(leaf('page screenshot').outputMode, 'structured-json-capable');
  assert.equal(leaf('browser cdp').outputMode, 'exact-raw-json-rejected');
  const rawHelp = assembleHelp(leaf('browser cdp'));
  assert.match(rawHelp, /output_mode_unsupported/);
  assert.match(rawHelp, /final-newline absence/);
});
