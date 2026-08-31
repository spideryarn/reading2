# Review: the prose gutter, as built

You are reviewing **built code**, not a plan. Be adversarial and concrete. For each finding, name the
file and line, say what input or sequence produces the wrong behaviour, and say what the fix is. Rank
by severity. Say plainly if something is fine — do not manufacture findings.

You reviewed the plan for this earlier today; that review is
`docs/plans/prose-gutter-icons-review-sol.md`. **Do not assume it was followed.** Five of your
findings changed the build, two were deliberately not taken, and the reasons are in
`docs/plans/prose-gutter-icons.md` § What the reviews changed. Please push back if the reasons are
bad.

## What was asked for

Greg, 2026-08-31:

> I think we need a very narrow vertical gutter alongside the text. Perhaps update/replace the
> existing one that shows the block-id? And instead of showing the block-id, show a permalink icon
> (with tooltip showing the block-id) — if copied, it should copy the url to that block. Then add a
> small flag or comment icon next to any blocks that have a Comment. Ideally interactive?

## What to read

- `docs/plans/prose-gutter-icons.md` — what was built and why, including the measurements.
- `src/web/BlockGutter.tsx` — **new**, the whole feature.
- `src/web/TableView.tsx` — the new `cmtsByBlock` memo, the `announce` ref and its live region, and
  the JSX that now renders `<BlockGutter>` where a `BlockRef` and a chat button used to be.
- `src/web/comment-nav.ts` — `commentsByBlock`.
- `src/web/BlockRef.tsx` — `blockPermalink`.
- `src/web/styles.css` — `td.text {`, `§ the gutter` (search `.blk-gutter`), the
  `@media (max-width: 731px)` block, and `§ the gutter reveals`.
- `docs/postmortems/block-chat-was-never-in-the-gutter.md`.
- Tests: `tests/block-ref.test.ts`, `tests/comment-nav.test.ts`.

**A scoped diff of everything except the stylesheet** is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/f0fea1f0-4057-4425-a42d-810c84376db7/scratchpad/gutter.diff`.
The stylesheet is excluded from it because **other agents have unrelated in-flight hunks in
`src/web/styles.css`** in this working tree (a mode-exit button, among others) — read the file, and
ignore anything that is not about the gutter.

## What was measured in a real browser

Driven with Playwright against a throwaway preview page (`preview-gutter.html` +
`src/web/preview-gutter.tsx`) that mounts the real `TableView` outside the auth gate. Numbers, so
you can check the reasoning rather than the prose:

- gutter 83px → 34px; prose top offset inside the cell 31px → 6px; one-line paragraph row 58px →
  39px; heading row 58px → 33px.
- Slots are 0.95rem: a two-item stack is 30px, three items 46px.
- **Exactly one row shape overhangs**: a one-line paragraph that is also commented — 16px below its
  row, 7px into the next row's gutter box. `elementsFromPoint` in that band returns nothing
  clickable at rest. Icons end at x=28, prose starts at x=34.
- Six click paths exercised: pointer click copies the absolute URL and the tick follows the promise;
  a rejected `writeText` shows an alert icon, announces, and jumps; a missing `navigator.clipboard`
  does not throw; keyboard activation (`detail === 0`) jumps and does **not** copy; ⌘-click,
  middle-click and shift-click are neither `preventDefault`ed nor copied.
- Comment markers appear on exactly the commented blocks; the orphan (quote edited away) has a
  gutter marker and **zero** `mark.cmt`; clicking the marker on a two-comment block opens the first
  in reading order.
- `matchMedia("(hover: none)")` is `false` in the harness, so the touch rule was verified by reading
  it out of `document.styleSheets` rather than claimed from a screenshot.

## The specific questions

1. **The `detail === 0` split.** A pointer click copies; keyboard activation calls `onJump`. Is
   `event.detail === 0` a sound test for "not a pointer" across browsers and assistive tech? What
   about Space on a link, a screen reader's virtual click, a synthetic `.click()` from other code,
   and a touch tap — does a tap arrive with `detail` 1 or 0? If a tap arrives as 0, a phone reader
   gets a jump where they wanted a copy, which would be the exact failure the plan claims to fix.

2. **The failure path calls `onJump`.** Is jumping on a failed copy right, or surprising? It writes
   `?at=` and pushes history. Is there a sequence — failure while a dialog is open, failure on a
   block already at `?at=` — where this does something bad? Note `navigate()` also does
   `scrollTo({top: 0})`, which is why `onJump` is used instead; check that `onJump` really is the
   in-place jump and really writes the URL.

3. **The live region.** One `role="status" aria-atomic="true"` span per table, written by setting
   `textContent` through a ref from a child's callback. Is writing to a React-owned node's
   `textContent` safe here — can React ever clobber or re-create it? Is the callback stable enough
   that it does not defeat the memoisation around it?

4. **`cmtsByBlock` and the memo boundary.** It is `useMemo(..., [comments, blocks])`, deliberately
   not depending on `openComment`. Is that right, and does anything else in the render path
   re-derive it? Does passing `cmtsByBlock.get(block.id)` — a fresh array identity whenever
   `comments` changes — cause any re-render worth caring about?

5. **The timer.** `settle` is a ref holding one timeout, cleared before each new one and on unmount.
   Any way to leave a stuck icon, or to set state after unmount?

6. **The overhang, now that it is measured.** The plan argues the residual case is harmless because
   nothing clickable is under it at rest and the overhanging control belongs to the row whose icons
   they are. Is that argument complete? Consider: focus order versus visual order when a control
   overhangs; a touch tap in the band, where `pointer-events` is `auto` on everything because
   `(hover: none)` reveals them all; and `tr.row-active` following the *pointer*, set from
   `onMouseEnter` on the `<tr>`.

7. **The stylesheet.** `.blk-gutter > *` styles children by descendant selector rather than by class.
   Is that too broad — does it catch anything it should not, now or the next time a slot is added?
   Are the reveal rules' specificities right, given `.block-chat.has` has to beat
   `tr:hover .blk-permalink` and friends? Is the heading's `bottom`-anchored gutter going to break on
   a heading that wraps to two lines?

8. **Accessibility.** The permalink's accessible name is `Link to this paragraph, spya-…`; the
   comment marker's is `Open your note(s) on this paragraph`. The comment marker's name does not name
   the block. Icon-only controls, opacity-hidden but focusable. Is anything here actually wrong
   rather than merely arguable?

9. **The two recommendations that were not taken** — keeping click-to-copy, and keeping the
   per-block chat button in the gutter. The reasons are in the plan. Are they good reasons? If you
   still disagree, say what specifically breaks.

10. **Do the tests pin the claims, or would a plausible wrong implementation pass them?** The
    grouping test was confirmed red against a grouping that ignores reading order. What is missing —
    and is there anything here that a unit test *could* have caught which was instead checked by
    driving a browser once?

11. **Anything else wrong, dangerous, or over-built.** Including whether the docs are honest, and
    whether the postmortem's root-cause claim ("a CSS comment can assert a layout and nothing checks
    it") is the real one.
