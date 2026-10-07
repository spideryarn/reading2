# Comments: the history moved out of the reference doc

Moved verbatim from [docs/project/comments.md](../project/comments.md) on 2026-10-07, when the docs sweep
split over-long reference docs (docs/plans/261007a-docs-sweep-signposts-truth-and-coverage.md § Three
questions, 3). The reference doc keeps what is true now; this keeps how it came to be. Nothing here is
current unless the reference doc says so.

## The opening note

For three days this file described a feature that was
closed: selecting a sentence bought an explanation until 2026-08-26, then opened a chat, and there
was no way to make a new comment at all.

**The tick-box became a button on 2026-10-03**, and the box stopped losing drafts.

## In Referee mode: the draft box

### Ask AI before 2026-10-06

Until 2026-10-06 it pre-filled the composer and waited for Send
([261006j](../plans/261006j-ask-in-chat-sends-the-question.md), D6).

## The whole-block bookmark

### Writing a note on a whole-block bookmark before the dialog invited it

It was possible — press the mark afterwards and type — and nobody found it.

## The referee's own placement

### Deleting a criterion between placement validation and write

It was a 500 until 2026-10-07.

## The five operations, and why there are five

There used to be one writer, `create`, which meant both *make this* and *redo this*. That was safe
only while making one cost a model call, so a colliding id could only ever be a retry.
### Answer-attempt tokens in the deleted filesystem store

The filesystem store had no token and needed none — one process, so `begun` in
`src/comments.ts` could say whether an attempt was live without a clock. That half was deleted on
2026-09-05; Postgres, and the token, are now the only way.

## Copying the passage

### Before every copy button used the shared hook on 2026-10-04

Until then there were eight hand-written copies and they had drifted: the token had
reached two of them.

## A pasted `?note=` brings its own passage into view

### A pasted note failed to scroll to its passage

It was found while building the metadata page and left
open there ([260825e-metadata-page.md](../plans/260825e-metadata-page.md)); it is fixed now.

**Checked in a browser, 2026-08-26**, on `constitution` (22,518 words) at 1300px. A fresh load of
`?note=` with no `?at=` scrolled from the top to the commented passage and opened the dialog on it,
then grew `&at=` on its own. With an `?at=` that already had the passage on screen, `scrollY` was
5073.5 on load and 5073.5 a second later — held still, which is the case that costs no movement. With
an `?at=` pointing at the article's first block, the note won and `?at=` was overwritten. A `?note=`
naming nothing rendered normally with no dialog and no console error. One Back went to the library
rather than through a trail of scroll positions, which is `?at=` replacing rather than pushing.

**One thing that pass could *not* establish**, recorded because a silent gap is worse than a stated
one: whether the glide reads as travel or as a jolt. Every round trip through the automation tool
took longer than the 200ms animation, so only "not yet arrived" and "arrived" were ever observable.
See [browser-testing.md § An animation shorter than your round trip](../project/browser-testing.md#short-animation).

## The stream owns the answer, and nothing else on the row

### Before 2026-10-07: server writes only answer fields, stream frames preserve reader fields, PATCH replies preserve streamed answers

Until 2026-10-07 none of the three held: a note edited mid-stream went back to the old one on
screen at the next delta and stayed there after `done`, and a PATCH answered after `done` brought
the spinner back for good. Postgres was right throughout, which is why nothing reported it.

## Two more ways to push back on an answer

### Dig deeper before code forced the search

It used to re-ask with an instruction to go and look properly and leave the
searching to the model.

### Search the web was offered on bookmarks and plain notes

It used to
be offered on anything that was not `pending`, which included `status: "none"`: every bookmark and
every note written without pressing Ask AI. Those are exactly what `beginAnswer` refuses
with a 409, *"was never a question, so there is nothing to answer"* — so a reader who wrote
*"what is the evidence for this?"* as a plain comment was offered a button labelled **Search the
web** and told, on pressing it, that they had never asked anything.

## The drawer that lists them, and what kind of thing it is

### The dock drawer's aria-modal attribute

It said `true` until 2026-09-06.

## A shared link carries them, since 2026-09-04

### Before comments and notes were included on 2026-09-04

Until then the sharing
card said comments and notes never left, and [privacy.md](../project/privacy.md) said the same in the reader's
own words.

### The SQL gates excluding referee placements and unfinished answers

Both were found by GPT Sol reviewing the plan, not by anybody writing the feature.

## Deliberate limits

### The minimum selection length

It was 8 until 2026-09-05, on the ground that *"every one of these costs a model call"*; that
reason died on 2026-08-28, when saving became free and the model became a tick-box, and the
constant outlived it. Meanwhile it refused `AI`, `GDP`, `Ryle` and `qualia` — the short selection
[§ The two questions a selection raises](../project/comments.md#the-two-questions) calls *almost always the second
question*.

### Deleting a comment before its answer POST returned

The POST returns the whole comment, so
storing it used to put back a row the reader had already deleted, mark and all.
