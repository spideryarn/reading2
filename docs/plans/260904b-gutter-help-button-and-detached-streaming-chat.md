# A "?" in the gutter: one click for "I don't understand this"

**Status:** planning, 2026-09-04. Reviewed by GPT Sol before building —
[260904b-gutter-help-button-review-sol.md](260904b-gutter-help-button-review-sol.md), and § What the
review changed says what moved. Not built.

Greg, 2026-09-04:

> In the vertical gutter next to each block, we have two little icons, a permalink one and a comment
> button. That's great. Can we just move them apart vertically slightly? Add a slightly bigger
> vertical gap between them because they're quite hard to click on on an iPad, and also add a
> question mark underneath the comment one, a question mark button, which basically just creates a
> comment with a word like, explain this and surrounding blocks and sends it to the LLM as a message
> to make it really easy for me to be like, hey, I don't understand. Tell me more. Maybe it would
> have an option to check the web, or maybe the LLM can decide whether it'd be valuable too. The key
> thing is, even though it's a question mark for a specific block, often the confusion is wider in
> scope than just that block, so the LLM is going to have to use its judgment on that. And the point
> is to make this easy for the user to be like, hey, I need help here. So it's one click. And in an
> ideal world, this would work in such a way that I can click I need help here, and keep scrolling
> around and reading while the LLM is generating its response, and ideally that response should
> stream.

Two jobs in one ask: **the gutter's hit targets**, and **a one-click "I need help here"**.

Product judgment from Fable, technical map from two repo trawls, plan review from GPT Sol.

## Greg's calls, 2026-09-04

Asked before anything was built, because each changes what gets made.

| | asked | chosen |
|---|---|---|
| 1 | Fable argued the "?" should **replace** the chat button — one door, no fourth slot, no row-height change | **A fourth slot, as originally asked.** Both doors stay |
| 2 | Fix the targets on touch only, or everywhere | **Bigger targets everywhere, desktop included** — closing the WCAG shortfall open since 2026-08-31 |
| 3 | One click means an accidental tap spends a model call | **Accepted.** One click is the point |

Fable's case for replacing is in § Rejected. It is a good argument and it lost on Greg's preference
for keeping the free-text door, which is the right kind of reason.

## The decision the review forced: **no new `ThreadKind`** <a id="no-new-kind"></a>

The first draft made a help conversation a fourth `ThreadKind`, for countability and to let the
prompt branch. Sol found two blockers in that alone, and chasing them down showed the idea was not
just expensive but **wrong**.

- The route admits an anchor **only** for `kind === "chat"` ([`routes.ts:2270`](../../src/routes.ts)),
  and says why in a comment written for exactly this moment: *"Written as `!== "chat"` rather than as
  a list of the other kinds, so that a fourth kind is anchor-less by default and **has to argue its
  way in**."*
- Postgres agrees: `check("chat_threads_kind", sql`…in ('chat','remember','candidates')`)`
  ([`schema.ts:2908`](../../src/db/schema.ts)).
- And the reason behind both is an invariant the reading view leans on — *"an unanchored thread of
  another kind draws no mark in the prose, which is what lets the reading view go on treating every
  mark it draws as a chat."* `App.tsx:1906` opens the overlay only for `kind === "chat"`.

A help conversation **is an anchored chat**. So it stays `kind: "chat"`, and the two things that
genuinely need to know it began as a help press are carried where they belong:

| what needs to know | how | why there |
|---|---|---|
| the prompt, for the first answer only | a **per-turn, non-persisted `help: true`** on the POST body, selecting the addendum in `anchorSection` | the addendum shapes the first answer; later turns are ordinary follow-ups. No migration, no export change, no validator list |
| the panel, for close-not-cancel and auto-send | a **client-side `ChatTarget` discriminant** | Sol recommended this independently: the stored thread may not be loaded yet during "Starting…", so `thread?.kind` would be undefined exactly when it is needed |

This deletes Sol's blockers 1 and 3 outright, and finding 12's `systemFor` branch with them — the
system bytes stay identical by construction rather than by a test. **Countability is what is
given up**; nobody asked for it, and a `help: true` in the request log is still countable server-side
if it turns out to matter.

## What is already true

Read out of this worktree's code, not inferred.

### The gutter today

[`BlockGutter.tsx`](../../src/web/BlockGutter.tsx), three fixed slots, `position: absolute`, and its
header carries the governing rule:

> **the gutter is the reader's column — your marks on this text, and the address of it.**
> Everything machine-generated stays out.

and the grammar that keeps it quiet:

> **at rest the gutter shows *state*; on hover it shows *affordances*.**

```
  1   permalink      every block, on hover                       .blk-permalink
  2   comment mark   only when this block has comments           .blk-cmt
  3   chat           on hover; always when the block has chats   .block-chat
```

**A visitor gets the permalink and nothing else.** `onChatAbout` is optional and *the callback is
the capability*. The "?" inherits this exactly: `onHelp?: ((id: BlockId) => void) | undefined`,
spelled with `| undefined` because `exactOptionalPropertyTypes` is on. No boolean prop, no
`disabled`, no dimming.

`.blk-gutter` is `pointer-events: none` and **every child opts back in individually**. Not
decoration: `.blk-cmt` is the one slot with no hover rule to hand pointer-events back, and it would
have shipped un-clickable without its own declaration.

### The measurements that constrain stage 1

| | |
|---|---|
| one slot, `--blk-slot` | `0.95rem` (~15px), set on `td.text` |
| target size | **22 × 15px** — WCAG 2.5.8 asks 24 × 24 |
| a one-line paragraph row | 39px |
| a heading row | 33px |
| gutter width / `--text-pad-l` | `1.4rem` / `2.1rem`, and the width *is* the hit target |
| the gutter's top offset | ~9.15px — one `--block-pad` plus `0.2rem` |

Slots are **fixed, not packed**, so the stack occupies its height whether or not anything is drawn.
`td.text.has-marks` floors a commented row at three slots so nothing overhangs, and *only* commented
rows, so the rest of the article's rhythm does not move.

**Greg's iPad complaint is prose-gutter-icons.md § Open for Greg, item 1, coming back**, which
recorded the constraint verbatim: *"no vertical arrangement of two or more 24px targets fits a 39px
one-line paragraph row."* Call 2 is that call being made.

### The arithmetic that forces the layout <a id="the-arithmetic"></a>

Four 24px targets stacked vertically come to ~100px against a 39px row. Flooring every row at that
would nearly triple the article's height. **So the gutter stops being a column and becomes a 2 × 2
pad.** Sol checked the horizontal arithmetic and it holds:

```
        permalink   chat          --text-pad-l  3.7rem = 59.2px
        bookmark    ?             .blk-gutter   3rem   = 48px
                                  two 24px columns fit, ~5.6px each side
```

| | now | proposed |
|---|---|---|
| target | 22 × 15 | **24 × 24** ✓ WCAG 2.5.8 |
| gutter width / `--text-pad-l` | 1.4rem / 2.1rem | 3rem / 3.7rem |
| stack height | 45px (3 fixed slots) | 48px (2 × 24px, **no explicit row gap**) |
| one-line paragraph row | 39px | to be measured — expect ~65px |
| heading row | 33px | to be measured |
| multi-line paragraph | unchanged | **unchanged** — already taller |

**No row gap between the two rows of the pad**, which is Sol's correction and is better than what
the first draft proposed: going from a 15px to a 24px box already adds most of the visible
separation Greg asked for, and a 4px gap on top pushed the floor from ~56px to ~67px for nothing.
The exact floor is **measured in a browser in stage 1, not calculated here** — the first draft's
56px was wrong because it forgot the ~9.15px top offset.

Three costs, named rather than discovered:

- **The prose starts 1.6rem further in — to the *right* within its cell**, not left; the first draft
  had this backwards. The search-hit bar stays at the cell's own `x=0` and so drifts further from
  the words, which is a look to check rather than a break.
- **`PROSE_ALONE_MAX_REM` must rise by 1.6rem** ([`layout.ts:88`](../../src/web/layout.ts)) or a lone
  prose column silently loses that much measure — the constant is documented as *"`--reading-measure`
  plus the text cell's own `--text-pad-l` and `--text-pad-r`"*, so it is a fact about this padding
  and goes stale the moment the padding moves.
- **`PROSE_MIN` stays**, which deliberately takes 25.6px off the text at narrow and multi-column
  widths. Consistent with call 2, and stated so it is a decision rather than a side effect.

**`tests/spine-width.test.ts` is not a gate on this.** The 731px query is `GIST_MIN + PROSE_MIN +
SPINE_W` and does not read `--text-pad-l`; the first draft claimed it as protection it does not
give. Sol ran it and it passes either way.

### The chat machinery the "?" uses

- **The gutter's chat button does not start a turn.** `chatAboutBlock` ([`App.tsx:2411`](../../src/web/App.tsx))
  sets a *draft*; nothing is written or spent until the reader types and presses Ask. The dialog says
  so literally: *"Nothing is asked until you send."*
- **The whole article is in every turn already.** `buildConverseMessages`
  ([`converse.ts:1016`](../../src/converse.ts)) puts the full article in one cached user message and
  re-sends `anchorSection` below the cache breakpoint every turn. **So "and surrounding blocks" needs
  no neighbour window and no tool** — only an instruction.
- **Web search is already on, every round, model's choice.** `webSearchTool(kind)` at
  `converse.ts:244` gives `openrouter:web_search`, and the system prompt already says to use it
  unless genuinely sure. **Greg's "maybe the LLM can decide" is the current behaviour — zero work,
  no tick-box**, and it matches comments.md § *Decision: the model decides whether to search*:
  > "Only when the model asks for it, but encourage the model to ask for it unless it's very sure"

  Sol confirmed `webSearchTool` branches only for `candidates`, so help gets chat's tool array
  unchanged and no cache tier is invalidated.
- **A turn survives the panel closing.** `routes.ts:2130`: *"A reader who leaves does not cancel the
  answer. The model call runs to completion and the answer is stored."* Partial text is persisted,
  `sweepPending` heals abandoned rows, and the client's recovery scan adopts a `pending` row with no
  writer. `controller.detach()` clears callbacks only, pinned by `tests/chat-unmounted-turn.test.ts`.

  Sol's narrowing, which the plan now states: **the guarantee starts once the server has accepted the
  request and written the pending row.** A failure before that leaves only optimistic client state,
  and "walk away" does not hold. Also: **pressing "?" on several blocks spends on all of them, in
  parallel.** There is no per-user concurrency cap and this plan does not add one — call 3 accepted
  the spend.

### Two traps

**1. The X button destroys the answer.** On a new thread's first answer `ChatDialog` classifies the
state as `firstAnswer`, and the header X calls `cancelAndDiscard` + `onDropped` + `onClose`
([`ChatDialog.tsx:229`](../../src/web/ChatDialog.tsx)) — the server aborts and **deletes the thread**.
Every "?" press makes a new thread, so a reader who taps X to get back to reading destroys the answer
they just bought, and nothing says so. [silent-success.md](../reusable/silent-success.md) shaped: the
button works, and what it does is the opposite of the feature.

Sol's correction: **two controls must change, not one.** The footer Stop is currently *hidden* during
`firstAnswer` (`ChatDialog.tsx:345`), so making the header X mean close would leave a help thread
with no way to stop at all. Esc already closes without discarding.

**2. `askAboutBlock` will not quote the block unless it is told to.** It inserts the opening words
only when given a `quote`, and `ChatDialog.ask()` passes one only for *selection* anchors
([`chat-handoff.ts:55`](../../src/web/chat-handoff.ts)). The launcher must pass the opening
explicitly while keeping the structural `{ blockId }` anchor. An exact-message test.

## Stages

Sol judged the first draft's stage 3 too broad and split it; this is that split.

### Stage 1 — the gutter becomes a 2 × 2 pad with 24px targets

CSS, `TableView`, and `PROSE_ALONE_MAX_REM`. No new button, no new behaviour — the fourth cell is
empty, so the layout change lands and is **measured** before anything is added to it.

- Explicit grid placement, so a conditional bookmark does not move the other three.
- The floor tied to **what the row can actually draw**, not to every row: a visitor's gutter is one
  permalink and does not need a two-row floor. Sol's finding 5.
- The heading rules rewritten deliberately, not inherited: ordinary headings bottom-anchor today,
  commented headings switch back to top. Test ordinary, first, commented and long headings separately
  — the commented-heading shape is the one the last piece of work found only after a review flagged it.

**Done:** targets measure 24 × 24 in a real browser; **no gutter control leaves its own row in any
shape**, checked programmatically by comparing every child's box against its row's; before/after row
heights recorded in this doc; `npm test` and `npm run typecheck` green.

#### Built, and measured — 2026-09-04 <a id="stage-1-measured"></a>

Measured in system Chrome through `preview-gutter.html`, which mounts the real `TableView` on a
fixture carrying every shape named above. Not read off the stylesheet: every number below is a
`getBoundingClientRect`.

| | before | after (owner) | after (visitor) |
|---|---|---|---|
| target | 22 × 15 | **24 × 24** | **24 × 24** |
| `--blk-slot` | 0.95rem | 1.5rem | 1.5rem |
| gutter / `--text-pad-l` | 22.4px / 33.6px | 48px / 59.2px | 48px / 59.2px |
| gutter box | 30.4px (2 slots) / 45.6 (3) | 48px (2 × 2, both rows reserved) | 24px (one slot) |
| one-line paragraph row | 39.1 | **63.1** | 39.1 — unchanged |
| commented one-line paragraph | 60.7 | 63.1 | n/a |
| multi-line paragraph | 66.3 | 66.3 — unchanged | 66.3 — unchanged |
| ordinary heading | 39.9 | **69.1** | 39.9 — unchanged |
| first heading | — | 63.1 | 33.9 |
| commented heading | 60.7 | 69.1 | n/a |
| long (wrapping) heading | — | 89.9 — the floor is a minimum | 89.9 |

**The overhang check, run rather than eyeballed.** For every gutter control on the page, at four
viewports — 1280 desktop, 820 × 1180 iPad and 390 × 844 phone with touch emulation (so
`(hover: none)` matches and *every* control is pointer-active), and the visitor variant — compare its
box against its own `<tr>`'s, then put the mouse on its centre and ask `document.elementFromPoint`
what is there. **23/23 owner controls and 10/10 visitor controls: all 24 × 24, all inside their own
row, each one the topmost thing at its own centre.** Worst clearance is 2.97px, on a visitor's
bottom-anchored heading. Before: the same fixture had the chat button hanging **0.45px** below a
one-line paragraph row, which is the old shortfall showing up as an actual escape.

**And re-run at 12, 16 and 20px roots after the WCAG fix** — `preview-gutter.html?root=12` writes
the root on `<html>` and hands the same number to `fitView`, which is what the real page does through
`useRootFontPx`. Nine combinations (owner / visitor / touch × three roots), **all clean**: 23/23 and
10/10, no control outside its row anywhere.

| root | slot | gutter / `--text-pad-l` | one-line paragraph (owner) | one-line paragraph (visitor) | worst clearance |
|---|---|---|---|---|---|
| 12 | **24** (px floor biting) | 48 / 56.4px | 59.3 | 35.3 | 2.22 |
| 16 | 24 | 48 / 59.2px | 63.1 | 39.1 | 2.97 |
| 20 | **30** (rem, past the floor) | 60 / 74px | 78.9 | 48.9 | 3.72 |

**What moved that the plan did not predict.** The one-line paragraph row landed at 63.1px rather
than the guessed ~65, because the floor is `--blk-top + 2 slots + a pad` and `--block-pad` is 5.95px,
not the 9.15px the top offset made it look. Headings cost more than paragraphs — 69.1 against 63.1 —
because `--blk-top` follows the cell's own doubled `padding-top` rather than being a constant, which
is what keeps the icons beside the heading's first line instead of a line below it.

**The lone-column cap went 50rem → 832px at a 16px root**, and on the way it stopped being a single
constant — see § What Sol's stage 1 review changed for why the gutter's px floor forced that. It went
50 → 51.6 → 52 → `PROSE_ALONE_MAX_REM = 49` plus the gutter as its own term; the *width* at 16px has
been 832 since the second of those and has not moved since.
`tests/text-alone-centring.test.ts` gained a guard that reads the padding out of the stylesheet and
fails when the cap stops covering it — the drift Sol's finding 9 named, which nothing could otherwise
see. Watched red first, with the pad temporarily at 5.2rem. Its multi-root half now lives in
`tests/gutter-target-size.test.ts`.

`tests/spine-width.test.ts` passed before and after, as Sol said it would.

#### Does it read as quiet, or as decoration? <a id="stage-1-quiet"></a>

The stylesheet's own worry, written for the single column: *"on a phone this is one glyph beside
every paragraph in the article, and at full strength eighty of them are a column of decoration."*
Looked at rather than reasoned about — desktop with the pointer resting on a one-line paragraph, and
820 × 1180 and 390 × 844 **with touch emulation on**, so `(hover: none)` matches and every control is
painted the way it is on a real iPad. A shot taken without it draws only the state icons and
flatters the design.

**Quiet, and the reason is worth stating: the ink did not grow.** The lucide glyphs are still
`size={12}`; what went from 22 × 15 to 24 × 24 is the *hit box*. So the amount of grey per row is
exactly what it was before, and the pair now sits side by side rather than stacked — which reads
lighter, not heavier: a vertical stack down the left of every paragraph looks like a list, a pair
reads as one small mark. **The 0.45 / 0.35 touch opacities should stay as they are for stage 1.**

**The risk lands in stage 2, not here.** The "?" goes in the bottom-right cell, and under
`(hover: none)` that is a *third permanently visible glyph on every row*, diagonally below the chat
bubble — which is the point at which the quiet pair becomes an actual 2 × 2 constellation. Two things
to look at then, in this order: whether the pad wants to be uniform (the chat button is 0.45 against
the permalink's 0.35 and is the one nearer the prose, so the right-hand column is already the louder
one — levelling both to 0.35 costs nothing and keeps the orange bookmark as the only thing with
weight, which is the grammar the file states); and only then whether the whole set needs to come
down. Do not pre-emptively lower anything now — there is nothing yet to lower it for.

#### What Sol's stage 1 review changed <a id="stage-1-review"></a>

[260904b-gutter-help-button-stage1-review-sol.md](260904b-gutter-help-button-stage1-review-sol.md).
Verdict: *"I would not commit stage 1 unchanged."* The overhang construction it audited and passed —
including three shapes the fixture does not have, and both the 12px and 20px roots — so what follows
is the size claim, not the geometry.

| | finding | what happened |
|---|---|---|
| 1 | **commit-blocking: `--blk-slot: 1.5rem` is 18 × 18 at a 12px root**, so the WCAG 2.5.8 claim held at one root out of three — and a `max()` on the slot alone would have left the grid *columns* at 18px | `--blk-slot: max(1.5rem, 24px)`, the gutter is `calc(--blk-slot * 2)`, the grid is `repeat(2, var(--blk-slot))`, and `--text-pad-l` is now `calc()` over the gutter rather than a fourth number kept in step by hand |
| 2 | the 49 passing tests exercise none of the gutter's geometry — deleting the floor or `.blk-cmt`'s `pointer-events` leaves them green | `tests/gutter-target-size.test.ts`, watched red twice first |
| 3 | "the floor follows what the row can actually draw" is **not true until stage 2** | reworded in both places to say what is true now; § below records the caveat |
| 4 | the centring guard is load-bearing for one drift, not proof of the geometry | said so in the file, and moved the multi-root half of it next door |
| 5 | `BlockGutter.tsx`'s `onJump` comment still claims a failed copy jumps | corrected; it had been false since 2026-08-31 |

**The fix for finding 1 introduced an overhang of its own, and only re-measuring found it.** Sol's
audit had checked the construction at 12 and 20px roots and passed it — *"the overflow construction
scales and remains safe"* — and it did, because everything scaled together. A **24px floor breaks
that**: below a 16px root the row keeps shrinking and the target stops. A visitor's one-line
paragraph fits a 24px target at a 16px root by **0.04px**, which is luck rather than clearance, and
at 12px the permalink hung **1.56px** into the next paragraph and the first heading's **0.81px** into
the table head. So unfloored rows now have a one-slot floor too — `td.text`, plus a shorter one for
the bottom-anchored heading, which is why there are three floor rules rather than one. It costs
0.04px per short visitor row at 16, nothing at 20, and 6px at 12: exactly where the px floor bites
and nowhere else. **This is why the geometry pass is worth re-running rather than reasoned about** —
a review that reads the code cannot see a 0.04px margin turn negative.

**The px floor also made the lone-column cap a function rather than a constant**, and that is the
part worth understanding. `--blk-slot`'s floor means that *below* a 16px root the gutter stops shrinking
while everything around it keeps going, so `--text-pad-l` grows **in rem terms** — 3.7rem at 16,
4.7rem at 12. No single rem constant can be right at every root: 52 under-reserved by 1.2px at a 12px
root and 12.9px at 9px, silently clipping the measure the cap exists to protect. So
`PROSE_ALONE_MAX_REM` is now the *rem part* (49 = measure + `--text-pad-r` + the gutter's two insets)
and `proseAloneMaxPx(root)` adds the gutter as its own term. **The two common roots do not move** —
832px at 16 and 1040 at 20, both exactly what they were — and only the 12px case widens, 624 → 636,
which is the case that was wrong. `layout.ts` holds `BLK_SLOT_REM` and `BLK_SLOT_MIN_PX` as copies of
the CSS, because CSS knows the reader's root and this file does not know the CSS; the new test reads
the declaration and fails when they disagree, which is the only thing that makes a copy safe.

#### The caveat on "independently shippable" <a id="stage-1-caveat"></a>

Sol accepted the reserved-but-empty second row as **an intermediate branch commit**, and was explicit
that it weakens the plan's claim that stage 1 ships on its own: *"short owner rows become visibly
taller before a control uses the space."* That is exactly right and it is the trade this stage makes
on purpose — a comment must not change the height of the row it is on, so the pad is reserved from
the reader's capability rather than from what happens to be drawn. But it means **stage 1 alone is a
cost with no benefit yet**: 24px more on every short owner row, holding a cell that stays empty until
stage 2 puts the "?" in it. Greg has the screenshots; if stages 2–4 were not going to follow, this
would not be worth shipping by itself.

#### Two things that will catch the next person <a id="stage-1-traps"></a>

**1. The preview harness's sticky `<thead>` lies at scroll 0, and it looks exactly like a gutter
bug.** `thead th` is `position: sticky; top: var(--bar-bottom)`, and the preview page renders no top
bar, so the variable is left at its app value and **sticky pushes the header 44px *down*, over the
first row** — a hit test on the first row's gutter then finds the `<th>` and reports the control as
unreachable. It cost half an hour to prove that was the harness rather than the layout. Fixed by
writing `--bar-bottom: 0px` on the preview's `.reader`, with the reason in the file. Stage 2 reuses
this harness; do not re-diagnose it.

Related, and the same species: a hit test taken immediately after `page.mouse.move` reads the opacity
the icons are transitioning *from* (`transition: opacity 0.12s`), so the screenshot catches them
half-drawn and a computed-style assertion reads `0`. Wait ~400ms, and assert the reveal actually
happened rather than trusting the move.

**2. The visitor's clearances are coincidences, not margins — and one of them went negative.** A
single 24px slot, top-anchored under a heading's doubled `padding-top`, ends **0.76px** above the
bottom of a 39.9px heading row at a 16px root; in a one-line paragraph the margin is **0.04px**. Both
fit, and neither is a margin — they are accidents of this face's metrics, and at a 12px root the
second one is a 1.56px overhang (§ above). That is why `td.text.kind-heading:not(.gutter-pad)`
bottom-anchors *and* has a floor of its own, and why unfloored rows are floored at one slot.
**The padded (owner) case must not bottom-anchor**: `--blk-top` already puts the pad beside the
heading's first line, and hanging a 90px wrapping heading's gutter from the bottom would drop the
icons 60px clear of the words. Sol confirmed the 2.97px figure is not luck — it is the bottom-anchor
rule's `--block-pad / 2` at a 16px root, 2.23 at 12 and 3.72 at 20 — which is the difference between a
number that scales and a number that happens to fit.

### Stage 2 — the "?" button, spending nothing

The fourth cell: `CircleHelp`, hover-revealed on desktop, faint-but-present under
`@media (hover: none)`, absent for a visitor. Wired to open the pre-filled draft — it behaves like
the chat button, and the UI must not imply it already sends.

**Done:** component tests for present/absent by callback, each confirmed red first; pointer-events
opt-in verified; tab order and `aria-label` checked.

#### Built, and measured — 2026-09-04 <a id="stage-2-built"></a>

`CircleHelp` at `size={12}` in `grid-area: 2 / 2`, rendered only where `onHelp` is, and wired in App
to **`chatAboutBlock` itself** — the same body as the chat button, so a press opens the pre-filled
draft and spends nothing. Stage 3 replaces that one line.

**The copy is "Ask for help with this paragraph"**, in both `title` and `aria-label`, and it is the
whole promise stage 2 can make: the press opens a composer that still says *"Nothing is asked until
you send"*. "Explain this" becomes true in stage 3 and would be a lie today — GPT Sol's condition on
this stage being coherent on its own.

**Nine tests, each watched red before it was made green** — six in
`tests/block-gutter.test.tsx` (drawn only where the callback is; calls `onHelp` and *not*
`onChatAbout`; the press does not reach the row's handler; the exact copy; the same 12px glyph; last
in the tab order) and three in `tests/gutter-target-size.test.ts` (row 2 / column 2 with all four
cells distinct; hidden at rest and revealed by hover *and* focus with `pointer-events` handed back;
present and pressable inside `@media (hover: none)`). The propagation one was then **mutation-checked**:
deleting `stopPropagation` turns it red on its own.

**The geometry did not move, which is the point of stage 1 having reserved the cell.** The overhang
pass re-run over 18 combinations — 1280 desktop, 820 × 1180 and 390 × 844 both with touch emulation,
× roots 12 / 16 / 20, × owner and visitor — with every control scrolled into view, the pointer put on
it, and `elementFromPoint` asked what is there: **33/33 owner controls and 10/10 visitor controls, all
24 × 24, none outside its own row, each the topmost thing at its own centre.** Worst clearance 4.45 /
5.95 / 7.44px at the three roots for an owner, 2.22 / 2.97 / 3.72 for a visitor — *identical to stage
1*, and every row height identical too (one-line paragraph 63.09, ordinary heading 69.05, visitor
39.09 / 39.86). A fourth drawn cell cost nothing because the row was already floored for it.

One trap worth recording, because it looks exactly like a layout bug: **`elementFromPoint` takes
viewport coordinates and returns `null` below the fold**, which the first run reported as 14 "buried"
controls at 390 × 844. Scroll each control into view before hit-testing it.

#### The touch opacities, looked at rather than reasoned about <a id="stage-2-touch"></a>

Stage 1 predicted the risk landed here — under `(hover: none)` the "?" is a third permanently visible
glyph on every row — and proposed levelling the pad to 0.35 before considering taking the whole set
down. **Levelled**, and the 4x crops are why: at 0.45 the chat button and the "?" stack in the right
column against a 0.35 permalink alone in the left, and the pad reads lopsided — the eye lands on its
right half before it lands on the prose. The 0.45/0.35 split was accretion, two rules written months
apart, not a hierarchy. At one number the pad reads as a single small mark.

Measured off the crops, peak glyph luminance against a page at 10: **67 → 54** levelled, and 45 if the
whole set went to 0.28 — which is not needed and is where an affordance on a real iPad in daylight
starts to be one you cannot find. `.block-chat.has` is untouched and stays at **opacity 1**, confirmed
in the browser rather than argued: it is *state*, and its (0,2,0) beats the touch rule's (0,1,0).

Shots are 4x and taken with the mouse never moved, both deliberately: at 1x a 12px glyph at a third of
strength is a few grey pixels, and an emulated pointer still fires `tr:hover`, which takes the thing
being judged to full strength.

#### What Sol's stage 2 review changed <a id="stage-2-review"></a>

[260904b-gutter-help-button-stage2-review-sol.md](260904b-gutter-help-button-stage2-review-sol.md).
Verdict: *"I would not commit stage 2 unchanged."* It confirmed the cascade, agreed that the identical
`title` and `aria-label` are right here, and established that **"cost zero pixels" is true by
construction rather than by luck** — a padded row already has two `--blk-slot` tracks and a floor
derived from the same variable, so the fourth child occupies a reserved cell at any root and in every
heading shape. Its own verification was partial: the sandbox blocked both Chrome and `tsx`, so its
typecheck line is not a TypeScript result.

| | finding | what happened |
|---|---|---|
| 1 | **the touch contrast fails WCAG 1.4.11** — 0.35 is not a 3:1 control | right, and by a wide margin: 0.35 measures **1.65:1**. Now `opacity: 0.653` = 3.00:1 — § below has the decision, the two shortfalls kept, and the bound that ruled out 4.5:1 |
| 2 | **commit-blocking: the floor is keyed to the wrong invariant.** `gutter-pad` came from `onChatAbout \|\| comments` while the component's API independently permits `onHelp`; "the two can only ever agree" is true of App and false at the type boundary | the condition is now `onChatAbout \|\| onHelp \|\| cmtsByBlock.has(…)`, and `tests/gutter-pad-floor.test.tsx` is the invariant written down — watched red on exactly the `onHelp`-only case |
| 3 | all nine tests stay green if **App** stops passing `onHelp`, and the harness cannot see that either | `tests/public-network-trace.test.tsx` — the one file that renders the real `App` at the real address for both readers — now asserts the "?" beside every paragraph for an owner and none for a visitor. Watched red by deleting App's `onHelp` line |
| 4 | the comment claimed the composer opens with the paragraph "already quoted" | corrected: `chatAboutBlock` passes `opening`, which is *shown above* an empty composer, and the anchor carries only `blockId`. Load-bearing in stage 3 |

Sol also judges stage 2 **not independently shippable** and it is right: on touch the bubble and the
"?" look like different actions and open the same empty composer, with no tooltip to tell them apart.
Ship it with stage 3.

#### The touch contrast, measured — and the decision is Greg's <a id="stage-2-contrast"></a>

Computed from the tokens rather than eyeballed. `--page` is `oklch(0.145 0 0)` and `--ink-faint` is
`oklch(0.63 0 0)`; both are achromatic, so linear-light sRGB is `L³` and that *is* the WCAG relative
luminance. `opacity` composites in **gamma-encoded** sRGB, which the pixels confirm: 0.45 predicted
67.2 and Chrome drew 67; 0.35 predicted 54.4 and Chrome drew 54.

| | opacity | composited sRGB | contrast vs page |
|---|---|---|---|
| today | 0.35 | 54.5 | **1.65:1** |
| the old chat button | 0.45 | 67.2 | 2.01:1 |
| **3:1** | **0.653** | 92.9 | 3.00:1 (0.65 lands at 2.985) |
| 4.5:1 | 0.868 | 120.3 | 4.51:1 |
| full strength | 1.0 | 137.0 | 5.66:1 |

For scale: the prose itself is **18.15:1**, so even a compliant "?" is about a sixth of the words'
contrast — 3:1 is not "as loud as the text".

**And the pixels say the opacity is only half the story.** Measured on the rendered glyph alone (one
`.blk-help` on an uncommented row, so nothing orange shares the crop):

| candidate | 1x | 2x | 3x |
|---|---|---|---|
| 0.35, stroke 2 (today) | 1.46:1 | 1.64:1 | 1.64:1 |
| 0.653, stroke 2 | **2.34:1** | 3.01:1 | 3.01:1 |
| flat `oklch(0.478 0 0)`, stroke 1.5 | 1.85:1 | 3.01:1 | 3.01:1 |
| **flat `oklch(0.478 0 0)`, stroke 2.5** | **3.01:1** | 3.01:1 | 3.01:1 |
| opacity 1, stroke 2 | 4.06:1 | 5.66:1 | 5.66:1 |

A 12px lucide glyph draws a 1px stroke that never covers a whole device pixel at 1x, so the nominal
3:1 renders 2.34:1 there. **Only a heavier stroke holds the ratio at every density.** Buying quiet
back by *thinning* the stroke does the opposite, which is why the obvious third option is the wrong
one.

**The decision: `opacity: 0.653`, stroke left at 2, on all three affordances.** Fable took the call
with fresh measurements and it overturned the flat-grey recommendation this section carried first;
two of its numbers dominate, and both are things the first pass had not measured.

- **The stroke was the whole of the 1x fix, and the flat colour contributed nothing to it.** The
  first sweep omitted `0.653 + stroke 2.5`, which measures 3.01:1 at 1x, 2x and 3x — identical to the
  flat variant. The 1x gain was the stroke all along.
- **"No alpha, so the ratio cannot drift" cuts the other way.** The prose cell is *already* tinted on
  ordinary rows: `td.text.opaque` (media, captions) paints `--muted` and `tr.row-active td.text`
  paints `--panel`. Over `--muted`, alpha 0.653 holds **2.77:1** while a flat `oklch(0.478 0 0)` falls
  to **2.46:1** — alpha partly rides a lighter ground up, and a flat colour cannot. Neither is
  compliant there; alpha is closer, and it does not add a second grey token.

**The bound that actually made the decision.** The gutter's grammar is that the reader's own mark
carries the weight. The bookmark is 4.48:1 against the page, and its *lead* over the affordances is:

| affordance grey | vs page | bookmark's lead |
|---|---|---|
| 0.35 (what stage 2 shipped for a day) | 1.65:1 | 2.72:1 |
| **0.653** | **3.00:1** | **1.49:1**, plus the hue the greys do not have |
| 0.868 (4.5:1) | 4.50:1 | 1.00:1 — hue alone |
| 1.0 | 5.66:1 | inverted (0.79:1) |

**0.868 is the inversion point.** At 4.5:1 the reader's mark stops leading on luminance, and anything
above it makes the buttons outshine the marks — which inverts the rule the whole column runs on. So
this is not "3:1 is the least we can get away with": **3:1 is the compliant setting the grammar
survives, and 4.5:1 is not.** A future reader must not round up to be safe.

**Two shortfalls, known and left in.** Recorded here rather than discovered later, in the same spirit
as the 22 × 15 target that stood for a month.

| | measured | the one-line remedy, and why it was not taken |
|---|---|---|
| a 1x screen | **2.34:1** (2.25 on a tinted row) | `.blk-gutter svg { stroke-width: 2.5 }` gives 3.01 at every density. It buys the ratio only on 1x `(hover: none)` hardware — old Android tablets; a 1x touch *laptop* has a trackpad and never matches the query — and costs about a quarter more ink on every iPad, on every row |
| a tinted row | **2.75:1** measured at 2x/3x against `--muted` | nothing cheap: the ratio is quoted against `--page`, and these cells are lighter |

**The crops show the gutter at rest, and that is not the state a reader is usually in.** A tap sets
`tr:hover` on iOS — sticky hover — and `row-active` with it, so the row a reader has touched shows
its gutter at full strength; Fable verified it in the browser. Every crop in this section was taken
with the mouse never moved, which is right for judging the resting column and shows nothing of what
follows a first tap.

**Held in reserve, not rejected: delete the `(hover: none)` block entirely** and let touch inherit the
desktop grammar — an empty gutter, tap a paragraph to reveal its affordances, tap the control. Fable
verified this already works. It is not v1 because help would cost two taps and Greg asked for one,
but it is the fallback if 0.653 is too loud on his own iPad. Two real-device checks first: that
Safari's sticky hover actually reaches `hoveredRow`, and that the `onJump` scroll nudge on every
paragraph tap is tolerable.

**One harness artefact worth knowing**, because it put two misleading crops in front of Greg:
`page.addStyleTag` is **unlayered**, so it beats this layered stylesheet whatever the specificity —
`gh-s2-contrast-wcag3` and `-alt` therefore drew `.block-chat.has` grey at 0.653 instead of blue at 1.
The shipping cascade does not: measured through it, `.has` is `oklch(0.72 0.12 235)` at opacity 1 and
the bookmark `rgb(219 138 69)` at 0.75, both untouched. Any further injected variant must say
`.block-chat:not(.has)`, and `tests/gutter-target-size.test.ts` now fails if anything inside the touch
query sets a `color` at all.

### The merge with `dev`, and the 22.5px nobody could have seen <a id="the-merge"></a>

Stages 1 and 2 came back to a `dev` that had, in the meantime, **centred the prose in its cell** —
`8f1a0a3e`, from Greg's *"Always centre the Text view within its column when visible, no matter
which mode is active."* Two conflicts, both in rules this work rewrote, and
[git-resolve-merge-conflicts.md](../reusable/git-resolve-merge-conflicts.md) is the process that
was followed: read both histories, propose, get a second model, then edit.

**Both sides were kept in both hunks.** `.blk-gutter` takes their `left:` calc — which adds half
the room the centring divides — and the two font declarations that make `65ch` count the *prose's*
zeroes rather than the chrome's, on top of this work's `--blk-top` / `--blk-gutter-w` / 2 × 2 grid.
Their `top`, `width: 1.4rem`, `display: flex` and `flex-direction: column` are the four declarations
stage 1 replaced, so they go. Their two literals become `--blk-gutter-x`, here and in the notes
region's opt-out, and the two assertions in their `tests/prose-centred-in-its-cell.test.ts` that
read `0.35rem` were updated to name the token. In `TableView`, their `note` / `note-open` classes
sit beside a `gutter-pad` that **absorbs** their `has-marks` rather than joining it — the same class
renamed, and two floors on one row would be a bug.

The two compose rather than merely coexist, and the reason is worth stating: their calc reads
`--text-pad-l`, which this work widened, so the leftover it divides shrinks by exactly what the
gutter grew. The gutter's right edge stays at `--text-pad-l − --blk-gutter-x`, i.e. `0.35rem` clear
of the prose, before and after. **It is a pure horizontal translation of the gutter and the prose
together**, so none of stage 1's vertical numbers can move. Re-measured rather than argued:
258 controls over 12 combinations, every one 24 × 24, topmost at its own centre and inside its own
row, worst clearance 4.453 / 5.953 / 7.438px owner at roots 12/16/20 against a pre-merge baseline
of 4.45 / 5.95 / 7.44 — identical. Gutter-to-prose gap 4.20 / 5.61 / 7.0px against a predicted
`0.35rem`.

**And then the thing neither branch could have caught.** GPT Sol, reviewing the resolution, read
`.reader.text-alone .masthead-inner` — Plain mode's title bar — and predicted from source that it
would now sit ~22px left of the prose. Measured in a browser: **22.53px at 1280 and at 1600**,
against the 4px its own comment claimed.

Nothing was wrong with either change. The rule said "the reading *cell*" — `--table-w` less its two
pads — which was the right box for as long as the prose filled its cell. `dev` moved the prose right
within that cell; this work widened the cell's left padding from 33.6px to 59.2px. **Both moved the
prose and neither moved the title, and the errors added rather than cancelling.** Each branch's
tests were green, because each branch was correct.

The fix is one declaration and it is exact, not an approximation. The prose sits
`(--text-pad-l − --text-pad-r) / 2` right of the table's centre, so a box centred on the same axis
must lose twice that to start on the same pixel:

```css
max-width: calc(var(--reading-measure) + var(--text-pad-r) - var(--text-pad-l));
```

**Measured after the change: +4.766px** at both 1280 and 1600, from −22.53px. And the number
decomposes, which is the part worth keeping — 2.762px from the weight axis (this box's `65ch` is
5.524px short of the prose's, because matching the prose's 450 would embolden the byline and the
source note that inherit from it) plus 2.0px because the masthead bar's own padding is 148px left
against 144px right, so centring *in the bar* is 2px right of centring in the window. 4.762
predicted against 4.766 measured, and the second term was not in the prediction at all — it came
back from the browser.

Two limitations were found the same way and are written into the rule rather than left to be
rediscovered. The new width is a **constant per root** where `--table-w` shrank with the window —
365.2px at a 9px root and 503.8px at 12, identical at 600, 700 and 731px of window — so "nothing
moves below the crossover" is true at the default root and false below it. And under about
`measure / 0.9` of window, `.prose` takes the `90vw` branch of its `clamp` and this rule does not
follow: −5.7px at a 12px root at 700 and 731px, **−22.1px at 600**. Not fixed, because the fix is a
second `clamp` here or a custom property `.prose` and this rule share, and neither earns its keep
for a reader who has both shrunk their type and narrowed their window.

`.blk-gutter` has the same two exposures and neither bites, for two reasons now stated there: its
`max(0px, …)` self-limits where a fixed `max-width` cannot, and the `90vw` interval is closed at
**every** root rather than only at 16 — `9 × (padL + padR + spine)` beats the measure at 9, 12, 16
and 20 (670/417, 713/556, 842/742, 1026/928), because the padding has a px floor and the measure
does not. That was checked at one root when the merge landed and at the rest afterwards, which is
precisely the shortcut that produced the 22.5px in the first place.

**Sol's review of the fix corrected two supporting claims, and the second one is the interesting
one.** The residual is 2.8px and not the 1.4px first written down — that came from halving the
sibling's number a second time, when the weight error reaches the left edge through `W / 2` either
way. And "the rule goes inert below ~1009px so nothing moves" is true at the default root and
**false at a small one**: `--table-w` shrank with the window, this constant does not, and
`--blk-slot`'s px floor stops `--text-pad-l` shrinking with the type while `--reading-measure` goes
on shrinking — so at a 9px root the width is ~373px against an old ~422px and around a 700px window
the title moves ~25px, toward the prose rather than away from it. A change, and the sentence that
claimed none is gone.

He also found a **latent bug that is `dev`'s rather than this work's**, and it is the same species
as the 22.5px: below 731px the narrow query wrote `td.text { padding-right: 0.9rem }` — the padding,
not the token — so `--text-pad-r` went on reading 1.4rem. Harmless while nothing but the padding
read it, and wrong the moment three rules started computing *half the room the centring divides*
from it. It is now `.reader { --text-pad-r: 0.9rem }`, which the cell's own `padding` shorthand
reads too, so the five consumers of that token agree at every width. Set on `.reader` rather than in
the `:root` block beside it, because that is where the token is declared.

`tests/text-alone-centring.test.ts` had an assertion that `--table-w` was present, which was **true
of the broken rule** — so the assertion is inverted to name the other box, and three more added.
Each was watched red: against the exact pre-merge rule, against the same arithmetic with the sign
flipped, and against a version missing the `font-size` that makes `65ch` mean the prose's `ch`.

> **The class, named:** *a defect that exists only in the composition.* Two correct changes to
> boxes that share an axis, landing on different branches, neither able to run the other's checks.
> A source-level test on either side would have passed. What found it was a second model reading the
> merge as a whole, and then a browser. It is the argument for measuring after a merge rather than
> only resolving one — the doc's own last line, *"run the checks for whatever the merge touched, not
> just the tests"*, with a rendered check as the only check that could have spoken.

### Stage 3 — one click sends, exactly once

- **A launch seam that does not hoist streaming state above `TableView`.** Sol's blocker 2: the
  obvious primitive `onSendNew` is closed over `ConversationBand`'s `useChat`, and that component is
  not mounted while the reader is reading. `ChatDialog` owns its own instance. So: a `ChatTarget`
  variant telling `ChatDialog` to auto-send **once** after mounting. Streaming state stays where it
  is, because a token that re-renders `TableView` re-renders the article.
- **Exactly-once under StrictMode and remounts**, tested.
- The canned message, with the opening passed explicitly (trap 2).
- **A synchronous per-block latch in a ref**, set before any async work — not a check against
  rendered state, which two taps in one tick both pass with the old value. Sol's finding 6. Test:
  invoke the handler twice synchronously.
- A press on a block that already has a help thread **opens it** instead.

**Done:** the exactly-once and double-tap tests red first; a real press spends one model call and
streams.

### Stage 4 — the addendum, and walking away safely

- The per-turn `help: true` → the addendum in `anchorSection`. A test that the system message, the
  cached article block and the serialised tool definitions are **byte-identical** to an ordinary
  chat, and only the final user addendum differs.
- **[Trap 1](#two-traps):** header X means close-and-keep-running for a help target; footer Stop
  becomes available during `firstAnswer` so there is still a way to abandon it.
- A browser pass at 1280 and at 820 × 1180 (iPad portrait): the answer streams, the reader scrolls
  while it does, closing the panel does not kill it, and it is there on return.

**Done:** the close-path test red first; the browser pass reported with what was actually observed.

## Deferred, deliberately

- **An ambient "still working" indicator.** Sol's finding 8: `.dock-count.pending` is the Comments
  badge, `ThreadSummary` has no pending field, its endpoint does not report one, and `useChatAnchors`
  fetches once rather than polling — so nothing would clear an optimistic state after the streaming
  component detached. Reusing the CSS class is trivial; the state lifecycle is a piece of work.
  **Not needed for the ask**: the panel is `min(24rem, 100vw − 2.5rem)` pinned bottom-right, so the
  reader can watch it stream *while scrolling*, which is what Greg described. Closing it is the
  secondary path, and the way back is the chat button's count.
- **Countability of help presses** — see [§ no new kind](#no-new-kind).
- **A concurrency cap** across blocks.

## The message the reader sees as their own

> About block k3m9qt ("Hierarchical Bayesian models of…"):
>
> I don't get this. What am I missing — here, or somewhere earlier?

Not *"explain this and surrounding blocks"* — that names a window, and the point is that the gap is
often nowhere near the block. The header line is `askAboutBlock`'s existing format; the opening words
appear **only because the launcher passes them** (trap 2).

The addendum tells the model: the reader pressed help at this block; the gap is often wider than the
block; find what they would need to have carried in — a term, an earlier argument this answers, a
person — say where it is with block ids, keep the author's vocabulary, don't summarise the article,
and search the web when the missing thing is outside it.

## Rejected

- **Replacing the chat button with the "?"** — Fable's recommendation, and a good one: the chat
  button only opens a composer, so the "?" is that intent with the send included; two buttons meaning
  "start a conversation about this paragraph" is the dashboard the gutter's rule warns against; and
  it costs nothing in layout. Greg chose to keep both doors, because free-text-first about a specific
  block is a distinct intent. Recorded because a future reader looking at four icons will have the
  same idea.
- **A `help` ThreadKind** — [§ no new kind](#no-new-kind).
- **A comment row as well as a chat.** Greg's words said "creates a comment", but a comment is *the
  reader's mark and their words*, and the "?" writes neither; a comment carrying an AI answer is the
  pre-2026-08-28 legacy path. The block already gets a marker for a conversation.
- **A web-search tick-box.** Already decided twice, and it is a control on a button whose whole point
  is one press.
- **A ±N neighbour window, or a "read nearby blocks" tool.** The article is already in the prompt.
- **A toast.**

## What the review changed

[260904b-gutter-help-button-review-sol.md](260904b-gutter-help-button-review-sol.md). Sol's verdict
opened *"I would not let stage 3 be built as written"*, and it was right on every count that mattered.

| | finding | what happened |
|---|---|---|
| 1 | the route and Postgres both reject an anchored `help` thread | **the kind is gone** — [§ no new kind](#no-new-kind) |
| 2 | `onSendNew` is not reachable from the gutter; `ConversationBand` is not mounted | stage 3 names a real seam: a `ChatTarget` variant that auto-sends once |
| 3 | `ThreadKind`'s blast radius has silent failures the compiler misses — `export.ts`, the overlay's `=== "chat"`, the hardcoded optimistic summary | gone with the kind |
| 4 | the 2 × 2 is right but the vertical arithmetic forgot the ~9.15px top offset | no row gap; the floor is **measured**, not calculated |
| 5 | the floor should not literally apply to every row — a visitor draws one icon | tied to what the row can draw |
| 6 | the double-tap guard is not race-safe against two events in one tick | a synchronous ref latch, set before any async work |
| 7 | the Cancel fix needs **two** controls — Stop is hidden during `firstAnswer` | both, and a target-level discriminant rather than `thread?.kind` |
| 8 | the pending indicator is not "nearly free" — no pending field, no polling, nothing to clear it | **deferred**, with the reason |
| 9 | `PROSE_ALONE_MAX_REM` must rise; `spine-width.test.ts` is not a gate; the prose moves *right* | all three corrected |
| 10 | the walk-away guarantee starts only once the server accepts the request | stated; concurrent spend across blocks stated too |
| 11 | `askAboutBlock` will not quote the block unless the launcher passes it | trap 2, with an exact-message test |
| 12 | `systemFor` would need an explicit branch | moot — the system bytes are identical by construction now |

Sol ran `tests/spine-width.test.ts`, `tests/chat-unmounted-turn.test.ts` and `tests/messages.test.ts`
— 41 tests, all green — which is how finding 9's "not a gate" was established rather than argued.

## Open, and for Greg

- **The 2 × 2 pad is the visible consequence of call 2**, and it is a bigger change to the look than
  "bigger targets" sounds. Worth a glance at a screenshot after stage 1 before stages 2–4 build on it.
  **Stage 1 is built and the shots are taken** — desktop hovering a one-line paragraph, and 820 and
  390 with touch emulation so `(hover: none)` matches. The reading, and what it means for stage 2, is
  [§ Does it read as quiet](#stage-1-quiet); the short version is that the *ink* did not grow, only
  the hit box, so nothing needs dimming yet. What is genuinely worth Greg's eye is the **row
  height**: an owner's one-line paragraph is 63px where it was 39, and an ordinary heading 69 where it
  was 40. Multi-line paragraphs — most of a real article — do not move.
