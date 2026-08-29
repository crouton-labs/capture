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

No real Lighthouse acceptance run was possible in this checkout. `bin/capture -h` exposes only `session`, `page`, `tab`, `measure`, `motion`, `cdp`, and `lib`; it has no Lighthouse surface. `package.json` has no Lighthouse dependency, `node_modules/lighthouse` is absent, and Node module resolution reports `ERR_MODULE_NOT_FOUND` for `lighthouse`. The oracle therefore marks `intendedCapabilityStatus` as `unshipped` and `intendedCapabilityRequiredForPass` as `false`. This is a harness/capability finding, not a fixture-preflight substitute: preflight remains CDP-only and does not invoke Lighthouse.
