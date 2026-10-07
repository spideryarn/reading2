# Seventh sweep: the rewrite hold on the six forced verbs without one

Up: [plans.md](../project/plans.md) ·
umbrella: [261006m](261006m-seventh-codebase-sweep-depth-umbrella.md), cluster **C10a**
(§ What the review changed: U6, U13, U14, U22)

## What

A forced re-run is a button beside a result that is already there: *Paint again*, *Find more*, the
button on a stale banner. The job that does the work leaves the job list a moment before the page
has read what it wrote. In that moment the old result is on screen and the button is live, and a
press is a second paid run for one result.

`useRewriteHold` ([`src/web/rewrite-hold.ts`](../../src/web/rewrite-hold.ts)) closes that gap: the
control is held from the press until a read the server answered shows the new result. Six mode
hooks used it. Seven had a forced verb and no hold (finding WCO3 in
[the Opus investigation](../investigations/261006d-seventh-sweep-depth-reader-client-and-per-mode-hooks-opus.md),
confirmed and corrected by
[Sol's review](../investigations/261006d-seventh-sweep-depth-reader-client-review-sol-on-opus.md)).
[mode.md](../project/mode.md) already states the rule for every mode, so this applies a written
rule rather than making one.

This cluster wires six of the seven: **Illustrated, Quotes, Timeline, FAQ, Debate, Citations**.

**Skim is left exactly as it is.** `useSkim.ts` and `modes/skim/*` belong to cluster C10b, which
runs after C9 because both change that hook. Until then Skim's forced run can still be pressed
twice in the gap.

Four smaller things ride along, each its own commit: a guard so the next forced verb cannot arrive
without a hold, the loaded branches of the Sketch and Illustrated views (looked at, not built), a
signpost in `mode.md` (WCO9), and stale counts in comments (WCO8).

## The simpler option passed over

**Disable the button until the job-completion read settles, in each panel.** One boolean per panel
and no shared module. Passed over because it is the hold Quiz first had, and
[the postmortem](../postmortems/261002f-a-band-local-hold-cannot-protect-a-job-that-outlives-the-band.md)
is about why it does not work: the band can be closed while the paid job runs on, and a boolean
that lives in the band is gone when it reopens. It also cannot tell a read the server answered from
one answered out of the offline copy. The shared hold already handles both, and using it is fewer
new lines than a seventh private version.

**The builder's stage did not change `rewrite-hold.ts`'s logic.** Its release rules were untouched;
the six hooks passed it an identity, their queue and their read's bookkeeping, as the first six do.
The write-capable review later added Retry's registration at the shared seam; see § What the
write-capable review repaired.

## The sibling each one copies

| Mode | Forced controls | Identity | Sibling | Why that one |
|---|---|---|---|---|
| Illustrated | *Paint again* (`PaintAgain`) | the stored value, as JSON | `useSketch` / `SketchView` | the same band, and neither artefact has a clock of its own |
| Quotes | *Find more* (foot, and the command bar's row through `quotesFindMoreOffered`); *Choose them again* (stale banner, and the outdated foot's status row) | `generatedAt` | `useGlossary` / `MoreRow` | the other appending verb, with its read mounted above the band |
| Timeline | *Read it again* (stale banner; foot status row) | `generatedAt` | `useIdeas` / `IdeasPanel` § `run` | a replacing verb drawn through `JobProgress` by a `run(label, again)` helper |
| FAQ | *Find them again* (same two places) | `generatedAt` | the same | the same |
| Debate | *Search again* (same two places) | `searchedAt`, its only clock | the same | the same |
| Citations | *Find them again* (same two places) | `generatedAt` | `useIdeas` for the panel, `useGlossary` for where the bookkeeping lives | the read is mounted above the band |

For Quotes the identity works for an append because the stage re-stamps `generatedAt` on every
run, including one that added nothing (`src/quotes.ts`, `generatedAt: completedAt`).

## What a held mode shows

The same thing the first six show: the forced button gives way to a quiet line and a *Try again*
that only reads ([`RewriteWaiting`](../../src/web/RewriteWaiting.tsx)); beside a failed re-read the
button is disabled instead, because the error already has its own *Try again*.

**The line is the one decision here that was not purely mechanical.** Each of the first six has its
own sentence in one pattern, *The new … hasn't loaded yet.* Two of the six new ones reuse an
existing sentence word for word (Illustrated uses Sketch's, FAQ uses Quiz's). Four are the same
pattern with the mode's own noun, which makes them new strings:

| Mode | Line | New? |
|---|---|---|
| Illustrated | The new picture hasn't loaded yet. | no, Sketch's |
| FAQ | The new questions haven't loaded yet. | no, Quiz's |
| Quotes | The new quotes haven't loaded yet. | yes |
| Timeline | The new timeline hasn't loaded yet. | yes |
| Debate | The new search hasn't loaded yet. | yes |
| Citations | The new citations haven't loaded yet. | yes |

The brief for this cluster said to stop on a mode that needed new wording. I read the pattern as
"what the existing six show" and built all six, because without the line a mode held over an
offline copy has a disabled button and nothing to press. The four strings are flagged in the
hand-back so they can be changed or the four modes pulled before anything is pushed.

## Red first

All in [`tests/rewrite-hold.test.tsx`](../../tests/rewrite-hold.test.tsx), which mounts the real
band, hook, `useStepJob`, `useOrderedRead` and `apiFetch`. The harness pressed only the profile
badge's *Regenerate*; none of the six has one, so a row may now name its own forced control
(`verb`) and the shape of artefact it needs (`shape`: a stale one, for the four whose only forced
control is on the stale banner). One test was added for every row, old and new: *holds every forced
control while the completion GET is still in the air*, which is the gap with nothing else going
wrong.

Before the wiring, per mode (the 4 or 5 that passed are the "lets go" tests, which pass with no
hold at all):

```text
Illustrated  14 failed |  4 passed     Quotes     15 failed | 4 passed
Timeline     14 failed |  4 passed     FAQ        14 failed | 4 passed
Debate       14 failed |  4 passed     Citations  14 failed | 4 passed

× holds every forced control while the completion GET is still in the air
  the job is done and its result has not been read: Paint again: expected 'enabled' to be 'disabled'
× holds the forced verb synchronously before the next render
  the hold fences the verb before React disables its controls: expected [ …, … ] to have a length of 1 but got 2
```

The second of those is worth reading twice: two clicks in one tick made **two forced POSTs**. The
gap did not need a slow network.

After: 218 of 218 in the file. Mutation check, per mode: with the hook's `rewriting` forced to
`false`, 13 of that mode's tests go red (14 for Quotes), and the file is green again when it is put
back.

## What landed, per mode

- **Illustrated.** `useIllustrated` keeps the stored painting as its identity and returns
  `rewriting` and `refresh`. `PaintAgain` is disabled while held; the loaded view draws the waiting
  line where Sketch draws it. The refusal counter that re-asks the Sketch still counts a refused
  forced start.
- **Quotes.** The bookkeeping is on `useQuotesRead`, which outlives the band. Both forced buttons
  give way to the waiting line or are disabled, and `quotesFindMoreOffered` now refuses while held,
  so the command bar's *Find more* cannot press through it.
- **Timeline, FAQ, Debate, Citations.** The panel's `run(label, again)` helper is Ideas' with the
  mode's own line. The foot that shows a job's progress on a current list also shows the waiting
  line, as Ideas' does.

## The guard: built

`tests/rewrite-hold.test.tsx` § the membership guard. A file under `src/web` that writes a `force`
into a request must be a row's hook or a line in `NOT_HELD` with its reason; every row's hook must
call `useRewriteHold`, and no excluded file may.

It reads the syntax tree (`@babel/parser`, as `tests/use-copy.test.tsx` does), not the text,
because Sol's review is right that the text is not enough. A hit is an object literal with a
`force` property, written out, shorthand or nested in a spread, whose value is not `false` and not
itself an object literal. That covers the three forms the review named, and the test asserts the
two awkward ones by name: Skim's conditional spread and the glossary's shorthand `{ force, … }`.
Eleven small snippets pin what is and is not a hit.

The exclusion list is six, not the two the brief expected, because six files force and hold
nothing: Skim (*pending C10b*), `useStepJob.ts` (the transport), `Metadata.tsx`, `CommandBar.tsx`,
`StructureNotice.tsx` and `ShelfEntry.tsx`. It is a table in a test, in the shape
`tests/read-error-matrix.test.tsx` § `NOT_A_ROW` already has. No registry.

**What it cannot see**, said in the test too: a request built another way (a computed key, an
object handed in from another module), and whether every forced path in a file goes through the
hold. The second is each row's *holds the forced verb synchronously* test, for the control the row
names.

Seen red: with the exclusion for Skim renamed, two of its four table checks fail.

## The loaded branches of the Sketch and Illustrated views: not built

When a picture is on screen and a redraw runs, `SketchView.tsx` § `progress` and
`IllustratedView.tsx` § `body` draw one grey line with a spinner, and one grey line if it failed.
The empty branches use `JobProgress`, which also gives Stop, Retry and the stalled warning. The UI
sweep handed over the question of making the loaded branches use it too.

**It is not a drop-in, so it is not built.** `JobProgress` in that place would reverse three
things that are written down as deliberate, and each needs somebody to choose:

1. **Whether there is a Stop beside a picture at all.**
   [sketch.md](../project/sketch.md) says the line is "Deliberately **not** `JobProgress`: that row
   carries a Stop button and, with no job running, the Draw button", and both views' comments say
   the same.
2. **What is drawn when nothing is running.** With no job and no failure `JobProgress` always draws
   its run button. So it would have to be mounted only while a job is running, starting or failed,
   or be given a new "status only" prop. And after a refused start it draws the run button anyway,
   which needs a label: Sketch has no words for a forced redraw in the band (its one redraw is
   *Regenerate*, in the profile panel), and in Illustrated it would be a second *Paint again* that
   skips the steering note.
3. **What a failure looks like.** `JobProgress` prints the failure in the destructive red.
   `diagram-sketch.css` § `.sk-failed` records the opposite choice for this band: "The same grey as
   every other failure in this band, not a red".

Smaller things it would also touch: where the line sits (`.sk-busy` is "above the notes rather
than below"), the two CSS classes `tests/diagram-css.test.ts` and
`tests/sketch-view-drawing.test.tsx` name, and the Retry it would add, which is not taken through
the hold (see § Left).

What is needed before anyone builds it: a yes or no on Stop beside a loaded picture; and if yes,
whether the reader gets Retry there too, in which colour the failure is said, and what the button
after a refused start is called in Sketch.

## WCO9: the signpost

One bullet at the end of [mode.md](../project/mode.md)'s client residue, naming what `Reader.tsx`
asks about the mode outside the `modeBand()` switch and pointing at the two typed sub-mode tables
(`subModeViews` in `Reader.tsx` § `surface`; `SUB_MODE_SELECTS_A_BAND_FOR` in `ModeBoundary.tsx`).
No count is written into the doc. Recounted from the syntax tree for this plan: 19 comparisons of
the `mode` identifier with a string, on 17 lines, naming seven modes, which is Sol's figure and
not the investigation's 21 and nine.

Sol's five groups needed a sixth thing said. Two of the comparisons decide what is drawn in the
prose rather than over it (the quote card knowing it is in Quotes, Skim's door after the current
stop), so the last group is "overlays, and what is drawn in the prose".

The same doc's sentence that the hold's row is something "which nothing checks you added" was made
false by the guard, and now says what the guard checks and what it does not.

## WCO8: counts in comments

Live counts removed, dated history left alone:

- `useAutoRun.ts`: "Eleven targets … twelve controls … eleven copies" is gone; the header points at
  `AutoRunTarget` in `auto-run-targets.ts`, which is the list. Its `@returns` no longer lists which
  hooks carry `automatic` (the list had missed FAQ and Skim).
- "shared with the seven other artefact readers" in `useQuotes.ts`, `useTimeline.ts`,
  `useSketch.ts` and `useArc.ts` is "the other artefact readers", as `useDebate.ts` already said.
- `useGlossary.ts`: the same phrase, and "all eight now pass `refresh` here", are reworded so the
  number is dated (2026-09-02) rather than a claim about today. The second was also false today:
  `useSkim` passes its own `onFinished`.
- `rewrite-hold.ts` and the header of `tests/rewrite-hold.test.tsx` no longer list the modes.
- Two comments that still spoke of a file: `useArc.ts` ("the one on disk") and `useIllustrated.ts`
  ("our own file").

**Left, because the file is another cluster's:** `useIdeas.ts` has the same "seven other artefact
readers" line. `JobProgress.tsx` counts its callers ("the nine other reader-facing callers … the
tenth is the showcase"); it is not a hook and was not touched.

## Left

- **Skim's hold** (C10b).
- **The builder left Retry's bypass unreproduced.** `JobProgress` re-ran a failed job without
  going through `useRewriteHold`, reopening the completion-read gap for that run. The
  write-capable review reproduced and repaired the shared seam; see below.
- **The command bar's *Run again* row buys a second run over a held mode** (GPT Sol's C4).
  **Fixed on 2026-10-07 in [261007i](261007i-command-bar-run-again-row-honours-the-rewrite-hold.md)**;
  the pin below is now the test of the fix. What follows is the finding as it stood.
  `CommandBar.tsx` § `rerunRows` posts `stepRunRequest(slug, step, { force: true })` straight
  through the queue and then navigates to Metadata; it never asks the mode's hold. **Reproduced at
  the row's action, not in the drawn bar:** with FAQ held (the rewrite finished, its GET still in
  the air), running the `rerun-faq` command out of `besideTheModes` posts a second
  `{ steps: ["faq"], force: ["faq"] }` while the mode's own controls stay held. It is pinned as a
  known-open defect in `tests/rewrite-hold.test.tsx` § *pins C4*, in the form
  `tests/adversarial-shapes.test.ts` uses: the pin goes red when the row is fixed. Not reproduced:
  the keystrokes in the real `Dock`, and the same press on any other step (the row's code is one
  `map` over `METADATA_RERUN_STEPS`, so it is read as the same). `CommandBar.tsx` was not changed.
  The fix is small in shape and a decision in substance: the hold is keyed by `(slug, step)` in a
  module, so the row could refuse while one is held, but it would need a sentence to say why.
- **Metadata's re-run rows** force a step with an artefact possibly on screen in another tab or
  behind them. Excluded from the guard with their reason; whether they want a hold is a separate
  question, and not reproduced here.
- **A browser pass.** None was made in this cluster; the caller arranges one.

## Done when

- each of the six has a row in `tests/rewrite-hold.test.tsx`, seen red before and green after, and
  red again with its hold wiring removed;
- every forced control in those six panels honours `rewriting`;
- the docs that own each mode say so, and
  [reader-profile.md § Regenerate waits for its own result](../project/reader-profile.md#regenerate-waits-for-its-own-result)
  names Skim as the one left;
- typecheck, the touched suites and `doc-links` pass.

## Gates

On the tree with `origin/dev` merged (2026-10-07), outside any sandbox: `npm run typecheck` clean;
`npx vitest run` by file in four runs, 91 files, 2,473 tests passed, 9 skipped, none failed
(`tests/rewrite-hold.test.tsx` 233 of 233, with `doc-links`, `read-error-matrix`,
`artefact-read-race` and every suite that names a changed hook, panel or band). Biome on the 19
touched files: 5 `useOptionalChain` warnings on the `waiting` line, written as
`IdeasPanel.tsx` writes it (it has the same warning), and 7 informational notes, among them the
existing complexity advisories on five panel functions and a new one on the guard's walker.
No full `npm test`, no browser pass, no cross-family code review yet: the caller runs that before
pushing.

## What the write-capable review repaired

Review reproduced the deferred Retry finding before changing code: nine mounted controls re-armed
while the retried result GET was pending. Thread's first fixture had no Retry button and was
corrected to use its stale banner; that harness failure is separate from those nine behavior
failures. The repair registers each mode's existing hold with `useStepJob`'s Retry and returns
the replacement job ID to it, preserving the retry endpoint and the existing release rules.
The loaded Sketch and Illustrated branches remain as built; their actual hooks exercise the seam
separately. The cause, history and countermeasures are in
[the postmortem](../postmortems/261007b-an-alternate-paid-action-bypasses-the-completion-fence.md);
the review cases are in [rewrite-hold.test.tsx](../../tests/rewrite-hold.test.tsx).

Reviewer validation on the final tree: the complete hold suite **331 passed, 24 skipped, 0 failed**;
the skips are the table's inapplicable branches, with the loaded picture hooks tested separately.
Disabling only Retry's hold registration made the twelve completion-gap probes fail (12 failed,
343 skipped); restoring it made the same probes pass (12 passed, 343 skipped).
The six shared-job/doc-link regression suites passed **90 tests**. The 18 typed-fixture suites
passed **726 tests** before the two new panel cases; the complete FAQ/Citations suites then passed
**157 tests**. Those suite counts overlap. `node --import tsx scripts/typecheck.ts` passed all four
projects and covered all 3,344 source files. No network, full `npm test`, browser pass or commit.

## Review status

**GPT Sol's code review: "ship with these fixes applied, for the scoped stage."** Four findings;
the prompt and the answer are beside this file
([prompt](261007b-seventh-sweep-rewrite-hold-on-the-six-forced-verbs-without-one-code-review-prompt.md),
[answer](261007b-seventh-sweep-rewrite-hold-on-the-six-forced-verbs-without-one-code-review-sol.md)).

- **C1, Retry reopened the paid-run gap in all twelve hold users: fixed by the reviewer**, at the
  `useStepJob` / hold seam. Checked again afterwards by disabling the one registration line: 32
  cases red (the ten mounted *Retry holds…*, their ten offline twins, the twelve picture-hook seam
  cases), green restored. A Retry that is refused, one whose job fails, and one pressed twice each
  release or stay single; all three are cases in the suite.
- **C2, `faq.md` and `citations.md` overstated Metadata's exclusivity: fixed by the reviewer.**
- **C3, a job that ended unseen and was trimmed left a dead control: fixed after the review**, in
  `rewrite-hold.ts` (about ten lines, no new state machine, no new wording). `run` now also asks
  the job engine's `watchTerminal`, which outlives every band and answers once: the job is listed
  as over, or it is missing from a list asked after the POST answered. Either sets `over` on the
  hold, and rule 3 releases on the same fresh read it always needed. It was shared by all twelve
  rows, not the six new ones. How long a failed row stays listed: `KEEP_FINISHED` is 50 finished
  jobs per reader, failures and successes interleaved by finish time
  (`src/store/pg-jobs.ts` § `trimFinished`), so the path needed some 25 to 50 later endings before
  the band reopened; rare, and a dead control when it happened. Red first on all twelve rows
  (*expected 'disabled' to be 'enabled'*), and two mutations each turn all twelve red: ignoring
  `over`, and releasing the moment the engine speaks (which lets a read asked earlier, or the
  offline copy, release). It cannot release early in the case the hold exists for: the engine
  speaks only once the server's job is finished (a job still going cannot be forgotten), and the
  read must start after a band has seen that. A job that succeeded and was trimmed is released by
  the same read, which carries the new identity.
- **C4, the command bar's *Run again* bypasses every hold: not fixed here, reproduced and pinned;
  fixed afterwards in [261007i](261007i-command-bar-run-again-row-honours-the-rewrite-hold.md).** See
  § Left.

One thing the review's own edit got wrong: its `key` on the test's adapter did not pass
`npm run typecheck` (TS2352 in `tests/tsconfig.json`), though its report says the typecheck
passed. The cast was narrowed in the commit that took its fixes.

**New reader-facing wording, following the existing six, for Greg to veto; keeping them was the
orchestrator's call:**

- *The new quotes haven't loaded yet.*
- *The new timeline hasn't loaded yet.*
- *The new search hasn't loaded yet.* (Debate)
- *The new citations haven't loaded yet.*

**Not built, and why:**

- **The loaded branches of the Sketch and Illustrated views on `JobProgress`.** It would reverse
  three written-down choices (no Stop beside a picture, nothing drawn when nothing runs, a grey
  failure rather than a red one), and each needs a decision. § The loaded branches, above.
- **Skim's hold** waits for C10b, which changes the same hook.

**The guard's known blind spots:** a computed key, `{ ["force"]: true }`, and a `force` assigned
after the object is built, `request.force = true`. Neither is in the tree today; the guard reads
object literals only, and says so in the test.

## What the documents got wrong

- **"The held state must use whatever the existing six show"** assumes they show one thing. They
  show one component and six sentences. See § What a held mode shows.
- **WCO3's table says Timeline, FAQ, Debate and Citations force "on the stale banner's `onRun`"**,
  and Sol's review repeats it. Each also draws the same forced button in its foot, on a current
  list, after a start that was refused (a failure with no job to retry). Both places are held.
- **Quotes has three forced controls, not one.** *Find more* is the one the finding names; *Choose
  them again* is on the stale banner and in the outdated list's status foot, through the same verb.
- **The review's list of who else forces a step stops at Metadata.** The command bar
  (`CommandBar.tsx`, the *Run again* rows), `StructureNotice.tsx` and `ShelfEntry.tsx` do too.
  None is an artefact hook; the guard names each.
- **`citations.md` and `faq.md` said the Metadata row "is the only redo".** The stale banner has
  one as well. Both now say so.
