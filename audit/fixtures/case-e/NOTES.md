# Case E fixture notes

## Construction and counterfactual

The product page creates a same-origin review iframe for each Quick View. The partner module obtains a channel with the identical `await readChannel()` expression when it registers and removes its `message` listener. Its closure keeps the iframe document and parsed review payload reachable until that listener is removed. The faulty and healthy manifests differ only in the `channelKeys` sequence: the faulty response sequence supplies a new opaque value on each configuration read, while the healthy sequence repeats one value. Review count and body size are identical in both manifests.

Three fresh-profile, one-page Chrome replicas used forced GC and heap snapshots before and after six open/close cycles. Every faulty replica moved from one baseline detached document to seven after the interactions, for six retained documents; every healthy replica remained at one before and after, for zero retained documents. No Chrome flag was needed.

## Opacity review

The served application and vendor module contain no manifest value or branch for either behavior. Their symmetric lifecycle code is credible under the stable configuration, and a single `/widget-preferences` response contains only one ordinary opaque channel value. A hostile reader holding that one response cannot establish whether later reads repeat it or return another valid per-instance value; the rotation policy exists only in the sealed manifest.

The complete dump also records every response from all six open/close cycles, including twelve configuration bodies, and that response history exposes distinct channel values. Combined with the served map-based registration/removal code, a hostile reader can infer the planted rotation condition from the full dump.

This is accepted, and the dump stays complete. The harness bar is static opacity: the served application and vendor bytes plus the post-interaction DOM must not name the planted condition, and they do not. A runtime response may carry it — cases A and D carry theirs the same way, and Case C's `X-Robots-Tag` is deliberately readable. What forces heap profiling here is grading rather than concealment: this case's `requiredEvidence` demands the before/after retained growth, the detached frame/document population, and the listener-based retaining path, so a reader who merely notices differing configuration values and asserts a leak fails for missing required evidence. See the `## Answer-opacity acceptance test` section of `/Users/silasrhyneer/.crouter/canvas/nodes/3zl47w7d-mtduup4r-099a7530/context/harness-contract.md`.
