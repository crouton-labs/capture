import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveLiveTarget } from '../src/interact.js';
import type { LiveClient } from '../src/interact.js';

class ResolutionClient {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'Accessibility.getFullAXTree') {
      return {
        nodes: [{
          nodeId: '1',
          backendDOMNodeId: 42,
          role: { value: 'textbox' },
          name: { value: '  Token   name \n' },
        }],
      };
    }
    return {};
  }
}

test('accessible-name targeting ignores leading, trailing, and repeated whitespace', async () => {
  const client = new ResolutionClient();
  const resolved = await resolveLiveTarget(client as unknown as LiveClient, 'ax:Token name');

  assert.deepEqual(resolved, {
    ok: true,
    kind: 'ax',
    backendNodeId: 42,
    role: 'textbox',
    name: '  Token   name \n',
  });
});
