# The gutter goes back to a vertical line, and the "?" admits nearby blocks

**Status:** building, 2026-09-05. Product arbitration from Fable; browser evidence from a Playwright
pass on the box; GPT Sol review of the built code. Follows
[260904b-gutter-help-button-and-detached-streaming-chat.md](260904b-gutter-help-button-and-detached-streaming-chat.md),
which is where the pad came from and which this partly undoes.

Greg, 2026-09-05:

> I asked you to add a question-mark (alongside the permalink and comment button) in the vertical
> gutter next to Text blocks. You have done it, but:
> - They are no longer in a vertical line. The three are arranged in an L-shape. Use browser
>   screenshots to inspect.
> - The prompt for the chat should leave room implicitly for the question/explanation to cover
>   nearby blocks too. Perhaps just "Please explain this and/or nearby blocks" or something like
>   that.

Two jobs, unrelated to each other except that yesterday's work produced both.

## What Greg is looking at, measured rather than guessed

A Playwright pass on the box, signed in as the owner of `/read/fowler-phrenology`, hovering an
ordinary paragraph. Root font size 16px.

| element | x | y | w | h |
|---|---|---|---|---|
| `.blk-permalink` | 251.72 | 476.23 | 24 | 24 |
| `.block-chat` | 275.72 | 476.23 | 24 | 24 |
| `.blk-help` | 275.72 | 500.23 | 24 | 24 |
| `.blk-cmt` | *absent — the block has no comment* | | | |

That is the L, exactly: two across the top, one under the right-hand one. On a block that *does*
have a comment (`/read/writes`, row 11) `.blk-cmt` draws at 251.72 / 472.88 and the four read as a
square. So **the shape a reader sees depends on whether they have made a note**, which nothing in
yesterday's plan noticed and which is on its own a reason the pad was wrong: the gutter's arrangement
is not supposed to be a fact about the article's contents.

Screenshots: `gutterA-tight-3x.png`, `gutterA-fouricon-3x.png` (scratchpad, 2026-09-05).

## The arithmetic, because it is what forces the answer

Tokens, at a 16px root: `--reading-size` 17px, leading 1.6 → **27.2px a line**; `--rhythm` 23.8px;
`--block-pad` 5.95px; `--blk-top` = `--block-pad + 0.2rem` = 9.15px; `--blk-slot` = `max(1.5rem,
24px)` = 24px.

A row's floor is `--blk-top + N × --blk-slot + --block-pad`, and a paragraph's natural height is
`lines × 27.2 + 2 × --block-pad`:

| slots | floor | | lines | natural |
|---|---|---|---|---|
| 1 | 39.10 | | 1 | 39.10 |
| 2 | 63.10 | | 2 | 66.30 |
| 3 | **87.10** | | 3 | 93.50 |
| 4 | 111.10 | | 4 | 120.70 |

**The number that decides everything: a two-line paragraph is 66.3px.** Today's two-slot pad floors
at 63.1, so it stretches one-line paragraphs and leaves everything else alone. A three-slot column
floors at 87.1, which stretches one- *and* two-line paragraphs and every heading. That is the cost of
the vertical line, and it is larger than the cost of the pad was.

## The trade, stated plainly

Greg has asked for two things that fight:

1. **2026-09-04 — 24 × 24px targets, everywhere, desktop included.** An explicit call, made against
   the alternative of fixing touch only.
2. **2026-09-05 — the icons in a vertical line.**

Three WCAG targets in a column are 72px of column against a 39px paragraph. There is no arrangement
that gives both asks and today's rhythm. **What is being traded away is the article's vertical
rhythm**, and it is being traded because Greg has now asked twice for the things that force it and
has never once objected to row height.

Fable's arbitration, 2026-09-05, and it is worth quoting the reasoning:

> He has never once objected to row height — he looked at yesterday's 39→63 and said only "they're
> in an L" — and he has explicitly asked for 24px and for a line. Physics leaves nothing else.

### Rejected, and why

- **Smaller slots (20px → 75.1px floor).** Breaks yesterday's call *and* still stretches two-line
  paragraphs. Most of the height for none of the honesty.
- **WCAG 2.5.8's spacing exception instead of its size clause.** Checked rather than assumed: the
  exception wants a 24px-diameter circle on each target to touch no other target's circle, i.e.
  centres ≥ 24px apart. An 18px pitch fails it; a 24px pitch is the full-size column with smaller
  ink. There is no third way.
- **A hover-triggered overlay that may overhang the row.** Restores the 39px rhythm outright, and
  dies on the device the work was for: with no hover, an iPad would need a tap to open the column and
  a second to press "?", and one press is the whole point.
- **Narrowing the gutter in this change.** The line is one column, so the box *could* be 24px wide
  instead of 48, giving the prose 24px back (`--text-pad-l` 59.2 → 35.2). Deferred deliberately — see
  § Deferred.

## The horizontal geometry does not move

`grid-template-columns: repeat(2, var(--blk-slot))` is **unchanged**, and so is every number derived
from it — `--blk-gutter-w`, `--text-pad-l`, `proseAloneMaxPx`, and the `90vw` caveat § the gutter
records as retired. The second column stops being a second column of buttons and becomes the
bookmark's, which is § The bookmark is beside the line, not in it.

That is a happy consequence of the arrangement rather than a constraint on it. Had the bookmark gone
into the line, the honest first cut would still have kept the box two slots wide — one grid column
the full `--blk-gutter-w`, targets 48 × 24 instead of 24 × 24 — because narrowing it is a separate
question with its own dependants. See § Deferred, which is where that went.

`--blk-gutter-w`'s comment stops saying "the two icon columns" and says what the two are for.

## The help sentence

Today, [`chat-handoff.ts`](../../src/web/chat-handoff.ts):

> I don't get this. What am I missing — here, or somewhere earlier?

**"here, or somewhere earlier" was itself a decision**, made on 2026-09-04 when Greg rejected
*"explain this and surrounding blocks"*: naming a window is the one instruction we know is usually
wrong, because the thing you needed was three sections ago. So the sentence asked for the **gap**
rather than for a radius. Today's ask widens that — *nearby*, in both directions — and must not
re-introduce the radius.

### The false sentence this uncovered

`chat-handoff.ts` says, in the present tense:

> The model is told the rest — that a "?" was pressed, and what to do about it — in the anchor
> addendum rather than here … `src/converse.ts § anchorSection`.

**There is no addendum.** It was stage 4 of 260904b and was never built: `grep` finds no `help` flag
in `routes.ts`, `converse.ts` or `types.ts`, and `anchorSection` has one branch for a quote and one
for a bare block. So `HELP_QUESTION` is not one half of the instruction, it is **the whole of it** —
which is what makes today's wording change load-bearing rather than cosmetic, and is the sentence
that would otherwise have excused not making it.

## Stages

1. **The column.** styles.css § the gutter, `BlockGutter.tsx`, `TableView.tsx`, the row floors, and
   the tests that pin the pad. Each test edited red first.
2. **The sentence.** `chat-handoff.ts`, its test, and the false addendum comment.
3. Docs, GPT Sol on the built code, browser pass, push.

## The bookmark is beside the line, not in it

The arrangement that made three slots enough, and the part Fable was asked to arbitrate a second
time because the first answer had not priced it:

```
bookmark   permalink      column 2 is the line — the three Greg counts
           chat
           "?"
```

Appending the bookmark to the *foot* of the line is the obvious reading of "one vertical line", and
it is wrong twice over. Fable, 2026-09-05, on what a commented one-line paragraph would look like:

> The text sits at y ≈ 6–33 and the bookmark at 81–105 in a 111px row; the next paragraph's first
> line starts at ~117. The mark is 48px from its own words and 12px from the next block's — to the
> eye it marks the *wrong paragraph*. Headings are worse (half a pad below), and headings are what
> people mark. A mark that is beside nothing is not a mark.

And the row would have had to floor at four slots — 111.1px — on any block the reader had noted.

Putting it in `1 / 1` fixes both, and buys a third thing that was not the point but is worth having:
**a comment now costs its row no height at all**, where under the pad it cost 24px. That is why
`TableView` no longer asks about `comments` when it sets `.gutter-pad`.

**The cost, stated so it is a decision rather than a discovery:** on hover, a commented row shows
four icons that are *not* four in a line — the mark stands to the left of the top of the column. The
alternatives were 111px rows or a mark adrift of its text.

### Rejected: folding the chat button into the "?"

Three slots become two, the floor goes back to 63.1px, and there is no conditional anything. Fable
recommended this on 2026-09-04 and again as a fallback today; it lost then on Greg's call to keep
both doors, and it is not an autonomous reversal now. But the facts *have* changed — yesterday the
second door cost nothing in layout, and in a line it costs 24px on every short row — so the re-ask
is legitimate and belongs in front of Greg:

> In a single column the chat button costs 24px on every short row — 87px against 63 — and the "?"
> already opens the existing conversation when there is one; do you still want both doors, or shall
> the "?" be the one?

## Deferred

- **Narrowing the gutter to one slot.** The line is one column, so `--blk-gutter-w` *could* be
  `var(--blk-slot)` and `--text-pad-l` 59.2 → 35.2px, giving the prose 24px back. Not done, and not
  merely unfinished: the bookmark wants a column of its own, and narrowing reopens a caveat § the
  gutter currently records as retired — at 35.2px the condition
  `9 × (--text-pad-l + --text-pad-r + --spine-w) < --reading-measure` is **626 < 742**, so the
  interval where the gutter sits ~6px shy of the text between roughly 680 and 810px of window comes
  back. It also moves `proseAloneMaxPx` (`layout.ts` adds `slot * 2`) and the by-hand numbers in
  `tests/layout.test.ts`. It is a product question — does the prose want 24px back at narrow widths?
  — rather than a loose end here.
- **The addendum, stage 4 of 260904b.** Still not built. `HELP_QUESTION` is the whole prompt; see
  § The false sentence this uncovered.

## Built, and measured

Playwright against real Chrome on the box, signed in as the owner, 16px root.

**The line.** `.blk-permalink`, `.block-chat` and `.blk-help` all at **x = 265.72**, y stepping
456.67 → 480.67 → 504.67 — one 24px slot apart, identical on every row shape sampled.

**The mark beside it.** On a commented block, `.blk-cmt` at x = 241.72 (exactly one slot left) and
y = 427.41, level with `.blk-permalink`.

**Nothing overhangs its row.** Every icon's `bottom` compared with its own `td.text`'s, across 118
rows at two window sizes:

| pass | rows | overhangs |
|---|---|---|
| `fowler-phrenology`, 1280 × 900 | 40 | 0 |
| `writes`, 1280 × 900 (both commented blocks, hovered individually) | 19 | 0 |
| `fowler-phrenology`, 820 × 1180 (iPad portrait) | 40 | 0 |
| `writes`, 820 × 1180 | 19 | 0 |

**Row heights**, and the two-line row is the one that had to be checked rather than reasoned:

| row | measured |
|---|---|
| one-line paragraph, uncommented | 87.09 |
| **genuine two-line paragraph** (five of them: rows 11, 23, 43, 58, 61) | **87.09 — floored, up from 66.3** |
| three-line paragraph | 93.44, its natural height, unfloored |
| heading, mid-document | 93.05 |
| heading, first row of the table | 87.09 — `tr:first-child` resets `--blk-top` |
| commented block, short | **87.09 — identical to the uncommented one-line row** |
| commented block, short, at 820px | 87.09 |

Two of those were caught by disbelieving the first report rather than by reading it. The first pass
called a row "two-line" that renders as three, which would have left *"two-line paragraphs are now
stretched"* — the headline cost of this change — asserted from a number that did not show it;
counting lines with `Range.getClientRects()` found five real two-line rows, all floored. And it
reported a heading at 87.09 when the doubled `--blk-top` says 93.05: that was the article's *first*
heading, which `tbody tr:first-child` resets. Both now measured both ways.

The tightest clearance anywhere is the "?" on a floored heading, and it is exactly one `--block-pad`
— 5.95px at a 16px root, 4.46 at 12, 7.44 at 20. GPT Sol computed that table
([260905b-gutter-review-sol.md](260905b-gutter-review-sol.md) § C) before it was measured, and the
browser agrees to the pixel.

## Status

Built. Reviewed by GPT Sol against the built code — no functional blockers; eleven false or
overclaiming comments, all fixed, and the outcome of each is in
[260905b-gutter-review-sol.md](260905b-gutter-review-sol.md) § What was done with it. Four of those
were **not** introduced by this change, which is worth noting: the `?` had been documented as free
for a day after it started spending, and the stylesheet had been calling the reading face Georgia.
