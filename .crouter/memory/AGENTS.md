---
kind: knowledge
when-and-why-to-read: When working in capture, this knowledge should be read
  because it is the project's operating guide.
short-form: capture
system-prompt-visibility: content
file-read-visibility: content
origin:
  created: 2026-07-10T17:23:49.216Z
  cwd: /Users/silasrhyneer/Code/cli/personal-apps
  node: mrf6atx6-61642ac6
---

# capture

`@crouton-kit/capture` — CDP browser automation / UI validation CLI (`capture` bin): session-based screenshots, HAR, a11y, interact, JS exec. Agents usually reach it as `crtr capture <args>` (verbatim forward).

## Dev loop

- pnpm project (`pnpm-lock.yaml`) — install with `pnpm install`.
- `npm run build` — esbuild bundles `src/capture.ts` into ONE self-contained CJS executable at `bin/capture`.
- `npm test` — `node --import tsx --test test/*.test.ts`.
- Publish on push to `main` (`.github/workflows/publish.yml`), conventional commits — never hand-bump the version.

## Constraints

- `bin/capture` must stay a single self-contained bundle — new runtime deps get bundled by esbuild, never left external for the consumer to install.
- `vault/libs/` is forked SOURCE synced from a northlight-vault checkout via `vault/sync.sh` — never hand-edit those files here; fix upstream and re-sync.
- Before changing any output surface (verdicts, checks, diffs, new verification commands), read the `taste/measuring-stick-not-coach` memory — the tool reports measurements, it never coaches.
