# Review the code built from the touch-glossary-card plan

You reviewed the **plan** for this earlier today and returned nine findings with the verdict *not
ready to build*. This is the review of what was actually built. **Weight this one higher than the
plan review**: a plan-stage review cannot find a listener registered in the wrong phase, a ref read
one render too early, or a guard placed after the thing it was meant to guard.

Read-only. Do not edit files. Rank findings by how much damage they would do, and mark each
must-fix / should-fix / note. End with a one-line verdict.

## What to read

- `docs/plans/260827ak-touch-glossary-card.md` — the plan, now updated, with a **§ What the review changed**
  saying which of your nine landed and which two were declined and why.
- `docs/plans/260827ak-touch-glossary-card-review-sol.md` — your own nine findings, for reference.
- A scoped diff is at
  `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/0d6e454e-1ae4-451f-bc77-f109815eb877/scratchpad/touch-glossary.diff`
  — read it for the shape, then read the real files, which are authoritative.

**The tree is shared with other agents and the diff is not all mine.** In `useHoverCard.ts` the
`host` option and its observer are somebody else's in-flight work; in `ProseHoverCard.tsx` the
named-places `selector` is too; most hunks in `styles.css` are other features. Mine are: everything
touch-related in `useHoverCard.ts` (`TAP_SLOP`, `SWALLOW`, `TAP_ATTR`, `Press`, `isTap`,
`tapSelector`, `onCommit`, `byTouchRef`, `currentRef`, the eight listeners inside
`if (tapSelector)`, and the `TAP_ATTR` effect), the `tapSelector`/`onCommit` block in
`ProseHoverCard.tsx`, the `mark.term[data-hover-tap]` rule, and all of
`tests/hover-card-touch.test.tsx`.

Also relevant: `src/web/TableView.tsx` (`onClick`, `onMouseUp`), `src/web/swipe.ts` (the other
compatibility-event eater), `src/web/Spine.tsx` § `bandPress`, `src/web/annotate.ts`,
`docs/project/touch.md`, `docs/reusable/silent-success.md`.

## What I most want you to attack

1. **Did your nine actually get fixed, or did they get a comment?** Check each against the code
   rather than against the plan's claims. In particular #1 (long press and selection), #2 (the test
   proving the capture phase), #3 (scroll dismissal), #5 (disarm on the next press) and #6
   (`pointermove` maximum).
2. **`currentRef`.** `current` was a local in the listener effect and is now a ref, so the `close()`
   the hook returns can clear it — the desktop path uses that too. Did moving it break any of the
   hover logic that read it? Is there now a stale-ref hazard across the effect's own teardown, or
   between the two effects?
3. **`byTouchRef` and the `TAP_ATTR` effect.** The ref is written inside a document listener and
   read in a `useEffect` keyed on `shown`. Is that ordering guaranteed, in StrictMode's
   double-invoke too? Can the attribute be left on a mark — after a commit, after the prose
   re-annotates under an open card, after unmount, after the effect re-runs because `tapSelector`
   changed identity?
4. **The `dismiss` listener.** `scroll` in capture on `document`, plus `resize` on `window`. Does it
   fire on things that are not the reader scrolling — Floating UI's own `autoUpdate`, a
   `scrollIntoView` from a jump, an iOS keyboard opening, a rubber-band bounce at the top? What
   happens to the desktop path if `byTouch` is ever wrongly true?
5. **The swallower.** It is capture-phase `mouseup` + `click` on `document`, bounded by 400ms, 24px,
   the click itself, and the next `pointerdown`. Walk a real iOS tap on a `mark.term.chat` inside an
   `<a>` inside `td.text` and say what still gets through. Does swallowing `mouseup` with
   `stopPropagation` break text selection, focus, or the dock? Is there any path where a *mouse*
   user's `click` is eaten?
6. **`isTap`.** Is `window.getSelection()` at `pointerup` the right moment to ask — has iOS already
   collapsed the selection by then when the reader taps to dismiss one? Is 10px right given the
   prose is `touch-action: pan-y`?
7. **The commit contract.** The hook now leaves the card open and `currentRef` set, and the consumer
   closes if it acts. Is that a trap for the next consumer? What happens on the third tap of a
   two-term mark, and after a commit whose mark is *not* replaced?
8. **The test file.** Where can it pass with the feature broken? It builds `PointerEvent`s out of
   `MouseEvent`s because jsdom has no constructor — what does that hide? Two mutations were run to
   prove it can fail (bubble phase instead of capture; selection guard removed) and each turned
   exactly one test red — name a third mutation it would sleep through, and say what assertion would
   catch it.
9. **Anything about this that is simply the wrong shape**, now that you can see it rather than a
   description of it.

Quote file and line where you can.
