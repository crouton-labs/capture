/**
 * Shared CDP domain enablement and reversible state-forcing helpers for `measure`/`motion`.
 *
 * Every helper here takes an already-connected `CDPClient` (see ./client.ts) and calls
 * `client.send(...)` directly — there is no separate client abstraction. Domain `.enable`
 * calls are idempotent in CDP, so callers may call these more than once per connection
 * (e.g. once per collector) without ill effect.
 */

import type { CDPClient } from './client.js';

/**
 * Enables the CDP domains the `measure snap` substrate collectors need: frame/navigation
 * metadata (Page), element geometry and tree access (DOM), computed style + winning-rule
 * provenance (CSS — requires DOM.enable first), the accessibility tree (Accessibility),
 * compositor layer facts (LayerTree), the animation inventory (Animation), and script
 * execution for hit-test/text/form introspection (Runtime).
 */
export async function enableDomainsForSnap(client: CDPClient): Promise<void> {
  await client.send('Page.enable');
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  await Promise.all([
    client.send('Accessibility.enable'),
    client.send('LayerTree.enable'),
    client.send('Animation.enable'),
    client.send('Runtime.enable'),
  ]);
}

/**
 * Enables the CDP domains the motion recorder bridge needs: frame/navigation metadata and
 * `Page.startScreencast` (Page), element geometry for rect/selector resolution (DOM), script
 * execution for the injected Mutation/Resize/Performance observers (Runtime), request/response
 * timing for `motion response` (Network), and playback-rate control for the animation inventory
 * (Animation). `Tracing.start` is configured with its own category set by the recorder bridge
 * (U13) and is not a plain `.enable` call, so it is not included here.
 */
export async function enableDomainsForMotionRec(client: CDPClient): Promise<void> {
  await client.send('Page.enable');
  await client.send('DOM.enable');
  await Promise.all([
    client.send('Runtime.enable'),
    client.send('Network.enable'),
    client.send('Animation.enable'),
  ]);
}

/**
 * CSS pseudo-classes CDP can force directly via `CSS.forcePseudoState`. Real control states
 * (checked/open/disabled/invalid) are not pseudo-classes in this sense — collectors toggle
 * those with reversible DOM property writes and restore them after capture instead of using
 * this helper.
 */
export type ForcedPseudoClass =
  | 'active'
  | 'focus'
  | 'focus-visible'
  | 'focus-within'
  | 'hover'
  | 'target'
  | 'visited';

/**
 * Forces (or, called with an empty array, clears) a set of CSS pseudo-classes on a node.
 * Requires `CSS.enable` (see `enableDomainsForSnap`). The caller is responsible for restoring
 * state after capture by calling this again with `[]`.
 */
export async function forcePseudoStateForNode(
  client: CDPClient,
  nodeId: number,
  forcedPseudoClasses: ForcedPseudoClass[],
): Promise<void> {
  await client.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses });
}
