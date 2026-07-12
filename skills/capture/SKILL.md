---
# Gap: agents need a stable entry into capture without carrying a leaf-by-leaf manual that can drift from the binary.
name: capture
description: Browser automation and UI measurement through capture's session, page, tab, measure, motion, cdp, and lib branches. Use when observing a web app, driving its UI, collecting network evidence, or measuring rendered state over CDP.
allowed-tools: Bash(capture:*), Read, Glob, Grep
---

# Capture

When browser evidence is needed, run `capture -h`, then the relevant branch and leaf `-h`, because built help is canonical for current inputs, outputs, effects, and targeting.

Capture has exactly seven root nouns: `session`, `page`, `tab`, `measure`, `motion`, `cdp`, and `lib`. `page` contains `elements`, `click`, `type`, `shot`, `navigate`, `exec`, and `scroll`; `tab` contains `list`, `open`, `reset`, and `network`; traffic and external logs are read through `session har` and `session log`. For the compact tree, shared contracts, and a representative flow, read [cli-reference.md](cli-reference.md).

## Choose the evidence grain

- Use `session` for scoped browser work so one tab, its traffic, and its artifacts stay together.
- Use `page elements` to discover live target identities, the other `page` leaves to drive or look at the current tab, and `page shot` only for visual orientation.
- Use `measure` when the criterion depends on settled static facts; its query leaves read a snapshot artifact rather than re-driving the browser.
- Use `motion` when the criterion depends on change over time; its query leaves read a finalized recording.
- Use `tab` for endpoint discovery, tab lifecycle, and connection-level network emulation.
- Use `cdp` only when the wrapped branches do not expose the protocol fact you need. Use `lib` only to inspect development-checkout service-library schemas.

Capture reports measurements and factual provenance. Preserve result blocks and artifact paths as evidence, state collection limitations, and make any comparison with the user's criterion explicitly your own.
