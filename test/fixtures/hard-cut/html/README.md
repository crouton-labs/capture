# Pinned-Chrome fixture placeholders

These fixtures are intentionally not synthesized by U1. The final conformance owner must capture/validate them with the pinned Chrome version because their meaning depends on real rendered geometry and CDP/AX behavior, not a hand-written DOM approximation.

Required files:

- `email-state.html`: produces visual viewport 1200×953, CSS content height 3515, modal/body two-axis extents, and the single canonical descendant-peer relation.
- `a11y-55-targets.html`: produces 55 retained AX targets for source-order/late-recovery coverage.
- `ancestry-201.html`: has structural parent edges beyond the former 200-hop DOM-path limit, including shadow/iframe edge cases.
- `dpr-region.html`: exercises exact DPR raster-region transform/crop behavior.

Each file must preserve page-controlled values verbatim; no redaction, pseudonymization, or secret-shaped-token substitution is permitted.
