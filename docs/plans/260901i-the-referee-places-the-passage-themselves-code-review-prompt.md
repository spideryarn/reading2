# Review this built code

You are reviewing **code that has landed**, not a plan. Four commits, `9f9c474 0b522a7 7d3311c a6a27c4`,
diffed against `2b0876c`. The scoped diff is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/b6f0e15b-feaa-4d62-8a2b-65a055770758/scratchpad/referee-placement.diff`
(6250 lines) and the whole repo is on disk at `/home/greg/code/spideryarn2` — read any file you want.

Be adversarial and specific. I want findings I can act on, ranked most serious first. Tell me what is
wrong, what is missing, and what will bite in a way we have not anticipated. **Do not be agreeable.**
Previous reviews of this feature returned "do not build as written", "do not ship this as a completed
safeguard layer" and "do not call the safeguard layer done yet", and all three were right.

The plan is `docs/plans/260901i-the-referee-places-the-passage-themselves.md`. Read it first; it
records what was passed over and why.

## The repo, in one paragraph

Spideryarn is an AI-assisted reading app whose stated purpose is to **augment** reading rather than
replace it. **Referee mode** helps a scientific peer reviewer. In it the referee writes **criteria**;
a `diverging` criterion has two named poles and the model returns ranked passages each carrying a
**valence** from −100 to +100. TypeScript, ESM, React, Postgres, `strict` +
`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.

## What was built

A referee can now place a passage on their own criterion, change it, and clear it; and the panel shows
their placement beside the model's.

1. **`patchMark`**, a fifth `CommentStore` operation, on `PATCH /api/comments/:slug/:id/mark`, through
   the same `tidyMark` the create path uses. Plus a fix to `PATCH /api/comments/:slug/:id`, which was
   deleting the reader's prose on any request carrying no `body` key.
2. **`src/web/PlaceOnCriterion.tsx`** — the instrument. Five positions in the criterion's own pole
   words, writing −100/−50/0/+50/+100. Mounted in `AnnotateDialog` (the box a prose selection opens)
   and in `CommentDialog`.
3. **The gap**, in `src/web/CriteriaPanel.tsx` — the referee's placement printed beside the model's,
   theirs first, plus a "Yours, that the model did not turn up" list.
4. **A vitest `setupFiles` guard** refusing any outbound request to a provider host, after two tests
   were found making real paid OpenRouter calls and passing.
5. Test hardening, and two client bug fixes (a staleness verdict that could never fire).

## The seven things I most want challenged

1. **Is the anchoring argument actually honoured by the code, or only by the plan?** The whole design
   turns on the referee's judgement being independent of the model's. The instrument lives in the
   selection flow so it can be used before any criterion has run and on passages the model missed.
   But `CommentDialog` — where a placement is *edited* — is opened from a mark in the prose, and the
   `CriteriaPanel` row now shows both numbers. Find the paths by which a referee sees the model's
   valence before or while making their own. Is `tests/referee-placement.test.tsx` § "the model's
   judgement is nowhere near the referee's instrument" a real assertion or theatre? What input would
   make it a real test?
2. **Five positions writing −100/−50/0/+50/+100.** Storage is a signed integer over the full range,
   and the model writes anywhere in it. So the referee's −50 and the model's −50 are the same number
   meaning different things: one is "one of five words I pressed", the other is a continuous estimate.
   Is that a real defect, and where does it first cause a wrong answer? Consider the "Yours, that the
   model did not turn up" list, the deferred gap-sorted list, and `db:export`.
3. **`PATCH /api/comments/:slug/:id/mark` requires both keys and 400s a half body.** That rule is the
   route's, not `markProblem`'s. Is it right? What can a client now do that it should not, or fail to
   do that it should — in particular around clearing a placement, changing the criterion under an
   existing valence, and racing two placements on one comment.
4. **The body-wipe fix.** `"body" in raw` with a `fields()` helper that turns a non-object body into
   `{}`. Verify the fix is complete and that `PATCH { body: null }` still clears. Is there another
   route in `src/routes.ts` with the same shape — a destructure whose absent field means "erase"?
   That is the question I most want answered by a sweep rather than an opinion.
5. **The provider guard** (`tests/setup/provider-guard.ts`, `tests/setup/no-provider-calls.ts`). Its
   author's first version installed itself as an import side effect, so its own "is the guard
   installed?" test passed with `setupFiles` deleted — the bug class inside its own fix. The split
   into two files is the fix. **Is the split correct, and can the guard still be defeated silently?**
   Consider `node:http`, `undici`, subprocesses, a provider host nobody listed, a test that stubs
   `fetch` and then makes a real call itself, and `vi.resetAllMocks`/`unstubAllGlobals` between tests.
6. **Does the panel ever combine the two valences?** The rule is *two valences, never one* — never
   averaged, reconciled, or shown as one number. Check `RefereeGap`, `refereeSide`, `placementByBlock`
   and `Misses` in `src/web/CriteriaPanel.tsx` for anywhere a single number could be derived, and
   check the matching rule (`criterionId` + `blockId`, span overlap deferred) for cases where one
   referee placement is attributed to the wrong model result or vice versa. Two placements on one
   block currently fall to the misses list.
7. **The tests.** This repo's recurring failure is a check that reports success while sharing an
   assumption with the code — see `docs/reusable/silent-success.md`. Several tests here are new.
   **Name the ones that cannot fail**, and for each say the one-line change to production code they
   would survive. Be concrete enough that I can reproduce it. `tests/referee-gap.test.tsx`,
   `tests/referee-placement.test.tsx`, `tests/referee-criteria-panel.test.tsx`,
   `tests/store-comments-parity.test.ts` and `tests/no-provider-calls-guard.test.ts` are the new ones.

## Facts you need, all verified

- **The referee's mark is a comment.** `comments.criterion_id` + `comments.valence`. A comment with a
  `criterionId` is a review comment; one without is a reading note. `comments_valence_range` and
  `comments_valence_needs_criterion` are `CHECK` constraints; a `CHECK` cannot reach `referee_criteria`
  to read a kind, so "a placement only goes on a criterion with two ends" is `markProblem`'s alone.
- **Valence is not confidence.** `validateHits` (`src/search.ts`) clamps a negative confidence to zero,
  so a placement routed through anything confidence-shaped arrives as `0` — "no strong feeling" — with
  nothing erroring. `clampValence` is deliberately a separate function from `clampConfidence`.
- **The prose stripe carries criterion identity, never valence**, because `annotateHtml` collapses
  strength while keeping identity, so repainting by valence would destroy provenance.
- **Colour is never the only carrier.** `docs/project/colour-scales.md` otherwise argues red↔green
  down; it is permitted here only because the direction is also printed in words. If the panel stops
  printing words, `DEFAULT_DIVERGING_SCALE` has to move.
- **`valenceGap` still has no caller.** The Stage 3 agent refused to add one, arguing the gap is a
  magnitude and the disagreement sentence is about direction — −100 against −5 is a wide gap and the
  same answer. It wrote `directionsDiffer` instead. **Tell me if that reasoning is wrong.**
- `SPIDERYARN_STORE=postgres` is what production runs; the filesystem store is the local default and
  `AGENTS.md` tells everyone to run with `postgres`.
- Deferred on purpose, so do not report as missing: a gap-sorted disagreement list across criteria;
  span-overlap matching; stored history of a placement and an undo toast; defaulting the picker to the
  criterion expanded in the panel.

## How to report

Findings, most serious first, each with file and line. Say plainly which are **must-fix before this is
called done** and which are worth recording and leaving. If a finding is a guess, say so — I will
check each one myself and I would rather have a marked guess than a confident wrong claim.

If you could make only one change, say which and why.
