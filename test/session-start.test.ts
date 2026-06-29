import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForPageLoad } from '../src/session/commands.js';

class FakeLoadClient extends EventEmitter {
  async waitReady(): Promise<void> {}

  async send(): Promise<unknown> {
    return undefined;
  }

  fireLoad(): void {
    this.emit('Page.loadEventFired', {});
  }
}

test('waitForPageLoad returns false when the page load event fires in time', async () => {
  const client = new FakeLoadClient();
  setTimeout(() => client.fireLoad(), 5);

  const timedOut = await waitForPageLoad(client, 50);
  assert.equal(timedOut, false);
});

test('waitForPageLoad returns true when the page load does not fire before the deadline', async () => {
  const client = new FakeLoadClient();

  const timedOut = await waitForPageLoad(client, 10);
  assert.equal(timedOut, true);
});
