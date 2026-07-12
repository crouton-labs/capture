---
kind: knowledge
when-and-why-to-read: When working in capture, this knowledge should be read because its esbuild single-bundle build and publish-on-main rules keep changes buildable and stop a hand-bumped version from colliding with CI.
short-form: capture
system-prompt-visibility: content
file-read-visibility: content
origin:
  created: 2026-07-10T17:23:49.216Z
  cwd: /Users/silasrhyneer/Code/cli/personal-apps
  node: mrf6atx6-61642ac6
---

# capture

`@crouton-kit/capture` is a CDP browser automation and UI measurement CLI with exactly seven root nouns: `session`, `page`, `tab`, `measure`, `motion`, `cdp`, and `lib`. `page` contains `elements`, `click`, `type`, `shot`, `navigate`, `exec`, and `scroll`; `tab` contains `list`, `open`, `reset`, and `network`; traffic and external logs are read through `session har` and `session log`. Agents usually reach it as `crtr capture <args>` (verbatim forwarding).

When operating the CLI, run `capture -h`, then the selected branch and leaf `-h`, because built help is the executable source of truth for each noun's model and each leaf's inputs, outputs, effects, and targeting.

## Dev loop

- pnpm project (`pnpm-lock.yaml`) — install with `pnpm install`.
- `npm run build` — esbuild bundles `src/capture.ts` into one self-contained CJS executable at `bin/capture`.
- `npm test` — `node --import tsx --test test/*.test.ts`.
- Publish on push to `main` (`.github/workflows/publish.yml`), conventional commits — versioning is workflow-owned.

## Constraints

- `bin/capture` stays a single self-contained bundle; bundle runtime dependencies so consumers need no companion install.
- When changing `vault/libs/`, fix the source in northlight-vault and run `vault/sync.sh`, because this directory is a synchronized source fork.
- Before changing an output schema or measurement command, read `taste/measuring-stick-not-coach`, because capture reports measurements plus factual provenance and leaves interpretation to its caller.
