# Rich tooltips on Structure mode's rows

> Add rich tooltips to Structure mode (so I can see summary of that bit of the text)
>
> — Greg, 2026-09-12, feedback report `SPIDERYARN-READING2-3N`

Standing in `temporal-context-reinstatement-spya-dhqkf9` at build `d358f773`, in Structure mode, on a
window wide enough for the two-column face.

## What is actually missing, which is narrower than the report reads

[Structure mode has two faces](260910g-structure-mode-subsumes-outline.md) — `StructureMode.tsx`
§ `structureFace` picks between them from the band's measured width:

| Face | Component | Hover card today |
|---|---|---|
| **columns** — band content ≥ 364px | `StructurePanel.tsx` | **none** |
| **list** — narrower than that | `OutlinePanel.tsx` | number, title, gist (`.outln-card`) |

So the list face already answers Greg's ask, and the columns face — the one he was on — has no card
at all. **This plan adds a card to the columns face only**, and deliberately leaves the list face's
card as it is. Two faces of one mode carrying slightly different cards is not lovely, but the list
face's card is not the reported defect, and `OutlineRow` carries a `TreeNode` rather than a
`SummaryNode`, so giving it the children preview below means a second projection change in a file
this work otherwise does not touch. Named here so the next person reads it as a choice rather than
an oversight.

## What the card says, and the one rule that shapes it

The machinery is the existing one, exactly as the report asks: `Tooltip` / `TooltipGroup` from
[`Tooltip.tsx`](../../src/web/Tooltip.tsx), and the `.tip-*` classes in
[`tooltip.css`](../../src/web/styles/tooltip.css) that the spine's `BandCard` already draws with.
Two new rules there and nothing else: a width cap and the number's spacing.

```
┌────────────────────────────────────┐
│ 2.3  How attention became a market │   .tip-title  — number + text
│                                    │
│ The section argues that … (the one │   .tip-gist   — the tree's gist,
│ sentence stage 4 wrote)            │                 only when the row
│                                    │                 is not printing it
│ · The first auctions               │   .tip-kids   — what is inside,
│ · What Overture changed            │                 only when it is not
│ · + 4 more                         │                 already drawn
└────────────────────────────────────┘
```

**The gist is dropped from the card when the row is already printing it.** Structure's rungs put a
gist on the current row (and, higher up the ladder, on its neighbours and eventually on all of
them) — `structure.ts` § `wantsGist`. A card that repeats a sentence sitting six pixels above it is
the failure [tooltips.md](../project/tooltips.md) names outright: *a hover that costs a reader a
second to discover they knew it already is worse than no card*. So the card carries the gist only
where the row does not.

**The children are dropped when they are already drawn, or may not be named.** Column B *is* the
current part's list of sections, so a card on the current part offering a five-item preview of the
same list would be the panel reading itself back; and where the paragraph rung has spliced a
section's paragraphs in underneath it, the same applies. The second refusal is
`allowParagraphs`: a paragraph is named by its `navLabel`, and a navLabel is a pointer to prose that
must never stand *in place of* prose that could be shown, so when the band covers the article the
whole layer is withheld from the card exactly as it is from the column. **A card is a smaller
surface than a column, not a quieter rule** — this was the review's finding and the first draft had
the hole. The gate applies to the navLabel fallback itself as well as to column B's child list: a
shallow branch may end in a leaf directly under a part, and that leaf must not leak its navLabel
through the non-current part's card.

Names come from `rowText`, title-first with the navLabel as fallback, which is what the *columns*
use. The spine's `childLabel` inverts that order, and it is right to, because its children are
depth-3 leaves that have no titles at all; here the question is real and the card and the column
beside it have to say the same words about the same node.

Where there is no gist at all and the row has a real title, the `navLabel` stands in, in italics —
`BandCard`'s rule, and the `&& node.title?.trim()` half of it matters: without it an untitled row
whose title *is* its navLabel would print the same words twice, once as the title and once under it,
which reads as a rendering fault.

**No crumb.** `BandCard` opens with one because a proportional rail cannot say what contains what.
Structure's whole shape is that statement — column A is the parts, column B is the inside of the
marked one, and column B's header names the part in words. A crumb would be the third printing of a
fact already on screen twice.

**No footer.** The spine's words-and-position line answers *how big, and where am I* for a band the
reader cannot read; here the mark is a highlight they can see, and a word count alone never earns a
panel. The first draft had one, and dropping it also dropped a `words` field on `SummaryNode` and
edits to six test fixtures — see below.

**No card at all when nothing is left to say.** A card needs at least one of *gist*, *navLabel* or
*children*. In practice this means paragraph rows get no card, which is right for a reason stronger
than tidiness: paragraph rows only exist when `allowParagraphs` is true, which requires
`proseBeside` — so the paragraph's own prose is physically beside the band, and a card summarising
two sentences the reader can already see is worse than nothing. (At the rung the panel actually
draws today there are no paragraph rows at all; see below.)

## The shape of the change

### `structure.ts` — a narrow card value, not the node

`StructureRow` gains `card: StructureCard | null` — `gist?`, `navLabel?`,
`children: { id, text }[]` and `more: number`. The children carry their node ids rather than
words alone, because two children of one node really can read alike — "Introduction" twice, a
repeated paragraph navLabel — and in React a duplicate key is a warning plus a list that
reconciles to the wrong rows. `BandCard` keys by id for the same reason.

**A narrow value and not the `SummaryNode`**, because that is the correction GPT Sol made to the
spine on 2026-08-28 and the reasoning transfers unchanged: handing the card the node hands it every
sibling, every grandchild and the parent's own gist to render three lines, most of which the card is
not allowed to show. A narrow value says what the card may use, and — the part that pays here — it
makes *"is there anything left to say"* a pure question a unit test can ask with no DOM at all,
which is the only way to check a **suppression**. A browser can show that a card appeared; it cannot
show that the right one was withheld.

The cards are hung on the rows in a final pass, once both columns are settled, because what a card
may say depends on what the *other* column turned out to draw.

**The pass asks about the level, never about how much of it survived a window.** The panel windows
column B again after the projection returns, so a card built from `columnB.rows.length` would be
reasoning about a list that is about to change. It does not need to: column B is *about* the current
part whether it has room for two of its sections or twelve, and its counters say how many it left
off.

### `StructurePanel.tsx` — the card, and the copies that must not have one

A `RowCard` component beside `Row`, in this file, the way `BandCard` lives in `Spine.tsx` rather
than in a shared module with one caller.

`Row` takes `tip: boolean` and renders the bare button when it is false or the row has no card.
**The measuring copies always pass `false`**, and that is load-bearing twice over: they are the full
unwindowed lists, so tooltips on them would be tens of extra Floating UI instances for nothing, and
they sit inside `aria-hidden="true"`, where a trigger with an `aria-describedby` is a dangling
reference.

The wrapper must not change a measured row's height, or the panel measures one box and draws
another — the exact class of silent failure this file's history is made of. `Tooltip` renders
`cloneElement(trigger)` plus a portal that only exists while open, so the `<li>` keeps exactly one
child element and the same box. The review checked this against `@floating-ui/react` 0.27.20 and
confirmed it adds only handlers and, while open, `aria-describedby`; **it is still checked in a
browser**, because it is a claim about a library rather than about our code.

One `TooltipGroup` around the visible grid rather than one per column, so that running the pointer
down column A and across into column B is one scrubbable surface — the spine's argument, and the
reason its delay pair (`{open: 240, close: 90}`) is reused rather than retuned. `FloatingDelayGroup`
renders a context provider and no DOM node, so the `:scope > .struct-side` selectors the measuring
code depends on are unaffected.

`placement="right"`, and — after the browser found the alternative broken — **without `keepSide`**,
which is where this differs from the list face. The band is the strip *between the spine and the
prose* (layout.ts § the mode band), so a card thrown right lands on the prose; column A's will
overlap column B while it is open, which is what a tooltip does and is preferable to throwing it left
onto the 12px rail and the window edge.

**`keepSide` was in the first build and it cut the card's text off the screen.** In Chrome at
420×844 the card opened at x≈222 with 288px of content and simply ran off the right-hand edge,
mid-word, with no scrollbar and nothing to say so. The reason is worth writing down because it is not
what `shift` looks like it promises: **`shift` slides along the *cross* axis**, which for a `right`
placement is vertical, so it cannot answer horizontal overflow at all. `flip` is the only middleware
that can, and `keepSide` (`crossAxis: false`) restricts it to left↔right — and in a 420px window with
a 210px band, *neither* side has room for the card, so flip kept the original placement and the card
stayed where it could not fit.

Dropping `keepSide` restores `fallbackAxisSideDirection: "end"`, so once left and right have both
failed the card drops to below the row, where `shift` *is* on the horizontal axis and slides it fully
on screen. The cost `keepSide` exists to avoid — a card landing on the neighbours the reader is about
to hover — was measured on a **row** of triggers (Tooltip.tsx § `keepSide`); Structure's are stacked
vertically, so what a bottom-placed card covers is the rows *below* it, and only in the one case
where there was no other option. A card over the next row beats a card with its sentence off the
screen.

**Capped at 18rem rather than `.tooltip`'s 22rem.** On a window narrow enough for the band to cover
the article, each track is about 176px and there is only about 200px from either track's edge to the
far side of the screen, so a 352px card has nowhere to go. Review finding 4 — necessary, and on its
own not sufficient, which is what the browser then showed.

**The list face has the same bug, confirmed.** `OutlinePanel` pairs `placement="right"` and
`keepSide` with a **22rem** card — wider than this one — on a band that is narrower by definition, so
on the narrow face neither side may fit and the same failure reproduces exactly. GPT Sol checked it
in the code review and it was explicitly left out of scope. It is written down here rather than left
to be rediscovered by a reader with a cut-off sentence.

### Keyboard

Structure's rows are real `<button>`s, so they are already in the tab order and `useFocus` opens the
card on focus — parity the list face cannot have, because its rows are `role="treeitem"` and
deliberately not focusable.

### Touch: not in this change, and the reason is a trade, not a technicality

**A phone does get this face.** The review did the arithmetic and it is worth writing down, because
the first draft of this plan waved at it: columns need 364 content px, Structure's padding is 24px at
a 16px root, and a covering band loses its right border, so a 400px viewport with the rail gives
`400 − 12 − 24 = 364` — columns, exactly on the threshold — and anything wider is comfortably over.

So a card no finger can open is a real gap on the device Greg reads on, and it is **the same gap the
list face already has**: `OutlinePanel`'s tooltip is uncontrolled too. It is not created by this
change and it is not closed by it.

It is left out because the fix is *reveal-then-commit* — the spine's `bandPress` — which needs the
tooltip to be **controlled**, the shape that took the spine's cards away for a day
([260828g](../postmortems/260828g-spine-hover-cards.md)), and because it buys less here than on the
rail: a spine band is two pixels tall and tapping one blind is a coin flip, whereas a Structure row
is a legible line of text whose title is already on screen. The review's advice if it is ever built
is *per-row* controlled state rather than one shared piece, which is the actual lesson of that
postmortem.

Written into the note back to Greg rather than left for him to find.

## What the review changed

GPT Sol reviewed this plan before anything was built
(`--sandbox review`, 2026-09-16). Five findings landed:

1. **The card's children ignored `allowParagraphs`** — a rule the column obeys and the card would
   have broken. Fixed, with a test.
2. **`childrenShown` was computed from `columnB.rows.length`**, which the panel windows afterwards.
   Now a question about the level.
3. **`words` on `SummaryNode` was not narrowly additive** — six test files construct `SummaryNode`
   literals, not the one this plan claimed. Combined with the footer being trimming rather than
   content, the whole field went.
4. **The card is too wide for a covering band.** Capped at 18rem.
5. **Production draws at rung 2, so column B has no paragraph rows at all today.** The plan had
   reasoned about the paragraph rung as though it were on. It does not change the design — it means
   the card is currently the *only* place a section's paragraphs can be seen, which makes the
   children list more valuable than the plan claimed rather than less. A test now pins the shipped
   rung.

It also verified, against the code rather than the prose, that the columns face genuinely has no
card today, that `Tooltip` cannot change a measured row's box, and that `allowParagraphs` really does
imply `proseBeside`.

## What the code review found, and what it left

GPT Sol reviewed the built code with the scoped diff and the browser evidence
(`--sandbox workspace-write`, 2026-09-16). It fixed two things in place and reported two.

**Fixed — the `allowParagraphs` gate still leaked, through the other column.** The plan-stage fix
covered column B, where a section's children are paragraphs. It missed column A: a **shallow branch
can end directly under a part** — a section by depth, a paragraph by shape — so a non-current part's
card was still naming leaves by their `navLabel` while the paragraph layer was withheld. The gate is
now a separate `allowNavLabels` argument covering the card's own navLabel *and* the children's
fallback, and a child's **title** is deliberately still allowed through either way: a title is
ordinary structure, a navLabel is paragraph chrome. Two regression tests, both watched failing
against the code with the gate removed.

**Fixed — the card pass was inflating `structureProjection`.** Extracted as `attachCards`, which is
what the plan said it was all along; the complexity score is back to its pre-change 45.

**Reported, not fixed:** the list face's overflow (above), and the rung-3 seam, which is now a
comment on `paragraphsShown` rather than only here — `StructurePanel` windows the *mixed*
section-and-paragraph list after `attachCards` has already treated a spliced run as shown, so
enabling rungs 3–5 wants detail-aware windowing first.

It also confirmed that dropping `keepSide` is preferable to adding `size()` middleware (a
bottom-placed card leaves the rows under it scrubbable, because `.tooltip-anchor` is
`pointer-events: none`), that every reused `.tip-*` class materially affects this card, and that
neither new test file can pass over a panel that draws no cards.

## Stages

1. **Red tests first** — `tests/structure-card.test.ts` (the pure projection) and
   `tests/structure-card-opens.test.tsx` (the panel). Watched red: 11 failed, 2 passed, and the two
   that passed were the negative assertions, which can pass over a panel with no cards at all. They
   are kept beside a positive one for exactly that reason. GPT Sol reviews the plan.
2. **Build it** — `structure.ts`, `StructurePanel.tsx`, two rules in `tooltip.css`. Green, typecheck,
   scoped vitest.
3. **Browser** — Playwright against system Chrome: the card opens, says what it should, and **the
   columns still fit**, at a wide band and at the narrowest band that still gets the columns face.
   It confirmed the fit (including on the 1,237-section article that has broken this panel's
   measurement twice) and found the `keepSide` overflow above, which no test here could have.
4. **GPT Sol on the code**, with the scoped diff and the browser evidence. Then the full suite, the
   docs, a commit, a push to `dev`, and the note under `docs/user-feedback/`.

## The simpler option passed over

**Print the gist on every row instead of on the rungs the ladder reaches, and add no tooltip.** That
is fewer parts and no new dependency on hover at all. It was turned down because it is the thing
Structure's ladder exists to avoid: gists are several lines each, the panel does not scroll, and a
gist on every row is how column B goes from sixteen sections to four. The tooltip is precisely the
surface that can hold a sentence without spending the height — which is the argument
[tooltips.md](../project/tooltips.md) opens with for the rail, arriving in a second place.
