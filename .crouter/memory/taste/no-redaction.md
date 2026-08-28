---
kind: knowledge
when-and-why-to-read: When designing or changing Capture collection, artifacts,
  output, or identity handling, this knowledge should be read because Capture
  must preserve the browser evidence agents need rather than redact it for a
  security threat model the CLI does not have.
short-form: "Capture does not redact captured browser evidence, with one
  carve-out: credential-like query values are masked where a URL is RENDERED."
surfaces:
  - on: boot
    at: preview
rationale: A privacy-oriented review treated ordinary form text and
  secret-shaped identifiers as disclosure risks, but Silas explicitly rejected
  the entire redaction premise for Capture rather than merely choosing
  ordinary-text retention.
last-updated: 2026-08-28T21:43:09.298Z
origin:
  created: 2026-07-12T19:41:32.731Z
  cwd: /Users/silasrhyneer/Code/cli/crouter
  node: mri4g3we-48b5b151
---

# Capture does not redact browser evidence

Capture is a local agent debugging instrument. Security and artifact disclosure are not product concerns for this CLI, so collection, artifacts, selectors, form values, accessibility names, IDs, protocol payloads, and rendered output must preserve the captured browser evidence rather than redact, pseudonymize, hash, or withhold it.

Sanitizing control characters or enforcing structural output boundaries is still correct because that protects the result protocol, not secrets. Do not let a security/privacy threat model destroy stable identity, joins, or debugging content.

## The one carve-out: credential values in rendered HAR URLs and headers

Silas explicitly overrode the rule for rendered `session har` output: credential-like query/fragment parameter values render as `REDACTED`, and credential-valued headers render as `redacted · <N> chars`. Its reason is transcript hygiene, not a threat model: a dashboard token pasted into an agent's context and terminal scrollback outlives the debugging session.

The boundary is exact, and everything about it exists to keep the evidence intact:

- Collection, the live NDJSON store, and bundled `har.json` are untouched — full fidelity.
- `--filter-url` matches the URL as captured, so the real value still selects the row.
- Names, ordering, and every non-credential value render verbatim, so a row still joins to its artifact record.
- Matching is on the parameter or header name only; no value is ever inspected.

Do not extend this to bodies, form values, or any other rendered content, and do not generalize it into a privacy posture — it is one narrow, user-directed exception to the rule above.
