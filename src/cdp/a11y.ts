import { captureError } from '../errors.js';
import { withScopeSerialization } from './scope-lock.js';

export const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'menuitem',
  'tab',
  'switch',
  'slider',
  'spinbutton',
  'option',
  'menuitemcheckbox',
  'menuitemradio',
]);

export function flattenA11yTree(
  nodes: A11yNode[],
  opts: { interactive?: boolean } = {},
  depth = 0,
): string[] {
  const lines: string[] = [];

  for (const node of nodes) {
    // Filter to interactive roles if requested
    if (opts.interactive && !INTERACTIVE_ROLES.has(node.role)) {
      lines.push(...flattenA11yTree(node.children, opts, depth));
      continue;
    }

    // Skip nodes without meaningful role or name
    if (!node.role || node.role === 'StaticText') {
      lines.push(...flattenA11yTree(node.children, opts, depth));
      continue;
    }

    const indent = '  '.repeat(depth);
    const nameStr = node.name ? ` "${node.name}"` : '';
    lines.push(`${indent}${node.role}${nameStr}`);

    // Recurse
    lines.push(...flattenA11yTree(node.children, opts, depth + 1));
  }

  return lines;
}

export interface AccessibilityClient {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** The fields consumed from a node returned by `Accessibility.getFullAXTree`. */
export interface FullAXNode {
  nodeId: string;
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: { value: string };
  name?: { value: string };
  childIds?: string[];
}

export interface A11yNode {
  role: string;
  name: string;
  children: A11yNode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAxStringValue(value: unknown): value is { value: string } {
  return isRecord(value) && typeof value.value === 'string';
}

function isFullAXNode(value: unknown): value is FullAXNode {
  if (!isRecord(value) || typeof value.nodeId !== 'string') return false;
  if (
    value.backendDOMNodeId !== undefined &&
    (!Number.isSafeInteger(value.backendDOMNodeId) || (value.backendDOMNodeId as number) < 0)
  ) return false;
  if (value.ignored !== undefined && typeof value.ignored !== 'boolean') return false;
  if (value.role !== undefined && !isAxStringValue(value.role)) return false;
  if (value.name !== undefined && !isAxStringValue(value.name)) return false;
  if (
    value.childIds !== undefined &&
    (!Array.isArray(value.childIds) || !value.childIds.every((id) => typeof id === 'string'))
  ) return false;
  return true;
}

/**
 * Reads one complete AX tree with call-scoped Accessibility ownership.
 *
 * The Accessibility domain's enabled state lives on the connection: a direct
 * connection's state dies with its own websocket session, but the
 * recorder-held connection is shared across commands (its bridge handles
 * each CDP request independently — it serializes nothing), so the entire
 * enable→read→disable scope serializes under the owning session's
 * `.ax-scope.lock` (`withScopeSerialization`) when the client is the
 * recorder-held adapter — otherwise a concurrent routed caller could
 * disable this read's domain mid-flight.
 */
export async function readFullAXTree(client: AccessibilityClient): Promise<FullAXNode[]> {
  return withScopeSerialization(client, 'ax', 'full AX tree read', () => axScopedRead(client));
}

/**
 * The one Accessibility state transaction: enable → read → disable.
 * Claiming ownership before awaiting `Accessibility.enable` matters because a
 * lost response does not prove the browser rejected the enable request. The
 * matching disable therefore always runs, without touching the DOM domain.
 * A disable failure prevents success — alone it throws a typed cleanup
 * failure; paired with a primary failure it throws an `AggregateError`
 * preserving both facts.
 */
async function axScopedRead(client: AccessibilityClient): Promise<FullAXNode[]> {
  let primaryFailed = false;
  let primaryError: unknown;
  let ownsAccessibility = false;

  try {
    ownsAccessibility = true;
    await client.send('Accessibility.enable');
    const response = await client.send('Accessibility.getFullAXTree');
    const nodes = isRecord(response) ? response.nodes : undefined;
    if (!Array.isArray(nodes) || !nodes.every(isFullAXNode)) {
      throw captureError(
        'world',
        'malformed_protocol',
        'Accessibility.getFullAXTree returned a malformed nodes payload.',
        { method: 'Accessibility.getFullAXTree', response },
      );
    }
    return nodes;
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
    throw error;
  } finally {
    if (ownsAccessibility) {
      try {
        await client.send('Accessibility.disable');
      } catch (error) {
        const cleanupError = captureError(
          'cleanup',
          'accessibility_cleanup_failed',
          'Accessibility.disable failed after a full AX tree read.',
          error,
        );
        if (primaryFailed) {
          throw new AggregateError(
            [primaryError, cleanupError],
            'The full AX tree read failed and Accessibility cleanup also failed.',
            { cause: primaryError },
          );
        }
        throw cleanupError;
      }
    }
  }
}

export async function getAccessibilityTree(
  client: AccessibilityClient,
): Promise<A11yNode[]> {
  const nodes = await readFullAXTree(client);

  const nodeMap = new Map<string, FullAXNode>();
  for (const node of nodes) {
    nodeMap.set(node.nodeId, node);
  }

  const SKIP_ROLES = new Set(['none', 'generic', 'InlineTextBox']);

  function buildNode(node: FullAXNode): A11yNode[] {
    const role = node.role?.value ?? '';
    const childNodes = (node.childIds ?? []).flatMap((id) => {
      const child = nodeMap.get(id);
      return child ? buildNode(child) : [];
    });

    if (SKIP_ROLES.has(role)) {
      return childNodes;
    }

    return [
      {
        role,
        name: node.name?.value ?? '',
        children: childNodes,
      },
    ];
  }

  const root = nodes[0];
  return root ? buildNode(root) : [];
}
