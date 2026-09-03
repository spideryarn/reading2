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
 │ ⊞Hierarchy ▤Summary 𝐀Glossary 🔍Search ⌸Chat │ ✳Questions ≡Tweets ⓘMetadata  │
 └─────────────────────────────────────────────────────────────────────────────┘

   ▐92▌ the model's confidence, printed as well as drawn
   ▬▬▭  where in the article the passage falls — on a literal result too
   ▐62▌how sure ▬▭ where   the legend, so neither mark is hover-only
   ┃    the bar down a matched paragraph, scaled HARDER than the wash
   ▂    the wash, over the words the model actually quoted
```

**Chat can now run both of these matchers as tools** — `search_article_meaning` is `findPassages`,
and `search_article_words` is the library box's query language pointed at one article: it imports
`parseQuery` and `fold` from [`src/library-search.ts`](../../src/library-search.ts) rather than
inventing a second idea of what a quoted phrase means. See [chat-tools.md](chat-tools.md).

Be exact about how far that sharing goes, because an earlier version of this paragraph said "the
three share `parseQuery`/`fold`/`occurrences`" and **all three halves of that were wrong**. There
are three word-matchers here and they are deliberately three:

| | What "matches" means | Why |
|---|---|---|
| the reading view's box (`findLiteral`) | a plain case-insensitive substring | this is find-on-page, and find-on-page has a meaning readers already hold — including matching inside a longer word |
| the library box (`searchLibrary`) | `parseQuery` terms and quoted phrases, accent- and punctuation-folded, ANDed | you are looking for an article, not a place in one |
| chat's `search_article_words` | the same parsed query, matched on **whole words** | a model asking "does this piece discuss *ion*" must not be told yes by "opinion"; chat-tools.ts § the tool says why it diverges from `occurrences` |

The reading view's box shares nothing with the other two, and that is the design rather than an
oversight. What it does share is the *offset* discipline: since a GPT Sol review on 2026-08-26 its
case folding is length-aware, because `toLowerCase` is not length-preserving — one `İ` earlier in a
paragraph used to put every later offset out by one, which moved the wash and the snippet a letter
to the right and threw nothing. `library-search.ts` had that trap written down already, in a
function doing the same job.

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
contract chat's citation chips hold ([260826a-chat-mode.md](../plans/260826a-chat-mode.md#the-citation-contract)),
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

`?mode=search` is one value in `MODES` — the fourth to arrive, after the table of contents (called
`toc` then and `hierarchy` since 2026-08-29), chat and the glossary. Greg's original framing of that
band, from
[260826a-chat-mode.md](../plans/260826a-chat-mode.md#gregs-reframing-which-is-the-actual-design):

> I'm thinking that this might be a common pattern, that when we switch into a mode (e.g. Chat,
> Glossary, etc) we'll want to keep the spine and article, but reuse the middle sections.
>
> — Greg, 2026-08-25

This is the third mode to arrive in that slot and it cost the layout **nothing**: no change to
[`layout.ts`](../../src/web/layout.ts), no new term in the arithmetic, one word in `MODES`, one row
in `MODES_UI`, one component. That is now enough evidence to stop calling the slot an experiment.

The cost is the one 260826a-chat-mode.md already stated: **the granularity columns are gone while you
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
[260825c-bottom-bar.md](../plans/260825c-bottom-bar.md#the-dimmed-placeholders-are-gone).

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

What this deliberately is **not** is a map. A number per row says *where*, and it does it for one
result at a time; seeing the shape of a whole search takes a picture of the article, which is the
rail. That arrived on the same day — [The rail, and the shape of a
search](#the-rail-and-the-shape-of-a-search) — and the two are complementary rather than
overlapping: the bar under a row places one result against the piece, the rail places all of them
against each other.

## The counts in the log line

Every finished search writes one line under `model` carrying, besides the usual timings and token
counts, a set of numbers that exist because **each of them is invisible from the outside**. A dropped
hit looks exactly like a passage the model chose not to return, and "nothing in this article matches
that" is a legitimate answer a reader sees. Textbook [silent-success](../reusable/silent-success.md),
handled by making it countable.

*(This heading said "the four counts" until 2026-08-26, while `Dropped` carried five and the
streaming work was about to add another. A number in a heading is a hostage to the next change.)*

| Count | What it means when it climbs |
|---|---|
| `unknownIds` | the model is citing block ids the article does not have — the id contract has stopped working |
| `unquoted` | the model is paraphrasing what it claims to be quoting |
| `subOne` | the confidence unit has drifted to 0–1 |
| `clamped` | confidences are arriving outside 0–100 and being pulled back into range |
| `truncated` | a criterion is matching more than `MAX_HITS` passages and the list is being cut |
| `streamedHits` | how many hits the reader was shown *before* the authoritative parse ran — see below |

**Never logged**: the criterion, any quote, any reasoning, the article, the key. A criterion is as
private as a selection — it is what somebody was looking for. See [logging.md](logging.md).

## The results arrive one at a time

**Since 2026-08-26.** Search asks for one JSON object and used to wait for all of it, which is
thirty to sixty seconds of spinner. It now shows each passage as it lands.

The reason this took a second look is worth keeping, because the first answer was confidently wrong.
The argument for not streaming was: *a search result is a list, not prose — half a JSON array is a
syntax error, so there is nothing to paint until it parses*. The first half is true. The conclusion
is not. Hits come back **best first**, and a *complete hit object* is renderable the moment its
closing brace arrives. The apparent alternative — asking for JSON Lines instead — would have changed
the prompt and therefore the ranking, which is a question about result quality and belongs in
[`evals/`](../../evals/README.md); it is also unnecessary. **Nothing about the prompt changed.**

[`search-hits-stream.ts`](../../src/search-hits-stream.ts) is a brace counter with a one-character
lookahead for strings and escapes — deliberately not a JSON parser. It hands back each element of
the `hits` array as it completes. Braces inside quoted prose do not count, which matters because
article prose is full of them.

**What makes a brace counter acceptable is one property, and it is worth stating exactly**, because
it is what a future change must not quietly break:

> Everything fed in is kept verbatim, so the strict whole-response `parseHits` + `validateHits`
> still decides what gets stored. The extractor's output is a preview. A hit it misses, splits
> wrongly, or never completes costs a **late** hit — never a wrong one.

That claim was false for about an hour after it was first written: the extractor took *the first
array one level inside the object*, so a reply of `{"notes":[…],"hits":[]}` would have previewed a
hit the stored result did not contain. Found by cross-model review. It keys on the `hits` key now.
The lesson generalises — **a comment claiming a safety property is not the property**, and this one
was the entire justification for the design.

Mid-stream hits go through `validateHits` one item at a time, the same function and not a copy, so a
hit shown while the reader watches has already passed the check the final pass will run again. That
is not tidiness: `validateHits` is where the quote is matched with `findQuote`, **the same function
the browser uses to decide which characters to wash**. A second set of rules here would let the
panel and the prose disagree, which is the thing this whole feature is built to avoid.

`streamedHits` in the log line exists for the one failure that is otherwise invisible: the reader
sees a row appear, and then quietly not be there once the run is saved.

One more consequence, in [`openrouter-stream.ts`](../../src/openrouter-stream.ts): **search reads
the stream strictly and chat and explain do not.** A malformed SSE frame costs prose a few words,
which is worth swallowing. It can cost one JSON object a whole array element while leaving text that
still parses — a confidently wrong answer, stored.

And, since 2026-08-26, **a clock on the bytes**. The hook already handled a stream that *ended*
without a `done` frame — that is the "The search stopped arriving" failure. It had nothing for a
stream that goes quiet without ending, which delivers no bytes and no error and leaves the reader
watching a spinner with nothing behind it. `readEvents` now gets the same 60-second `stallMs` chat
uses, and `sse(res)` beats a `: ping` down this route every 15 seconds so that silence means
something. There is nowhere for a search to *recover* to — unlike chat, which goes and looks for
the answer the server finished writing — so all this buys is the failure it already knew how to
show. See [260826r-sse-stall-recovery.md](../plans/260826r-sse-stall-recovery.md).

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

## Several searches at once, each with a colour

> assign a categorical colour to each of the "Search" highlights. And then add a checkbox by each of
> them (default-false), and allow multiple to be active, showing their results overlaid somehow. And
> a box at the top of the "Search" column for select/deselect-all.
>
> — Greg, 2026-08-26

Before this, a saved search was a thing you *opened*: pressing it replaced the list with its results
and `?run=` named the one that was open. Now every saved search is on screen all the time with a box
beside it, several can be on at once, and their results are one list.

Four decisions, all Greg's, taken together as one design.

**The colour belongs to the search, not to the passage.** One hue per saved question, so a mark in
the prose answers *which of my questions found this*. Eight hues, from
[colour-scales.md](colour-scales.md) — that page has the palette, the colour-blindness argument and
the honest ceiling on how many anyone can tell apart.

**Overlap is stacked rules, not blended washes.** Where two searches cover the same words, the words
get one wash and *two* thin coloured rules under it, stacked. The alternative — each search painting
its own translucent wash, mixing where they meet — is prettier for two and turns to mud at three,
and the mud is a colour that **is not in the palette**, so a reader cannot look it up. Worse, each
extra layer eats the text's contrast. Stacked rules stay identifiable however many there are, and
the contrast of the prose underneath never changes at all.

That forced a split that turns out to be the good part of the design: **the wash carries confidence,
the rules carry identity.** The wash is now a deliberately low-chroma slate (`--hit-wash-rgb`) so it
can never be mistaken for one of the eight; the rules are at full strength, so a low-confidence match
is still unmistakably *blue* rather than fading toward grey. Before this the wash carried both and
the two would have fought: a 35%-confidence blue and a 35%-confidence pink are both nearly the same
faint nothing.

The rules are drawn as a gradient inside the mark's own box, in `padding-bottom` — which grows the
mark's background downward into the leading **without touching the line box**, so switching a search
on cannot reflow the article. The band caps at 6px and the stripes inside it get thinner rather than
the band growing; past **six** they are not drawn at all (`HUE_STRIPES` in
[`annotate.ts`](../../src/web/annotate.ts)). It was four, and a GPT Sol review pointed out that the
justification for that — a fifth stripe would be sub-pixel — was simply arithmetic nobody had done:
six stripes in six pixels is one pixel each. The bar down the paragraph has no such cap, because it
is as tall as the paragraph and can show all eight. There is a `box-decoration-break: clone` on that rule, and the story of it is worth keeping
because it is a good example of a plausible rationale that was simply untrue. The comment beside it
claimed the default, `slice`, would draw a bottom-anchored stripe once at the foot of the last line
and leave the first line of a wrapped phrase bare. A GPT Sol review disputed it; a browser pass
toggled the property live on a real wrapped match and pixel-diffed the result. **Chrome renders the
two identically** — 12 differing pixels out of 42,780 across the line boundary, which is
antialiasing.

The reason is what to remember: the stripe is sized and positioned in *percentages*, which resolve
against each fragment's own box. `slice` only differs where a declaration reaches for the unwrapped
box — an absolute background size, the inline-start/end padding, the corners a radius rounds. So
`clone` is kept as insurance (it is free, Safari and Firefox are untested, and the day someone
replaces that `100%` with a pixel width it starts mattering), not as the thing making this work.

**The bar down the left of the paragraph is divided too**, and it answers a coarser question on
purpose: *is any of my searches in this paragraph*, which is the thing you catch while scrolling
past at speed. So a paragraph where one search matched the first sentence and another matched the
last gets two segments in its bar and one rule under each phrase, and both are true. `blockHues` in
[`search-hits.ts`](../../src/web/search-hits.ts).

**Default-false**, which is the rule the glossary and the summaries already follow: *the article
acquires marks when the reader asks for them and at no other time.* Asking a new question is the one
exception — it ticks its own box, because a search you just paid for and cannot see is not a result.

**One merged list.** Every ticked search's passages in a single list, sorted by place or confidence
across the lot, each row wearing its search's colour on a dot and its left edge. The alternative —
a sub-list per search — keeps provenance obvious but makes "the strongest match anywhere" a question
the panel can no longer answer. So provenance moves into the row instead: the dot, the edge, the
criterion in the hover card, and the criterion in the row's accessible name.

### Pressing the row is not the same as pressing the box

> if I click on a row, select that and deselect all the others (since usually we care about just one
> at a time). If I want multiple-selection, I'll use a checkbox.
>
> — Greg, 2026-08-27

The set stayed. What changed is which gesture builds it. Until now the box and the words beside it
were one `<label>`, which is the right thing for a checkbox and its text and the wrong thing for a
list: every press added or removed, so getting from four ticked searches to *just this one* was four
presses, and the common case was paying for the rare one.

Now there are two controls on the row, and the difference between them is the difference between
**and** and **only**:

| you press | what happens |
|---|---|
| the checkbox | this search is marked *as well as* whatever is already marked |
| anywhere else on the row | this search is marked and every other is unmarked |

The row is a `<button>`, so the keyboard reaches it and Enter does what the click does, and it is
**not a toggle** — pressing the row that is already the only one on leaves it on. "Show me just
this" is a place to arrive at rather than a switch, and a second press emptying the article would be
the panel punishing a reader for pressing twice. Unticking is what the box is for.

This is one more hit area on a row that already had three, which is the arrangement
[library.md § What you can do to a card](library.md) describes giving up on — a nested button inside
a clickable row does two different things a few pixels apart. What makes it survivable here is that
neither of these two is destructive, and both are one press from being undone: a mis-hit marks the
wrong searches until you press the right thing. The pixels still matter, so the box keeps padding of
its own rather than sharing the row's. [`SearchPanel.tsx`](../../src/web/SearchPanel.tsx) § Four
targets on a row, and `.srch-saved-tick` / `.srch-saved-body` in
[`styles.css`](../../src/web/styles.css).

**The honest cost, measured** in the browser at the narrowest band (`MODE_MIN`, 288px): the box's
target is **26 × 46px** and the row button's is **183 × 46px**, with a 3px gap between them, so the
box is a smaller thing to aim at than it was — it used to be the whole row, because the whole row
was its label. Tall enough for a pointer, and the four or five pixels to the right of the tick still
belong to the label rather than to the button, which is the direction a near miss actually goes. On
a touchscreen it is under the 44px square the guidelines ask for on one axis, and that is a real
debt rather than a resolved question. The row button keeps the app's own orange focus ring
(`--highlight`, the convention `.cmt-dialog button:focus-visible` explains) inset by 2px, because
the list is a scroller and an outward ring on the first or last row is clipped by it.

### Changing a row's colour

> In Search mode, I'd like to be able to change the colour for a given row.
>
> — Greg, 2026-08-27

The fourth control on the row: a palette icon that opens a popover with the eight hues in it, and a
ninth choice called **Automatic** which hands the row back to the hash. It is the day-after reversal
of a decision on this exact subject, and [hit-colours.ts](../../src/web/hit-colours.ts) argues its
own case both ways — the short version is that the objection to storing a colour was an objection to
storing a *derived* value, and a colour the reader picked is not one. What that objection was really
protecting is intact: **what gets stored is a slot number, and nothing outside `colourscales.css`
ever learns what colour it is.**

Three things about it are worth knowing before touching it, and all three are in
[260827l-search-row-colour.md](../plans/260827l-search-row-colour.md) in full:

- **The assignment is two passes now.** Every chosen slot is reserved before a single automatic run
  probes, so a pin is a pin rather than a preference. And two searches *may* share a hue if the
  reader says so — that is an instruction, not a collision.
- **The check on the stored value is deliberately looser than the palette** (sixty-four, not eight).
  The server does not know how many hues there are, so a tight bound would be a constraint holding
  an opinion it cannot keep current. A slot past the end of the palette falls back to automatic;
  a constraint pinned at 8 would instead refuse a reader's choice the day the palette grows.
- **Slot 0 is a colour and `null` is a command.** Every obvious shape of validation gets one of them
  wrong: `if (!colour)` refuses the first hue in the palette, `if (colour !== undefined)` lets a
  float through to a custom-property name, where it paints nothing and says nothing.

**Sixteen hues, arranged as a wheel** — Greg again, once the picker existed:
*"add more colours, arranged more naturally."* The grid is 4×4 in hue order, so
each row is a quarter of the circle (warms, greens, blues, violets) with the one
colourless slot parked at the end. Two things about that are worth knowing:

- **The hash still hands out only the first eight.** `CATEGORICAL_SLOTS` against
  `PALETTE_SLOTS` — growing one number instead of two would have recoloured
  every saved search anybody has ever run, and would have broken the
  distinguishability argument exactly where it matters, which is hues nobody
  chose overlaid on one paragraph. [colour-scales.md](colour-scales.md) has the
  measurements, including the pairs that collapse under dichromacy.
- **"Arranged more naturally" is a checked property.** The order is a list of
  slot *numbers*; a test reads `colourscales.css`, converts each triplet to
  OKLCH and requires that list to be sorted by hue angle. Move a hue and a test
  goes red rather than the grid quietly falling out of order.

**No colour-picker library**, and not for the usual reasons — `react-colorful` is 5.9M downloads a
week, zero dependencies and 4.8KB. It is the wrong tool because it picks an *arbitrary* colour, and
an arbitrary colour is the thing this control must not offer: the eight hues were chosen together
for a near-black page ([colour-scales.md](colour-scales.md)), and the first thing anybody reaches for
on a black background is a dark one nobody will be able to see. The picker is Floating UI, which was
already here for the tooltips, with `useClick` where the tooltip has `useHover`. Note that "more
colours" did **not** become a wheel — it became sixteen vetted ones, which is the same answer with a
bigger number in it. The reason for a fixed set is that every hue has to survive a near-black ground
and stand apart from its neighbours, and that is no less true of the sixteenth than of the eighth.

## The rail, and the shape of a search

> And also show the Spine by default when "Search" mode is active, and add dots/thin vertical lines
> of the relevant search-colour in all the places where there's a match in the Spine so it's easy to
> see at a glance where the results are in the doc (and how common).
>
> — Greg, 2026-08-26

The results list can tell you *what* matched and the marks in the prose can tell you *where a
particular one is*. Neither can tell you the thing you actually want to know after running a search:
**what shape is it.** Thirty passages clustered in one section and thirty spread evenly through the
piece are the same list. They are not the same finding, and only one of them means "this article is
about my question".

The [spine](granularity-zoom.md#the-spine-a-birds-eye-rail) is already a squashed picture of the
whole article, so it is the one place that shape exists. Search results now paint into it:
[`spine-marks.ts`](../../src/web/spine-marks.ts) does the arithmetic,
[`Spine.tsx`](../../src/web/Spine.tsx) measures and draws.

**One lane per search, down the right-hand edge.** With several searches on at once, a single
stacked column could only say "something matched here" — which is exactly the question the colours
were introduced so that it would not be the only one anybody could ask. Parallel lanes say *whose*
match, and where each search is dense. The lanes are **packed** rather than fixed to slot numbers:
two searches get two lanes whichever of the eight palette slots they happen to wear. Fixing them to
the slot would mean nothing ever moved sideways, at the price of a rail permanently divided into
eight tracks, six of them empty and each under three pixels wide — the wrong trade for a rail whose
whole job is to be readable out of the corner of the eye. The cost is stated rather than hidden:
switching on a search that sorts before an existing one shifts the existing one's lane. The
*colour*, which is what says whose match it is, does not move.

**One lane may be wider than eight lanes are.** The gutter is a fixed 10px slice of the 12px rail,
divided between however many searches actually matched, and capped at 5px so that one search draws a
tick rather than a slab. Two lanes fill the gutter exactly, so one search and two searches — nearly
all real use — each get a 4px bar. That cap was tuned by a browser pass which called an earlier,
narrower one "easy to miss with only one or two searches active, since the gutter isn't fully used
then", and the point survives every change to the numbers since: a cap tuned for the crowded case
leaves most of the rail empty in the common one.

**The gutter did not halve when the rail did**, on 2026-08-28. A mark's legibility is absolute
rather than proportional — 2.5px is not "the same bar, smaller", it is a bar you cannot tell from
the L2 hairline — so the numbers were chosen to keep the common cases identical rather than to keep
the ratio. What that costs is at the crowded end, and it is stated rather than hidden: the 1.5px
floor starts governing at four simultaneous searches and exceeds the pitch at seven, past which
adjacent lanes merge into one band of colour. No 12px rail can do better; eight distinguishable
lanes need 20px. The panel still lists every search whatever the rail can draw.

**A mark is as tall as the paragraph it names**, floored at three pixels. That is the same
proportional promise the bands themselves make, and it is what makes "how common" readable at a
glance — a search that matched six long paragraphs paints far more of the rail than one that matched
six list items, which is true and is what you want to know.

**The count *within* one paragraph is deliberately not a visual channel.** Three matches in one
paragraph and one match in it are the same mark. The rail has no room to say otherwise without
inventing a width or an opacity the reader would have to learn, and it already has two channels in
use. The number goes in the band's hover card instead — *"4 matches"* beside the word count and the
percentage — and into the band button's accessible name, where there is room for the word.

### The ruler, which is the thing this could have got silently wrong

A result row already says how far through the article it falls, and that number is measured in
**characters** — deliberately, because it is computed where there is no DOM and characters are the
cheap stand-in for height ([§ Where in the article](#where-in-the-article-on-every-result)). Reusing
it here would have been one line and wrong: twenty one-line list items hold very few characters and
a great many pixels, so a mark placed by the character ruler drifts out of the band it belongs to.
A bird's-eye rail that points at the wrong section is worse than no rail, because it is still
pointing confidently.

So the marks are placed from the **measured pixel geometry the spine already reads out of the DOM**
— the same `tr[data-block]` rects the bands are sized from, in the same coordinate system. It is the
same reasoning that made the bands measure heights rather than count words in the first place. None
of this is visible in a screenshot, which is why [`tests/spine-marks.test.ts`](../../tests/spine-marks.test.ts)
exists: every failure in this file renders perfectly.

### The words matcher has a lane too

`blockHues`, which divides the bar down the left of a paragraph, drops a `null` slot — a literal
match belongs to no saved search, and the bar falls back to the one fixed search hue it always had.
The rail has no such fallback, and reusing `blockHues` there would have meant it showed every search
that cost money and **nothing at all** for the free one, which is the matcher a reader is most
likely to be using. So `blockMatches` carries the `null` through and
[`spine-marks.ts`](../../src/web/spine-marks.ts) turns it into a lane in `--hit-rgb`. The two
functions are one implementation and two views of it, and a test pins that they agree.

### Entering search mode brings the rail back

`?spine=0` is a choice about the page rather than about the mode you happen to be in, so it
survives a trip through chat or the glossary ([layout.ts § fitMode](../../src/web/layout.ts)). But a
reader who has put the rail away and then opens search would find half of this feature drawn
somewhere they cannot see. So **pressing Search in the bottom bar clears `?spine=`** — back to
automatic, which in a mode means on.

On the transition and **not** as a standing rule, which is the part worth getting right. A rule that
re-asserted the rail whenever search mode was open would make the `Spine` pill dead in exactly the
mode this is about: press it off, and it comes straight back. "By default" is a fact about arriving,
not a fact about staying — so it is also gated on actually changing mode, since the dock calls its
handler for a press on the mode you are already in.

The cost is real and is not hidden: this **throws the preference away rather than suspending it**.
Come back to reading mode afterwards and the rail is there, with no memory that you had hidden it.
Suspending it would mean `?spine=` growing a per-mode shape — a lot of machinery for one bit — and
the alternative of leaving it alone means a reader who has hidden the rail opens search and finds
half a feature drawn somewhere they cannot see. The pill is one press away.

## Prioritised: place order with a bar under it

> add a "Prioritised" ordering/filtering (kinda like how we do with Glossary) that orders by place
> but thresholds by confidence, and a threshold slider to the UI
>
> — Greg, 2026-08-26

A third option beside *by place* and *by confidence*. It sorts exactly as *by place* does and
**hides** every passage the model was less than `?conf=` sure of — 50 to start with, on a slider.
50 is the midpoint of the scale the rows already print, and is chosen for that and not because it
means *more likely than not*: this confidence is
[not a probability](#what-the-number-means-which-printing-it-does-not-say), and a starting position
described as one would be the flattering reading the hover card was rewritten to avoid.

**It hid where the glossary grouped, and since 2026-09-03 all three thresholds hide.** This one was
the odd one out and is now the model the other two follow —
[glossary.md § It hides what is below it](glossary.md#it-hides-what-is-below-it-since-2026-09-03)
has Greg's words and the shared rule, [`src/web/threshold.ts`](../../src/web/threshold.ts). What
changed with them is that this panel gained the **foot line** saying how many are hidden, which it
did not have and which was the only thing Greg asked for that it was missing.

**The reference-list argument this section used to make did not survive contact**, and it is worth
naming rather than quietly deleting. It ran: a glossary shows every term and lifts the ones that
clear the bar to the top, because a glossary is a reference list and *a term you cannot find is a
term you have lost*; a search is the opposite errand, where the reader is hunting and what they want
done with a weak match is for it to go away. It treated hiding as loss. The bar is on screen with
its number, the foot line says how many it is holding back, and dragging it left is one gesture — a
result is not lost when the control that hid it is the control in your hand.

What the argument got right, and what still holds, is that hiding is worth *more* here than next
door. (The prompt does tell the model to leave weak matches out, so this is not a claim that the
matcher is careless — it is that *the model's* bar and *this reader's* bar are different bars, and
only one of them can be moved.) It also fits *"orders by place"* better than grouping does: two
groups is not place order, it is group order with place inside it. The phrase is ambiguous and this
is a reading of it rather than the only one — GPT's review, which agreed with the call, was right
that the first draft of this paragraph overstated that.

**And hiding buys something a list cannot show.** The dropped results lose their marks in the prose
too, because [`App.tsx`](../../src/web/App.tsx) computes one array and hands it to both the panel and
the article — the same single-source rule the `hitMarks` prop in
[`TableView.tsx`](../../src/web/TableView.tsx) already existed for. So the bar declutters the page,
not just the list. Grouping would have left every weak wash exactly where it was. That is the
argument for the design rather than merely a consequence of it.

### The four ways a filter lies, and what stops each

A threshold can swallow the reader's results and look like an ordinary empty list, which is
[silent success](../reusable/silent-success.md) with a slider on it. So:

- **A result with no confidence always survives, at any bar.** Every result in words mode has a null
  confidence, so treating null as low would empty that list the moment an `?order=prioritised` link
  was opened there. Absent is not low — the same rule `orderFound` already followed when it sorted a
  literal match as certain. It is one line, `clears` in [`search-hits.ts`](../../src/web/search-hits.ts),
  and it has a test of its own.
- **The count says `3 of 11`, never `3`**, and under the track a line says *"8 passages are hidden by
  this threshold. Drag the slider left to show them."* A filter that hides eight things must not look
  like a search that found three. Both come out of one pass over the list (`applyConf` in
  [`search-hits.ts`](../../src/web/search-hits.ts)), because a count that disagrees with the list
  under it is the worst thing this feature can do.
- **"Nothing matched" is not printed when the reader hid it all.** That empty state would have taken
  the slider off the screen along with the results, leaving no way back. The zero case keeps the
  slider and says what actually happened.
- **`?conf=0.5` parses to nothing rather than to zero.** `?gate=` is a 0–1 fraction and sits beside
  this in the same URL, so a fraction is exactly what somebody writes here by mistake;
  `Number.parseInt` would have made it `0`, a bar that hides nothing with nothing to see. `conf` is
  in the **same 0–100 unit the rows print**, which is the whole point given
  [the unit that changed silently](#the-confidence-and-the-unit-that-changed-silently) above — a
  threshold in a different unit from the numbers it hides would be that bug wearing a slider.

The slider is the glossary's `GateSlider` in every respect that can be shared: the number on screen,
the count on screen, the foot line in every state including none and all, and a reset that only
appears once there is something to reset. Its track is the exception — a fixed 0–100, because that
is the unit the rows print, where the glossary's ends where its data does.

**Not the default**, and it stayed that way when the glossary started hiding too. The reason given
in 2026-08-26 was that the glossary's default only reordered while this one would hide; since
2026-09-03 both hide, and what is left is the better half of it anyway — **a reader who has not
asked for a filter should not have results kept from them.** A glossary is a list of the article's
terms, there before the reader asked anything; these are the answer to a question they just typed.

### What this removed

Worth recording, because each of these looked like a feature and was a consequence.

- **The list-or-results ternary** `SearchPanel` was built around. Both are on screen now.
- **The `dirty` ref in `Box`**, and the effect it guarded. That effect existed because a saved run's
  criterion arrived from the server a whole request after the box was focused, so it could overwrite
  what the reader was typing — a real race, found by a GPT Sol review. With no search "open", nothing
  arrives from the server wanting to be in the box. Putting a saved question back is now the ↺ button
  on its row, which is a click, and a click cannot land mid-word. The guard is gone because its
  *cause* went, not because it was unnecessary.
- **The retry button in the results area.** A failure belongs to the search that failed, and with
  several on there is no longer one failure for a shared area to be about. It is now a ⚠ on the row.

### The bug the key change prevented

A result's key was `blockId:n`, which was unique while exactly one search could be showing. With
three on, three searches that each found their second hit in the same paragraph all produce
`spya-k3m9qt:1`. React renders one and drops the rest with a warning nobody reads, `openKey` matches
whichever comes first, and **the mark in the prose belongs to a different search from the row the
reader pressed**. Every part of that is silent. The key is now `runId:blockId:n`, and it is pinned in
[`tests/search-hits.test.ts`](../../tests/search-hits.test.ts).

## The URL

Six parameters, which is more than any other mode wants, because search mode has two matchers in it
rather than one feature. The division: `match` says which matcher, and then exactly one of `find` and
`runs` is the thing being matched. (`run` is the sixth and is legacy — read on load, never written.)

| Parameter | Values | History | Why |
|---|---|---|---|
| `mode` | `search` | push | A mode is where you are, not a glance |
| `match` | `words`, `meaning` (default) | **push** | It changes what the article looks like, like a column toggle. Back should undo it |
| `find` | any string | replace, debounced 200ms | Written on every keystroke. A Back button that walked back through a half-typed word one letter at a time would be useless — same call `?at=` makes |
| `runs` | comma-separated minted ids | replace | Which saved searches are switched on. Ticking one while you read is browsing; `mode` already put the entry on the stack Back should use |
| `run` | a minted id | replace | **Read, never written.** The single-search spelling from before 2026-08-26, kept so the links already in the world still open the search they name |
| `order` | `document` (default), `confidence`, `prioritised` | push | Changing the order of a list is a deliberate act on the view |
| `conf` | `0`–`100` integer, **no default** | replace, debounced 200ms | Where the prioritised bar sits. Dragged, so the same call `find` makes; absent has to keep meaning *nobody has touched it* |

### `runs` and the singular `run` it replaced

Same shape as `match` below, and the same reason: **absence has to stay visible**, so `runsParam` has
no `withDefault` and `resolveRuns` decides.

```
  ?runs= says something   →  those
  ?runs= absent, ?run= set   →  just that one   ← the URLs already in the world
  ?runs= absent, no ?run=    →  none            ← default-false
```

Comma-separated and spelled out, exactly like `?cols=` and for the reason given there: these URLs get
pasted to people, and a reader should be able to see what a link is going to show them. Ids are
URL-safe by construction ([block-ids.md](block-ids.md)), so nothing needs encoding.

Two differences from `?cols=`, both deliberate. **Order is preserved rather than sorted** — sorting a
set of ids would order the reader's searches by a random six characters, which is not an order, so
what is kept is the order they switched them on in. And **one bad id drops only itself**, where
`?cols=` rejects the whole value: a depth list is short and hand-written, but a run list is
machine-written and long-lived, and the id most likely to be wrong in one is a search deleted on
another machine. Throwing away the other four because of it would be the worst available answer.

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
press means *I am still using this pair*, so it does not. That is the same distinction, and literally
the same `e.detail > 0` test, as the bottom bar's mode switcher
([`Dock.tsx`](../../src/web/Dock.tsx) § the mode switch).

**The pair has no arrow keys**, since 2026-08-31, and neither does the bottom bar or the diagram's
three chips. It briefly had the full radiogroup pattern — a roving tabindex and the wrapping
arithmetic shared with the bar — which a GPT Sol review had rightly asked for, on the grounds that
`role="radiogroup"` is a promise about the keyboard. What that review could not weigh is that on this
page the arrows are *already* spoken for: ← / → choose the granularity stride and ↑ / ↓ step the
article ([keyboard.md](keyboard.md)), and the pattern's `stopPropagation` killed all four whenever a
matcher held focus. Greg met it as a bug and asked for the behaviour removed. Each button is its own
tab stop now, and Enter, Space or a click selects. The full reasoning, and what it costs, is in
[`Dock.tsx`](../../src/web/Dock.tsx) § the mode switch.

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
Greg on 2026-08-26. The research is in [260826e-postgres-search.md](../research/260826e-postgres-search.md); the
short version is that Supabase gives you `ts_rank` rather than BM25, `pgvector` is available but not
enabled, and Anthropic has no embeddings API so it would mean a second vendor.

**When it stops being deferred, the embedding model is already chosen and it was measured rather
than argued.** Four candidates reachable through OpenRouter — `baai/bge-m3`, `voyageai/voyage-4-lite`,
`voyageai/voyage-4` and `openai/text-embedding-3-small` — were run against **this shelf's own 495
paragraphs** with 18 reader-style questions, judged blind on a pooled union so every arm was scored
against identical judgements, and judged twice by two different models to check the verdict was not
one judge's opinion.

Two findings, and only one of them is a difference. **`bge-m3` is genuinely behind** — every measure,
both judges, no interval near zero, and nothing relevant at all in its top five on three of the
eighteen queries where the others fail on at most one. That was the cheapest option and the
originally preferred one. **`voyage-4` and `3-small` cannot be separated**: identical precision@5,
six per-query wins each, every bootstrap interval straddling zero. At this sample size the harness
says "too close to call", and it is written to be able to say that.

So the tie-break decides, and it is stated rather than implied: `voyage-4` is 1024 dims against 1536
and bills to OpenRouter credits, where Greg wanted the billing, against `3-small`'s BYOK to a
separate OpenAI account. **`voyage-4`** — with one prerequisite, below.

Numbers, method and the honest caveats — 18 queries, 221 judged pairs, three English articles, why
absolute scores may not be quoted across runs with different arm sets, and what happens to the
multilingual argument if the shelf stops being English — are in
[evals/results/embedding-retrieval-2026-08-26.md](../../evals/results/embedding-retrieval-2026-08-26.md);
the eval is `npm run eval:embeddings`.

**The prerequisite, and it is not a detail.** Voyage's models 404 on one of the two OpenRouter keys
in play here — *"No endpoints available matching your guardrail restrictions and data policy"*, which
looks like a bad model id and is actually that account's privacy settings refusing every upstream
that serves Voyage. `baai/bge-m3` and `openai/text-embedding-3-small` work on both keys; Voyage works
only on the one in `.env.local`. Whichever account's key reaches production has to have Voyage's
providers allowed at <https://openrouter.ai/settings/privacy>, or the choice falls back to `3-small`
and its billing comes with it. Note also that [`src/env.ts`](../../src/env.ts) lets an exported
`OPENROUTER_API_KEY` beat the file, so which key is in play is not always the one you are looking at.

The same run puts a number on what semantic search is *for*, which is the question this whole
document keeps circling. `searchLibrary` as it ships ANDs every term, so on those eighteen
sentence-shaped questions it returns **nothing at all — zero hits on all eighteen**. Even a
deliberately generous word matcher (OR over content words, ranked) finds under a quarter of the
relevant passages. That is the gap the embeddings are buying, stated as a measurement rather than as
a hope.

## What is still open

- **No keyboard shortcut** opens search, and nothing steps between results with the arrow keys. The
  app still has no shortcut map at all — the gap [keyboard.md](keyboard.md) and
  [260825c-bottom-bar.md](../plans/260825c-bottom-bar.md#what-is-still-open) both record.
- **The rail has no scroll-to-next.** Marks in the spine now show where the results are
  ([above](#the-rail-and-the-shape-of-a-search)), and each mark is inside a band you can click — but
  clicking lands on the section, not on the match. Chrome and Firefox put *both* on the scrollbar
  for find-in-page: the ticks and a way to step between them. The stepping half is the same gap as
  the missing keyboard shortcut above, and probably the same piece of work.
- **A hit that is real but wrong** — the model quotes an adjacent sentence that does not actually
  match — is undetectable from here and uncounted. Only a quote that is not in the block at all is
  caught. The same residual [260826a-chat-mode.md](../plans/260826a-chat-mode.md#what-is-still-open) has.
- **The two *matchers* still cannot be on at once.** You cannot hold a words-search and a
  meaning-search on screen together — one box, one matcher, and switching clears the other's
  selection. Several *saved* searches together stopped being a limitation on 2026-08-26 (see
  [Several searches at once](#several-searches-at-once-each-with-a-colour)); this half remains,
  and the case for changing it is much weaker, because "the letters I typed" and "what I meant"
  are not two criteria to compare so much as two ways of asking.
- **A stale search is usually not announced, and never re-run.** A saved search is answered against
  the article as it was; if the article is re-extracted, hits whose blocks are gone are silently
  dropped and the rest may have moved. The machinery to say so is all there — runs carry a
  `sourceHash`, [`src/search-stale.ts`](../../src/search-stale.ts) judges it, and
  [`src/web/SearchPanel.tsx`](../../src/web/SearchPanel.tsx) has the banners — but **the searches
  GET never sends the article's current fingerprint** (`sweepSearches` in
  [`src/routes.ts`](../../src/routes.ts) answers `{ runs }` only; `readSearches`, the function that
  reads both halves together, has no caller). So `useSearch` learns the fingerprint only from a
  `begin` frame, and a reader who opens an article and looks at yesterday's searches is told
  nothing. Referee mode's two panels do send it and do say it. Re-running from the banner is a
  separate thing nobody has built; the tweet thread page is the model
  ([260825g-tweet-thread-page.md](../plans/260825g-tweet-thread-page.md)).
- **Words mode has no whole-word or case-sensitive option.** Deliberately: find-on-page has a
  meaning readers already hold, and the reader who wants cleverness has the other toggle. But it is
  the first thing somebody will ask for.
- **No evidence it helps.** Which is the criticism the previous version earned for its chat, and
  repeating their mistake would mean never asking.
  [Q6](open-questions.md#q6) is where "how would we know we are failing at this" lives.

## See also

- [ideas.md](ideas.md) — **the third arm of this file's `Found` pipe**, and the evidence that "two
  matchers, one downstream" was the right shape: an entire mode's worth of marks, paragraph bars,
  spine lanes and ordering cost one resolver. It is also why `resolveOne` was extracted out of
  `resolveHits` rather than copied — the `whole` rule has been got wrong here once already, in
  exactly the way a second copy invites

- [colour-scales.md](colour-scales.md) — the eight hues a saved search can wear, where they came
  from, and the honest ceiling on how many anyone can tell apart

- [original-version/highlighting.md](original-version/highlighting.md) — the feature this is borrowed
  from, the overlapping-marks wall, and the confidence-unit bug
- [original-version/search-and-chat.md](original-version/search-and-chat.md) — their text search, the
  two snippet lengths, and why one UI should serve both matchers
- [block-ids.md](block-ids.md) — the contract every hit is anchored to
- [glossary.md](glossary.md) — the other mode that marks up the prose, and the rule both follow about
  when the article may acquire marks
- [comments.md](comments.md) — the older marks-on-prose feature, and where `resolveMark` came from
- [260826a-chat-mode.md](../plans/260826a-chat-mode.md) — the mode band this is the fourth tenant of
- [url-state.md](url-state.md) — `?match=`, `?find=`, `?run=` and `?order=` among the rest
- [design-css-overview.md](design-css-overview.md) — the tokens, and `--hit-rgb` among them
- [logging.md](logging.md) — what a model call may and may not write down
- [testing.md](testing.md) — why the model call itself is not tested and the validation is
