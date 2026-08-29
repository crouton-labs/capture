# Case A fixture notes

## Static opacity

The public checkout tree contains a generic ordered merge of two ordinary checkout fragments, a cart qualification threshold, and a free-shipping preview. A hostile reader of the document, script, styles, images, and DOM snapshots can infer that either fragment could affect the combined summary, but cannot name the planted condition: the tax route's extra top-level `shipping` member and its `$19.00` value are absent from every static application byte and from the DOM. The public tree remains credible with either sealed manifest because neither route's effective payload is embedded in it.

The tax response body is visible in the complete dump by design. Runtime evidence is the subject of this audit; its presence does not defeat static opacity. The oracle therefore requires both the tax-response mock counterfactual and the shipping-response negative control. Reading the response alone cannot establish either that removing only its extra member removes the symptom or that changing only the shipping response leaves the symptom in place.

## No reference route yet

`audit/sealed/case-a/reference-route.json` is intentionally absent, and the grader's refusal to grade this case without it is correct. A reference route is recorded only by an operator who does not know the planted condition; a route recorded by this fixture's author is contaminated by that knowledge and would give the grader a denominator no blind agent can be measured against. The capability finding this fixture surfaced — built help exposes no first-class response-mocking command, so the only route to the required counterfactual runs through `page exec` or raw CDP — is recorded in the oracle's unshipped matcher candidates, not in a route file.

## Counterfactual evidence

On this Mac with fresh Chrome profiles, three real-browser replicas produced `$19.00` displayed shipping with the faulty manifest and `$0.00` with the healthy manifest; the qualifying badge remained true and each recalculation reached `ready`. In the same three replicas, changing only the shipping-quote response from `$0.00` to `$7.50` while retaining the faulty tax response still displayed `$19.00`. The client merges the shipping quote first and the tax calculation second, so only removing the extra member from the latter removes the symptom. The numeric zero-versus-1900-cent result is a categorical free-versus-paid delivery difference; thresholds are tuned on this Mac and require retuning on the pinned audit host.

## Dump coverage

`audit fixture dump --case case-a --variant faulty` captured the document, stylesheet, script, both JSON responses, every response header, an empty console log, and DOM snapshots before and after recalculation. The server has no other browser-requested resources: the favicon is a data URI. No core gap was hit.
