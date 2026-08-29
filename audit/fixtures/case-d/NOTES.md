# Case D fixture notes

## Static opacity

The hostile reader can infer from the public grid page, styles, vendor module, and post-scroll DOM that `ornaments.js` performs style writes followed by geometry reads, and can count the generated cards. They cannot establish from those static surfaces that the operations alternate under the active configuration, or that their cost dominates a scroll. The public source contains one general batched implementation; it is correct and efficient when the runtime batch is the catalog size, and its final badge positions look the same under both scenarios. A screenshot or DOM therefore also leaves image decode and raw DOM size plausible.

The complete dump deliberately includes the runtime `/display-options` response, which reveals the active batch value. That response is expected and is not hidden or omitted. It does not establish the causal claim: the oracle requires forced synchronous layout, `positionMarks`/`ornaments.js` attribution, the write-then-read pattern under batch size one, and cited trace timing. A reader can form the right hypothesis from the configuration value, but cannot satisfy the diagnosis evidence requirement without the recorded trace.

## Counterfactual evidence

Changing only the sealed runtime batch configuration while retaining the same 720 generated products and all public assets removes the forced-reflow condition. Three fresh-profile preflight replicas on this Mac recorded faulty badge-attributed UpdateLayoutTree time of 2507.557 ms, 2534.765 ms, and 2490.778 ms; the healthy control recorded 0.501 ms, 0.500 ms, and 0.518 ms. Every faulty replica crossed the forced-reflow assertion and every healthy control did not, with the same `positionMarks` stack attribution in `ornaments.js`. The threshold separation is over 4,800× at the closest pair and requires no CPU throttling.

## Trace-engine boundary

The fixture's coordinator preflight records a real Chrome trace through CDP and identifies `UpdateLayoutTree` events whose stack frame is `positionMarks` in `ornaments.js`; its assertion is named `forced-reflow-insight`. The current checked-out harness exposes no first-class trace/insight command and the declared `@paulirish/trace_engine@0.0.65` package is not installed in this checkout, so this preflight cannot invoke the actual DevTools Trace Engine insight processor. That is expected while the capability under audit is unshipped; the fixture does not edit core or invent a capture capability to conceal it.
