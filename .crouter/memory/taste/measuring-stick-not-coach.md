---
kind: knowledge
when-and-why-to-read: When designing or reviewing any capture output surface —
  verdicts, checks, diffs, or new verification commands — this knowledge should
  be read because Silas ruled the tool is a measuring stick, not a coach, and
  output shape decisions keep re-litigating that line.
short-form: Capture reports measurements, never diagnoses or prescriptions;
  design general primitives, not today's failure modes.
system-prompt-visibility: preview
file-read-visibility: preview
rationale: "The measure/motion design draft graded results against an --expect
  prediction and emitted coaching lines ('fix the winning rule', 'cause
  candidate: X', 'fixes ordered by blast radius'); Silas rejected the whole
  posture, not just the grammar."
origin:
  created: 2026-07-08T18:41:48.163Z
  cwd: /Users/silasrhyneer/Code/cli/crouter
  node: mrccr4ld-26b23a4a
---

# Capture is a measuring stick, not a coach

Two first principles Silas set for capture's verification surface (2026-07-08, measure/motion design review):

**1. Report measurements, never judgments or prescriptions.** Output states facts about the rendered page — geometry, computed styles, provenance (which rule won and from where), motion numbers, diffs. It never says "this is wrong", "this needs to change", or grades the result against a predicted outcome (the `--expect` predict-then-compare design was rejected on this ground). The agent reading the output owns all interpretation and judgment; the tool's job is to transcode pixels/motion/cascade into numbers the agent can reason over. Factual causal provenance (e.g. "rule A wins over rule B by specificity, from file:line") is measurement; "edit rule A" is coaching and is out.

**2. Design general primitives, not today's failure modes.** Don't index the command surface or checks on the currently-common AI-agent UI mistakes — as models improve, old failure modes disappear and new, previously untackleable ones become relevant. Failure-mode research motivates *which measurements matter*, but the surface itself must be general instruments (snapshot, geometry facts, style census, diff, motion timeline) that stay useful as the failure distribution shifts.
