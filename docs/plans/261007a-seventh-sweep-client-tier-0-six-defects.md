# Seventh sweep, reader client, tier 0: six small defects

Up: [plans.md](../project/plans.md) ·
umbrella: [261006m](261006m-seventh-codebase-sweep-depth-umbrella.md)

One cluster of the seventh sweep. Six defects in the reading view's client code, each found by one
model family and confirmed by the other in the four reader-client documents under
`docs/investigations/261006d-seventh-sweep-depth-reader-client-*`. Each was treated as a claim: a
failing test first, then the fix, then the fix put back to watch the test go red again.

## What

| Id | What a reader would have seen | Where |
|---|---|---|
| WCO1 | Start a quiz, leave the Learn band before it finishes: the questions never appear in the prose until the band is reopened or the page reloaded. | `useQuiz.ts` § `useQuizRead` |
| WCO2 | Cross-reference underlines vanish from the prose when the re-read after a finished job fails. | `useCrossrefs.ts` |
| WCO5 | The Metadata page prints the browser's own "Load failed", or any exception's text, at the top of *AI processing*. | `Metadata.tsx` |
| WCO7 | After two refused *Paint it* presses in a row, the Illustrated panel still describes the Sketch as it was before the first. | `useIllustrated.ts` |
| WC2 | A bookmark pressed just before choosing Debate's other view opens its comment box over that view. | `reader/Reader.tsx` § `surface` |
| WC4 | A Debate view that crashed leaves its "not working" band over the other view after Back or Forward. | `reader/ModeBoundary.tsx` |

## The simpler option passed over

For WC2 and WC4 the smallest fix is one more line in each of two hand-written lists of five. That
is what both investigations proposed, and it is how the lists came to be one short: Debate's
sub-modes arrived (`4b502174a`) a day after the lists were written. Taken instead: each list is a
`Record<ModeWithSubModes, …>` in the file it was already in, so a seventh mode with sub-modes does
not compile in either until somebody has decided it. No new module and no registry — two typed
object literals, about the same number of lines as the lists they replace.

For the other four the simpler option *is* what landed: one line each for WCO1 and WCO7, a
functional `setRead` for WCO2, and the existing `describeFetchFailure` for WCO5.

Not taken, and why:

- **A derived check that every artefact read `OwnedArticle` holds has a row in
  `always-mounted-reads-refresh.test.tsx`** (Opus's class fix for WCO1). Sol's review is right that
  "every hook called there" is wider than the four artefact reads, so it needs a list of named
  exclusions and a decision about each. `READS` stays a hand list, and its header now says so.
- **Any new sentence.** WCO5 uses `describeFetchFailure`'s three existing sentences.

## Done when

Each of the six has a test that was red before the fix, is green after it, and goes red again when
the fix is reverted; `npm run typecheck` passes; every test file that names a changed module passes
by file; `tests/doc-links.test.ts` passes.

## What landed, per item

### WCO1 — the quiz read hears its own step finish

`useStepFinished(slug, "quiz", refresh)` in `useQuizRead`, and a `quiz` row in the test's `READS`.

Red first, with only the row added:

```
× quiz: the always-mounted read asks again, and starts nothing
× quiz: Strict Mode and a slug change keep completions scoped
× quiz: an open band adds a trailing GET when no read is outstanding
AssertionError: expected [ 'GET /api/quiz/always-mounted' ] to deeply equal [ Array(2) ]
Tests  3 failed | 14 passed (17)
```

The investigation was right in every particular, including the three failing cases Sol's review
counted.

### WCO2 — a failed re-read leaves the cross-references alone

The catch is now `setRead((was) => (was?.slug === slug ? was : { slug, links: null }))`: state this
article's last answered read gave stays; anything else settles on nothing to draw. The hand-written
completion listener became `useStepFinished(slug, "crossrefs", refresh)`. I checked the two are the
same before swapping: both are `useJobs("quiet", …)` filtered on `job.slug === slug` and
`job.steps.some((s) => s.name === step)` (`useStepJob.ts` § `writesStep`).

`tests/crossrefs-revalidate.test.tsx` now uses the real `readJson`, which is what throws for a 500;
its old mock only parsed the body, so a failed refresh could not be told from a successful one
there. Seven new cases: kept on a 500 and on a transport failure; cleared on a successful stale
answer, a 404 and a `200 null`; nothing drawn when the opening read fails; nothing carried to
another article whose own read failed.

Red first:

```
× keeps the links it has when the refresh fails (http-500)
× keeps the links it has when the refresh fails (transport)
AssertionError: expected 'none' to be 'the result'
Tests  2 failed | 7 passed (9)
```

### WCO5 — the Metadata page's failed read

`setProvenanceError(describeFetchFailure(e as Error))`, and one predicate,
`const provenanceFailed = provenanceError !== null`, in the five places that asked. `RerunSection`
and `StageRecord` take the same `string | null` and now test `=== null` / `!== null` too; their
`!error` was the same fact.

Red first (`tests/metadata-failed-read-says-a-readers-sentence.test.tsx`, new):

```
× a dropped connection is said in our words, not the browser's
    expected 'Load failed' to be 'Couldn't reach the dev server — is `…'
× an exception nobody wrote for a reader is the page's own sentence
    expected 'ECONNRESET at socket 0x1f' to be 'This page ran into a fault of its own…'
× a failure with nothing in its message is still a failure, and still says so
    expected null to be 'Couldn't reach the dev server — is `…'
Tests  3 failed | 1 passed (4)
```

**Two things the investigations did not say.**

1. *Calling `describeFetchFailure` from `Metadata.tsx` turns a second test red.*
   `tests/describe-fetch-failure.test.ts` § *throws no plain Error for it to swallow* forbids
   `throw new Error(` in any file that calls it, and this file had two. Both are sentences drawn for
   a reader, so both are `ReaderFacingError` now. One of them was a live instance of what that test
   exists to stop: `saveTags` threw *"Still saving the last tag change — a moment."* as a plain
   `Error`, and `TagEditor` draws its failures through `describeFetchFailure`, which would have
   given the reader the page-fault sentence instead. Whether the editor's own busy gate lets that
   path be reached, I did not establish.
2. *The empty-message half is reproducible at the door, not only a hypothesis.* A transport
   `TypeError("")` gave `provenanceError === ""`: no sentence drawn, four consumers told "not
   failed", the sharing card told "not still checking". After the fix a failure cannot have an
   empty sentence, **which also means the predicate change cannot be mutation-tested on its own**:
   putting `Boolean(provenanceError)` back leaves all four cases green. It is kept as the one
   spelling of the fact, not as a guard a test holds.

No new reader-facing wording. A reader who used to see "Load failed" sees `COULD_NOT_REACH`; one
who used to see an exception's text sees `PAGE_FAULT`; a server's own `{ error }` is unchanged.
One cost: `describeFetchFailure` reports an unauthored exception to Sentry, and this read asks
again four times after a failed first read, so one bad page load can report five times.

### WCO7 — the Illustrated re-ask key

`queue.failed?.message ?? ""`.

Red first (`tests/illustrated-reasks-the-sketch-after-a-refusal.test.tsx`, new): two refused starts
with different refusals; no job is made, so the id half of the key never moves.

```
× asks again after a first refusal, and again after a second in different words
AssertionError: a different refusal is new evidence about the Sketch: expected 2 to be 3
Tests  1 failed | 1 passed (2)
```

**Where the investigation was wrong.** Opus called it *"every case I could construct, so nothing is
broken"*. Two refused `POST`s in a row is a case, and it is the one the re-ask is for: a refusal is
the server saying the Sketch is not what the panel thinks. Sol's review found the collision but
rated it cosmetic. Still true after the fix, and pinned by the second test: two refusals in the
same words do not re-ask.

### WC2 — Debate's view in the foreground snapshot

`surface.current` now ends with one string built from
`Record<ModeWithSubModes, string>`, in place of five `subNav.*` entries.

Red first, with a control beside it (the box *does* open over Debate when nothing changed), since
"no box" is also what a band that never lets it open looks like:

```
× does not open over a Debate view the reader chose while the store was answering
AssertionError: expected 'spya-aktfqw' to be null
Tests  1 failed | 8 passed (9)
```

The test changes the view through the address rather than by pressing the chip: the chips are drawn
only over a stored debate. The held selection create (`selectProse`) reads the same snapshot and
has no test of its own for this.

### WC4 — Debate's view in the boundary's reset key

`SUB_MODE_PARAMS` (`satisfies Record<ModeWithSubModes, unknown>`) and
`SUB_MODE_SELECTS_A_BAND_FOR: Record<ModeWithSubModes, "anyone" | "owner">` replace the nested
ternary. Debate is `anyone`, with Summary and Structure, as the Opus review said.

Red first, both arms:

```
× owner: Back from a broken Claims to Reception is a fresh band
× visitor: the other view is a fresh band too
Tests  2 failed | 88 skipped (90)
```

## Mutation checks

Each fix put back, its test run, the file restored:

| Mutation | Result |
|---|---|
| WCO1: no `useStepFinished` in `useQuizRead` | 3 failed, 14 passed |
| WCO2: the catch clears again | 2 failed, 7 passed |
| WCO2: a failure keeps the previous article's state under the new slug | 1 failed, 8 passed |
| WCO5: the raw message again | 3 failed, 1 passed |
| WCO5: the predicate back to `Boolean(…)` | **0 failed** — see above |
| WCO7: the object in the key again | 1 failed, 1 passed |
| WC2: Debate's entry made constant | 1 failed, 8 passed |
| WC2: Debate's entry deleted | `tsc`: `TS2741 Property 'debate' is missing` |
| WC4: Debate left out of the key | 2 failed |
| WC4: Debate `owner` only | 1 failed (the visitor's), 1 passed |
| WC4: Debate's policy deleted, or its parser | `tsc`: `TS2741` |

## Comments corrected on the way

Only in files this touched: *"shared with the seven other artefact readers"* in `useQuiz.ts` (the
count is gone, not corrected); four comments in `Metadata.tsx` that described the metadata request
as a directory walk or as looking on disk; `useStepJob.ts`'s list of the always-mounted reads;
`read-error-matrix.test.tsx`'s two `NOT_A_ROW` reasons, both of which described the behaviour
changed here; and `web-client.md`'s *"the seven files that use"* `describeFetchFailure` (36 do).
`useQuotes.ts` carries the same *"seven other"* line and was not touched.

## Left

- `Metadata.tsx` § `DeletePermanently` still interpolates `(e as Error).message` into *"Couldn't
  delete it — …"*, and `setError(ended((e as Error).message))` on a 409. The same class as WCO5, on
  a different read; not in this cluster's brief.
- `Metadata.tsx` says *"Checking which files the pipeline wrote…"* to a reader. There are no files.
  A wording change, listed for the owner in the Opus investigation.
- WCO8's other files (`useAutoRun.ts`, `useTimeline`, `useArc`, `useGlossary`, `useIdeas`,
  `useSketch`, `useQuotes`, `useOrderedRead.ts`) and `src/routes.ts`'s *"stat-ing every file"*.
- No browser pass was made.


## Write-capable review corrections

The committed-stage review reproduced identical Illustrated refusals losing the Sketch re-ask
and Metadata’s retries repeating reporting five times. The uncommitted review fixes count refused
starts locally and reuse consecutive identical failure descriptions per article. The root causes,
introducing commits and trade-offs are in
[the review postmortem](../postmortems/261007a-repeated-reader-failures-need-occurrence-identity.md).
These are reviewer corrections to the orchestrator/builder’s stage choices.

U7 now has a small syntax-derived guard: every slug-taking hook inside `OwnedReader` must appear
in the refresh harness or in a named exclusion with a reason. It catches a newly hoisted direct
hook; aliases and wrappers hiding the slug remain outside its scope. The held `selectProse` path
also has Debate changed-view and unchanged-view cases. Three misleading Metadata comments were
corrected: unauthored exceptions versus server sentences, metadata’s actual completed/current
verdict, and an unmeasured local latency claim.

Wider, left unchanged: two completion listeners can send two GETs with a band open; the shared
API cache preserves a previous artefact after a successful null/404 and can replay it offline.
The latter can redraw deleted crossrefs. Neither originates in this stage’s failure-preservation
branch. No network, database, browser, full suite or commit was used for the review.


Review validation: the final explicit Vitest run passed **12 files, 337 tests** (the original
stage suites, held selections, doc links, permanent deletion and step-job request shapes).
`npx tsc -p src/web/tsconfig.json --noEmit` and the same command for `tests/tsconfig.json` both
exited 0. Scoped Biome lint exited 0 with one existing complexity advisory in the selection test’s
reply stub. No full-suite gate is claimed.

Red evidence: identical-refusal and repeated-report tests together had **2 failures, 5 passes**
before their fixes; after the companion case was added they had **8 passes**. Removing Quiz’s
inventory row produced **1 failure, 14 skips**. Replacing the Debate snapshot value with a
constant produced **1 failure, 1 pass, 50 skips** in the held-selection cases. Removing Debate
from each of the snapshot, boundary parser and boundary policy produced `TS2741` three times.
All mutations were restored by editing back. The offline replay test separately passed **1 test,
69 skipped** against the existing shared cache policy; the hook redraw is a source inference.

## Review status

**GPT Sol's code review (2026-10-07): "ship with these fixes applied."** The
[answer](261007a-seventh-sweep-client-tier-0-six-defects-code-review-sol.md) and the
[prompt](261007a-seventh-sweep-client-tier-0-six-defects-code-review-prompt.md) are beside this
file. Its fixes were read as a proposal by a second (Claude) pass before being committed; each of
C1 to C3 was hand-reverted, its test watched go red, and the fix put back.

- **C1, fixed.** Two Illustrated refusals in the same words did not re-ask the Sketch. A refusal
  count local to `useIllustrated`, shared by its three start verbs, is now part of the re-ask key.
  Red without it: `expected 2 to be 3`. Checked: the count only moves when a start is refused, and
  a start comes only from a press or from the one automatic run, whose token `useAutoRun` consumes
  before it fires — so the count can cause a `GET /api/sketch/…` and nothing else, never a paid
  call and never a loop. It is not reset on a change of article and does not need to be: the slug
  is its own dependency of the re-ask, and a stale count is only a number that differs.
- **C2, fixed.** Metadata's four timed retries reported the same unauthored failure five times.
  Consecutive failures with the same class, message and transport branding for the same article
  now reuse the first one's sentence. Red without it: `called 1 times, but got 5 times`. Checked:
  the remembered failure is cleared on a successful read and when the article changes, and the
  slug is part of the comparison, so the first report of a new failure cannot be suppressed. What
  it does give up, knowingly: two different defects throwing the same class and message back to
  back, with no success between them, are reported once. **Tested**: the repeat, a different
  exception, and an authored failure in the same words. **By inspection only**: the reset on
  success and on a change of article.
- **C3, fixed.** `tests/always-mounted-reads-refresh.test.tsx` now derives the slug-taking hooks
  inside `OwnedReader` and requires each to have a row or a named exclusion. Red with Quiz's row
  removed (2 failed, 13 passed). Aliased hooks and wrappers that hide the slug are outside it.
- **C4, fixed.** Three Metadata comments that claimed more than the code does. No behaviour.
- **C5, left — wider than the stage.** A deleted crossrefs artefact can be replayed from the
  offline API cache after a transport failure: saved links, then a successful `200 null` clears
  them, then a dropped connection serves the older cached copy. That is the shared cache's policy
  for a null or 404 answer, not this stage's failure-preservation branch.
- **C6, left — wider than the stage.** With the Quiz band open, the band and the always-mounted
  read both hear a job complete, so two GETs go out when no read is outstanding (an outstanding
  read coalesces them into one). It is the shared four-read pattern, the same for Citations,
  Glossary and Quotes.

Gates at commit, outside any sandbox: `npm run typecheck` clean on all four projects; `npx vitest
run` by file, 60 files and 1,643 tests passed, none failed (10 touched files plus doc-links: 288;
the 50 other suites naming the changed modules: 522 and 833); Biome on the six touched files, one
existing complexity advisory. No full `npm test`, no browser pass.
