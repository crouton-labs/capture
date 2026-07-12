import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clickByName } from '../src/interact.js';
import type { CDPClient } from '../src/cdp/client.js';

class InteractionClient {
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
    if (method === 'DOM.getBoxModel') {
      return { model: { content: [0, 0, 100, 0, 100, 20, 0, 20] } };
    }
    return {};
  }
}

test('accessible-name targeting ignores leading, trailing, and repeated whitespace', async () => {
  const client = new InteractionClient();
  const result = await clickByName(client as unknown as CDPClient, 'Token name', 'textbox');

  assert.deepEqual(result, { x: 50, y: 10, role: 'textbox', name: '  Token   name \n' });
  assert.equal(
    client.calls.filter((call) => call.method === 'Input.dispatchMouseEvent').length,
    2,
  );
});
