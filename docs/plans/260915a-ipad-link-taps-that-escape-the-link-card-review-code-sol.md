# GPT Sol's code review of 260915a, 2026-09-15

Run with `--sandbox workspace-write`: it wrote its findings first, then fixed them. What the
orchestrator changed on top of its fixes is in the plan, § The code review, and what it changed.

## Findings, written before any edit

1. **P1 — `src/web/useHoverCard.ts:475` — a delayed first tap can commit after a later press overwrites `lastPress`.** Concrete failure: a Pencil presses outbound link A while its hover timer is still pending, the timer opens A, then the user presses link B before A's delayed click is dispatched. The click for A now reads B's snapshot (`open === A`) and calls `onCommit`, so A's first tap opens the external page. The Pointer Events specification explicitly permits compatibility mouse events to be delayed/grouped while preserving their relative order; a singleton "most recent press" cannot associate each click with its own press. **Intended change:** keep an ordered queue of primary touch/pen press snapshots, consume one snapshot for each corresponding click, and allow commit only from that click's own snapshot. Add a grouped Pencil regression in `tests/link-tap-escapes.test.tsx` that is red with the singleton.

2. **P1 — `src/web/useHoverCard.ts:534,709` — cancelled and stale presses retain commit authority, while `clicked` ignores the click's own input metadata.** Concrete failure: with link A's card open, `pointerdown(A)` followed by `pointercancel` leaves `lastPress.open === A`; if the platform nevertheless emits a click, or a later trusted pointing click arrives without another `pointerdown`, the handler commits A. A stale touch record can likewise misclassify a later mouse/non-pointing activation because only `lastPress.type` is read. Modern Pointer Events require a pointing-device click to carry its own `pointerType`/`pointerId`, and non-pointing activation to carry `pointerType === ""`; `HTMLElement.click()` is untrusted and has `detail === 0`. **Intended change:** invalidate the matching queued snapshot on `pointercancel`/`contextmenu`, prefer the click's own pointer metadata when present, consume snapshots on every touch/pen click (including non-link clicks), and make unmatched/expired touch clicks reveal-only rather than commit. Add regressions for `pointercancel → click` and a stale touch followed by a no-pointerdown mouse click.

3. **P2 — `tests/link-tap-escapes.test.tsx:376` — the mouseup test does not prove the safety claimed by its name/comment.** Concrete failure: the harness increments `ancestor.mouseup` unconditionally, so the assertion passes whether a TableView-like handler returns for `a[href]` or opens a comment/chat surface. It proves propagation only, not that letting the event through is harmless. **Intended change:** make the harness separately count receipt and the TableView-like surface action, mirror the `closest("a[href]")` early return, and assert the link mouseup is received but opens no competing surface.

## Its answer, after fixing them

Implemented all three review findings.

1. **P1 — grouped clicks could commit a first tap.** Replaced the singleton `lastPress` with ordered per-press records in `useHoverCard.ts`. Ambiguous or missing-click sequences retain interception but lose commit authority.

2. **P1 — cancelled/stale presses could authorize later clicks.** `pointercancel`, `contextmenu`, second fingers, unmatched clicks, and snapshots older than two seconds can no longer commit. Touch clicks without an observed press reveal safely. Input metadata is used while accommodating WebKit's reopened bug where touch clicks report `pointerType: "mouse"` ([WebKit bug 282988](https://bugs.webkit.org/show_bug.cgi?id=282988)). Non-pointing activation remains native; `HTMLElement.click()` was verified as `detail: 0`, untrusted.

3. **P2 — mouseup test proved propagation, not safety.** The harness now models TableView's `a[href]` early return and separately asserts that mouseup arrives without opening a competing surface.

Each regression was observed red without its fix, including grouped Pencil clicks, cancellation, missing clicks, stale snapshots, second-finger input, WebKit's mislabeled click, and the mouseup guard mutation.

No source finding was left unfixed. Two qualifications:

- A first *touch* can still commit when the same card was already visibly open from mouse hover. That matches the existing "card already open" contract; it is not a blind first-tap escape. The accurate invariant is now: a commit requires that the click's own recent, unambiguous, uncancelled press began with that exact element's card open.
- Replacing the anchor between press and click changes element identity and therefore safely downgrades to reveal. `ProseHoverCard.onCommit` remains synchronous inside the click listener, so `window.open` retains user activation.

Letting `mouseup` through is safe: TableView handles selection first and then returns for links; the only other prose-adjacent listener found is swipe's earlier window-capture swallower.

Results, as it reported them: the scoped Vitest command exited 0 (9 files, 175 tests). `npm run typecheck` could not start in its sandbox (`EPERM` on tsx's IPC socket); `node --import tsx scripts/typecheck.ts` exited 0. The orchestrator re-ran both outside the sandbox: 175 passed, typecheck exit 0.
