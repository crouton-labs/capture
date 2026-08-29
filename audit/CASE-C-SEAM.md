# Case C (campaign page / Lighthouse) — in scope, fixture design in progress

Lighthouse ships: it is a normal npm dependency of capture, and the binary is allowed to stop being standalone. Case C is therefore part of this harness. It is not yet built — `audit/core/registry.mjs` carries it as `status: 'not-built'` and no `audit/fixtures/case-c/` or `audit/sealed/case-c/` exists, so every iteration over cases skips it and nothing pretends it works. The fixture author flips that entry when the fixture lands.

## Why the original Case C could not be built as designed

The parent design planted exactly one condition — `X-Robots-Tag: noindex` on the document response — and then accepted a direct header observation as sufficient causal evidence, because that header is genuinely readable through capture's existing network surface. So the case could not distinguish "solved it with Lighthouse" from "read one response header": its entire Lighthouse signal rested on the relative route budget, and the parent design's own open risk records the consequence — if the audit route and a header-first hand search cost the same on the pinned host, the case measures nothing about Lighthouse.

## The correction being designed

The fixture carries **several independent defects across different Lighthouse categories, only one of which explains the stated symptom.** Breadth across audits, not any single directly-readable measurement, is what solves the case. Opacity becomes a *selection* property rather than a *detection* property: a reader holding every served byte may well spot individual defects, but cannot establish which one explains the symptom without seeing the whole audited surface. The contract's answer-opacity acceptance procedure applies to that selection property.

The corrected case design is being written and will land at `/Users/silasrhyneer/.crouter/canvas/nodes/3zl47w7d-mtel80m6-1e6187c3/context/design-case-c-lighthouse.md`.

## Case-C-only environment constraint

Lighthouse cannot drive `chrome-headless-shell`; Case C needs the full Chrome-for-Testing build. That pin belongs to Case C's environment contract, not to the shared coordinator — the other four cases do not carry it.
