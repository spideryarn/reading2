# Search: the history moved out of the reference doc

Moved verbatim from [docs/project/search.md](../project/search.md) on 2026-10-07, when the docs sweep
split over-long reference docs (docs/plans/261007a-docs-sweep-signposts-truth-and-coverage.md § Three
questions, 3). The reference doc keeps what is true now; this keeps how it came to be. Nothing here is
current unless the reference doc says so.

## The opening: three word-matchers

### Earlier incorrect claim that all three matchers shared helpers

Be exact about how far that sharing goes, because an earlier version of this paragraph said "the
three share `parseQuery`/`fold`/`occurrences`" and **all three halves of that were wrong**.

## Quick search: a meaning search in about a second

### Eval of the mention-or-discuss wording at the former 0.7 and 0.5 floors

From the bullet on the floor of 0.7, before 2026-10-04:

On the new wording, up to 94 of 505 blocks cleared 0.7 in the eval.
Floors of 0.6 and 0.65 found no more literal targets on its short-topic set and let in more
known wrong paragraphs; 0.5 recovered three more target opportunities with more junk.

From the bullet on the fallback, as built at 0.7 and 0.5:

What it costs: a word with no clear referent in the piece,
or a neighbouring topic the piece does not cover, can now show a few wrong paragraphs where it
showed none (13 of 50 new lists held nothing right; 4 of 75 absent and near-miss searches showed
something).

### Thorough replaces the quick row, and a quick hit has no wash

#### Rejected replacement only after the thorough search succeeds

The button was *flesh out* and kept both rows, unticking the quick one.

Deleting only on success was the plan's first version, and its review says what that would
have needed: a server-side replace, protection from the 30-row trim, and a new column.

## Search as you type, and the box in the bottom bar

### Former icon-only display on coarse pointers, fit rung 4, and windows under 732px

Until 2026-10-05 those three cases drew the ⚡
alone.

### From the command bar

#### Switching an already-open Search view to quick skipped that view on Back

(The box had this
wrong until now: it replaced the entry and Back skipped the view.)

## The mode band

This is the third mode to arrive in that slot and it cost the layout **nothing**: no change to
[`layout.ts`](../../src/web/layout.ts), no new term in the arithmetic, one word in `MODES`, one row
in `MODES_UI`, one component. That is now enough evidence to stop calling the slot an experiment.

## What a hit is anchored to

### Inferring whether the whole-block quote fallback fired

The first
version inferred it — a span covering the whole block, plus the quote not matching the block's text —
and a hit whose quote genuinely *was* the whole block produced exactly the shape the fallback
produces. The model had retyped a line break as a space, so the string comparison said "different",
and a perfect match was labelled as having moved.

## The confidence, and the unit that changed silently

### What the number *means*, which printing it does not say

#### Hover card behaviour before 2026-09-12

Until then the card opened wherever on the row you were hovering, and a click opened it too, both
because the pointer was on the row and because the row button took focus. So it landed over the
prose the jump had just scrolled to, and on a touch screen it stayed there.

## Where in the article, on every result

### The former sort-bar legend for confidence and place

There was one: a line under the sort bar
with miniature specimens of both marks, there because a hover-only explanation is one nobody on a
touchscreen ever sees. On a landscape iPad it wrapped to three lines and, with the rest of the
panel's furniture, left the results a window shorter than one result.

## The counts in the log line

*(This heading said "the four counts" until 2026-08-26, while `Dropped` carried five and the
streaming work was about to add another. A number in a heading is a hostage to the next change.)*

## The results arrive one at a time

The reason this took a second look is worth keeping, because the first answer was confidently wrong.
The argument for not streaming was: *a search result is a list, not prose — half a JSON array is a
syntax error, so there is nothing to paint until it parses*. The first half is true. The conclusion
is not.

### The preview guarantee: never a wrong hit

That claim was false for about an hour after it was first written: the extractor took *the first
array one level inside the object*, so a reply of `{"notes":[…],"hits":[]}` would have previewed a
hit the stored result did not contain. Found by cross-model review.

## Saving, and the toy it stops this being

### Former meaning-search storage

Until 2026-09-05 it was a file, `data/<slug>/searches.json`, written
atomically behind a serialised read-modify-write queue; that filesystem half was deleted along with
the rest of the store.

## Several searches at once, each with a colour

Before this, a saved search was a thing you *opened*: pressing it replaced the list with its results
and `?run=` named the one that was open.

### An outline, since 2026-10-03

#### Former cap on coloured stripes under a search match

It was four, and a GPT Sol review pointed out that the
justification for that — a fifth stripe would be sub-pixel — was simply arithmetic nobody had done:
six stripes in six pixels is one pixel each.

#### Former rationale for `box-decoration-break: slice`

The comment beside it
claimed the default, `slice`, would draw a bottom-anchored stripe once at the foot of the last line
and leave the first line of a wrapped phrase bare. A GPT Sol review disputed it; a browser pass
toggled the property live on a real wrapped match and pixel-diffed the result. **Chrome renders the
two identically** — 12 differing pixels out of 42,780 across the line boundary, which is
antialiasing.

#### Saved-search colour display before 2026-10-03

Until then the edge was at 30% on an unticked row and there was no swatch, so an unticked row barely
said its colour at all.

### Pressing the row is not the same as pressing the box

#### Gestures that build the set of marked saved searches

The set stayed. What changed is which gesture builds it. Until now the box and the words beside it
were one `<label>`, which is the right thing for a checkbox and its text and the wrong thing for a
list: every press added or removed, so getting from four ticked searches to *just this one* was four
presses, and the common case was paying for the rare one.

## Prioritised: place order with a bar under it

### Former default confidence threshold

It was 50, the midpoint of the scale the rows print, until 2026-09-15, when this order became the
default and every prioritised bar in the app was lowered so that most entries come in (below).

The current defaults and filter rules remain in
[search.md § Prioritised](../project/search.md#prioritised-place-order-with-a-bar-under-it).

**The reference-list argument this section used to make did not survive contact**, and it is worth
naming rather than quietly deleting. It ran: a glossary shows every term and lifts the ones that
clear the bar to the top, because a glossary is a reference list and *a term you cannot find is a
term you have lost*; a search is the opposite errand, where the reader is hunting and what they want
done with a weak match is for it to go away. It treated hiding as loss.

## The URL

### And the fetch, which can still take the text away

The fetch race and its guard ended with the several-searches change; see
[search.md § What this removed](../project/search.md#what-this-removed).

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

## The third search: the whole library at once

(Until 2026-09-05 the shelf's
box had a second ranking too, a filesystem scan that counted matches and damped by length; that
implementation is gone.)

Four candidates reachable through OpenRouter — `baai/bge-m3`, `voyageai/voyage-4-lite`,
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
