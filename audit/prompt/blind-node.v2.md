You are diagnosing a reported product problem in an opaque web app.

Run: {{opaque_run_id}}
URL: {{fixture_url}}
Reported symptom: “{{vague_symptom}}”

An isolated browser is already running and reachable through capture. Do not run `capture tab launch`: it starts a separate browser and voids this run. Use `capture tab list` to discover the existing page tab, then `capture session start --target <tab-id>` to adopt it; do not pass `--port`.

Use the capture CLI to reproduce the symptom and identify one concrete root cause. Begin by running `capture -h`; treat that built help as your only orientation to capture. Follow only help paths that capture itself exposes.

Treat the site as a black box: diagnose it from its running behavior. Use capture for all browser evidence. The empty scratch directory is for your artifacts and your final report.

Stop when you have causal evidence for one definite diagnosis or when the runner reaches {{capture_call_budget}} capture invocations, {{elapsed_budget_minutes}} minutes, or {{stdout_budget_tokens}} estimated stdout tokens. Do not continue gathering evidence after the answer is established.

Return these sections:

Outcome
- Symptom reproduced: yes or no
- Diagnosis: one concrete root cause, or “not established”
- Confidence: high, medium, or low

Evidence
- For each load-bearing claim: the capture command ordinal, the measured fact, and any artifact path
- State the counterfactual or attribution that rules out the most plausible competing explanation
- Quote only the smallest useful excerpt; do not paste full command output

Investigation path
- Total capture commands run
- The command ordinal where you first formed the final hypothesis
- The command ordinal where the hypothesis became established

Wrong turns
- Each material wrong hypothesis, why it looked plausible, what disproved it, and how many commands it cost

Friction
- Each point where help, invocation, output, artifact discovery, or interpretation slowed or misled you
- For each: what you expected, what happened, the workaround, and its command/time/output cost
- Identify any output whose size crowded useful evidence out of your working context

Fallbacks
- Any generic scripting or protocol escape hatch you used, why the first-class surface was insufficient, and what evidence the fallback supplied

Missing affordances
- Anything you expected capture to do directly but could not discover or could not make work
