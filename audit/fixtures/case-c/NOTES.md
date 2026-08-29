# Case C fixture notes

## Selection opacity

The complete faulty dump at `audit/runs/case-c-dump/` contains the document header, every served text response, binary hashes, the post-load DOM, and the one captured console error. A hostile reader can identify four defects directly: `X-Robots-Tag: noindex`, an informational pass-grid image with no text alternative, the caught closures-slot `TypeError` and absent closures banner, and the `h2` to `h4` heading skip. The same dump also contains the runtime palette tokens. None of those readable facts identifies the cause of the symptom. The symptom's artifact is the refund-window sentence and its control fact is that callers had the page open: noindex operates before arrival, the pass image and heading skip affect other regions, and the console error removes only the closures banner while the refund sentence renders.

The remaining candidate requires a rendering measurement: the reader must resolve which muted-text node sits on the recessed surface and calculate contrast from the computed foreground/background pair. The dump contains the inputs to that calculation but does not label any condition as causal. This meets Case C's static-opacity bar: individual defects are detectable, but the dump alone does not select which one explains an already-open page's unreadable refund sentence.

## Counterfactual and contrast

The sealed faulty and healthy manifests retain the same app, all four decoys, and every palette value except `palette.textMuted`: faulty is `#6e737c`; healthy is `#4a4f57`. CDP-only preflight against full Chrome ran the complete assertion sequence three times per variant and measured these deterministic WCAG 2.x ratios on every replica:

| Pair | Faulty | Healthy |
|---|---:|---:|
| muted text on white | 4.766:1 | 8.244:1 |
| refund sentence on `#d2d6da` recessed panel | 3.262:1 | 5.642:1 |
| refund sentence on mobile emulation | 3.262:1 | 5.642:1 |

The measurements agree with the design's rounded 4.77:1 and 3.26:1 values. Faulty has four sub-4.5:1 text nodes, all in `.panel--sunken`; healthy has none, and both variants have zero failures outside that panel. The refund sentence is present at 13px in both variants. The robots header, absent pass-grid alt, one error-level console entry, absent closures banner, and heading skip all remain present in both variants.

## Lighthouse acceptance

All five planted conditions fire under real Lighthouse, proven out-of-tree: **Lighthouse 12.8.2 with bundled axe-core 4.10**, run via `npx -y lighthouse@12` from a temp directory against the pinned full Chrome for Testing 143.0.7499.40, three runs per variant. Every run of a variant produced identical audit outcomes — no flake, `runtimeError: null` on all six. `color-contrast` fails on faulty (score 0, four nodes) and genuinely passes on healthy (score 1, zero items, rule ran); `is-crawlable`, `image-alt`, `heading-order`, and `errors-in-console` fail identically on both. Across all three audited categories, `color-contrast` is the only audit whose result differs between variants and accessibility the only score that moves (0.90 faulty, 0.93 healthy), so Lighthouse independently reproduces the counterfactual preflight measures with CDP. All four failing contrast nodes are inside `.panel--sunken`, the refund-window sentence among them, and axe's own explanation reports 3.26:1 on `#6e737c` over `#d2d6da` at 13px against a 4.5:1 threshold — the same numbers from a different implementation. Evidence: six LHRs under `/Users/silasrhyneer/.crouter/canvas/nodes/3zl47w7d-mtenh1pg-fd7846f1/context/lhr/` with the full account beside them in `lighthouse-acceptance.md`.

The design reasons from Lighthouse 13.4.1 / axe 4.12.1; this evidence is 12.8.2 / axe 4.10. Every semantic conclusion held across that gap, including the design's specific worry that an `alt=""` formulation might silently pass — the attribute is genuinely absent and axe 4.10 fails it.

One finding the design did not anticipate: **axe minimizes the failing selector to `div.panel`, dropping the `--sunken` modifier.** The recessed panel is identifiable from the DOM path, not from the selector string, so an agent reading only selectors gets a weaker attribution signal than the oracle's `localized-not-global` fact assumes. A Lighthouse surface in capture must expose node paths, not selectors alone.

None of this changes the oracle: `intendedCapabilityStatus` stays `unshipped` and `intendedCapabilityRequiredForPass` stays `false`, because those describe *capture's* Lighthouse leaf, which does not exist. `bin/capture -h` exposes only `session`, `page`, `tab`, `measure`, `motion`, `cdp`, and `lib`, and the repo has no Lighthouse dependency. Preflight remains CDP-only and never invokes Lighthouse.
