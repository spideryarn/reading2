# Three more, and one of them can destroy something

**Status: done bar one.** -18 and -19 are resolved and on `dev`; **-1A is deliberately left open**
because the fix cannot be verified without a real phone — see *Waiting on Greg*. Started 19:40 London
on 2026-09-04, by the second run of the
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

- ~~**`tests/client-imports.test.ts` is red on `dev`**~~ — **done 2026-09-04**, and the fix was the
  one named here: § A third pass below.
- **Unexplained 404s in the dev browser console**, no URL captured, nobody has looked.
- **`tests/client-imports.test.ts` checks import edges, not side effects** — GPT Sol, 2026-09-04.
  A top-level `console.log` or timer in an allowlisted module passes a test whose header claims
  purity is checked rather than trusted. Nothing on the list does it today. § A third pass.
- **Dictation has never been measured on human speech** — the 90–92% hard-term recall behind -11 and
  -15 is a synthetic corpus.
- Seven decisions from the last batch are waiting on Greg in
  [260904b § Waiting on Greg](260904b-address-user-feedback-reports-batch.md#waiting-on-greg-decisions-taken-so-the-run-could-finish);
  the one that is a property of the codebase rather than of that batch is **unbounded paid calls in
  `routes.ts`**.

## Waiting on Greg

1. **-1A cannot be closed from here.** The dialog now sizes from `visualViewport` on both engines,
   but nobody has seen it work in the installed PWA. **Open the Feedback box on your phone with the
   keyboard up and check Send is reachable** — that closes it, and no automation here can.
2. **Permanent delete: hard-delete, or `deleted_at` with a 30-day purge?** The purge is the boring
   option and the same shape as `archived_at`. Recommended.
3. **Permanent delete: what should a public link to a deleted article do?** 404 with a note, or
   refuse to delete while the article is public.
4. **The Feedback dialog is vertically centred on desktop**, so switching Problem ↔ Suggestion moves
   the kind buttons 29–38px — the button you just pressed shifts under the pointer. The fix (grow
   downward only) repositions the dialog for everybody, so it was left rather than decided.
5. **The chat composer's Enter always sends and there is no Shift+Enter**, so on a phone a reader
   cannot type a newline in it at all. Found while surveying, not part of any report.

Plus the seven from [260904b](260904b-address-user-feedback-reports-batch.md#waiting-on-greg-decisions-taken-so-the-run-could-finish).

## What this batch turned up that nobody asked for

- **A regression from the previous batch**, fixed with a postmortem: making links open in a new tab
  was done inside the *client* sanitiser, which stopped it being byte-for-byte the server one and had
  `tests/sanitize-client.test.ts` red on `dev` since `0f754742`. Now at ingress —
  [260904d-a-presentation-rule-inside-the-sanitiser…](../postmortems/260904d-a-presentation-rule-inside-the-sanitiser-broke-the-one-policy-invariant.md).
- **The rule had only ever covered `<a href>`** — not `<area>`, not SVG `xlink:href`. Zero of either
  in 5,301 stored blocks, which is exactly why no test and no browser pass would have found it.
- **A dictation race in three dialogs** — chat, Annotate and Quiz all left the send button enabled
  while the microphone was armed. `dictation.md` now says "disable the button too, not only the
  guard".
- **A sign-in key labelled Next that submitted** when a password manager had filled the field.
- **Two tests that could not fail**, and a third whose evidence was measured against the wrong dev
  server — see the browser-testing note below.

## The lesson worth keeping from the run

The doc had already written down the trap that a Vite port silently moves, two paragraphs above where
it would have helped. What it had **not** written down is that `npm` is a wrapper and the server is
its `node` child, so the PID you kill is not the PID that is listening. Two agents hit that within an
hour; one of them killed the wrapper, started a "fresh" server that walked to 5302, verified against
5301, and reported a clean re-check with byte-identical numbers — equally consistent with the fix
working and with having measured the wrong process. It caught itself and said so.
[browser-testing.md](../project/browser-testing.md) now carries it, with the remedy: prove *which
code* is being served with a `curl` before trusting anything the browser says.

## A third pass, 2026-09-04 23:00 — the queue was empty and the trunk was not green

The loop's next run found **one unresolved report, and it was this batch's own -1A**, left open
deliberately because the keyboard fix could not be verified without a phone. Leaving it open was the
wrong call: `feedback-reports.md` says an issue nobody closes is one the loop rediscovers every three
hours and re-derives the same answer for, which is exactly what happened. It is resolved now, and the
device check is written into the note instead —
[the note](../user-feedback/260904_1723-mobile-keyboard-done-send-button.md), which was also rewritten,
because it still described `interactive-widget=resizes-content` as the fix and still carried the
sentence about a standalone app resizing "on its own" that had already been retracted on the Sentry
issue. **A retraction that lives only in a Sentry comment is a retraction nobody will read.**

`awaiting-approval.md` was empty, and is still empty.

### The carried-over red test, cleared — twice, by two agents who never met

`tests/client-imports.test.ts` had been red on `dev` since `a9fd3197` because
`src/web/useStepJob.ts` took `import type { StepBefore }` from `src/pipeline.ts` — a server module.
Nothing shipped wrong: the import really was erased, which is why it survived. What was wrong is
that the rule had a standing exception, and a rule with an exception cannot be read off its own test.

**Two agents fixed it independently within the same hour, and produced the same answer**: a new
`src/step-order.ts` holding `STEP_ORDER`, `StepsMissingFromOrder` and `StepBefore`, importing
`types.js` and nothing else, with `pipeline.ts` re-exporting `STEP_ORDER` alone so its two dozen
callers did not change. Same file name, same three symbols, same decision *not* to re-export the two
types — which this pass only reached after GPT Sol pointed out that a façade re-export is an unused
export knip will list, and that `@public` protects the declaration rather than the façade.

`d138c609` landed first and is what is on `dev`; this pass's copy was discarded at the merge in its
favour. **Agreement reached separately is the only kind that says anything** — the registry two
directories away makes the same remark about a classification arrived at twice — and it is worth the
paragraph because the alternative design (rewriting `StepBefore` to take a hand-written order) was
available to both and taken by neither.

What did survive from this pass, because the other agent's change did not include it:

**A debt nobody was tracking.** `src/web/tsconfig.json` carried `"../*.d.ts"` in its `include` for
one reason, stated in its own comment: the old import dragged the pipeline's whole type closure into
the client project, through `src/fetch.ts` and `src/pdf.ts`, and without the glob those resolved as
`any` and the project failed TS7016 on packages the browser never loads. The comment recorded the
price — 267 files to 346, and 2.5s → 3.2s across `npm run typecheck`. With the import moved there is
nothing left for it to declare, so it is gone, and the comment now says why it is absent.

**And two corrections to it, from Sol.** There *is* still a closure —
`step-order.ts → types.ts → messages/assets/ids` — merely a small one already in the project. And
**TS7016 is not what will catch the next breach**: a client import of a fully typed server module
would typecheck in silence. `tests/client-imports.test.ts` is the diagnostic; that `include` was only
ever a plaster over one breach of it.

Also this pass's, and small: the stale citation in
[new-mode.md](../project/new-mode.md) that still sent a reader to `pipeline.ts` for the array.

**The check was proved able to fail** before it was believed: a `node:crypto` import added to
`step-order.ts` turns the allowlist entry red, and removing it turns it green again.

### Decisions and assumptions, this pass

1. **-1A resolved rather than left open.** Assumption: if the phone check fails, a new report is the
   right way for that to come back, and the loop working as designed. The alternative — an issue
   parked open for a check only Greg can do — costs a run every three hours and hides nothing usefully.
2. **`STEP_ORDER` moved rather than duplicated**, and moved rather than `StepBefore` being rewritten
   to take a hand-written order. A second copy of the sequence is the failure
   `src/web/feedback-diagnostics.ts` § `WORD` already argues against, and the order is a fact with
   ends on both sides of the wire.
3. **`step-order.js` on the allowlist holds a runtime value**, not only types, unlike
   `public-types.js` beside it. Judged to qualify on the rule as written — it imports nothing but an
   already-listed module — and the array is nine short strings, so nothing meaningful reaches the
   bundle even if a future caller imports it as a value.
4. **Appended here rather than given a plan doc of its own.** Two items, both continuations of this
   doc's own *Carried over* list.

### GPT Sol on the move, and what it caught

Sol reviewed this pass's copy of the move, which the merge then discarded in favour of `d138c609`.
Two of its four findings went with it — **and both are worth reading anyway**, because the surviving
implementation had already got them right, which is part of why it is the one that survived.

No runtime finding: Sol checked the one that mattered, that `import { STEP_ORDER }` followed by
`export { STEP_ORDER }` is the same live binding as the old `export const` for every consumer,
including `import * as`, enumeration and interop, and confirmed the cycle gate clean across 1,370
files. That verdict covers `d138c609` too — it is the same construction.

Four Lows, all real:

1. **The compatibility re-exports defeated the very protection they looked like.** This pass's
   `pipeline.ts` re-exported `StepBefore` and `StepsMissingFromOrder` as well as `STEP_ORDER`, and
   nothing in the tree imports either from there any more — so knip listed both as unused exports.
   The `@public` tag that keeps `StepsMissingFromOrder` alive protects the **declaration**, not a
   façade in front of it. *(Moot: `d138c609` re-exported only `STEP_ORDER` from the start, and says
   so in its header. Two routes to the same place, one of them via a reviewer.)*
2. **Four comments stopped being true in transit**, which is what a move does and why it is worth a
   reviewer: `isStepName` described as "below" when it stayed behind; a warning that a value import
   would pull the pipeline into the bundle, when it would now pull nine short strings; and two files
   still naming `pipeline.ts` as where `StepBefore` is defined. *(Also moot: the surviving copy caught all four
   unaided, including the two in files it did not otherwise touch. Both agents rewrote
   `tests/step-job-preceded-by.test.ts` line 17 to the same string, and the merge took it as one
   edit.)*
3. **The new tsconfig comment overclaimed, twice.** There *is* still a closure —
   `step-order.ts → types.ts → messages/assets/ids` — merely a small one that was already in the
   project. And **TS7016 is not what will catch the next breach**: a future client import of a fully
   typed server module would typecheck in silence. `tests/client-imports.test.ts` is the diagnostic;
   the `include` was only ever a plaster over one breach of it. The comment says that now.
4. **Not fixed, and worth carrying: the purity guard does not check purity.**
   `tests/client-imports.test.ts` checks import edges and `node:` builtins, so a top-level
   `console.log`, a timer, a global mutation or a side-effectful bare-package import in an
   allowlisted module passes it. No module on the list does any of that today, so nothing is broken —
   but the test's own header says purity is "checked rather than trusted", and that is stronger than
   what it implements. Left alone deliberately: tightening it is a change to a rule that eight
   modules are already on the right side of, and it belongs in its own piece of work rather than
   riding along with a move.

### The trunk had a second red, and it was also this batch's — and it was fixed twice too

`npm run check` came back with three failing files out of 661. Two —
`tests/admin-store.test.ts` and `tests/step-failure-seam.test.ts` — were 20- and 30-second
**timeouts**, and both pass alone: fifteen other sessions were on the shared Postgres at the time.
That is the known signature on this box, and the rule that goes with it is *re-run each alone before
believing a red batch*.

The third was real. `tests/store-migration-registry.test.ts` had
`tests/feedback-dictation-vocabulary.test.tsx` down as a file the import graph can reach a condemned
module through, with no registry entry and no witness record. **That file is `b96eadc0`'s — the
previous batch's answer to the microphone misspelling "Spideryarn"** — and it landed after
`store-migration-witness.json` was recorded, which is precisely the case the registry's hole check
exists to catch and the third time it has caught one.

Proved not to be this pass's doing before it was touched: with the old `../pipeline.js` import put
back in `useStepJob.ts`, the failure is identical.

**And classified twice, like the move above it.** This pass wrote
`store-agnostic-fake` / `static-only` off the file's own contents; the registry's owner had already
written `shared-mechanism-collateral` / `import-only` / `static-only` off **Witness 1's bucketing** —
`flag-selection-only`, the mildest reach it records — which is evidence this pass did not have and
did not think to look for. Theirs stands; the duplicate key is gone. The registry's header remarks
that agreement reached separately is the only kind that says anything, and this is the shape of the
case where it is *not* agreement: two verdicts, one of them better sourced.

**Two red tests on the trunk, both left there by this batch, and neither noticed until a later run of
the loop went looking** — by which time another agent was already fixing both. The gate that would
have caught them at the time is `npm run check`, which takes half an hour here and was not run at the
end of that batch. That is the lesson, and it survives the fact that this pass's own fixes were the
ones discarded.
