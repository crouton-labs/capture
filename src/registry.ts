/**
 * Capture's static command descriptor tree. This module is pure and deliberately
 * unreachable from the legacy launcher until U15 wires it in.
 */
import {
  EXACT_RAW_LEAF_PAYLOADS,
  EXPECTED_LEAF_PATHS,
  MAX_BOUNDED_BYTES,
  NO_EFFECTS,
  PAGINATED_LEAF_PATHS,
  type BranchDescriptor,
  type FlagSpec,
  type LeafDescriptor,
  type PositionalSpec,
  type RouteDescriptor,
  type RouteEffects,
  combine,
  fail,
  validateRegistry,
  type ValidationResult,
} from './contracts/index.js';

export interface HelpContent {
  /** The child-owned row shown in the parent help. */
  readonly description: string;
  /** The child-owned reason for choosing this command. */
  readonly whenToUse: string;
  /** Branch model or leaf input/output rubric. */
  readonly rubric: string;
  /** Literal static next step for an unsuccessful invocation. */
  readonly followUp: string;
}

export interface RegistryBranch extends BranchDescriptor {
  readonly visibility: 'public' | 'internal';
  readonly help: HelpContent;
  readonly children: readonly RegistryNode[];
  /** Aliases are prohibited, rather than silently ignored. */
  readonly aliases?: readonly string[];
}

export interface RegistryLeaf extends LeafDescriptor {
  readonly visibility: 'public' | 'internal';
  readonly help: HelpContent;
  readonly recovery: string;
  readonly aliases?: readonly string[];
}

export type RegistryNode = RegistryBranch | RegistryLeaf;

const bounded = (path: string) => ({ kind: 'bounded' as const, domain: path.replaceAll(' ', '-'), schema: `${path.replaceAll(' ', '-')}-v1` });
const flags = (...names: readonly string[]): readonly FlagSpec[] => names.map((name) => ({ name, grammar: 'boolean' }));
const effects = (browser = false, session = false, artifact = false, environment = false): RouteEffects => ({ browser, session, artifact, environment });
const words = (path: string) => path ? path.split(' ').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ') : 'Capture';

function leaf(path: string, description: string, options: { readonly positionals?: readonly PositionalSpec[]; readonly flags?: readonly FlagSpec[]; readonly effects?: RouteEffects; readonly growing?: boolean; readonly stderr?: 'empty-on-success' | 'declared-progress'; } = {}): RegistryLeaf {
  const rawPayload = EXACT_RAW_LEAF_PAYLOADS[path];
  const paginated = PAGINATED_LEAF_PATHS.includes(path);
  return {
    kind: 'leaf', path, summary: description, visibility: 'public',
    positionals: options.positionals ?? [], flags: options.flags ?? [], mutualExclusions: [],
    effects: options.effects ?? NO_EFFECTS,
    result: rawPayload ? { kind: 'exact-raw', payload: rawPayload } : bounded(path),
    ...(rawPayload ? {} : { bounds: { maxBytes: MAX_BOUNDED_BYTES, maxRecords: 20, growing: options.growing ?? paginated, paginated } }),
    stderr: options.stderr ?? 'empty-on-success', exits: [0, 2, 3], handler: path.replaceAll(' ', '.'),
    help: {
      description, whenToUse: `Use when you need ${description.toLowerCase()}.`,
      rubric: rawPayload ? `Exact raw payload: ${rawPayload}; size unbounded; --json is not accepted.` : `Structured output: ${path.replaceAll(' ', '-')}-v1, bounded to ${MAX_BOUNDED_BYTES} bytes.`,
      followUp: `run capture ${path} -h`,
    },
    recovery: `Run capture ${path} -h for the canonical input grammar.`,
  };
}

function branch(path: string, description: string, children: readonly RegistryNode[]): RegistryBranch {
  return {
    kind: 'branch', path, summary: description, visibility: 'public', children,
    help: { description, whenToUse: `Use when working with ${description.toLowerCase()}.`, rubric: `${words(path)} command family.`, followUp: `run capture ${path} -h` },
  };
}

const id = (name: string, required = true): readonly PositionalSpec[] => [{ name, grammar: 'container-id', required }];
const text = (name: string, required = true): readonly PositionalSpec[] => [{ name, grammar: 'text', required }];
const url = (): readonly PositionalSpec[] => [{ name: 'url', grammar: 'absolute-http-url', required: true }];

export const CAPTURE_REGISTRY: RegistryBranch = branch('', 'Browser evidence capture and neutral measurement.', [
  branch('session', 'session lifecycle and recorded logs.', [
    leaf('session start', 'start a browser capture session.', { flags: flags('--url', '--hold'), effects: effects(true, true, true) }),
    leaf('session stop', 'stop and bundle a capture session.', { positionals: id('session-id'), effects: effects(true, true, true) }),
    leaf('session list', 'list capture sessions.', { growing: true, effects: effects(false, true, true) }),
    leaf('session view', 'view one capture session.', { positionals: id('session-id'), growing: true, effects: effects(false, true, true) }),
    leaf('session log', 'read recorded session log bytes.', { positionals: text('path'), effects: effects(false, true, true) }),
  ]),
  branch('page', 'page inspection and interaction.', [
    leaf('page a11y', 'read the full accessibility tree.', { effects: effects(true) }),
    leaf('page screenshot', 'capture a screenshot.', { flags: flags('--out', '--full-page'), effects: effects(true, false, true) }),
    leaf('page click', 'click an accessible page element.', { positionals: text('name'), flags: flags('--role'), effects: effects(true, false, true) }),
    leaf('page type', 'type text into a page control.', { positionals: text('text'), flags: flags('--into'), effects: effects(true, false, true) }),
    leaf('page navigate', 'navigate the selected page.', { positionals: url(), flags: flags('--settle'), effects: effects(true, false, true) }),
    leaf('page exec', 'evaluate handler-owned page code.', { positionals: text('code'), flags: flags('--file'), effects: effects(true) }),
  ]),
  branch('measure', 'immutable structural and pixel measurement.', [
    leaf('measure snap', 'acquire an immutable snapshot.', { positionals: [{ name: 'url', grammar: 'absolute-http-url', required: false }], flags: flags('--session', '--target', '--port'), effects: effects(true, true, true) }),
    leaf('measure check', 'read neutral measurement families.', { positionals: id('snapshot-id'), effects: effects(false, false, true) }),
    leaf('measure geometry', 'read selected snapshot geometry.', { positionals: id('snapshot-id'), effects: effects(false, false, true) }),
    branch('measure map', 'snapshot topology maps.', [
      leaf('measure map focus', 'map captured focus traversal.', { positionals: id('snapshot-id'), effects: effects(false, false, true) }),
      leaf('measure map scroll', 'map captured scroll topology.', { positionals: id('snapshot-id'), effects: effects(false, false, true) }),
      leaf('measure map layers', 'map captured compositing layers.', { positionals: id('snapshot-id'), effects: effects(false, false, true) }),
    ]),
    leaf('measure explain', 'explain selected snapshot evidence.', { positionals: id('snapshot-id'), effects: effects(false, false, true) }),
    branch('measure variation', 'cross-snapshot variation reads.', [
      leaf('measure variation diff', 'compare immutable snapshots.', { positionals: id('snapshot-id'), effects: effects(false, false, true) }),
      leaf('measure variation census', 'summarize immutable snapshot variation.', { positionals: id('snapshot-id'), effects: effects(false, false, true) }),
      leaf('measure variation sweep', 'acquire a declared variation sweep.', { positionals: id('snapshot-id'), effects: effects(true, false, true) }),
    ]),
  ]),
  branch('motion', 'recorded motion evidence.', [
    leaf('motion rec', 'record page motion.', { effects: effects(true, false, true) }),
    leaf('motion mask', 'record motion masking evidence.', { positionals: id('recording-id'), effects: effects(false, false, true) }),
    leaf('motion timeline', 'read a motion timeline.', { positionals: id('recording-id'), effects: effects(false, false, true) }),
    leaf('motion jank', 'read frame timing measurements.', { positionals: id('recording-id'), effects: effects(false, false, true) }),
    leaf('motion response', 'read motion response measurements.', { positionals: id('recording-id'), effects: effects(false, false, true) }),
  ]),
  branch('traffic', 'network traffic capture.', [
    leaf('traffic record', 'record network traffic.', { flags: flags('--duration'), effects: effects(true, false, true) }),
    branch('traffic har', 'HAR artifact lifecycle.', [
      leaf('traffic har create', 'create a HAR recording.', { effects: effects(true, false, true) }),
      leaf('traffic har read', 'read stored HAR bytes.', { positionals: id('har-id'), effects: effects(false, false, true) }),
      leaf('traffic har delete', 'delete a HAR recording.', { positionals: id('har-id'), effects: effects(false, false, true) }),
    ]),
  ]),
  branch('browser', 'browser endpoint and protocol control.', [
    leaf('browser detect', 'detect browser endpoints.', { growing: true, effects: effects(true, false, false, true) }),
    leaf('browser list', 'list browser targets.', { growing: true, effects: effects(true) }),
    leaf('browser open', 'open a fresh browser page.', { positionals: url(), effects: effects(true, false, true) }),
    leaf('browser reset', 'reset a browser page.', { positionals: url(), effects: effects(true, false, true) }),
    leaf('browser network', 'set selected page network state.', { positionals: text('state'), effects: effects(true) }),
    leaf('browser cdp', 'send one raw CDP request.', { positionals: text('method'), flags: flags('--port', '--params'), effects: effects(true) }),
  ]),
  branch('library', 'bundled Capture library discovery.', [
    leaf('library list', 'list bundled libraries.', { growing: true }),
    leaf('library search', 'search bundled library functions.', { positionals: text('query'), growing: true }),
    leaf('library show', 'show a bundled library.', { positionals: text('library'), growing: true }),
    leaf('library read', 'read bundled function source bytes.', { positionals: text('library'), effects: effects(false, false, false, true) }),
  ]),
]);

export function flattenRegistry(node: RegistryNode = CAPTURE_REGISTRY): readonly RouteDescriptor[] {
  if (node.kind === 'leaf') return [node];
  const descendants = node.children.flatMap((child) => flattenRegistry(child));
  return node.path ? [node, ...descendants] : descendants;
}

/** Reject descriptor drift before a caller has any chance to parse argv or perform effects. */
export function validateCaptureRegistry(root: RegistryBranch = CAPTURE_REGISTRY): ValidationResult {
  const errors: ValidationResult[] = [validateRegistry(flattenRegistry(root))];
  const visit = (node: RegistryNode, parent?: RegistryBranch): void => {
    if (!node.help.description || !node.help.whenToUse || !node.help.rubric || !node.help.followUp) errors.push(fail(`route ${node.path || 'root'} missing help description, when-to-use, rubric, or follow-up`));
    if (node.aliases?.length) errors.push(fail(`route ${node.path || 'root'} declares aliases; canonical paths have no aliases`));
    if (node.kind === 'leaf' && !node.recovery) errors.push(fail(`leaf ${node.path} missing recovery`));
    if (node.kind === 'branch') {
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
    if (parent && node.visibility === 'public' && !node.path) errors.push(fail('public child missing canonical path'));
  };
  visit(root);
  const expected = new Set(EXPECTED_LEAF_PATHS);
  if (flattenRegistry(root).filter((descriptor): descriptor is LeafDescriptor => descriptor.kind === 'leaf').some((leaf) => !expected.has(leaf.path))) errors.push(fail('registry contains a public leaf outside the canonical census'));
  return combine(...errors);
}
