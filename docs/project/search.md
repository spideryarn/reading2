# Search — finding a passage by its words, or by what it says

**Built 2026-08-26.** One box in the mode band, two ways of matching behind it, and the passages
that match get marked in the article beside it. Greg's ask:

> Add functionality for Semantic Search/Highlights.
>
> Take heavy inspiration from [docs/project/original-version/](original-version/overview.md)
>
> When active, it should replace the middle sections of the UI (i.e. right of the spine, left of
> the doc).
>
> Use a button in the bottom-bar to activate it.
>
> — Greg, 2026-08-26

Code: [`src/search.ts`](../../src/search.ts) (the model call),
[`src/searches.ts`](../../src/searches.ts) (storage),
[`src/quote-match.ts`](../../src/quote-match.ts) (finding a quote in a block — the shared rule),
[`src/routes.ts`](../../src/routes.ts) § search,
[`src/web/SearchPanel.tsx`](../../src/web/SearchPanel.tsx),
[`src/web/search-hits.ts`](../../src/web/search-hits.ts),
[`src/web/useSearch.ts`](../../src/web/useSearch.ts), and `§ search mode` at the end of
[`src/web/styles.css`](../../src/web/styles.css).

```
 ┌──────────────┬──────────────────────────┬───────────────────────────────────┐
 │              │  Mode: search            │                                   │
 │  ▇▇▇▇▇▇▇▇▇   ├──────────────────────────┼───────────────────────────────────┤
 │  ▇▇▇▇▇       │ ┌──────────────────────┐ │  Seth begins by asking what a     │
 │  ▇▇▇         │ │ arguments against    │ │  self is actually for.            │
 │  ▇▇▇▇▇▇▇     │ │ substrate independ...│ │                                   │
 │  ▇▇          │ └──────────────────────┘ │ ┃He rejects the idea that mind is │
 │  ▇▇▇▇        │  ( words ) ( ●MEANING )  │ ┃▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂ │
 │              │ ──────────────────────── │ ┃software running on wet hardware,│
 │  the spine —  │  3 passages   by place ▾ │ ┃▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂         │
 │  where you   │  ▐62▌how sure ▬▭ where   │ ┃and the reason is not squeamish- │
 │  are, and it │                          │ ┃ness about carbon.               │
 │  never moves │  ▐92▌ …mind is software  │                                   │
 │              │  ▬▭▭▭ running on wet…    │  Living things are self-maintain- │
 │              │       Answers the func-  │  ing in a way a chip is not.      │
 │              │       tionalist claim    │                                   │
 │              │  ────────────────────    │ ┃A thermostat has no interior.    │
 │              │  ▐61▌ …a thermostat has  │ ┃▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂▂     │
 │              │  ▬▬▬▭ no interior…       │                                   │
 │              │       An example, not    │  There is nothing it is like to   │
 │              │       an argument        │  be one.                          │
 ├──────────────┴──────────────────────────┴───────────────────────────────────┤
 │ ⊞Contents ▤Summary 𝐀Glossary 🔍Search ⌸Chat │ ✳Questions ≡Tweets ⓘMetadata   │
 └─────────────────────────────────────────────────────────────────────────────┘

   ▐92▌ the model's confidence, printed as well as drawn
   ▬▬▭  where in the article the passage falls — on a literal result too
   ▐62▌how sure ▬▭ where   the legend, so neither mark is hover-only
   ┃    the bar down a matched paragraph, scaled HARDER than the wash
   ▂    the wash, over the words the model actually quoted
```

## The one decision everything else follows from

**Two matchers, one box, one results list.** The reader types, and a toggle says whether we match
the letters or the meaning:

| | **words** | **meaning** |
|---|---|---|
| what it matches | the characters you typed | passages that mean what you described |
| where it runs | in the browser | a model call over the whole article |
| what it costs | nothing | a few cents, and 15–40 seconds |
| when it runs | every keystroke | when you press **find** |
| what a result carries | a snippet, and where in the piece it falls | the same, plus a confidence and one line of reasoning |
| is it saved | no — it is `?find=` in the URL | yes, beside the article |

Greg chose both over meaning-only. It is also what the previous version converged on, and its own
note is the argument:

> Text search and meaning-based search answer different questions and their version ran both, side
> by side.
>
> — the note the `Search` placeholder used to carry in [`Dock.tsx`](../../src/web/Dock.tsx),
> before the placeholder became this feature

and, on the relationship between them:

> **The same UI serves both literal and semantic search**, switched by a URL parameter. That is the
> right relationship between the two: one place to look for things, two ways of matching.
>
> — [original-version/search-and-chat.md](original-version/search-and-chat.md#text-search)

The two meet in [`search-hits.ts`](../../src/web/search-hits.ts) and **nothing downstream of that
file knows which one ran**. One `Found[]`, one list, one kind of mark, one sort control. A third way
of matching would be a third arm of one ternary.

The practical difference the panel is at pains to make obvious is *what pressing a key does*. In
words mode the results are already there as you type. In meaning mode nothing happens until you
submit, because submitting spends money. A box that quietly billed you per keystroke would be the
worst possible version of this feature — so there is a **find** button in one mode and deliberately
none in the other, rather than a disabled one that invites you to wonder what you did wrong.

## Why this is on the augment side of the line

[vision.md](vision.md) exists to refuse tools that read the article *instead of* you. A results list
is a place that could go wrong, so it is worth being exact about why it does not:

**Every row is an index into the piece.** Press it and the page goes there. That is the same
contract chat's citation chips hold ([chat-mode.md](../plans/chat-mode.md#the-citation-contract)),
and it is what makes this a way of *getting to* prose rather than a way of avoiding it.

**A hit is a highlight, not a summary.** The model's own words in a result are one sentence of
reasoning about why the passage matches — never the passage's content. The prose the reader ends up
in is the author's, unedited, uncompressed, in its own place in the argument.

**The marks are transient and the reader asked for them.** The article carries no search highlight
until somebody searches, and they go when the mode closes. That is the same rule the glossary
follows ([glossary.md](glossary.md)) and for the same reason: the article does not acquire marks the
author did not write on the model's initiative.

The two snippet lengths are part of this too — short in the row, longer on hover — and they are
capped so that the hover card is enough to *judge* a hit and never enough to *read* it.

## The mode band

`?mode=search` is the fourth value in `MODES`, after `toc`, `chat` and `glossary`. Greg's original
framing of that band, from [chat-mode.md](../plans/chat-mode.md#gregs-reframing-which-is-the-actual-design):

> I'm thinking that this might be a common pattern, that when we switch into a mode (e.g. Chat,
> Glossary, etc) we'll want to keep the spine and article, but reuse the middle sections.
>
> — Greg, 2026-08-25

This is the third mode to arrive in that slot and it cost the layout **nothing**: no change to
[`layout.ts`](../../src/web/layout.ts), no new term in the arithmetic, one word in `MODES`, one row
in `MODES_UI`, one component. That is now enough evidence to stop calling the slot an experiment.

The cost is the one chat-mode.md already stated: **the granularity columns are gone while you
search, not shrunk.** You cannot read the L1 gists and the results list at the same time. It is a
real loss on a wide screen and it is the deal the band is.

## The bottom bar

The bar had **two** dimmed placeholders for this, side by side: `Search` and `Highlights`. They are
one button now, and that is the design rather than a tidy-up — highlighting is what search *does to
the page*, not a separate thing to press. Greg's call.

Both placeholders carried a note about what the previous version learned. Neither is lost:

- **Search's** — *text and meaning search answer different questions* — became the design above.
- **Highlights'** — *overlapping highlights need the CSS Custom Highlight API; a library that wraps
  matches in tags cannot nest them* — turned out to be about a wall we had already gone round. See
  below. It now lives at the top of [`annotate.ts`](../../src/web/annotate.ts), where somebody
  adding a fifth kind of mark will meet it.

**There are no dimmed placeholders in the bar at all any more**, and Search is most of the reason:
of the five it once carried, four became buttons and the last one (`Reading time`) turned out to be
answered by the metadata page already. The convention survives on that page for its own unbuilt
rows; the bar is all live controls now. See
[bottom-bar.md](../plans/bottom-bar.md#the-dimmed-placeholders-are-gone).

## Drawing the marks, and the wall that wasn't there

[original-version/highlighting.md](original-version/highlighting.md#the-technical-wall-highlights-cant-overlap)
is emphatic, and its advice was *"go straight to the CSS Custom Highlight API"*:

> a search hit, a glossary term and a semantic highlight can all land on the same span, and
> **Mark.js cannot express that**. The reason is structural, not a library defect — Mark.js wraps
> matches in `<span>`s, HTML elements nest and cannot partially overlap, so two highlights whose
> ranges cross each other have no valid markup.

**That is right about the problem and was aimed at a different solution to it.**
[`annotateHtml`](../../src/web/annotate.ts) does not wrap a range. It **cuts every text node at
every mark boundary and labels each piece with whichever marks cover it**. Nothing nests, so nothing
can fail to nest, and three marks that only partially overlap come out as a run of well-formed
`<mark>`s carrying two classes each. There is a test for exactly that case in
[tests/annotate.test.ts](../../tests/annotate.test.ts), and it is the evidence the approach holds —
if it ever fails, that recommendation becomes live again.

So a search hit is a third `MarkKind` and cost that file one entry in a union and one `if`.

What we *did* take from their implementation, verbatim, is the one visual trick worth having:

> **the left border is scaled harder than the fill** (`opacity * 1.5`, clamped). A wash faint enough
> to keep text readable is too faint to notice; the border carries the signal, the fill carries the
> extent.

That is the `┃` in the diagram: `td.text.has-hit` gets an inset shadow at 1.5× the block's strongest
confidence, and the wash behind the words is at 0.3×. (An inset shadow rather than a `border-left`,
because a border changes the cell's width and every matched paragraph would jump sideways as you
type.)

And the mistake we did **not** take: theirs drew search hits, glossary terms and semantic highlights
all in the brand orange, separated only by opacity. We can show all three at once, so the search
wash is a different **hue** — `--hit-rgb` in [`tokens.css`](../../styles/tokens.css) — not a
different alpha. On a near-black page a low-alpha orange is not subtle, it is invisible.

## What a hit is anchored to

A block id and the exact words, which is [the one contract](block-ids.md) — id first, text second,
offsets only ever as a tie-break between repeats. Their version anchored semantic hits by element id
too, and that is worth recording as evidence for the contract rather than as a coincidence.

The awkward part is that the two halves of the app measure text differently:

```
  what the MODEL is shown          what the BROWSER renders
  block.text                       renderedText(block.html)
  ────────────────────────         ─────────────────────────────
  whitespace collapsed             text nodes concatenated
  a space inserted at every        no separator at a block
  nested block boundary            boundary at all
                    ╲                    ╱
                     ╲                  ╱
                   src/quote-match.ts — findQuote()
                   one rule, used by BOTH sides
```

[`quote-match.ts`](../../src/quote-match.ts) is the shared rule, the same "one definition, two
sides" discipline [`term-match.ts`](../../src/term-match.ts) follows for glossary terms and for the
same reason: if the server's idea of "is this quote in this block" differed from the browser's, the
panel would list a passage and the article would show nothing marked — which looks like a rendering
bug and is not one.

It is forgiving about case, whitespace runs, curly quotes and dashes, in two passes of increasing
forgiveness. **Where it fails, the whole paragraph is washed and the row says so** — "whole
paragraph — the exact words have moved". That is a fallback rather than a failure: the model named a
block and said why, and that much is still true when the words have moved. Marking nothing throws a
good answer away over a whitespace difference; marking the wrong words is worse than either.

One thing there worth writing down, because it was wrong for about an hour and real data caught it:
**whether the fallback fired is read from `findQuote`'s own answer and from nothing else.** The first
version inferred it — a span covering the whole block, plus the quote not matching the block's text —
and a hit whose quote genuinely *was* the whole block produced exactly the shape the fallback
produces. The model had retyped a line break as a space, so the string comparison said "different",
and a perfect match was labelled as having moved. A derived fact that *usually* agrees with a known
one is the shape of most of [silent-success.md](../reusable/silent-success.md), and the fix is always
the same: ask the thing that knows.

## The confidence, and the unit that changed silently

Their version had a real bug here, and it is the kind worth inheriting the fix for rather than the
code:

> a genuine inconsistency they left behind: the API documents `confidence` as 0–1, and the
> highlighting code takes it as 0–100. Somewhere between fetch and render there is a conversion. A
> unit that changes silently as it crosses a boundary is a bug waiting for someone to move a line of
> code.

So: **0–100, integer, one unit everywhere.** Stated on the type
([`SearchHit`](../../src/types.ts)), demanded in the prompt, enforced in `validateHits`, and never
rescaled anywhere else.

A value of 1 or less is **counted, not corrected.** Rescaling would be a guess about which unit the
model meant, and a confident wrong guess paints the whole article at the wrong intensity with
nothing at all to see. Counting it puts `subOne` in the log line instead — and the number is printed
beside every row, so a run whose confidences all read "1" is visible to a reader too.

Confidence is **printed as well as drawn**, which is the other note we took: *confidence should be
visible, not just used. A binary highlight hides the model's uncertainty, which is the opposite of
what we want.* A reader cannot tell 40 from 55 by looking at two washes.

There is a floor on the wash — a 0%-confidence hit still draws at 0.35 — because an invisible mark
is indistinguishable from a bug.

### What the number *means*, which printing it does not say

> for the meaning results, make it clearer what the confidence number means (e.g. with a tooltip)
>
> — Greg, 2026-08-26

Printing the number solved the previous version's problem (a wash cannot be read) and left a
different one standing: **a bare 92 beside a paragraph is a number with no noun.** The `title` it
carried said "The model's confidence in this match: 92%", which is the word already stencilled on the
chip. What a reader actually needs is *whose* judgement it is and how much weight to put on it.

So the explanation moved into the row's hover card, under the passage and behind a rule, and it says
the honest thing rather than the flattering one:

> **92 out of 100** — how strongly the model thinks this passage matches what you asked for. It is
> the model's own judgement about its own answer, not a measurement of anything: read it as *worth a
> look* against *probably*, not as a probability.

That is the same rule the glossary follows about the model's difficulty and centrality scores
([glossary.md](glossary.md)) — offer them, label them, never let them read as fact.

**Not a second tooltip on the number itself.** The row already opens a hover card, and a native
`title` underneath a floating panel is two tooltips fighting over one pointer. The card opens
wherever on the row you are hovering, the number included, so the explanation is there when you look
at the thing it explains. The `title` is gone and the chip carries an `aria-label` instead, which is
what a screen reader needed anyway.

## Where in the article, on every result

> perhaps also indicate somehow with a little sparkline or similar how far through the doc it is,
> i.e. so each result shows both confidence and place. And also show the place-sparkline for "words"
> results.
>
> — Greg, 2026-08-26

Every row now has a **second channel**: a thin bar in the left gutter that fills up to how far
through the article the passage sits. It is on a literal result too, where it is the only thing
besides the words that the row can tell you — a words-search has no confidence to report, and "the
fourth of nine matches" is a fact about the list, not about the piece.

**The ruler is characters, not blocks**, and that is the one part of this that is easy to get
silently wrong. Counting blocks is the obvious implementation and it lies in a way nobody would catch
by looking: an article whose last third is twenty one-line list items puts a hit in its long opening
paragraph at "halfway", because half the *blocks* are behind it. Characters are the cheap stand-in
for height, and the offset within the block is folded in as well, so two hits in one long paragraph
are not drawn on top of each other. There is a test for exactly the list-item case in
[tests/search-hits.test.ts](../../tests/search-hits.test.ts).

**And they have to be characters of the same string.** The first version summed `block.text.length`
for the ruler — it is already on the block and costs no DOM — while measuring the position along it
with an offset into the *rendered* text. Those are two different strings:
[`block.text`](../../src/blocks.ts) collapses whitespace and inserts a space at every nested block
boundary, `renderedText` is the raw concatenation of text nodes. For a paragraph they agree to within
a character or two; for a table or a deeply nested list they do not, and nothing would have *looked*
broken — the bars would simply have been wrong by an amount nobody could see. Raised by a GPT Sol
review, and the fix is to hand `ruler()` the rendered strings, which `findLiteral` has to produce
anyway. There is a test with the two lengths deliberately three-to-one apart.

**A filling bar and not a dot on a track.** "How far through" is a progress question and a filling bar
is the answer everyone already reads without being taught. The gutter is about 44px wide, which is
well under the size at which a mark's exact position can be read off, so this is deliberately a
*zone* indicator — near the start, halfway, near the end. The number that says exactly is in the
hover card ("62% in") and in the bar's accessible name.

**Neutral grey, not the search hue.** The hue means *a match* everywhere else in this mode — the wash
in the prose, the bar down a matched paragraph, the selected matcher, the confidence chip — and a
second thing wearing it would be a reader having to learn that this particular blue sometimes means
something else. Two channels, two colours, and neither carries its meaning by colour alone: the
confidence prints its number, the place bar has a name.

**And a legend, so neither mark is hover-only.** One line under the sort bar with miniature specimens
of both — *how sure the model is — its own guess, not a measurement*, and *where in the article*. A
hover-only explanation is one that nobody on a touchscreen ever sees, because tapping a row navigates
rather than hovering it; the reader who most needs to be told what a confidence number is is exactly
the reader who would not think to hover it. The caveat is the half that matters, so it is in the
legend and not only in the hover card — GPT Sol's point, and it is right.

The legend is built from the same two components the rows use, so it cannot drift from what it
describes. Its place-bar specimen is `aria-hidden`: it is a picture of the control rather than a
reading of anything, and announcing "30% of the way through the article" there would be a screen
reader stating a fact about the article that is not true.

What this deliberately is **not** is ticks on the spine. Three results scattered through a long
article are still three places you have to scroll to find, and a shared rail is the thing that would
actually fix that — it stays in [what is still open](#what-is-still-open) below.

## The four counts in the log line

Every finished search writes one line under `model` carrying, besides the usual timings and token
counts, four numbers that exist because **each of them is invisible from the outside**. A dropped
hit looks exactly like a passage the model chose not to return, and "nothing in this article matches
that" is a legitimate answer a reader sees. Textbook [silent-success](../reusable/silent-success.md),
handled by making it countable.

| Count | What it means when it climbs |
|---|---|
| `unknownIds` | the model is citing block ids the article does not have — the id contract has stopped working |
| `unquoted` | the model is paraphrasing what it claims to be quoting |
| `subOne` | the confidence unit has drifted to 0–1 |
| `truncated` | a criterion is matching more than `MAX_HITS` passages and the list is being cut |

**Never logged**: the criterion, any quote, any reasoning, the article, the key. A criterion is as
private as a selection — it is what somebody was looking for. See [logging.md](logging.md).

## Saving, and the toy it stops this being

Meaning-searches are stored in `data/<slug>/searches.json`, the third file with exactly the shape of
[`comments.ts`](../../src/comments.ts) and [`chat.ts`](../../src/chat.ts) — atomic write, serialised
read-modify-write queue, reader state beside the article rather than in it. Greg chose this over
keeping nothing.

The reason is the criticism the previous version earned in its own docs:

> Theirs vanished on reload, which quietly makes the feature a toy — nothing you produce with it can
> be returned to.

A search costs a model call and half a minute. Re-opening one from the list repaints the whole
article with **no model call and no wait**, because the answer is on disk.

Words-mode searches are **not** stored, and that is not an omission: a substring match is instant and
free, and `?find=` in the URL describes it completely. Storing it would be caching a computation
cheaper than the read.

`MAX_RUNS` is 30, oldest dropped first.

## The URL

Four parameters, which is more than any other mode wants, because search mode has two matchers in it
rather than one feature. The division: `match` says which matcher, and then exactly one of `find` and
`run` is the thing being matched.

| Parameter | Values | History | Why |
|---|---|---|---|
| `mode` | `search` | push | A mode is where you are, not a glance |
| `match` | `words`, `meaning` (default) | **push** | It changes what the article looks like, like a column toggle. Back should undo it |
| `find` | any string | replace, debounced 200ms | Written on every keystroke. A Back button that walked back through a half-typed word one letter at a time would be useless — same call `?at=` makes |
| `run` | a minted id | replace | Stepping between saved searches is browsing; `mode` already put the entry on the stack Back should use |
| `order` | `document` (default), `confidence` | push | Changing the order of a list is a deliberate act on the view |

### `match` defaults to `meaning`, and used to default to `words`

Changed by Greg on 2026-08-26. The original argument for `words` was that **it is the free one** — a
reader who opens the panel and types should get instant highlights, not a bill.

That argument was about the wrong thing, and it is worth saying why rather than just flipping the
constant. **Nothing in meaning mode spends anything until the reader presses find.** The cost is
attached to the submit, not to the mode; the free-ness of `words` was never at risk from the default,
because a default cannot spend money. What the default actually decided was which *question* the
panel opens on — and the interesting one, the one this app exists to offer, is *describe what you are
looking for*. Find-on-page is the thing every reader already has a keyboard shortcut for.

**The blast radius is bigger than the code that produces those URLs, and the first version of this
change missed that.** `?find=` with no `?match=` was the *only* spelling of a words search before
2026-08-26, so every one that was pasted into a message, bookmarked, or left in a history entry is of
that shape — the library's passage deep-link
([library.md](library.md#finding-an-article-and-finding-a-passage-in-one)) is just the one that is
still generating them. Flipping the default would not have broken those loudly. It would have opened
them in meaning mode with the words they were sent for sitting unread in a parameter nothing looks
at, which is the quiet kind of wrong this repo keeps a
[whole document](../reusable/silent-success.md) about. Caught by a GPT Sol review of this change.

So the rule is not a default at all. `matchParam` has **no** `withDefault` — absence has to stay
visible — and one exported function decides:

```
  ?match= says something   →  that
  ?match= absent, ?find= set   →  words     ← the URLs already in the world
  ?match= absent, no ?find=    →  meaning   ← the new default
```

`resolveMatcher` in [`params.ts`](../../src/web/params.ts), used in one place
([`App.tsx`](../../src/web/App.tsx) § SearchBand), tested against the URL shape rather than against
the constant. It is safe in the other direction because **`?find=` is cleared on the way into meaning
mode** (below): a live meaning search never has one set, so "has `find`" cannot mean anything else.
The library's link now also says `match=words` out loud, which is the canonical spelling rather than
the fallback.

### The box keeps what you typed when you switch matcher

> if I have text in the input box when I switch from "words" to "meaning" or vice versa, preserve it.
> Put the focus on the input box when opening the mode.
>
> — Greg, 2026-08-26

The two matchers have two lifecycles — words is `?find=` and therefore controlled, meaning is a local
draft and therefore not ([`SearchPanel.tsx`](../../src/web/SearchPanel.tsx) § Box) — and before this
the reader could see the seam: pressing the other matcher emptied the box. That is the worst possible
moment to lose it, because switching matcher *is* the act of saying "try this same thing the other
way".

`?find=` is cleared on the way **into** meaning mode rather than left behind, which matters more than
it looks: a literal query sitting in the URL while a meaning search is on screen is a parameter
nothing is reading, and the deep-link rule above would read that URL as a words search.

Focus was already taken on mount, and was silently lost on every matcher switch — the `<input>` was
keyed on the matcher, so switching **replaced the element** and a mount-only effect held a ref to a
node that no longer existed. The key is gone now: it was there under a comment claiming one mode's
input was uncontrolled, and neither half was true (`value` is always supplied), so all the remount
ever bought was throwing the caret position away.

**Which leaves the question of when focus should move at all, and the answer is: it depends how you
switched.** A pointer click on a matcher means *I want to type now*, so focus goes to the box. A key
press inside the matcher pair means *I am still using this pair*, so it does not — otherwise the
first arrow press throws you out of the group you are arrowing through. That is the same distinction,
and literally the same `e.detail > 0` test, as the bottom bar's mode switcher
([`Dock.tsx`](../../src/web/Dock.tsx) § DockModes).

Which in turn forced the pair to become a **real** radio group. It claimed `role="radiogroup"` and
delivered none of what that promises: two tab stops instead of one, and no arrow keys. It now has the
roving tabindex and shares `nextModeIndex` with the bottom bar rather than growing a second copy of
the wrapping arithmetic. Both of these came out of a GPT Sol review.

### And the fetch, which can still take the text away

A saved run's criterion arrives from the server. Land on `?mode=search&run=<id>` and for the length of
one request `runs` is `[]`, so the criterion is empty — and the box is now focused, so **the reader
can already be typing when the answer lands**, at which point the effect that fills the box from the
criterion deletes what they wrote. The autofocus did not create that race so much as make it
reachable.

A `dirty` ref is the guard: once the reader has touched the box, the criterion stops being allowed to
overwrite it. Opening a *different* saved run clears the flag, because that is a deliberate act that
plainly means "show me this one". Escape sets it too — an emptied box is the reader's as much as a
typed one, and a criterion landing afterwards would refill something they had just cleared on
purpose.

`order` is a separate parameter from the glossary's `?sort=` rather than one shared one with five
legal values, because two modes' orderings have nothing in common but the word — and
`sort=difficulty` arriving in search mode would be a value with no meaning that something would
eventually have to guess at.

Every parser degrades rather than throwing: an unknown `match` is `meaning`, an unknown `run` is the
list, an unknown `order` is document order. Same rule as everything else in
[url-state.md](url-state.md).

## How the pieces fit

```
  SearchPanel.tsx ─── App.tsx § SearchBand ─── useSearch.ts ──POST /api/search/<slug>──┐
   the box, the         the four ?params,       the client half,                       │
   toggle, the list      and the ONE place       one POST one answer                   ▼
        │                the two matchers                                        routes.ts § search
        │                    meet                                                      │
        │                       │                                             ┌────────┴────────┐
        │                       ▼                                             ▼                 ▼
        │              search-hits.ts                                   searches.ts        search.ts
        │            findLiteral / resolveHits                         data/<slug>/       OpenRouter,
        │            → Found[] → hitMarks()                            searches.json      no web search
        ▼                       │                                                              │
  the results list              ▼                                                        validateHits()
                        App holds Found[] ──► TableView ──► annotateHtml ──► mark.hit     ▲
                                                                                          │
                                                     src/quote-match.ts ──────────────────┘
                                                     the same findQuote() both ends use
```

The one seam worth knowing: **`SearchBand` computes the results and pushes them up to `Reader`,
which owns the prose.** Not because that is elegant — it is the awkward half of a hook that must
fetch only inside its own mode — but because the panel and the marks *must* be showing the same set.
Computing them twice from the same inputs would work until the day one side gained a filter, and
then the list and the highlights would quietly disagree. Same shape as the glossary's `onSelected`.

## The third search: the whole library at once

Everything above is **inside one article**. On 2026-08-26 a third search arrived, on the home page,
and it is worth naming all three together because they are easy to confuse:

| | scope | how | cost |
|---|---|---|---|
| `findLiteral` ([`search-hits.ts`](../../src/web/search-hits.ts)) | one article | substring, in the browser | free |
| `findPassages` ([`search.ts`](../../src/search.ts)) | one article | a model call | seconds, and money |
| the shelf's box ([library.md](library.md#finding-an-article-and-finding-a-passage-in-one)) | **every article** | a text index, on the server | free |

The third one **keeps this document's shape on purpose**: one box, two matchers, the free one the
default. There the two are "filter the cards" (in the browser, over the four fields a card shows) and
"find the passages" (on the server, `websearch_to_tsquery` under Postgres and a folded substring scan
under the filesystem store).

Two things travel between the two features, and they are what make the handoff work:

- **A hit is anchored the same way** — block id first, quote text second, offsets never as primary.
  [§ What a hit is anchored to](#what-a-hit-is-anchored-to) is as true of a library hit as of an
  in-article one.
- **A library result deep-links as `/read/<slug>?at=<blockId>&find=<query>`**, so landing on it lights
  the same words up through the machinery already described in [§ The URL](#the-url). Reusing `?find=`
  rather than inventing a third parameter is the whole reason that works.

What they do **not** share is the ranking. `ts_rank_cd` weighs term density and proximity; the
filesystem scan counts and damps by length; and the model-driven `confidence` in this document is a
third thing again, which is why `LibraryHit` deliberately has no `confidence` and no `reasoning`
field. There is nothing for a text index to be uncertain about and nobody to explain anything.

Meaning-based search across the library — embeddings, pgvector, a blended list — is **deferred**, by
Greg on 2026-08-26. The research is in [postgres-search.md](../research/postgres-search.md); the
short version is that Supabase gives you `ts_rank` rather than BM25, `pgvector` is available but not
enabled, and Anthropic has no embeddings API so it would mean a second vendor.

## What is still open

- **No keyboard shortcut** opens search, and nothing steps between results with the arrow keys. The
  app still has no shortcut map at all — the gap [keyboard.md](keyboard.md) and
  [bottom-bar.md](../plans/bottom-bar.md#what-is-still-open) both record.
- **Nothing marks where the hits are on the spine.** Three results scattered through a long article
  are three places you have to scroll to find. Each row now says *where* it falls
  ([above](#where-in-the-article-on-every-result)), which is half the answer — you can see at a glance
  that everything matched in the first third — but it is still a number per row rather than a map. A
  shared rail of ticks is the thing that would actually fix it, and the spine already knows about
  block positions. It is the same pattern Chrome and Firefox put on the scrollbar for find-in-page
  and VS Code puts in its overview ruler, so there is plenty of prior art to copy.
- **A hit that is real but wrong** — the model quotes an adjacent sentence that does not actually
  match — is undetectable from here and uncounted. Only a quote that is not in the block at all is
  caught. The same residual [chat-mode.md](../plans/chat-mode.md#what-is-still-open) has.
- **One result set at a time.** You cannot hold a meaning-search on screen and a words-search at
  once, or two saved searches together. Their version had the same limitation and called it debt;
  here it is a deliberate simplification, but it *is* the thing to revisit first if comparing two
  criteria turns out to be what people want.
- **No re-run of a stale search.** A saved search is answered against the article as it was; if the
  article is re-extracted, hits whose blocks are gone are silently dropped and the rest may have
  moved. Nothing says the run is out of date, where the tweet thread page does say exactly that
  ([tweet-thread-page.md](../plans/tweet-thread-page.md)). A `sourceHash` on the run would fix it.
- **Words mode has no whole-word or case-sensitive option.** Deliberately: find-on-page has a
  meaning readers already hold, and the reader who wants cleverness has the other toggle. But it is
  the first thing somebody will ask for.
- **No evidence it helps.** Which is the criticism the previous version earned for its chat, and
  repeating their mistake would mean never asking.
  [Q6](open-questions.md#q6) is where "how would we know we are failing at this" lives.

## See also

- [original-version/highlighting.md](original-version/highlighting.md) — the feature this is borrowed
  from, the overlapping-marks wall, and the confidence-unit bug
- [original-version/search-and-chat.md](original-version/search-and-chat.md) — their text search, the
  two snippet lengths, and why one UI should serve both matchers
- [block-ids.md](block-ids.md) — the contract every hit is anchored to
- [glossary.md](glossary.md) — the other mode that marks up the prose, and the rule both follow about
  when the article may acquire marks
- [comments.md](comments.md) — the older marks-on-prose feature, and where `resolveMark` came from
- [chat-mode.md](../plans/chat-mode.md) — the mode band this is the fourth tenant of
- [url-state.md](url-state.md) — `?match=`, `?find=`, `?run=` and `?order=` among the rest
- [design-css-overview.md](design-css-overview.md) — the tokens, and `--hit-rgb` among them
- [logging.md](logging.md) — what a model call may and may not write down
- [testing.md](testing.md) — why the model call itself is not tested and the validation is
