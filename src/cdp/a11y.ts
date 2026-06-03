import { type CDPClient } from './client.js';

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

interface AXNode {
  nodeId: string;
  role?: { value: string };
  name?: { value: string };
  childIds?: string[];
  properties?: Array<{ name: string; value: { value: unknown } }>;
}

export interface A11yNode {
  role: string;
  name: string;
  children: A11yNode[];
}

export async function getAccessibilityTree(
  client: CDPClient,
): Promise<A11yNode[]> {
  await client.send('Accessibility.enable');
  const result = (await client.send('Accessibility.getFullAXTree')) as {
    nodes: AXNode[];
  };
  await client.send('Accessibility.disable');

  const nodeMap = new Map<string, AXNode>();
  for (const node of result.nodes) {
    nodeMap.set(node.nodeId, node);
  }

  const SKIP_ROLES = new Set(['none', 'generic', 'InlineTextBox']);

  function buildNode(node: AXNode): A11yNode[] {
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

  const root = result.nodes[0];
  return root ? buildNode(root) : [];
}
