import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate } from '../src/session/artifacts.js';

test('successful accessibility reads on the active session target are retained verbatim in its bundle directory', async () => {
  const { clearActiveSession, setActiveSession } = await import('../src/session-context.js');
  const { persistActiveSessionA11y } = await import('../src/cdp/commands/ui.js');
  const previousNodeId = process.env.CRTR_NODE_ID;
  const id = `a11y-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(CAPTURE_ROOT, id);
  const tree = [{ role: 'button', name: 'Open raw-token-123' }];

  try {
    process.env.CRTR_NODE_ID = 'test-node-a11y-artifact';
    clearActiveSession();
    ensurePrivateDir(path.join(dir, 'a11y'));
    writeJsonPrivate(path.join(dir, '.session.json'), {
      id, dir, harId: null, startedAt: new Date().toISOString(), url: null,
      targetId: 'target-a11y', cdpPort: null, stepCount: 0, logPids: [], bridgeSocket: null, bridgePid: null,
    });
    setActiveSession({ sessionId: id, dir, harId: null, targetId: 'target-a11y', stepCount: 0 });

    const artifactPath = persistActiveSessionA11y(tree, 'target-a11y');
    assert.ok(artifactPath);
    const artifact = JSON.parse(fs.readFileSync(artifactPath!, 'utf8'));
    assert.equal(artifact.targetId, 'target-a11y');
    assert.deepEqual(artifact.tree, tree);
    assert.equal(persistActiveSessionA11y(tree, 'other-target'), null);

    const { sessionMain } = await import('../src/session/commands.js');
    await sessionMain(['stop', id]);
    const bundle = JSON.parse(fs.readFileSync(path.join(dir, 'bundle.json'), 'utf8'));
    assert.deepEqual(bundle.a11y, [{ name: path.basename(artifactPath!), path: artifactPath }]);
  } finally {
    clearActiveSession();
    if (previousNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = previousNodeId;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
