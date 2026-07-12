# Capture CLI orientation

The built binary owns command syntax. Run `capture -h`, `capture <noun> -h`, and `capture <noun> <leaf> -h` as you descend, because each leaf declares its current inputs, output schema, and page-observable effects.

## Command tree

Capture has exactly seven root nouns:

```text
capture
├─ session  start · stop · list · view · har · log
├─ page     elements · click · type · shot · navigate · exec · scroll
├─ tab      list · open · reset · network
├─ measure  snap · check · diff · census · explain · sweep · map
│  └─ map   focus · scroll · layers · ax
├─ motion   rec · mask · timeline · jank · response
├─ cdp
└─ lib      list · search · show · read
```

- `session` is the artifact container. An active session supplies its tab as the default target, accumulates recorded traffic, and finalizes shots, logs, snapshots, recordings, and HAR into one bundle.
- `page` addresses live tab content. Its driving leaves resolve exactly one current element; `elements` supplies role, accessible name, and `backend:<id>` discriminators; `shot` captures visual orientation.
- `tab` handles browser endpoint discovery, tab lifecycle, and connection-level network emulation. `capture tab list` is the browser probe.
- `measure` writes one settled snapshot substrate with `snap`; its query leaves read static facts from that artifact. A URL target creates a snapshot before the query.
- `motion` writes a recording with `rec`; its query leaves read facts from a finalized recording.
- `cdp` sends raw protocol methods or waits for protocol events.
- `lib` reads service-library summaries and schemas in a development checkout; execution goes through `capture page exec`.

## Shared contracts

- Help is `-h`. Descend from root help rather than relying on an embedded flag catalog.
- Rendered prose on stdout is the contract; `--json` mirrors the same result, while stderr carries in-flight diagnostics.
- Exit 0 means the command completed, including empty lists and reported findings. Exit 1 is a structured invocation, precondition, or world error. Exit 2 is confined to `capture measure check --gate` and `capture measure diff --gate` when measured findings or changes exist.
- Explicit targeting takes precedence over the active session, which takes precedence over `CDP_PORT` and `CDP_TARGET` environment pinning.
- Live `page` target forms are bare CSS, `ax:<name>`, `axid:<id>`, and `backend:<id>` where leaf help declares a target. Driving leaves require exactly one match and return candidates when resolution is ambiguous.
- `page click`, `page type`, and `page scroll` write a session shot after input unless `--no-screenshot` is set. Session traffic is read with `session har`.
- Capture reports measurements and factual provenance. The caller owns interpretation against its criterion.

## Representative flow

```bash
capture tab list
capture session start --url http://localhost:3000
capture page elements
capture page click "ax:Open settings"
capture page type "Ada" --into "ax:Name"
capture page scroll "main" --to bottom
capture page navigate http://localhost:3000/account
capture page shot
capture page exec 'document.title'
capture session har --filter-url /api
capture session stop "$SESSION_ID"
capture session view "$SESSION_ID" --filter shots
```

Set `SESSION_ID` to the id emitted by `session start` before the final two calls. Use `capture session har -h` for traffic filters, `capture measure -h` for static instruments, and `capture motion -h` for recording instruments.
