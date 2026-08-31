# Review: a narrow icon gutter beside the prose (plan stage)

You are reviewing a **plan**, before any code is written. Be adversarial and concrete. For each
finding say what would go wrong, under what input or sequence, and what the fix is. Rank by
severity. Say plainly where something is fine — do not manufacture findings.

The plan is `docs/plans/prose-gutter-icons.md` in this repo. Read it first, then the code it names.

## What Greg asked for

> I think we need a very narrow vertical gutter alongside the text. Perhaps update/replace the
> existing one that shows the block-id? And instead of showing the block-id, show a permalink icon
> (with tooltip showing the block-id) — if copied, it should copy the url to that block. Then add a
> small flag or comment icon next to any blocks that have a Comment. Ideally interactive?

He also asked for other UI ideas from a second model; that model's answer is folded into the plan,
including everything it argued against.

## The code you need to read

- `src/web/TableView.tsx` — the whole file matters for *cost*; the prose cell is ~lines 810–925.
  Note the many comments about re-render and re-annotate cost, and the `marksByBlock` /
  `termMarksByBlock` split.
- `src/web/BlockRef.tsx` — `blockHref`, `shortBlockId`, and the argument for `<a href>`.
- `src/web/styles.css` — `td.text {` (~883), `.block-id` (~912), `.block-ref` (~925),
  `mark.cmt` (~1683), `.block-chat` (~7641), the `@media (max-width: 731px)` block (~8725), and
  `§ the gutter reveals` (~9225).
- `src/web/comment-nav.ts` — `orderComments`, and the warning about ordering by id string.
- `src/types.ts` — `interface Comment` (~1630).
- `docs/project/comments.md`, `docs/project/block-ids.md`, `docs/project/url-state.md`,
  `docs/reusable/silent-success.md`.

## Context that is not obvious from the diff

- There is **one contract**: every block has a stable id and everything addresses text by it, never
  by offset or selector.
- The reading view has **no DOM tests** and will not for a while; a browser is the harness. So a
  claim that can only be checked by looking at a page is a weak claim, and the plan should say how
  each one gets checked.
- The stylesheet has shipped the same accessibility bug twice — an affordance reachable only through
  `:hover`, therefore absent on touch, therefore invisible to a desktop-Chrome harness.
- House rules: a check that has never failed is not evidence; anything that reports success while
  doing nothing is the bug class to hunt; `opacity: 0` rather than `display: none` for anything
  focusable.

## The specific questions

1. **The claim that `.block-chat` is not in the gutter at all.** The plan asserts that because
   `.block-chat` has no `position`, it is an in-flow inline-flex box above the first line of prose,
   adding ~19px of invisible height to every paragraph — and that the stylesheet's comments describe
   something that isn't happening. Read the CSS and the JSX and tell me whether that is right. If it
   is right, what else in that stylesheet is describing a layout it does not produce? If it is
   wrong, what actually positions it?

2. **Promoting the 2.1rem gutter to every width, and deleting the `max-width: 731px` block-id rule.**
   Is anything else depending on `.block-id { display: none }` or on the 5.2rem padding? Consider
   `layout.ts` / `fitView` (does anything compute available prose width from a constant that has to
   agree with this padding?), the pinned-column shadow, `position.ts`, and the search-hit bar drawn
   on the cell's left edge. Name any number in JS that has to move with the CSS.

3. **Left-click-to-copy on an `<a href>`.** Is keeping the anchor and preventing default the right
   shape, or does it break something — middle-click, drag-to-select, a screen reader announcing a
   link that does not navigate, `:visited`? Is there a case where `preventDefault` should not fire?
   Is copying the *absolute* URL right, given `blockHref` returns a path?

4. **The copy feedback.** Promise-gated tick, a distinct failed state, one `aria-live` region for
   the whole table written through a ref rather than state. Is the ref-not-state choice sound in
   React 19, and does a single live region shared by every block announce correctly when two blocks
   are copied in quick succession? Is there a better honest failure than "right-click for the link"?

5. **The comment marker counted from `comments` rather than from `marksByBlock`.** The plan's central
   argument is that this is what makes an orphaned comment visible. Is the grouping cheap enough to
   sit in this component (see the existing memo comments about O(comments × blocks) and DOM parses)?
   What is the right memo boundary so that opening a comment dialog does not invalidate work that
   has nothing to do with it?

6. **Fixed slots vs a packed stack, and the overlap.** Three ~1.05rem slots (~50px) against a
   one-line paragraph row of ~39px. Is "accept the rare overlap" defensible, or is there a cheap
   layout that does not have the problem? Does the overlap create a real hit-testing bug — one row's
   invisible `pointer-events` swallowing clicks meant for the row below — given the plan keeps
   `pointer-events` travelling with opacity?

7. **The tab order claim.** The plan says the change is at parity because the permalink replaces the
   id link and the comment marker only exists on commented blocks. Check that. On an article of 300
   blocks, how many focusable elements are there before and after?

8. **`title` instead of the `Tooltip` component.** The plan rejects Floating UI here on
   per-instance cost. Is that the right call, or is it under-serving the explicit ask for a tooltip
   showing the block id? Is there a middle path that is not one instance per block?

9. **Anything the plan is missing, over-building, or getting wrong.** Including: is the
   "gutter is the reader's column" rule actually a good rule; is `Bookmark` the right glyph when
   Greg said "flag or comment"; should the permalink carry the whole view state; and is there a
   simpler design that satisfies the brief with fewer moving parts.

10. **What would you cut?** The instruction in this repo is that two good affordances beat six. If
    something here should not ship, say which and why.
