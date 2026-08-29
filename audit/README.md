# Capture adversarial audit harness

`audit/bin/audit fixture list` reports registered fixtures. Built registry entries remain `pending` until their fixture package and sealed manifests are present.

Serve a fixture locally with `audit/bin/audit fixture serve --case case-a [--variant faulty|healthy] [--port N]`; it prints the loopback URL and stops on Ctrl-C.

Verify both sealed variants before a run with `audit/bin/audit fixture preflight --case case-a`. It launches a fresh pinned Chrome profile and exits non-zero when an assertion fails.

Inspect browser-visible fixture evidence with `audit/bin/audit fixture dump --case case-a [--variant faulty|healthy]`. It clears and rewrites `audit/runs/case-a-dump/` with DOM, responses, headers, console data, and raw browser network timing. Text response bodies are written as files; binary bodies are intentionally digest records (`storage: "digest-only"`, `fileWritten: false`, `resourceName`, `size`, and `sha256`) in `responses.json`, not missing files. `dump.json` states that convention alongside the dump's completeness.

Each response record carries every CDP event timestamp verbatim, exactly as Chrome reported it, with no reconciliation. Chrome's own outer event timestamps are not always ordered: a `loadingFinished.timestamp` can precede the matching `responseReceived.timestamp` (observed by up to ~9 ms on a script). That is what the browser said, not a recording error — the harness stores each event's own `params.timestamp` under its own key and never derives one from another. For per-response phase timing, read the nested `timing.*` block, which is the browser's own authoritative breakdown.

Record a verified route with `audit/bin/audit reference record --case case-a --transcript /path/transcript.ndjson [--provisional]`.

Grade a completed run with `audit/bin/audit grade <runId>`. The command becomes available when `audit/grader/grade.mjs` is installed by the grader lane.
