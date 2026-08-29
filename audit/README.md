# Capture adversarial audit harness

`audit/bin/audit fixture list` reports registered fixtures. Built registry entries remain `pending` until their fixture package and sealed manifests are present.

Serve a fixture locally with `audit/bin/audit fixture serve --case case-a [--variant faulty|healthy] [--port N]`; it prints the loopback URL and stops on Ctrl-C.

Verify both sealed variants before a run with `audit/bin/audit fixture preflight --case case-a`. It launches a fresh pinned Chrome profile and exits non-zero when an assertion fails.

Inspect browser-visible fixture evidence with `audit/bin/audit fixture dump --case case-a [--variant faulty|healthy]`. It writes DOM, responses, headers, and console data to `audit/runs/case-a-dump/`.

Record a verified route with `audit/bin/audit reference record --case case-a --transcript /path/transcript.ndjson [--provisional]`.

Grade a completed run with `audit/bin/audit grade <runId>`. The command becomes available when `audit/grader/grade.mjs` is installed by the grader lane.
