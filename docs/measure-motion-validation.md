# `capture measure` + `capture motion` — U29 end-to-end validation record

End-to-end validation of the `measure` and `motion` command branches against the live crouter-infra (formerly "Hearth") `home-ui` streaming chat, per build-plan §U29. This is a measurement record: exact commands, artifact paths, per-step verdicts, and the disposition of every observation against the current working tree. It records measurements only.

## Target and environment

- Target app: crouter-infra `home-ui` at `http://localhost:5173` (Hearth chat panel). Stack up and healthy at validation time (CP `:8787`, shim `:9797`, home-ui `:5173`).
- Browser: Chrome/150.0.7871.115 (real, over CDP).
- Capture session: **cap-mrfg5h5c-nt5i** (active). Bundle root: `/var/folders/b4/p883jhy555j8l_mmq55m5w9m0000gn/T/capture-sessions/cap-mrfg5h5c-nt5i/`
- Capture binary: `node /Users/silasrhyneer/Code/cli/capture/bin/capture <args>`.
- Session tab used for driving/recording: `D0262ECC8B156734D76472128A424781` (port 54133), the session's recorded tab. A second Hearth tab (`F7641CDE…`, port 50028) was also connected to the same home node during validation — see Motion blocker.

## Verdict summary

| Step | Command | Verdict |
|---|---|---|
| measure snap | `measure snap --pixels --state all` | PASS — settled snapshot, full substrate |
| measure check | `measure check <snap> --for all` | PASS (facts) — overlap noise M1 (corrected) |
| measure map focus | `measure map focus <snap>` | PASS — reads artifact; forward-walk cap M3 (corrected) |
| measure map scroll | `measure map scroll <snap>` | PASS — reads artifact |
| measure map layers | `measure map layers <snap>` | PARTIAL — paint order OK; LayerTree unavailable M4 (open runtime gap) |
| motion rec (composed) | `motion rec --start … --stop` | PASS — finalized recording, frames/events/markers |
| **live streaming response** | chat send → streaming assistant bubble | **BLOCKED** — VM environment (E1, E2); not a capture defect |
| motion mask | `motion mask <rec>` | PRECONDITION FAIL — viewport resize in recording (T1, corrected) |
| motion timeline | `motion timeline <rec> --element textarea` | PASS — factual per-frame geometry, reads artifact |
| motion jank | `motion jank <rec>` | PASS — factual dropped-frame/layout-shift report |
| motion response | `motion response <rec> --action …` | PRECONDITION FAIL — duplicate action labels, no occurrence selector (T2, corrected) |
| privacy (measure/motion) | perms sweep | PASS — dirs 0700, files 0600 |

The `measure` branch and the `motion` recording + read pipeline are exercised against real artifacts. The one §U29 criterion not met is "sends a chat message that produces a live streaming response" — blocked by two independent VM-side environment failures (E1, E2). The motion read commands were therefore validated against a real finalized recording of **composer/input DOM motion** (typing, focus, button state, viewport resize), not a streaming assistant bubble.

---

## Measure phase (previously validated; carried forward)

Snapshot **snap-mrfh55hk-945cb015** in the session bundle.

```
node bin/capture measure snap --pixels --state all
node bin/capture measure check snap-mrfh55hk-945cb015 --for all
node bin/capture measure map focus  snap-mrfh55hk-945cb015
node bin/capture measure map scroll snap-mrfh55hk-945cb015
node bin/capture measure map layers snap-mrfh55hk-945cb015
```

- `snap --pixels --state all`: exit 0. settled=true (622ms), 90 elements, full substrate + crops + states.json. Transcript `/tmp/u29-snap-out.txt`.
- `check --for all`: exit 0. 705 findings, all factual, no missing substrate. Transcript `/tmp/u29-check-out.txt`.
- `map focus|scroll|layers`: all exit 0, each reads purely from the snapshot artifact (no browser re-drive). Transcript `/tmp/u29-map-out.txt`.

Disposition of measure observations M1–M4 below.

---

## Motion phase

### Composed recording — PASS

```
node bin/capture motion rec --start
node bin/capture type "…" --into "Message"
node bin/capture click "Send message"
node bin/capture motion rec --stop
```

Finalized recording **rec-e49f**:
`/var/folders/b4/p883jhy555j8l_mmq55m5w9m0000gn/T/capture-sessions/cap-mrfg5h5c-nt5i/motion/recs/rec-e49f`

- 175 frames over 743.7s, 11345 event records, `baseline-availability=available`, `video=encoded`.
- Event kinds: performance 7677, trace 3445, mutation 217, input 4, resize 1, binding-dropped 1.
- Artifacts present: `events.jsonl`, `frames/`, `markers.json`, `meta.json`, `rects.jsonl`, `video.webm`.

The composed recorder correctly armed on the session tab, routed the intervening `type`/`click` commands through the held recorder connection (`Routing via active recorder rec-e49f`), and finalized with all expected artifact files. Frames, events, and clock-baseline markers are all present.

### Live streaming response — BLOCKED (VM environment, not capture)

Two chat messages were typed and sent through the armed recorder ("What is 2 plus 2? …", then "Ping test 4477. Reply with just: pong."). Neither produced a streaming assistant response. Root cause is two independent VM-side failures; capture behaved correctly throughout.

**Evidence — the prompt never reached the home node (E1):**
The home-ui chat binds to the VM node named `home` = `mrf5bt4t-e467b570` (`home-ui/src/broker/useHomeNode.ts:14,40`). Its pi session file
`/Users/silasrhyneer/mock-vms/crouter/home/.pi/agent/sessions/…/2026-07-10T16-24-35-876Z_…jsonl`
stayed at 17 lines with the last user turn being a prior "Please briefly describe…" message; neither sent prompt appears. The node broker log stayed byte-for-byte unchanged (1220 bytes) across the send + 64s of monitoring. home-ui's `submit()` clears the draft optimistically (`ChatPane.tsx:357` → `setDraft('')`), but `useBroker` drops the outbound frame unless the client holds broker control (`home-ui/src/broker/useBroker.ts:224` — `if (body === '' || !isControllerRef.current) return;`). Two Hearth tabs were connected to the one home-node broker; only one can hold control, so the recorder tab's sends were silently swallowed. The composer is disabled only on non-`open` status (`ChatPane.tsx` Composer `disabled={state.status !== 'open'}`), never on non-controller, so a non-controller tab shows an enabled Send button that no-ops.

**Evidence — all VM model providers rate-limit-exhausted (E2):**
The home node broker log (`…/nodes/mrf5bt4t-e467b570/job/broker.log`) shows every credential exhausted:
```
[provider-rotation] Claude pool exhausted -> openai-codex/gpt-5.5:high
[provider-rotation] OpenAI Codex subscription "openai-codex" rate-limited (reason=usage limit …); cooling down for 300s
[broker] stream watchdog: no engine event for 300000ms while streaming — aborting stalled provider stream
```
The prior turn stalled for the full 300s stream-watchdog window and was aborted. Even if a prompt had reached the node (E1 resolved), no streaming assistant text could be generated while all Claude subscriptions and the OpenAI Codex fallback are cooling down on usage limits.

Both blockers are VM-side environment failures. Neither can be resolved from the capture side (E2 is an upstream provider rate limit). A live streaming assistant bubble is unobtainable in this environment at this time.

### Read commands against rec-e49f

All four read commands read the finalized artifact only (no browser re-drive; `timeline` output confirms "11345 event record(s) were read with the recording"). Recorded subject is composer/input motion, not a streaming bubble.

```
node bin/capture motion mask rec-e49f                                   # exit 1
node bin/capture motion timeline rec-e49f --element '.justify-start:last-of-type .rounded-2xl'   # exit 1
node bin/capture motion timeline rec-e49f --element 'textarea'          # exit 0
node bin/capture motion jank rec-e49f                                   # exit 0
node bin/capture motion response rec-e49f                               # exit 1 (lists actions)
node bin/capture motion response rec-e49f --action 'click:Send_message' # exit 1 (duplicate)
```

- **mask** — exit 1, `artifact_unavailable`: *"Frame dimensions differ between frame-000014.png (3036x1884) and frame-000015.png (1600x992); a motion composite requires one viewport size."* The recording spans a viewport resize (recorded `resize` event), so a single composite cannot be built. Output is factual; see the T1 disposition. Output `/tmp/u29-mask.txt`.
- **timeline `--element textarea`** — exit 0. 175 sampled frames, per-frame bounding-box geometry, factual. Captures the textarea moving from `x=1140 y=810 w=302 h=32` to `y=790 w=302 h=52` at frame 15 (the resize). Carries recording id/path, state, timing-domain note, and ±1-frame uncertainty. Output `/tmp/u29-timeline-textarea.txt`.
- **timeline `--element '.justify-start:last-of-type .rounded-2xl'`** — exit 1, `element_not_found`. The recommended streaming-bubble selector uses the `:last-of-type` pseudo-class, which rects.jsonl matching does not support (only tag/`#id`/`.class`/simple combinations, because rects.jsonl retains no DOM tree). Independently, no streaming bubble existed to sample. Output `/tmp/u29-timeline-bubble.txt`.
- **jank** — exit 0. 1106 estimated dropped frames, 0 long-task records (incomplete), 10 layout-shift records (incomplete). The dropped-frame count is dominated by the long idle gaps of the ~12-min session (screencast cadence 494.90ms; multi-second-to-90s idle intervals scored as dropped frames), i.e. it faithfully measures the sparse idle recording rather than real animation jank. One layout-shift entry reports a negative recorder-relative timestamp (`t=-1541098.60ms`); see the T3 disposition. Output `/tmp/u29-jank.txt`.
- **response** — exit 1, `action_required`. Correctly detected all four recorded action marks (`type:Message` ×2, `click:Send_message` ×2) and asked for `--action`. Passing `--action 'click:Send_message'` still exits 1 because that label appears twice and there is no occurrence selector; see the T2 disposition. Output `/tmp/u29-response.txt`, `/tmp/u29-response2.txt`.

### Privacy check — PASS (measure/motion scope)

```
find <bundle>/measure <bundle>/motion -type d ! -perm 700   # (empty)
find <bundle>/measure <bundle>/motion -type f ! -perm 600   # (empty)
```

- `measure/` and `motion/` trees: 11 directories all `0700`, 3563 files all `0600`. Zero violations. Bundle root and `motion/recs/rec-e49f/` (including `frames/`, `video.webm`, `events.jsonl`, `rects.jsonl`) all conform.
- Out-of-scope observation: `shots/*.png` interaction screenshots are mode `0644` (not `0600`), though their parent `shots/` dir and the bundle root are `0700`, so other users cannot traverse to them. See the T4 disposition.

---

## Disposition of observations

Every capture-side observation from this run (M1–M3, T1–T4, R1) was corrected in the current working tree after it was measured. M4 remains an open runtime-availability gap. E1–E2 are environment blockers outside capture and are unchanged. Working-tree changes are not built or committed here; the §U29 umbrella owns the single `bin/capture` rebuild.

### Measure branch

- **M1 — `measure check` overlap noise (705 findings on a 90-element page from all-pairs ancestor/descendant intersection).** Corrected after observation: overlap resolution now consults only authoritative `layers.json` paint order (`src/cdp/measure/check.ts`); a finding is omitted unless both candidates' backendNodeIds appear in the paint order, with no DOM-order fallback or DOM-order provenance. Covered by `test/measure-check.test.ts` (8/8 focused).
- **M2 — rendered stdout HTML-escaped `>` in selectors (`div#root &gt; main`).** Corrected after observation: the renderer anchors CSS/attribute-selector context on the unambiguous `[ident="…"]` shape and treats other `>`/`<` as prose while still neutralizing real markup as data (`src/output/render.ts`); hostile attribute-value labels stay fully escaped. Covered by `test/output-render.test.ts` (51/51 focused).
- **M3 — `measure map focus` forward walk hit the 300-stop cap (~23× wrap of the ~13-stop tab ring).** Corrected after observation: cycle detection keys each stop on a collector-private `document.activeElement` → `DOM.describeNode.backendNodeId` bridge instead of the page-readable marker id (`src/cdp/measure/collectors/focus.ts`); the forward walk terminates on the real repeat and the private keys are never emitted in JSON. Covered by `test/measure-focus-cycle.test.ts` (5/5 focused).
- **M4 — `measure map layers`: LayerTree domain unavailable on Chrome 150 (`no-layertree-event-within-timeout` → layers=0).** Open runtime-availability/degradation gap, unresolved: paint order still works and the command reports the layer substrate as unavailable rather than fabricating it.

### Motion branch

- **T1 — `motion mask` exited 1 when a recording spanned a viewport resize (3036×1884 → 1600×992).** Corrected after observation: mask composites the longest contiguous same-size frame run with a precise caveat, rect facts are gated to that run's frames, and exit 1 occurs only when no same-size run of ≥2 frames exists (`src/cdp/motion/mask.ts`).
- **T2 — `motion response` could not disambiguate repeated action labels (`click:Send_message` ×2).** Corrected after observation: `--occurrence <n>` (1-based) selects an individual occurrence; an ambiguous label without a selector still exits 1 with a factual occurrence list (`src/cdp/motion/response.ts`, `src/cdp/args.ts`).
- **T3 — `motion jank` emitted a negative recorder-relative layout-shift timestamp (`t=-1541098.60ms`).** Corrected after observation: negative recorder-relative observer timestamps route to the existing 'unavailable' branch (null fields), and the note names only the cause(s) actually present (`src/cdp/motion/jank.ts`).
- **T4 — interaction screenshots were world-readable (`shots/*.png` mode `0644`).** Corrected after observation: session auto-screenshots under `CAPTURE_ROOT` write `0600` via the private writer; explicit `--out` paths outside root keep the plain writer (`src/cdp/screenshot.ts`).
- **R1 — `motion rec` reported `video="failed"` on a long (~23 min, 2561-frame) recording.** Corrected after observation: the fixed 30s ffmpeg encode timeout is now `min(15min, 30s + 60ms/frame)`; a timeout is reported only on ETIMEDOUT, and a bare SIGTERM gets the distinct factual reason `ffmpeg_terminated` (`src/cdp/commands/motion/rec.ts`).

### Environment blockers (E1–E2 — not capture defects, unchanged)

- **E1 — home-ui chat send is dropped when the tab is not the broker controller.** With two Hearth tabs connected to one home-node broker, the non-controller tab's sends silently no-op (`home-ui/src/broker/useBroker.ts:224`), and the composer gives no non-controller affordance (`ChatPane.tsx` Composer disabled only on non-`open` status). crouter-infra / home-ui behavior.
- **E2 — all VM model providers rate-limit-exhausted.** Claude subscription pool exhausted, OpenAI Codex fallback rate-limited (usage limit, 300s cooldown), stream watchdog aborting stalled streams (VM node `mrf5bt4t-e467b570` broker.log). No streaming assistant response is generable in this environment until provider limits reset. Upstream provider limits.

---

## Full-suite status

The full `npm test` suite was not run green, and this record does not claim a green full suite. The historical full run was classified, not passed, into two failure classes with no product regression in the U29 diffs:

- **Historical deterministic stub failures, subsequently fixed.** Four focus-walk assertions across three pre-existing test files (`test/measure-maps-substrate.test.ts`, `test/measure-mutating-invariants.test.ts` — two stub harnesses, `test/measure-restoration.test.ts`) initially failed because their stub CDP harnesses predated M3's private active-element/objectId → `DOM.describeNode.backendNodeId` cycle-identity contract, not because of any product change; no `src/` file was implicated. The current stub updates model that bridge and the focused mutating-invariants run is now green: `node --import tsx --test --test-name-pattern="(focus\\.ts|scroll\\.ts).*stub proof" test/measure-mutating-invariants.test.ts` reports 13 passing, 0 failing. Full historical mechanism and per-failure fixes: `/Users/silasrhyneer/.crouter/canvas/nodes/mrgofsiv-75d2b21a/context/u29-test-failure-diagnosis.md`.
- **Live-Chrome-unavailable failures.** The remaining failures are real-Chrome/CDP browser-dependent suites that error on Chrome launch or reachability under a saturated machine (e.g. `test/motion-rec.test.ts` real-Chrome integration cases with `Failed to open a new tab` / recorder-bridge-not-reachable, `test/measure-snap.test.ts` 30s child timeout). They fail before reaching changed code — environmental, not content assertions.

Focused per-lane suites were green at their respective lane snapshots: `test/output-render.test.ts` 51/51, `test/measure-check.test.ts` 8/8, `test/measure-focus-cycle.test.ts` 5/5, and the combined motion focused set 86/89 (the 3 non-passing being the two real-Chrome integration tests plus, at that earlier snapshot, the render-escaping case since closed by the M2 fix).
