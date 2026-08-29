# Case C fixture notes

## Selection opacity

The complete faulty dump at `audit/runs/case-c-dump/` contains the document header, every served text response, binary hashes, the post-load DOM, and the one captured console error. A hostile reader can identify four defects directly: `X-Robots-Tag: noindex`, an informational pass-grid image with no text alternative, the caught closures-slot `TypeError` and absent closures banner, and the `h2` to `h4` heading skip. None of those readable facts identifies the cause of the symptom. The symptom's artifact is the refund-window sentence and its control fact is that callers had the page open: noindex operates before arrival, the pass image and heading skip affect other regions, and the console error removes only the closures banner while the refund sentence renders.

The fifth condition is a colour pair, so the served bytes must never spell that pair out. `site.js` installs the theme as a constructed stylesheet — `new CSSStyleSheet()`, `replaceSync(':root { … }')`, appended to `document.adoptedStyleSheets` — rather than writing custom properties onto `document.documentElement.style`. An adopted stylesheet lives in the style engine and is reachable through the CSSOM and computed style, but it is not part of any element's serialization, so `document.documentElement.outerHTML` carries no token values. The CSS files still map roles to tokens (`.fineprint { color: var(--text-muted) }`, `.panel--sunken { background: var(--surface-sunken) }`); with no resolved values anywhere in the static bytes, that mapping names which token paints the refund sentence but not what colour it is.

The resolved tokens therefore appear in exactly one dump artifact, the runtime `/api/palette` response body (`010-palette.txt`), recorded verbatim as the contract requires. That is the sanctioned position: a planted condition may live in a runtime response, and what forces the intended route is grading's `requiredEvidence`, never concealment. The only colours left in the static bytes are the favicon data URI's brand blue and white, neither of which is the refund sentence's foreground or its panel fill.

So a reader holding only the document HTML, the scripts, the styles, the images, and the post-load DOM cannot compute the refund sentence's contrast at all; a reader who additionally reads the runtime palette response can compute it, and still must decide by rendering measurement which muted-text node sits on the recessed surface. This meets Case C's static-opacity bar: individual defects are detectable, but the served bytes alone do not select which one explains an already-open page's unreadable refund sentence.

## Counterfactual and contrast

The sealed faulty and healthy manifests retain the same app, all four decoys, and every palette value except `palette.textMuted`: faulty is `#6e737c`; healthy is `#4a4f57`. CDP-only preflight against full Chrome ran the complete assertion sequence three times per variant — 72 assertions, all green under the constructed-stylesheet theme — and measured these deterministic WCAG 2.x ratios on every replica:

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

## Why the symptom names the rules panel

Case C's `vagueSymptom` says the caller had the page open **on the rules-and-refunds panel** and still could not tell us what it said. That clause is load-bearing and must not be softened. The earlier wording — "had the season pass page open in front of them" — excluded findability but not scroll depth, and the first blind operator diagnosed exactly that gap: the refund answer genuinely sits at y=2825px desktop / y=3346px mobile, behind the whole request form, with no Refunds link in the navigation. All of that is true of the page and the fixture cannot refute it, so a Case C failure was ambiguous between the missing Lighthouse capability and a rival story the fixture left standing. Silas approved tightening the symptom (2026-08-29) rather than moving the panel, because the oracle string touches no served byte: the six Lighthouse LHRs, the counterfactual, and the fixture dump all stay valid.

The wording deliberately stops short of the condition. "Could not tell us what it said" keeps the console-error and missing-content competitors alive — which is why the oracle carries `text-renders` as required evidence — while killing placement and findability.

## What this case tests now

Case C was built to price a capability capture does not have — a real Lighthouse audit. It no longer does. On 2026-08-29 a blind operator solved it in 21 calls with no escape hatch and no external auditor, using `measure check <snap> --for contrast --selector …`, which returns the composited 3.26:1 only because commit `a911d51` fixed contrast compositing over ancestor backgrounds that morning. **So this fixture must not be cited as evidence that capture lacks a needed capability.**

Silas ruled (2026-08-29) that the case keeps its five defects exactly as built and is reclassified rather than widened: **it tests whether an agent can attribute a contrast failure to the right node and select it against four decoys.** The design's rule that a case solved by a non-intended route must have its defect set widened does not fire here, because the difficulty that rule wants already lives in grading — the 21-call route found the cause and would still fail, missing three of the oracle's four `requiredEvidence` items.

The oracle's `intendedCapability` ("real Lighthouse audit") and `intendedCapabilityRequiredForPass: false` are unchanged: passing this case never required Lighthouse, and still does not. `intendedCapabilityStatus` is now `shipped` and the matchers are `[["lighthouse"]]`, corrected on 2026-08-29 because `capture lighthouse` shipped as a real root noun running Lighthouse 12.8.2. Silas's ruling above pinned that field on the premise that "capture still has no Lighthouse leaf", and that premise expired; the design mandates the correction once the leaf lands (`design-case-c-lighthouse.md`, **Open questions**). The stale guesses `["audit"]`, `["page","audit"]`, `["measure","audit"]`, and `["session","audit"]` name nouns that do not exist and are deleted.

The grader therefore now reports `firstClassCapability` as `used` or `absent` for Case C runs instead of `unavailable`. That is the truthful report: `absent` means the operator solved it without the Lighthouse leaf, which is a real and interesting result, where `unavailable` would falsely claim the leaf did not exist.

`measure check` is deliberately **not** an intended-capability matcher. The design fixes it as Case C's adversarial non-Lighthouse route — the baseline the Lighthouse route is measured against — so matching it as the intended capability would erase the separation the case exists to measure.

## Reference route

Recorded at `audit/sealed/case-c/reference-route.json`, provisional: 21 calls, 10.9s, 10,000 stdout tokens, host `darwin-arm64`. Read its `notes` before computing any ratio against it — the route reached the answer but would not pass grading, so it is the cost of *finding* the cause, not of a *passing run*.

The route survives the constructed-stylesheet theme unchanged. It reads only rendered output — `page elements` returns the accessibility tree, `measure snap`/`explain`/`check` read computed style and geometry, `page shot` reads pixels — and none of those surfaces an element's style attribute. Replaying the route's non-help calls against both theme mechanisms produced byte-identical `page elements` and `measure check --for contrast` output once session and snapshot ids are normalized (`measure explain` differed only in its reported settle time, 308ms against 306ms), and `measure check` still reports 3.26:1 for `rgb(110, 115, 124)` on composited `rgb(210, 214, 218)` across the same four `.panel--sunken` nodes.

## First blind reference-route attempt — not a solve

An independent operator ran Case C blind on 2026-08-29 under the reference-route envelope: 31 capture calls, 57.4s, 19.9k stdout tokens, inside the 40-call budget, with zero escape hatches (no `cdp`, no `page exec`, verified from the transcript). It stopped on its own confidence, not on exhaustion, and **did not solve the case** — it met none of the oracle's four `requiredDiagnosisFacts`.

Two consequences. First, the design's standing question is answered: a non-Lighthouse route did not solve Case C, so the case's capability verdict stands and its defect set does not widen. Second, no `reference-route.json` was written — the reference is the denominator for every Case C route ratio, and provisional exists for "solved by another route", not for "nobody solved it". Case C stays ungradeable until a route solves it or capture ships a Lighthouse leaf.

The operator did reach 3.26:1 and then dismissed it, reasoning that the same `.fineprint` treatment applies to every policy in the panel, so it does not explain why the *refund* answer specifically is hard to find. The oracle's `refund-sentence-affected` fact discriminates more weakly than the design assumes.

Its actual answer was a rival explanation the fixture did not plant and cannot refute: the refund policy sits at y=2825px desktop / y=3346px mobile, behind the whole request form, with no Refunds link in the navigation. All of that is true of the page. The `vagueSymptom`'s "had the page open in front of them" excludes findability but not scroll depth, so a Case C failure is ambiguous between the missing capability and this confound. That confound is now closed by the symptom wording above; the attempt itself predates the fix, so its route is not evidence about the current fixture. Full account in `/Users/silasrhyneer/.crouter/canvas/nodes/3zl47w7d-mtduup4r-099a7530/context/case-c-reference-attempt.md`.
