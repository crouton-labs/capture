---
kind: knowledge
when-and-why-to-read: When you are enabling a CDP domain for a new capture
  capability, or judging whether two capture features can run against one
  browser at the same time, this knowledge should be read because a domain
  Chrome scopes to the whole browser rather than to one tab turns a feature pair
  you planned as parallel into a runtime failure that only reproduces when both
  are live.
surfaces:
  - on: read
    match:
      - "**/recorder-bridge.ts"
      - "**/domains.ts"
      - "**/har-recorder.ts"
      - "**/cdp/connection.ts"
    at: content
rationale: A design assumed CDP domain exclusivity was per-target and planned
  three capabilities as independent parallel lanes; a spike showed Tracing is
  browser-global and that motion rec already holds it, which changed the
  concurrency rule the whole design rested on.
last-updated: 2026-08-29T17:02:17.973Z
origin:
  created: 2026-08-29T17:02:17.973Z
  cwd: /Users/silasrhyneer/Code/cli/capture
  node: 3zl47w7d-mtduhbqk-c0d3b64a
---

# CDP domain exclusivity in capture

Measured against Chrome-for-Testing 143.0.7499.40. These are runtime facts, not documentation claims — verify by spike before assuming a different domain behaves like one of these.

## Tracing is browser-global, and the recorder already holds it

A second `Tracing.start` anywhere in the browser fails with `Tracing has already been started (possibly in another tab).` — including from a connection attached to a **different tab**. It succeeds only after the first holder sends `Tracing.end` and `Tracing.tracingComplete` arrives.

The composed `motion rec` bridge starts tracing for its own event stream. So any second capability that traces cannot run while a recording is live, and filtering by target tab does not make it safe. Anything that runs its own trace over its own CDP connection — a third-party runner such as Lighthouse — collides the same way, and the failure surfaces from inside that runner as an opaque error.

## Fetch and Network coexist

`Fetch.enable` does not blind the Network domain. With both enabled, `Network.requestWillBeSent`, `responseReceived`, and `loadingFinished` all still fire for intercepted requests, and `Network.getResponseBody` returns the body of a request fulfilled synthetically. Capture's HAR collection therefore keeps working while request mocking is active.

## Fetch's last enabler wins, silently

Two connections may both `Fetch.enable` with no error. Only the later one receives `Fetch.requestPaused`; the earlier one receives nothing and its `Fetch.continueRequest` fails with `Invalid InterceptionId.` There is no signal to the loser that it was preempted, so a mock that stopped applying looks identical to a page that made no requests. Detect it by counting pause events against observed network activity rather than trusting that enabling succeeded.

When the connection owning Fetch closes with a request still paused, Chrome resumes that request — the page loads. A crashed interceptor does not stall the browser.

## HeapProfiler composes with Tracing

`HeapProfiler.enable`, `startSampling`, `stopSampling`, and `takeHeapSnapshot` all work with a trace active, and snapshot chunks stream normally. A blank page produced a 10 MB snapshot across 10 chunks, so any snapshot write path must stream to disk rather than buffer the payload.
