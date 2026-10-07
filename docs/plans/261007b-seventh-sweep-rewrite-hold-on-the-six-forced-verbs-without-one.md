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

**Nothing new was added to `rewrite-hold.ts`.** Its release rules are untouched; the six hooks pass
it an identity, their queue and their read's bookkeeping, as the first six do.

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

## The guard, the loaded branches, WCO9 and WCO8

Recorded as each lands, below.

## Done when

- each of the six has a row in `tests/rewrite-hold.test.tsx`, seen red before and green after, and
  red again with its hold wiring removed;
- every forced control in those six panels honours `rewriting`;
- the docs that own each mode say so, and
  [reader-profile.md § Regenerate waits for its own result](../project/reader-profile.md#regenerate-waits-for-its-own-result)
  names Skim as the one left;
- typecheck, the touched suites and `doc-links` pass.

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
