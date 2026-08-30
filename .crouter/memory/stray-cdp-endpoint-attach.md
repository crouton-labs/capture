---
kind: knowledge
when-and-why-to-read: When you are about to run capture on a machine where other
  agents, tests, or finished nodes may have launched a browser, this knowledge
  should be read because capture's endpoint discovery can silently bind your
  commands to someone else's browser, so the measurements you report describe a
  page you never opened.
rationale: A graded audit round was invalidated by a stray CDP endpoint left by
  a node that had already reported done, and two later rounds each found another
  one during a pre-launch sweep; agents assume a finished node has released its
  browser.
last-updated: 2026-08-30T19:49:58.374Z
origin:
  created: 2026-08-30T19:49:58.374Z
  cwd: /Users/silasrhyneer/Code/cli/capture
  node: 3zl47w7d-mtduup4r-099a7530
---

# A stray CDP endpoint on localhost silently captures your session

Capture discovers a browser by enumerating localhost listening ports and probing each one for `/json/version` then `/json/list`. It does not distinguish a browser it should use from one that merely exists, so **any orphaned Chrome on the host is a candidate target** and the attach looks completely normal.

**A node that has finished does not guarantee its browser is gone.** Observed three separate times on this host: a `chrome-headless-shell` still holding a CDP endpoint hours after its owning node reported done and its broker died. One of them attached an isolated audit run to the wrong browser and invalidated the run's result.

Sweep before any measurement whose correctness matters:

```
ps aux | grep -Ei "chrome-headless-shell|bin/capture"
lsof -nP -iTCP -sTCP:LISTEN
```

Reap stray browsers by pid. A plain HTTP server on a stray port is harmless — it carries no CDP endpoint, so discovery finds nothing to attach to; only a live CDP endpoint is the hazard.

`tab launch` starts a browser capture owns and reaps, which is the reliable way to know which browser you are driving.
