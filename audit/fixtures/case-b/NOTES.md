# Case B fixture notes

## Opacity

`landing.mjs` publicly shows an ordinary asynchronous profile slot: it fetches `/profile` and inserts the image URL supplied by that response. The effective response delay, selected image URL, and private source behind that URL are read only from the sealed manifests; the healthy and faulty manifests use the identical hero bytes and differ only in `profileDelayMs`. The runtime profile body carries the normal selected route but never a delay value, variant name, or private source path. No served script, response header, DOM node, route name, asset filename, or console message carries either effective delay value or the private source path. `res.sendDate = false` also prevents Node's automatically generated `Date` header from turning the response-header dump into a timing side channel.

The preload scanner can discover the module but cannot discover the selected image URL: that URL arrives only after the profile response body resolves. A hostile reader of the faulty dump can see the normal asynchronous relationship and can be tempted by the 176,226-byte hero image, but cannot name the planted delay or distinguish it from an ordinary short profile request from the served contents. The dump contains the document, stylesheet, module, profile JSON, and hero response; its hero record is `004-primary`, 176,226 bytes, SHA-256 `c2c3d30d48d2333d54523f4948c2415c9eb5beef68a0fbfab59d5fabebe86686`.

I could not name the planted condition from the dump's response bodies, headers, console output, or DOM snapshots alone. One dump-tool caveat remains: the two DOM artifact files receive filesystem modification times when written, so a reader allowed to inspect host filesystem metadata can infer an approximate interval between its pre- and post-personalization snapshots. `dump.json` itself does not serialize timing. Normalizing dump artifact timestamps would close that core-owned metadata side channel; no served byte leaks it.

## Counterfactual and tuning

On this Mac with the harness's fresh Chrome profile and cold cache, six faulty replicas measured FCP `[28, 28, 24, 24, 44, 24]` ms and LCP `[3228, 3224, 3224, 3220, 3248, 3220]` ms. Six healthy replicas measured FCP `[28, 28, 32, 28, 28, 28]` ms and LCP `[100, 100, 100, 108, 100, 100]` ms. The faulty and healthy worst-case LCP values are separated by more than 28x. In each faulty preflight, the injected `IMG` was the LCP element and its resource-load delay exceeded both image TTFB and download duration.

The current oracle uses FCP `≤800` ms, faulty LCP `2800–3800` ms, and healthy LCP `<1200` ms. These deliberately broad margins are tuned on this Mac's pinned harness Chrome (`143.0.7499.40`) and need retuning on the final pinned audit host. The counterfactual changes only sealed `profileDelayMs` from 3200 ms to 80 ms; the selected source, response body, image bytes, application tree, and browser/cache conditions remain unchanged.
