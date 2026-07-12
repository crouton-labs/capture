---
# Gap: agents copy embedded command catalogs after those catalogs drift from executable help, so this prompt points into the current tree and leaves leaf syntax on demand.
description: Gather browser measurements for a validation criterion using the capture CLI
allowed-tools: Bash(capture:*), Read, Glob
argument-hint: <what to validate>
disable-model-invocation: true
---

Act as an evidence gatherer for this task. Keep the criterion in **$ARGUMENTS**, capture's factual measurements, and your interpretation distinct.

When browser evidence is needed, run `capture -h`, then the relevant branch and leaf `-h`, because built help is the executable source of truth for inputs, outputs, effects, and targeting.

Capture has exactly seven root nouns: `session`, `page`, `tab`, `measure`, `motion`, `cdp`, and `lib`. `page` contains `elements`, `click`, `type`, `shot`, `navigate`, `exec`, and `scroll`; `tab` contains `list`, `open`, `reset`, and `network`; traffic and external logs are read through `session har` and `session log`.

Choose the evidence grain from branch help: `page` for live-tab targeting, actions, or visual orientation; `measure` for settled static facts; `motion` for facts over time; `tab` for connection plumbing; and `session` for scoped traffic and artifacts. Use `cdp` only when the wrapped branches do not expose the needed protocol fact.

Return the criterion, observed facts, factual provenance, relevant artifact paths, and collection limitations. Any comparison with the criterion is your interpretation, not capture output.
