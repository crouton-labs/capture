---
kind: knowledge
when-and-why-to-read: When designing or changing Capture collection, artifacts,
  output, or identity handling, this knowledge should be read because Capture
  must preserve the browser evidence agents need rather than redact it for a
  security threat model the CLI does not have.
short-form: Capture does not redact captured browser evidence; security is not a
  concern for this local agent CLI.
system-prompt-visibility: preview
file-read-visibility: none
rationale: A privacy-oriented review treated ordinary form text and
  secret-shaped identifiers as disclosure risks, but Silas explicitly rejected
  the entire redaction premise for Capture rather than merely choosing
  ordinary-text retention.
origin:
  created: 2026-07-12T19:41:32.731Z
  cwd: /Users/silasrhyneer/Code/cli/crouter
  node: mri4g3we-48b5b151
---

# Capture does not redact browser evidence

Capture is a local agent debugging instrument. Security and artifact disclosure are not product concerns for this CLI, so collection, artifacts, selectors, form values, accessibility names, IDs, protocol payloads, and rendered output must preserve the captured browser evidence rather than redact, pseudonymize, hash, or withhold it.

Sanitizing control characters or enforcing structural output boundaries is still correct because that protects the result protocol, not secrets. Do not let a security/privacy threat model destroy stable identity, joins, or debugging content.
