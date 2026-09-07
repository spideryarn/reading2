# The chat button was never in the gutter

**Found 2026-08-31**, by measuring the reading view in a browser rather than reading the stylesheet.
The per-paragraph chat button — the door into chat beside every block — was not beside anything. It
sat **above the first line of prose, at the prose's own left edge**, and it had cost **21px of
height on every block in the article** since it was written on 2026-08-26.

Nobody saw it because the button is `opacity: 0` until you hover the row, and 21px of empty space
above a paragraph reads as paragraph spacing.

## What the code said, and what it did

```css
.block-chat {
  display: inline-flex;      /* and no `position` */
  margin-top: 0.15rem;
  opacity: 0;
}
```

`.block-id` beside it *was* `position: absolute`. `.block-chat` never was. It is rendered before the
`.prose` div inside `td.text`, so it is an in-flow inline-flex box that opens an anonymous line at
the top of the cell — inside the cell's 5.2rem left padding, which means at the prose's left edge,
not in the gutter that padding reserves.

Measured on the real component, at a 900px reading width:

| | x | y (from the cell's top) |
|---|---|---|
| `.block-id` | 433 | 18 |
| `.block-chat` | **501** | **9** |
| `.prose` | **501** | **31** |

The button shares an x with the prose and sits 22px above it. The block id it was supposed to be
under is 68px to its left and *below* it.

## The comments were worse than the code

Three separate places described a layout that was not happening, and each was written by somebody
reasoning from the others:

- `styles/gutter.css`, on `.block-chat`: *"`pointer-events` has to go with the opacity, or **the gutter**
  grows an invisible target that eats clicks meant for **the block id above it**"* — the id is below
  it, and neither is in the gutter.
- `styles/narrow-window.css`, § the gutter reveals: *"it joins the chat button that **already lives in the same
  gutter** and already worked this way"* — this is the sentence that made the error load-bearing,
  because the block-id reveal was then designed to match a button that was somewhere else.
- `TableView.tsx`: *"A door into chat **beside** every paragraph … perhaps **underneath the
  block-id**"* — quoting Greg's brief as though it were a description of the result.

## The root cause, and the three things that let it stand

**The cause is a missing `position`**, and it is worth saying that plainly before anything else — an
earlier draft of this file named the comments as the root cause, and GPT Sol was right that a comment
cannot move an element. The button was written to sit in a gutter and was never given the one
declaration that would put it there, nor a container that would have made the question unaskable.

What is interesting is not the cause but why it survived five days, and that is three things
compounding:

1. **`opacity: 0` still takes its space**, so a positioning bug in a hidden element is invisible by
   construction. The stylesheet chose `opacity` over `display: none` for a good reason — a hidden
   element is not focusable — and the cost of that choice is that a mislaid invisible element looks
   exactly like a correctly-laid one.
2. **Nothing in this repo covers geometry.** Every other claim that matters has a test or a type
   behind it; *where is this element* had neither, and the reading view has no DOM tests at all
   (testing.md), so a browser is the only instrument and nobody had reason to point it here.
3. **The comments then reinforced the mistake rather than catching it.** Three of them described the
   layout, each written by somebody reasoning from the others, and the block-id reveal was designed
   to match a button that was somewhere else. A comment that asserts computed geometry is a
   measurement written down as prose, and it rots without anything going red.

The commit that introduced it is the one that added the button (2026-08-26). It was never right; it
was only ever unnoticeable.

## What would have caught it

Not review, and not a screenshot — the button is invisible in both. Three things would have:

1. **Measuring the thing the comment claims.** `getBoundingClientRect()` on `.block-chat` and
   `.prose` at any point in the last five days. This is what actually found it, on the first look.
2. **Noticing the height.** Prose started 31px into a cell whose top padding is 6px. That number was
   on screen the whole time and nobody had a reason to read it.
3. **A rule of thumb the stylesheet can adopt**: when you write a comment placing an element
   relative to another, the comment is a measurement, so take the measurement. Where two elements
   are supposed to be in one container, put them in one container — which is what the fix does.

## The fix

Both affordances now live in a real `<div class="blk-gutter">` that is itself `position: absolute`
([`BlockGutter.tsx`](../../src/web/BlockGutter.tsx)). Its position is still a CSS fact rather than a
DOM one — Sol's correction, and a fair one — but it is now **one** CSS fact governing both icons
instead of two that could disagree, so a mistake in it is wrong for all of them at once and
therefore visible. The three stale comments are gone.

The 21px came back to every block: a one-line paragraph row went 58px → 39px, and a heading row
58px → 33px, on the same fixture. The whole gutter went 83px → 34px at the same time
([prose-gutter-icons.md](../plans/prose-gutter-icons.md)), but that was a decision; this was a bug.

## The class

Anything invisible-but-present is a place where a layout bug cannot be seen. The repo already has a
name for the shape — [silent-success.md](../reusable/silent-success.md) — and this is its geometric
cousin: not a check that passes while doing nothing, but a *claim about layout* that nothing can
falsify. Worth a look wherever `opacity: 0` and `position` appear near each other.

**And the replacement produced two more of the same family within the hour**, which is the strongest
evidence that measuring is the instrument here rather than reading:

- The new gutter container was an `auto` hit-test surface swallowing clicks aimed at its own hidden
  children. Found because Playwright refused to click one — *"`<div class="blk-gutter">` intercepts
  pointer events"*. It has no handler, so it swallowed silently.
- One declaration later, the comment marker — the one slot with no reveal rule to hand
  `pointer-events` back — **would have shipped un-clickable**.

Neither is visible in a screenshot and neither would fail a unit test. The lesson is narrow and
usable: *when a comment places an element, take the measurement it is claiming.*
