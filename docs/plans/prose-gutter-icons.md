# A narrow icon gutter beside the prose

**Status:** built 2026-08-31.

Greg, 2026-08-31:

> I think we need a very narrow vertical gutter alongside the text. Perhaps update/replace the
> existing one that shows the block-id? And instead of showing the block-id, show a permalink icon
> (with tooltip showing the block-id) — if copied, it should copy the url to that block. Then add a
> small flag or comment icon next to any blocks that have a Comment. Ideally interactive?

Plus: *"Get input from Fable to help think of other UI additions that might be helpful to the
reader."* Fable's answer is folded in below, including everything it argued **against** — see
§ What the gutter is for, and § Rejected. GPT Sol reviewed the plan before it was built and the code
after; both reviews are beside this file, and § What the reviews changed says what moved.

## What was there before

`td.text` reserved `padding-left: 5.2rem` (83px) for a block id shown only on hover, and a chat
button that **was not in the gutter at all** — it had no `position`, so it was an in-flow box above
the first line of prose, costing 21px of height on every block in the article. That is its own
write-up: [block-chat-was-never-in-the-gutter.md](../postmortems/block-chat-was-never-in-the-gutter.md).
Below 732px the id was hidden outright and the gutter shrank to 2.1rem.

## What the gutter is for

One governing idea, or a gutter becomes a dashboard. Fable's, and it is the right one:

> **the gutter is the reader's column — your marks on this text, and the address of it.**
> Everything machine-generated stays out.

And one grammar that keeps it quiet:

> **at rest the gutter shows *state*; on hover it shows *affordances*.**

On an article you have never marked, the gutter is **empty** all the way down until the pointer
lands on a row.

## What was built

[`BlockGutter.tsx`](../../src/web/BlockGutter.tsx), one per prose cell, `position: absolute` — so
*being in the gutter* is a fact about the DOM rather than a claim in a comment. Three fixed slots:

```
  1   permalink      every block, on hover
  2   comment mark   only when this block has comments
  3   chat           every block on hover; always when the block has chats
```

Fixed rather than packed, so nothing moves when hover adds the permalink above a comment marker that
was already there.

### One gutter, 2.1rem, at every width

The narrow-window gutter was promoted to the design: `5.2rem → 2.1rem`, and the two declarations
inside `@media (max-width: 731px)` that hid `.block-id` and re-did the left padding are gone. **The
query itself stays** — it also owns the wordmark and the two scrolling bars, and its value is tied
to `GIST_MIN + PROSE_MIN + SPINE_W`, which `tests/spine-width.test.ts` pins.

Measured on the same fixture, before and after:

| | before | after |
|---|---|---|
| gutter | 83px | 34px |
| prose starts | 83px in | 34px in |
| prose top offset inside the cell | 31px | 6px |
| a one-line paragraph row | 58px | 39px |
| a heading row | 58px | 33px |

The width claim needs stating honestly: on a **narrow** window this widens the prose. On a wide one
the prose is already capped at its measure, so it mostly moves the column left. The 21px of height
per block is the unambiguous gain, and it is the bug's, not the design's.

**Nothing in JavaScript had to move.** `fitView` sizes the whole prose cell from `PROSE_MIN` and
never subtracts this padding; `position.ts` measures geometry live; the search-hit bar is painted at
the cell's own `x=0`. Checked because a CSS number that a constant has to agree with is exactly the
kind of thing that goes stale silently.

### The permalink

A real `<a href={blockHref(id)}>` carrying a `Link2`, with the full block id in `title` and in
`aria-label`. What activates it decides what it does:

| | what happens | why |
|---|---|---|
| plain pointer click | copies the **absolute** URL | the convention Greg asked for |
| Enter / screen-reader activate (no `pointerType`) | `onJump` — goes to the block | it announces itself as a link, so activating it must do what a link does |
| ⌘/ctrl/shift/alt click, middle click | left to the browser | new tab, new window, and the reason it is an `<a>` |
| copy rejected, or no `clipboard` at all | alert icon and an announcement, **and nothing else** | see below |

`onJump` rather than the browser's own navigation, and that is not pedantry: **this app intercepts
no anchor clicks globally**, so an unprevented click would *reload the reading view* — re-fetching
the whole article to arrive at the paragraph already under the cursor.

**`pointerType` first, `detail` as the fallback.** `detail === 0` is the classic keyboard-click test
and is nearly right — Enter gives 0, a mouse gives 1, and a touch tap gives 1, which puts a phone on
the copying side where it belongs. But assistive technology that emulates a mouse can produce a
`detail` of 1 for something that was never a pointer, and `pointerType` is empty on those. Sol's
refinement. Verified with **trusted** events: a real click arrives `detail: 1`, a real Enter `0`.

The tick waits for the promise. An optimistic one is a copy that reports success while the clipboard
holds what it held before — [silent-success.md](../reusable/silent-success.md).

**A failed copy says so and does nothing else.** It used to jump, on the reasoning that
`preventDefault` has already run so the cancelled navigation has to be performed by hand. Sol's
counter-example killed it: a rejection can arrive *seconds* later, after the reader has opened a
dialog or moved down the page, and a scroll and a history entry then arrive out of nowhere. A failed
copy is a failed copy; the link's own context menu is still there on desktop, and a long press is on
a phone.

**A clipboard promise can also settle late or out of order.** Every press takes a token; a
continuation whose token is stale, or whose component has gone, is dropped. Without it, pressing
twice and having the *older* write reject last replaced the newer tick with an error.

Feedback for a screen reader is **one** `role="status"` region for the whole table, written through
a ref: state here re-renders the table, and a copy confirmation has no business re-annotating an
article's worth of prose. It is **cleared and then rewritten a tick later**, because writing the same
string twice is not a DOM mutation — so copying the same block twice announced once and then went
silent, which reads as *it did not work* to the one reader who cannot see the tick.

**A permalink carries the whole view** — `?cols=`, the open mode, the open dialog — because
`blockHref` does, deliberately ([url-state.md](../project/url-state.md)). Read it as *link to this
block in the current view* rather than as a canonical clean address.

### The comment marker

A `Bookmark` in `--highlight`, the colour `mark.cmt` already paints the passage with, so the gutter
and the words underline the same fact. Always visible — it is state, not an affordance — with a
count when there is more than one. Clicking opens the block's **first comment in reading order**
through `onOpenComment`, which is the `?note=` machinery that already exists, and the dialog's own
prev/next already handles a block with several.

`Bookmark` rather than the flag or bubble Greg offered, because
[comments.md](../project/comments.md) is explicit that a comment *is* a bookmark, and because a
second message-square beside the chat button would read as a second chat.

**Counted from `comments` by `blockId` alone, never from the resolved marks**, and that is the whole
argument for the feature: `resolveMark` returns null when the article was re-extracted past the
quoted words, so an orphaned comment draws no underline and is today invisible in the article. Keyed
on the permanent id spine, the marker still shows. Verified: the fixture's orphan renders a gutter
marker and zero `mark.cmt`.

One narrowing, from Sol: this recovers a comment whose **block still exists**. A comment whose block
is gone has no row to sit beside; `orderComments` keeps it in the dialog list and that is where it
stays.

## The overhang, and how it was actually fixed <a id="the-overhang"></a>

Sol's headline finding, twice: three ~24px targets do not fit a ~39px row, and an overhanging
control is an input bug rather than a cosmetic one. The first answer to it was wrong and the review
of the built code said so.

**What was tried first, and why it was not enough.** Slots went to 0.95rem, headings hung their
gutter from the bottom into the three pads of empty space a heading already has above it, and the
one remaining shape — a commented one-line paragraph — was argued to be harmless because
`elementsFromPoint` found nothing clickable in the band at rest.

That argument had two holes, both Sol's:

- **"At rest" was doing all the work.** The overhanging control is the chat button, and it is
  pointer-active whenever `.block-chat.has` matches, and on **every** touch device, where
  `(hover: none)` reveals the whole gutter. The browser check had covered the one case where it is
  hidden.
- **A commented heading was a second shape the fixture did not have.** Bottom-anchoring cannot make
  a 46px stack fit a 33px row; it only chooses which end escapes. A commented heading would have
  grown *upward* into the row above, and a commented first heading into the table head.

**So the overhang was removed rather than reasoned about.** A row that draws all three slots is
floored at the height of three slots — `td.text.has-marks`, set from `cmtsByBlock` in
[TableView.tsx](../../src/web/TableView.tsx). `height` on a `<td>` is a minimum, so every taller row
is untouched, and two slots (30px) already fit a one-line paragraph (39px), so **nothing without a
comment moves**. Measured after: **no gutter control leaves its own row, in any shape** — checked by
comparing every child's box against its row's, not by looking.

**And the browser found the part that mattered most, which was not the icons at all.** Playwright
refused to click a permalink: *"`<div class="blk-gutter">` intercepts pointer events"*. The container
was an `auto` hit-test surface the full height of the stack, swallowing hits aimed at its own hidden
children. One declaration — `pointer-events: none`, with every child opting back in — and it caught a
second bug on the way: `.blk-cmt` is the one slot with no reveal rule to hand `pointer-events` back,
because it is always visible. **It would have shipped un-clickable.**

### The one thing not fixed: target size

The targets are **22 × 15px**. WCAG 2.5.8 asks for 24 × 24, and the spacing exception does not apply
because they are 15px apart. Sol is right, and it is not fixed, because **no vertical arrangement of
two or more 24px targets fits a 39px one-line paragraph row** — relocating the chat button does not
rescue it either. Meeting it means taller rows, which is a change to the article's vertical rhythm.
That is Greg's call, and it is § Open for Greg below. What was done: each slot now fills the gutter's
width, which took the target from the SVG's own 12px to 22px, and corrected a comment on `td.text`
that claimed the gutter width *was* the target when nothing made it so.

For scale: the affordance this replaced was smaller — a 12px glyph with 0.1rem of padding.

## Rejected

Fable was asked for other candidates and argued most of them down. Recorded because the next person
to look at a mostly-empty gutter will have the same ideas.

| candidate | why not |
|---|---|
| search hits | already the left-edge bar, which is the *right* form — hue and extent need a bar, an icon is a worse duplicate |
| glossary terms | underlined inline already, and they are in nearly every block, so the gutter becomes a solid column |
| footnotes | the superscript in the prose is the marker; that is what superscripts are |
| `gistable` / `block.kind` | `td.text.opaque` and the typography already say it, and it is pipeline internals |
| reading position | the spine's whole job. A second you-are-here is the two-trees mistake in miniature |
| a hover card on the comment marker | a second renderer of what `CommentDialog` already renders, free to drift from it, over a body that can be long |

**Ideas is the near miss.** A marker on blocks an idea rests on is a genuine door — but only while
ideas mode is open, so it would have to be mode-scoped, painted the way search paints the spine.

**Reading progress** — "blocks you've passed",
[granularity-zoom.md](../project/granularity-zoom.md) — is the one future resident that fits the
grammar, because it is the reader's own trace rather than generated content. Not built, so not a
slot.

## What the reviews changed

Sol's plan review is [prose-gutter-icons-review-sol.md](prose-gutter-icons-review-sol.md). Five
findings changed the build:

1. **The overhang** — measured, and fixed twice, above.
2. **A link whose ordinary activation copies is semantically dishonest.** Right, and the fix is the
   `detail === 0` split rather than dropping the copy: the role and the behaviour now agree for
   every reader who cannot see which they got.
3. **The tab-order parity claim was false.** It was. The real numbers, for a 300-block article with
   `C` commented blocks: desktop **600 → 600 + C**; narrow **300 → 600 + C**, because the narrow
   query used to hide the id link entirely. The mobile doubling is the price of the permalink being
   reachable on a device with no right-click, and it is a decision rather than an oversight —
   § Open for Greg.
4. **`(hover: none)` cannot be verified in a desktop harness**, so claiming it from a screenshot
   would be worthless. The rule is checked by reading it out of `document.styleSheets` instead, and
   `matchMedia("(hover: none)").matches` is asserted `false` so the claim is not overstated. Touch
   is **unverified on a real device.**
5. **Stale comments elsewhere.** `§ the gutter reveals`, the `.block-chat` warning, the JSX comment
   and the comments section's *"no column, no gutter"* were all describing something untrue or about
   to be. All four rewritten.

Two of Sol's recommendations were **not** taken:

- **"Cut custom left-click copying."** Greg asked for a permalink icon that copies; a click-to-copy
  permalink is the near-universal convention, and relying on right-click → *copy link address*
  leaves a touch reader with no way to do it at all. The honest objections behind the finding — the
  semantics, the failure path — are fixed above.
- **"Cut or relocate the per-block chat button."** It is an existing feature Greg asked for
  (2026-08-26) and removing it is not this piece of work. The overhang it was cited for is measured
  above and is one row shape with nothing clickable under it.

Sol also corrected a claim in the first draft: 2.1rem does not need to clear the pinned column's
shadow — only `.pin-left` is pinned, and it is on the other side of the prose. The width is the hit
target and nothing else.

### The review of the built code

[prose-gutter-icons-code-review-sol.md](prose-gutter-icons-code-review-sol.md), and it opened with
*"the gutter should not ship unchanged"*, which was right. Nine findings; eight are fixed above and
one is § Open for Greg:

| | finding | what happened |
|---|---|---|
| 1 | targets are 12 × 15px, not the gutter's width | slots now fill the gutter → 22 × 15. **Still short of WCAG's 24 × 24** → Greg |
| 2 | the overhang is live wherever the chat button is | row floored so nothing overhangs at all |
| 3 | a commented heading is a second, unmeasured shape | same floor; the fixture grew the shape |
| 4 | a late clipboard rejection navigates the reader | failure no longer jumps |
| 5 | no protection against stale promises or unmount | operation token + mounted ref |
| 6 | the tests do not exercise the feature | sixteen component tests, each confirmed red |
| 7 | copying the same block twice is silent to a screen reader | live region cleared before rewriting |
| 8 | `.blk-permalink.failed` loses on specificity | `tr:hover .blk-permalink.failed` added |
| 9 | several stale documentation claims | four fixed, including this file and the postmortem |

Two of its judgements were checked and stand as they were. **`detail === 0` was called "too strong"
as a test** — it is, so `pointerType` is read first with `detail` behind it. And on
*"keeping chat as a third vertical gutter control is not reasonable"*: the argument was target size
and overlap, and the overlap is now gone by construction; the target-size half is real and is the
open question, but it is not solved by moving the chat button, because two compliant targets do not
fit either.

The postmortem's root cause was **wrong and is rewritten**. A CSS comment cannot move an element;
the cause was a missing `position`, and the comments are why it survived rather than why it happened.

## How it was checked

There are no DOM tests for the reading view ([browser-testing.md](../project/browser-testing.md)),
and Claude-in-Chrome was not connected, so:

- **A throwaway preview page** — `preview-gutter.html` + `src/web/preview-gutter.tsx` — mounting the
  real `TableView` with a fixture article outside the auth gate, exactly as `preview-sketch.tsx`
  did. Every article in the local database is `private`, so there was no signed-in reading view to
  photograph. The blocks are the hard cases and nothing else: a heading, a one-line paragraph, a
  block with two comments, a block with a comment *and* chats, an **orphaned** comment, and a
  one-line paragraph that is also commented — which is the only row shape that overhangs. Driven
  with the Playwright MCP. Deleted afterwards, like its predecessor.
- **Six click paths exercised in the browser**, each with an observable result: copy writes the
  absolute URL and the tick follows the promise; a rejection shows the alert icon, announces, and
  jumps; a missing `navigator.clipboard` does not throw; keyboard activation jumps and does *not*
  copy; ⌘-click, middle-click and shift-click are neither prevented nor copied.
- **And then the two that matter re-run with `isTrusted` events**, because a synthetic
  `dispatchEvent` is the thing being tested here, not a stand-in for it. A real mouse click arrives
  `isTrusted: true, detail: 1` and copies without navigating; a real Enter on the focused link
  arrives `isTrusted: true, detail: 0`, does not copy, jumps to `?at=`, and **does not reload the
  page** — checked by a global that survives. A trusted click on the comment marker opens the first
  comment on the block without the row being hovered first.
- **`elementsFromPoint`** in the overhang band, rather than an argument about it.
- **Unit tests** for the two pure pieces: `blockPermalink` (tests/block-ref.test.ts) and
  `commentsByBlock` (tests/comment-nav.test.ts), the latter confirmed red against a grouping that
  ignores reading order.
- **Component tests for the gutter itself** — `tests/block-gutter.test.tsx`, sixteen of them — added
  because Sol pointed out the two pure tests do not touch the feature: *"an implementation that
  always copied, copied on modified clicks, opened the last comment, used an optimistic tick, threw
  without Clipboard API support, or rendered no live region would pass."* Every one of those is now
  a test, **and every one was confirmed red against exactly that wrong implementation** — five
  mutations, five single failures, green when restored.

  What is deliberately *not* in them is geometry. jsdom computes no layout and would answer those
  questions with plausible zeroes, which is worse than not asking.

## Open for Greg

1. **Target size, and it is the real one.** The gutter's targets are 22 × 15px where WCAG 2.5.8 asks
   for 24 × 24. Meeting it needs taller rows — no arrangement of two or more compliant targets fits
   a 39px one-line paragraph — so it is a trade against the article's vertical rhythm and yours to
   make. Doing nothing keeps a shortfall the app already had; the chat button was smaller than this.
2. **A retained browser fixture.** Sol's view is that geometry, target sizes, hit testing and the
   touch rules "belong in a retained browser fixture rather than a deleted one-off preview", and
   this repo has no such thing. The preview page was deleted per the convention `preview-sketch.tsx`
   set. Two real bugs were found with it in one afternoon, which is an argument for keeping the
   practice — but an un-run fixture rots, so it needs a home and a command, not just a file.
3. **The tab cost on a phone.** A narrow window now has two focusable elements per block where it
   had one, because the permalink is reachable where the id link was hidden. Worth it, I think — no
   right-click on a phone — but it is your call.
4. **Slot order.** Permalink on top, matching where the id was. The alternative is state markers on
   top, level with the first line, with the hover-only permalink beneath. One line to change.
5. **Left-click no longer jumps.** Jumping to the paragraph you are already hovering was close to a
   no-op, so the slot was spent on copying instead. `BlockRef` still jumps everywhere else.
6. **The block id is now only in a `title`, an `aria-label` and the copied URL** — never visible
   text. That is the point of the change and also a real reduction when quoting a paragraph to an
   agent.
7. **Touch is unverified.** The rules are written and read back out of the stylesheet; no real
   device or touch-emulated context has run this. The specific thing to check on a phone is that a
   tap arrives as `detail: 1` and therefore **copies** rather than jumping — on the desktop harness
   only a mouse and a keyboard could be produced, and the split between them is what a tap has to
   land on the right side of.
