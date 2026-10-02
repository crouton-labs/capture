# Contributing to capture

Issues and pull requests are welcome at [github.com/crouton-labs/capture](https://github.com/crouton-labs/capture).

## Before you start

- **Bugs:** open an issue with the capture version (`capture --version`), your OS, the browser it drove, and the command that failed with its output.
- **Features and larger changes:** open an issue first, so the direction is agreed before you write the code.
- **Questions:** ask in [Discord](https://discord.gg/afwW4saEtr) or open an issue.
- **Security problems:** do not open a public issue. See [SECURITY.md](SECURITY.md).

## Set up

`package.json` declares no Node version; CI runs Node 24, so use that or newer. The package manager is pnpm, which is what the committed `pnpm-lock.yaml` and CI use. To run the commands against a real page you also need a Chrome; see [Quick start](README.md#quick-start) in the README.

```bash
git clone git@github.com:crouton-labs/capture.git
cd capture
pnpm install
pnpm build
```

`pnpm dev <command>` runs the CLI from source with `tsx`, without building.

## Run the tests

```bash
pnpm test              # deterministic suite, no browser needed
pnpm check:bin         # confirms bin/capture matches a fresh build
```

`pnpm test` runs every `test/*.test.ts` file except the two that need a real Chrome, with Node's built-in test runner. Several other files gate their real-Chrome cases behind `CAPTURE_LIVE_CHROME=1`, and `pnpm test` skips those cases. `pnpm test:live` runs them. It needs a local Chrome, found the way the README's Quick start describes.

`bin/capture` is the bundled CLI and is committed. CI fails a pull request whose `bin/capture` differs from a fresh build of its source, so run `pnpm build` and commit the result when you change anything under `src/`. Do not bump `version` in `package.json`: CI does that and commits the release.

## Pull requests

- Branch from the current `main`, and keep one change per pull request.
- Describe what changed and why in the pull request body, and say how you tested it.
- Add or update a test for behavior you change.
- Keep the history linear: rebase onto `main` rather than merging it into your branch.
- Commit messages follow the style of the existing log: a short imperative subject, with a prefix such as `fix(session):` or `docs:` when it helps.

## Repository layout

| Path | Contents |
|---|---|
| [`src/`](src) | The CLI: `capture.ts` is the entry point, with the CDP client, sessions, measurement, and output code beneath it |
| [`bin/`](bin) | `bin/capture`, the committed bundle that npm installs |
| [`test/`](test) | The test suite |
| [`scripts/`](scripts) | The build and test runners |
| [`vault/`](vault) | Source for the site libs that `capture lib` runs inside a tab |
| [`skills/`](skills), [`commands/`](commands) | The agent skill and slash command that ship with capture |
| [`docs/`](docs), [`demo/`](demo) | Reference notes and the README clips |
| [`audit/`](audit) | A harness for grading agent runs against fixture pages |

## License

capture is licensed under MIT. By contributing, you agree that your contribution is licensed under the same terms.
