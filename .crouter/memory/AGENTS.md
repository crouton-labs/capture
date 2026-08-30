---
kind: knowledge
when-and-why-to-read: When working in capture, this knowledge should be read
  because its esbuild single-bundle build and publish-on-main rules keep changes
  buildable and stop a hand-bumped version from colliding with CI.
short-form: capture
surfaces:
  - on: boot
    at: content
last-updated: 2026-08-30T22:38:36.929Z
origin:
  created: 2026-07-10T17:23:49.216Z
  cwd: /Users/silasrhyneer/Code/cli/personal-apps
  node: mrf6atx6-61642ac6
---

# capture

`@crouton-kit/capture` is a CDP browser automation and UI measurement CLI with exactly ten root nouns: `session`, `page`, `tab`, `measure`, `motion`, `perf`, `heap`, `lighthouse`, `cdp`, and `lib`. `page` holds live-tab verbs (`click`, `type`, `scroll`, `navigate`, `exec`, `repeat`, `shot`, `elements`, `inspect`); `tab` holds browser/tab plumbing plus network conditions and response mocking (`launch`, `quit`, `list`, `open`, `close`, `reset`, `network`, `mock`) — `tab launch` starts a browser capture owns and reaps (never hand-roll a detached browser), and capture signals only browsers it started itself. `measure`, `motion`, `perf` (trace → vitals/insights), and `heap` (snapshot → census/objects/retainers/diff) each own a recorded substrate: one leaf records, the rest are read-only queries over the artifact. `lighthouse` runs Lighthouse destructively against a URL and stores its report unmodified. Traffic and external logs are read through `session har` and `session log`; `session collectors` shows what is live. Agents usually reach it as `crtr capture <args>` (verbatim forwarding).

When operating the CLI, run `capture -h`, then the selected branch and leaf `-h`, because built help is the executable source of truth for each noun's model and each leaf's inputs, outputs, effects, and targeting.

## Dev loop

- pnpm project (`pnpm-lock.yaml`) — install with `pnpm install`.
- `npm run build` — esbuild bundles `src/capture.ts` into one self-contained CJS executable at `bin/capture`.
- `npm test` — `node --import tsx --test test/*.test.ts`.
- Publish on push to `main` (`.github/workflows/publish.yml`), conventional commits — versioning is workflow-owned. The `NPM_TOKEN` repo secret is a 90-day granular token (rotation technique: `personal-operations/npm-2fa-cli`).

## Constraints

- Bundle runtime dependencies into `bin/capture` by default. One decided exception (Silas, 2026-08-29): Lighthouse ships as a normal npm dependency loaded at runtime, because it reads its audits, locales, and report assets package-relative and cannot be bundled — the binary is no longer fully standalone, and that tradeoff is accepted.
- When changing `vault/libs/`, fix the source in northlight-vault and run `vault/sync.sh`, because this directory is a synchronized source fork.
- Before changing an output schema or measurement command, read `taste/measuring-stick-not-coach`, because capture reports measurements plus factual provenance and leaves interpretation to its caller.
