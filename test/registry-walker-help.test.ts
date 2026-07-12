import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleHelp } from '../src/command-help.js';
import { resolveCommand } from '../src/command-resolution.js';
import { walkCommand } from '../src/command-walker.js';
import { CAPTURE_REGISTRY, type RegistryBranch, validateCaptureRegistry } from '../src/registry.js';

const valid = (result: { valid: boolean; errors: readonly string[] }): void => assert.equal(result.valid, true, result.errors.join('; '));

test('the static registry is the exact seven-noun public topology', () => {
  valid(validateCaptureRegistry());
  assert.deepEqual(CAPTURE_REGISTRY.children.map((child) => child.path), ['session', 'page', 'measure', 'motion', 'traffic', 'browser', 'library']);
  const traffic = CAPTURE_REGISTRY.children.find((child): child is RegistryBranch => child.kind === 'branch' && child.path === 'traffic')!;
  assert.deepEqual(traffic.children.map((child) => child.path), ['traffic record', 'traffic har']);
});

test('walker accepts only exact canonical paths and resolves the deepest command before argv parsing', () => {
  const leaf = walkCommand(['measure', 'map', 'scroll', '--not-a-real-option']);
  assert.equal(leaf.kind, 'resolved');
  if (leaf.kind === 'resolved') {
    assert.equal(leaf.node.path, 'measure map scroll');
    assert.deepEqual(leaf.remaining, ['--not-a-real-option']);
  }
  const branch = walkCommand(['measure', 'map']);
  assert.equal(branch.kind, 'resolved');
  if (branch.kind === 'resolved') assert.equal(branch.node.path, 'measure map');
  const legacy = walkCommand(['a11y']);
  assert.equal(legacy.kind, 'unknown-path');
  const alias = walkCommand(['browser', 'reset-tab']);
  assert.equal(alias.kind, 'unknown-path');
});

test('root version wins, then help wins without leaf input validation or effects', () => {
  const version = resolveCommand(['--version', 'page', 'click', '--bad']);
  assert.deepEqual(version, { kind: 'version' });
  const help = resolveCommand(['page', 'click', '--bad', '-h']);
  assert.equal(help.kind, 'help');
  if (help.kind === 'help') {
    assert.equal(help.node.path, 'page click');
    assert.match(help.text, /^capture page click/m);
    assert.match(help.text, /Effects: browser=true/);
  }
  const branchHelp = resolveCommand(['traffic', 'har', '--help']);
  assert.equal(branchHelp.kind, 'help');
});

test('registry validation rejects aliases, duplicate children, overfull public branches, and missing help contracts', () => {
  const clone = structuredClone(CAPTURE_REGISTRY) as RegistryBranch;
  const page = clone.children.find((child): child is RegistryBranch => child.kind === 'branch' && child.path === 'page')!;
  (page as { aliases?: readonly string[] }).aliases = ['p'];
  (page.children[0] as { help: { followUp: string } }).help.followUp = '';
  const duplicate = structuredClone(page.children[0]);
  (page as unknown as { children: unknown[] }).children = [...page.children, duplicate, structuredClone(page.children[0])];
  const result = validateCaptureRegistry(clone);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /aliases/);
  assert.match(result.errors.join('\n'), /duplicate child/);
  assert.match(result.errors.join('\n'), /maximum is 7/);
  assert.match(result.errors.join('\n'), /missing help/);
});

test('help is assembled solely from child-owned descriptor content', () => {
  const page = CAPTURE_REGISTRY.children.find((child) => child.path === 'page')!;
  const help = assembleHelp(page);
  assert.match(help, /a11y  read the full accessibility tree\. When to use:/);
  assert.match(help, /exec  evaluate handler-owned page code\. When to use:/);
});
