# Review this plan before it is built

You are reviewing a plan in the `spideryarn2` repo (the product is **Spideryarn**, a reading app).
Read-only review. Be adversarial. Your job is to find what is wrong with the plan, not to approve it.

## The plan

`docs/plans/260916a-back-to-where-you-were-survives-a-mode-change.md` — read it in full first.

## Background you should read

- `docs/plans/260906g-back-to-where-you-jumped-from.md` — the plan this extends. It built the return
  chip. It went through six cross-family reviews; its findings are numbered F1–F21 and several are
  quoted in the source. **This new plan deliberately changes one rule that plan states** ("any push
  strips the stamp"), so check whether that rule was load-bearing for something the new plan has not
  noticed.
- `src/web/jump-history.ts` — the stamp, the arm, the handshake.
- `src/web/router.ts` — `watchHistoryWrites`, `dismissJumpOrigin`, `useJumpOrigin`, `originHref`.
- `src/web/ReturnChip.tsx` — the chip.
- `src/web/keynav.ts` — `measureOrigin`, `beginJump`.
- `src/web/reader/useReadingPosition.ts` — the position spy and the restore effect.
- `src/web/position.ts` — `positionToWrite`.
- `src/web/Spine.tsx` around line 700 and `src/web/spine-marks.ts` — the other reader of the stamp.
- `docs/project/url-state.md` — the contract, especially § Position replaces history.
- `src/web/styles/narrow-window.css` § a band with no room — the phone layout the plan leans on.
- `tests/return-chip.test.tsx`, `tests/jump-history.test.ts`, `tests/spine-jump-origin.test.ts`.

## The conclusions I would least like to be wrong about

Check each of these against the source rather than against my prose. Say plainly if one is false.

1. **Every mode already jumps through one function** (`jumpTo` → `beginJump`), so the "reusable
   machinery across modes" the reporter asks for already exists and does not need building. Is there
   any panel, band, hover card, keyboard path or drawer that moves the reader through the article
   *without* going through `beginJump`, other than `comment-jump.ts`'s deliberate step?
2. **A `?mode=` change after a jump strips the stamp**, so the chip disappears. Trace
   `history.pushState` in `watchHistoryWrites` and confirm.
3. **On a narrow window the mode band covers the article**, so after a jump from a band the reader
   must leave the mode (a push) to see where they landed. Confirm from `narrow-window.css` and
   `layout.ts` `fitMode`.
4. **Nothing re-anchors the reader after a rotation**, and `useReadingPosition`'s spy effect
   (keyed on `layoutKey`, which contains `windowWidth`) actively overwrites `?at=` with the
   post-reflow position.

## What I most want you to attack

- **The depth counter.** The stamp gains `depth`, incremented on each inheriting push, and the chip
  becomes `history.go(-depth)`. Is there any sequence of Back, Forward, push, replace, a second
  jump, a `popstate`, a nuqs-abandoned write, or a cross-document navigation after which an entry's
  `depth` no longer names the origin's distance? Please construct the counterexample if there is
  one. Consider especially: the reader presses browser Back and then pushes (forward stack
  truncated); a jump made from an entry that already carries an inherited stamp; `dismissJumpOrigin`
  on an intermediate entry; and entries written by the *previous* deploy that carry no depth.
- **The inheritance test** — same pathname and same `?at=`. Is `?at=` equality the right proxy for
  "the reader has not moved"? Is there a push in this app that changes `?at=` without being an
  armed jump, or that keeps `?at=` while genuinely moving the reader?
- **Stage 3's re-anchor.** Does re-anchoring on every `layoutKey` change introduce a loop with the
  spy, fight the restore effect, fight `scrollToBlock`'s glide, or break the deliberate
  `measure()`-on-layout-change that the comment there says exists for a column toggle? Is skipping
  the first run the right way to avoid double-scrolling on mount, or is there a better seam?
- **Whether the cap (`MAX_RETURN_DEPTH = 10`) is the right mechanism at all**, and whether dropping
  the stamp at the cap is better or worse than clamping the chip to the cap.
- **Scope.** Is any stage bigger than it looks? Is any of it unnecessary? Would a simpler design get
  the same result — say the reporter's complaint answered by Stage 3 alone?

## House rules that constrain the answer

- TypeScript + ESM, `strict` and `noUncheckedIndexedAccess`. Prefer boring, prefer simple over easy,
  simplest version first.
- Make wrong states unrepresentable in the types where you can.
- A check that has never been seen to fail is not evidence (`docs/reusable/silent-success.md`).

## Output

Numbered findings, most serious first. For each: what is wrong, the evidence (file and line), and
what to do instead. Then a one-line verdict: build it as written, build it with these changes, or
do not build it.
