import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  identifyBrowserBundleId,
  pickPreferredEndpoint,
  pickPreferredEndpointWithReason,
  type CdpEndpoint,
} from '../src/cdp/detect.js';

function endpoint(overrides: Partial<CdpEndpoint>): CdpEndpoint {
  return {
    port: 1,
    app: 'unknown',
    bundleId: 'unknown',
    isElectron: false,
    hasPageTarget: true,
    ...overrides,
  };
}

test('listening process identity distinguishes Arc from generic Chromium hosts', () => {
  assert.equal(
    identifyBrowserBundleId('Chrome/150.0.0.0', 'Arc'),
    'company.thebrowser.browser',
  );
  assert.equal(identifyBrowserBundleId('Chrome/146.0.0.0', 'Spotify'), 'unknown');
  assert.equal(identifyBrowserBundleId('Chrome/150.0.0.0', 'Google Chrome'), 'com.google.chrome');
});

test('endpoint selection prefers the default recognized browser over Spotify', () => {
  const spotify = endpoint({ port: 51095, app: 'Spotify' });
  const arc = endpoint({
    port: 62535,
    app: 'Arc',
    bundleId: 'company.thebrowser.browser',
  });

  const configuredDefault = pickPreferredEndpointWithReason([spotify, arc], 'company.thebrowser.browser');
  assert.equal(configuredDefault.endpoint.port, 62535);
  assert.equal(configuredDefault.reason, 'matched the configured default browser among endpoints with a live page target');

  const knownBrowser = pickPreferredEndpointWithReason([spotify, arc], null);
  assert.equal(knownBrowser.endpoint.port, 62535);
  assert.equal(knownBrowser.reason, 'is a recognized non-Electron browser among endpoints with a live page target');
  assert.equal(pickPreferredEndpoint([spotify, arc], null).port, 62535);
});
