# Case D fixture notes

## Static opacity

The hostile reader can infer from the public grid page, styles, vendor module, and post-scroll DOM that `ornaments.js` performs style writes followed by geometry reads, and can count the generated cards. They cannot establish from those static surfaces that the operations alternate under the active configuration, or that their cost dominates a scroll. The public source contains one general batched implementation; it is correct and efficient when the runtime batch is the catalog size, and its final badge positions look the same under both scenarios. A screenshot or DOM therefore also leaves image decode and raw DOM size plausible.

The complete dump deliberately includes the runtime `/display-options` response, which reveals the active batch value. That response is expected and is not hidden or omitted. It does not establish the causal claim: the oracle requires forced synchronous layout, `positionMarks`/`ornaments.js` attribution, the write-then-read pattern under batch size one, and cited trace timing. A reader can form the right hypothesis from the configuration value, but cannot satisfy the diagnosis evidence requirement without the recorded trace.

## Counterfactual evidence

Changing only the sealed runtime batch configuration while retaining the same 720 generated products and all public assets removes the forced-reflow condition. Three fresh-profile preflight replicas on this Mac recorded faulty badge-attributed UpdateLayoutTree time of 2507.557 ms, 2534.765 ms, and 2490.778 ms; the healthy control recorded 0.501 ms, 0.500 ms, and 0.518 ms. Every faulty replica crossed the forced-reflow assertion and every healthy control did not, with the same `positionMarks` stack attribution in `ornaments.js`. The threshold separation is over 4,800× at the closest pair and requires no CPU throttling.

## Trace-engine boundary

The fixture's coordinator preflight records a real Chrome trace through CDP and identifies `UpdateLayoutTree` events whose stack frame is `positionMarks` in `ornaments.js`; its assertion is named `forced-reflow-insight`. The current checked-out harness exposes no first-class trace/insight command and the declared `@paulirish/trace_engine@0.0.65` package is not installed in this checkout, so this preflight cannot invoke the actual DevTools Trace Engine insight processor. That is expected while the capability under audit is unshipped; the fixture does not edit core or invent a capture capability to conceal it.

## Preflight ceiling: `layoutMs.max` is 20000, not 10000

The faulty preflight measures forced-synchronous-layout time over raw CDP (no `bin/capture` involved). On this host the figure sits at roughly 9.6-11.1 s — five consecutive samples read 9625, 10634, 10758, 10668 and 11138 ms — because the audit target container runs `--platform linux/amd64` under emulation and is therefore sensitive to whatever else the machine is doing. The original 10000 ms ceiling fell inside that distribution and began failing the preflight outright, blocking round starts.

Raising the ceiling to 20000 ms costs no discrimination. The bound that separates faulty from healthy is the 800 ms floor, and healthy measures 1.5-2.3 ms — more than two orders of magnitude below it. The ceiling's only job is to catch a pathological hang, which 20000 ms still does. Nothing graded depends on this number: `layoutMs` gates whether a run may start and appears in no oracle fact or evidence item.

Chrome was ruled out as the cause. The container reports `HeadlessChrome/143.0.7499.40`, which is the build `oracle.json` pins and the build case D round 2 recorded, so the drift is host state rather than a browser change. `fixtureRevision` stays `d.1` deliberately: the served bytes, the planted condition and every graded criterion are byte-identical, and bumping the revision would signal a fixture change that did not happen.
