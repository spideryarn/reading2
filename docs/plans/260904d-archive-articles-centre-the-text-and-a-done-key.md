# Three more, and one of them can destroy something

**Status: in progress**, started 19:40 London on 2026-09-04, by the second run of the
`feedback-reports` loop ([feedback-reports.md](../project/feedback-reports.md)). The first run's
twelve are done and written up in
[260904b](260904b-address-user-feedback-reports-batch.md) — this is a fresh batch, not a
continuation.

Runs unattended, so **questions, decisions and assumptions go in this file**.

## The queue

Three reports, all from Greg, all from the home page within four minutes on 2026-09-04, all on build
`b2881d7` — a newer build than the last batch, so none of them is a ghost of something already fixed.

| id | what it says | size |
|---|---|---|
| [-18](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-18) | always centre the Text view in its column, whatever mode is on | small |
| [-19](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-19) | archive an article; hide archived from the shelf; maybe permanent delete too | the big one |
| [-1A](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1A) | the mobile keyboard should offer Done/Send where appropriate | small |

## -19 is the one to be careful about

It is the first report in either batch that asks for a way to **destroy a reader's own data**, and
this repo has exactly one production database with real people's articles in it and no staging copy.
So the two halves are being held apart from the start:

- **Archive** is reversible by construction. If it is a nullable timestamp and a default filter, a
  mis-tap costs nothing and the undo is the same switch back.
- **Permanent delete** is not. A mis-tap is unrecoverable, a shared link dies, storage objects can
  be orphaned, and an in-flight job can still be writing to the article while it goes.

**The presumption is: ship archive, defer delete**, and say so plainly rather than quietly dropping
the half Greg asked for. He said *"maybe there should also be"*, which is already the softer half of
his own sentence. Fable is being asked whether that is right and what confirmation UI would actually
be appropriate if we did build it.

The thing to establish before writing any of it is **what `archived_at` would have to be threaded
through** — the shelf query, sharing and the public payload, the ingest queue, search — because that
is the difference between "one column and a filter" and a week.

## -18 may be wrong as written

There is an existing conditional centring rule and a test named for it. "Always centre" is a request
to delete a condition, and conditions usually exist because a case needed them. Fable is checking
whether the literal request breaks the case the current rule serves; if it does, the answer is the
rule Greg actually wants rather than the one he described.

### It was not, and it is built

The condition turned out to belong to a *different* mechanism. `Fit.alone` and
`PROSE_ALONE_MAX_REM` centre the whole **table** when the article is the only thing on the page,
which is right and is untouched; what nobody had done was centre the **measure inside its cell**,
which is why a band mode left 65ch of prose against the left of an 1190px cell with 400px of empty
page beyond it. So the literal request deletes no condition — it adds a rule beside the one that was
already there. Three declarations in `styles.css`, all self-limiting (`auto` and `max(0px, …)`), so
they do nothing at all once the cell is narrower than the measure:

- **§ text** — `margin-inline: auto` on `.prose`.
- **§ the gutter** — the reader's icon column moves the same distance, or the permalink and the chat
  door sit 200px out in the margin beside a paragraph they are no longer next to.
- **§ the title over the column** — the masthead lands on the prose's own left edge wherever the two
  share a box (`table.only-prose`, i.e. a band mode). Not `margin-inline: auto`: that bar reserves
  24px on its left in a mode against 144px on the right for the Feedback button, so auto margins
  would have put the title 60px left of the column.

Measured in Chrome at 1600 / 900 / 390 across Plain, Summary and Hierarchy:

- **Summary at 1600** — prose centred (230.5px left, 219.3px right; the 11.2px is `--text-pad-l`
  minus `--text-pad-r`), title 2.8px from the prose's left edge, and the gutter's icons 5.6px from
  the first word — which is the gap they have at 390px where nothing moves at all, so the column
  travelled exactly as far as the text did. It read 2.9px before the weight fix, and *that* was the
  tell.
- **Footnotes at 1600 in a mode** — the "Notes" heading, the number and the note's own text all
  share one left edge, 33.6px in from the cell, which is what opting out is supposed to look like.
- **900 and 390** — no-op in every mode, to the pixel: the prose starts at the cell's left padding
  edge and the gutter has not moved.
- **Plain moved 2.9px**, and is the one thing that is not exactly unchanged. The alone cap rounds
  *up* on purpose, so the cell is ~6px wider than 65ch; that slack used to sit entirely on the
  right and is now split, which pushed the documented "title 4px left of the prose" to 6.5px. Left
  as it is: it is a quarter of a character, and the alternative is a `:not(.text-alone)` exception
  that reintroduces exactly the conditional the report asks to be rid of.

### Hierarchy, and the thing that was actually wrong with it

The first build shipped it as asked and flagged a reservation: at 1600 with two gist columns it
leaves a 190px void between the Sections column and the prose, and the `TEXT verbatim` column
header stayed at the cell's left edge, 180px from the text it named, while `Parts` and `Sections`
sat squarely over theirs. Greg looked at the screenshot and agreed it read as a misalignment rather
than as whitespace.

**The fallback was the wrong answer, and he said so.** "Centre unless a gist column is beside it"
buys back a conditional the report exists to remove — and the defect had already been solved once in
this same change: the masthead was a left-aligned title over a centred column, and it was fixed by
moving the *title*, not by un-centring the prose. The column header is the same bug wearing a
different element. So it moves too, and the honest version of the old behaviour is that this heading
was never aligned to the text at all — it was aligned to the cell, and that only looked right while
the text began at the cell's edge.

Only that heading: the gist columns are not centred, so `th.text` is a class TableView puts on one
cell. It costs the prose header two nested spans, and **the reason is the same `ch` fact Sol found**
— one element cannot both resolve `65ch` in the article's face and be set in the chrome's 0.68rem,
so the outer box carries the reading metrics and the geometry and the inner one puts the head's own
type back. Both values are named on `thead th` rather than copied, so the heading cannot drift from
its neighbours.

**And the obvious version of it does not work.** The first attempt was percentage padding on the
`<th>`, which reads so naturally that it would have been easy to ship: measured in Chrome, the
heading landed **239px past** the prose, because a table cell does not resolve percentage padding
against its own width. The geometry is a margin on a block inside the cell instead, where `100%` is
defined. Probed in a real browser before either version went near the app, along with the clamped
case, which returns the heading to the 1rem gutter it has always had.

Measured after: **`Text verbatim` lands 0.016px from the first word of the article** at 1600, and
17.6px left of it at 900 — which is the 1rem head gutter against the body's 2.1rem, and is exactly
where it has always been at that width, because the offset clamps to zero there. The heading is
still 10.88px at weight 600, `Parts` and `Sections` are still 1rem inside their own columns, and the
head band is the same height with no wrapping.

**The verdict on the 190px, looked at again: the detached heading was the whole of it.** With the
heading and the first word sharing an edge, the space between the Sections column and the prose
reads as the text column's own margin, which is what it is — the two things that name the column now
agree with each other, and agreement is what makes whitespace look deliberate. The fallback
("centre only when the prose is the table's only column") is not needed and is not built.

**GPT Sol reviewed the built code** and found two things worth the trip, both fixed:

- **`ch` depends on the weight axis, not only the size.** Geist is a variable face, and `65ch`
  measured at 400 is ~3px narrower than the same `65ch` at `--reading-weight: 450`. That was the
  2.8px residual in the measurements. `.blk-gutter` now matches both; `.masthead-inner` matches only
  the size, deliberately, because the byline and the source note inherit their weight from it and
  emboldening four pieces of small print is a worse trade than 2.8px.
- **The footnotes were left half-moved.** `.notes-head` and `.note-num` are absolutely positioned
  against the cell and set their own 0.8rem/600, so the same offset means something ~90px different
  there; a centred note would have stranded its own number 200px out. Notes now opt out as a block —
  prose, gutter and apparatus all keep the left edge they had. The clean fix is a length resolved
  once and inherited, and **this build cannot have one**: a registered `@property` is silently
  replaced by its `initial-value` in the served stylesheet, which is written up beside `--bar-bottom`
  in `styles.css` § tokens. Verified in a real browser first — a probe page showed the registered
  property resolving `ch` correctly and the unregistered twin 68px out — so the mechanism is right
  and only this pipeline rules it out.

Two of his findings were argued rather than accepted: the **search-hit bar** and `row-active` stay at
the cell's edge, because both say *this row*, not *this phrase*, and a rule down the margin is the
right shape for a mark you catch while scrolling; and the **gutter follows the paragraph measure**
rather than each row's own box, so a callout or a caption keeps one straight icon column instead of a
ragged one. Both are now said out loud in the stylesheet rather than implied.

**Wiring test:** `tests/prose-centred-in-its-cell.test.ts`, a sibling of
`tests/text-alone-centring.test.ts` rather than an edit to it — that file guards the other
mechanism and nothing here changes it. Proved red by deleting the declarations from a copy of the
stylesheet before it was believed.

**And one of the carried-over 404s has a name.** The unexplained dev-console 404 is
`GET /api/glossary/<slug>` on an article that has no glossary — expected, not a regression, and
still noise in every console pass.

## Stages

Provisional until Fable and GPT Sol report; the shape is deliberately small.

1. **The keyboard, and a look at the dialog** — -1A, plus the visual check of the Feedback dialog
   that the last run recorded as undone (two attempts died on box contention with six agents
   building; the tree is quiet now). *In flight.*
2. **Centring** — -18, once we know whether to do what it says.
3. **Archive** — -19's reversible half, with the migration and whatever it turns out to touch.
4. **Delete** — only if Fable and Sol both say it belongs in this batch. Otherwise deferred, in
   writing, with the reason.

Every stage ends by resolving its Sentry issues and writing the notes in `docs/user-feedback/`,
including for anything deferred.

## Carried over from the last batch

Still open, and cheap:

- **`tests/client-imports.test.ts` is red on `dev`** — `src/web/useStepJob.ts` imports `StepBefore`
  from `../pipeline.js` (commit `a9fd3197`). Type-only, so it erases, but the test flags the erased
  form **deliberately** and says so. The fix is moving the type to a shared module.
- **Unexplained 404s in the dev browser console**, no URL captured, nobody has looked.
- **Dictation has never been measured on human speech** — the 90–92% hard-term recall behind -11 and
  -15 is a synthetic corpus.
- Seven decisions from the last batch are waiting on Greg in
  [260904b § Waiting on Greg](260904b-address-user-feedback-reports-batch.md#waiting-on-greg-decisions-taken-so-the-run-could-finish);
  the one that is a property of the codebase rather than of that batch is **unbounded paid calls in
  `routes.ts`**.

## Questions, decisions and assumptions

To be filled in as the run goes. Nothing here blocks it.
