# The referee places the passage themselves

**Status:** in progress, started 2026-09-01.

The referee's own valence has been storable since 2026-08-31 and unreachable ever since. The
columns exist, the create input carries them, the route validates them, both stores round-trip
them, and the export includes them — and **nothing on screen has ever offered to make one.**

That is half of what Greg asked for:

> I'm keen to also include some kind of ranked red, green, and/or red-green-spectrum, for a range
> of criteria defined by the user, perhaps harmonising with the ability for the user to comment
> (perhaps quantitatively) on things.
>
> — Greg, 2026-08-31

The second clause is the anchoring antidote. Referee mode exists because Greg is wary of
"cognitive surrender" — handing the intellectual labour to the model. A referee who only ever
*reads* the model's valence has surrendered exactly the judgement the mode is meant to protect.
`valenceGap` ([`src/referee-criteria.ts`](../../src/referee-criteria.ts)) measures the distance
between two independent judgements, and until now there has only ever been one.

This plan builds the other one, and the place it becomes visible.

## What is already built, and is not up for redesign

`Comment.criterionId` + `Comment.valence`, `NewComment`, `tidyMark` and `markProblem` on
`POST /api/comments/:slug`, both stores, `db:export`, and
`tests/comment-referee-mark.test.ts` — which puts a −80 in through the real route and reads it
back off the real store. [comments.md § the referee's own placement](../project/comments.md#the-referees-own-placement).

## The one place the design was genuinely open, and how it was settled

**Where does the referee place a passage?** Two candidates, and the choice is the whole plan.

- **In the `CriteriaPanel` row**, beside each model result. Two clicks, and wrong. It fails the
  anchoring constraint twice: the referee can only place passages *the model surfaced*, and the
  model's rank, words, number and swatch sit in the same visual field as the input. A control
  that renders the model's judgement while soliciting the referee's is not measuring the
  referee's judgement, it is measuring their willingness to copy a number.
- **In the selection flow** — `AnnotateDialog`, the box that opens when the referee selects
  prose. **This is the one.** It is independent *by construction*: it exists before any criterion
  has run, it works with `?crits=` empty, it works on a passage the model never returned, and the
  anchor comes from the referee's own selection rather than from a model row. It is also the
  cheapest: the dialog, the create call and the wire fields all exist.

The gutter was ruled out by the panel's own rule 1 (the prose carries criterion *identity*, never
valence) and by the note in `CriteriaPanel.tsx` that gutter valence is deliberately unbuilt.

Fable argued this out on 2026-09-01 and named the objection that would falsify it: **friction**.
Select, open, expand, pick, press — per passage, per criterion, against eight criteria. If real
use shows model runs and near-zero placements, friction was the problem, and the fix is a
row-level *"place this yourself"* that opens the same instrument **with the model's line hidden
until commit** — the sealed-envelope version of the thing argued against here.

## The instrument: five positions in the referee's own words, never a slider

A −100…+100 slider is false precision (nobody means −63), it looks like the model's scale so it
invites numeric matching, and Greg is lukewarm on numbers to begin with. Drag-to-rank is worse: a
rank has no zero and no direction, and converting one to a signed valence is the rescaling step
`referee-criteria.ts` spends its header forbidding.

Five labelled positions, in the criterion's own pole words:

| what the referee presses (poles: against "underpowered", favour "well powered") | what is written |
|---|---|
| clearly underpowered | −100 |
| leans underpowered | −50 |
| counts neither way | 0 |
| leans well powered | +50 |
| clearly well powered | +100 |

Five and not three, because referees distinguish *a wrinkle* from *fatal*, and with only ±100
available every objection paints as maximal. Five and not seven, because past five the labels
stop being sayable in the poles' words.

The numbers are a **wire format, not a claim**. The instrument is discrete, so the display always
echoes back the exact label pressed and no precision is ever invented. That is "ranking over
scores" honoured in substance: the referee touches ordered words, never a number line.
`valenceStep` maps −100/−50/0/+50/+100 onto ramp steps 0/2/4/6/8, and `markProblem` accepts all
five unchanged.

## Overwriting gets an operation of its own

[comments.md](../project/comments.md#the-five-operations-and-why-there-are-five) already wrote
down what to do here: *"When editing is wanted it gets an operation of its own, named, like the
other four."* So:

- A fifth store operation, **`patchMark`**, writing `criterionId`, `valence` and `updatedAt` and
  nothing else.
- A route of its own, **`PATCH /api/comments/:slug/:id/mark`**, following the precedent of
  `POST /api/comments/:slug/:id/answer`.

**Why a separate path rather than extending `PATCH /api/comments/:slug/:id`.** That route takes
`{ body }`. Adding `criterionId`/`valence` to it means partial-update semantics on the wire —
absent means *leave alone*, `null` means *clear* — and a client that sends only `{ body }` would
be one missing branch away from silently clearing a placement. That is precisely the shape
[silent-success.md](../reusable/silent-success.md) is about: nothing errors, and a judgement the
referee made is gone. A named path cannot express the ambiguity.

The request carries **both fields, always**, and goes through the **same `tidyMark`** the create
path uses — one definition of what a placement is, not a second one that can drift.
`{ criterionId: null, valence: null }` clears the placement back to a plain reading note, which is
already a legal state.

**No stored history in v1.** A versions table is real weight for a value nobody has yet shown a
use for. The tension is named rather than hidden: a referee who places −50, sees the model's +60
and revises to +40 has silently destroyed the gap the placement existed to measure. V1 accepts
that, because the mode serves the referee and is not an experiment run on them. If it ever
matters, one write-once `valence_first` column recovers it cheaply. What v1 *does* do is show the
current placement before it is changed, so an overwrite is never invisible.

## Stages

### Stage 1 — `patchMark`, server side

`CommentStore.patchMark` in [`src/store/contracts.ts`](../../src/store/contracts.ts) (and its
allowlist table grows a fifth row), the filesystem implementation in
[`src/comments.ts`](../../src/comments.ts), the Postgres one in
[`src/store/pg-comments.ts`](../../src/store/pg-comments.ts), and
`PATCH /api/comments/:slug/:id/mark` in [`src/routes.ts`](../../src/routes.ts) reusing `tidyMark`.

**Done looks like:** a placement made through `POST`, changed through the new route, and read back
off the real store with the new value — against **Postgres**, in
`tests/comment-referee-mark.test.ts`; plus the parity suite covering both stores; plus the
refusals (a criterion that is not yours, an out-of-range valence, a valence with no criterion, a
placement on a non-`diverging` criterion, an unknown comment id).

### Stage 2 — placing a passage

`AnnotateDialog` grows a **"Place on a criterion"** section, in Referee mode only, defaulting the
picker to the criterion currently expanded in the panel. Only `diverging` criteria are offered,
because `markProblem` refuses the rest. The picker shows the criterion's text and its two pole
words and **never** shows whether the model has run, what it found, or any number.
`CommentDialog` shows and edits an existing placement.

**Done looks like:** a referee can place a passage the model never returned, with no criterion run
at all; the placement survives a reload; changing it goes through `patchMark`; clearing it works.
Plus a tripwire in the style of `tests/referee-copy-is-about-the-model.test.ts`: **no model
valence is ever rendered inside the placement instrument's container.**

### Stage 3 — where the gap becomes visible

Without this the feature writes to a database nobody reads, which is the day's own bug class.

- A `CriterionResult` row whose passage the referee has also placed grows a second line, **referee
  first**: *"You: leans underpowered · −50 — Model: counts against — underpowered — −64"*, and,
  when the directions differ, a plain sentence: *"You and the model disagree here."* Words before
  colour, per [colour-scales.md](../project/colour-scales.md).
- Each criterion gets a small sub-list, **"Yours, that the model did not turn up"** — the
  referee's placed passages with no matching model result. This is the mirror image of the gap and
  arguably the more valuable half: it is the model's *misses*, and it exists only because the
  entry point is the prose rather than the panel.

Matching is on `criterionId` + `blockId` for v1. Span-overlap matching is deferred until
same-block-different-passage is shown to be common.

**Nothing is averaged, reconciled, or shown as one number.** Two valences, never one.

### Stage 4 — the tests, hardened

Driven by a survey of the referee area for the repo's recurring bug shape: a check that reports
success while sharing an assumption with the code it checks. Findings and what landed are recorded
at the end of this file.

### Stage 5 — GPT Sol on the built code, and a browser pass

Sol reviews the code, not the plan, per Greg's instruction. A Sonnet subagent drives a real
browser, because tests going green is not evidence that a referee can see it.

## What this plan passed over

- **A row-level control in the panel** — two clicks instead of five, and it destroys the
  independence the whole feature measures. Recorded above with the condition that would bring it
  back, in sealed form.
- **A −100…+100 slider** — it is what the storage holds, and it is the wrong instrument for a
  human. False precision, and it invites copying the model's number.
- **A gap-sorted disagreement list across all criteria** — deferred. The per-row gap line and the
  misses sub-list get most of it, and a list sorted by disagreement is a ranking of the referee's
  own work, which wants thought before it wants code.
- **A versions table for placements**, and an undo toast on overwrite. Both deferred; the current
  placement being visible before it changes is the v1 answer to "not silent".
- **Making `criterionId` immutable on edit.** It would be a second rule with no enforcement
  benefit: the pair goes through one `tidyMark` either way, and re-placing on the right criterion
  should not require deleting the comment.

## What landed

_(updated at the end of every stage)_

### Stage 1 — `patchMark`, server side

`CommentStore.patchMark` ([`src/store/contracts.ts`](../../src/store/contracts.ts), whose allowlist
table and its "four operations" heading both grew a fifth row), `patchCommentMark` in
[`src/comments.ts`](../../src/comments.ts) wired into [`src/store/fs.ts`](../../src/store/fs.ts),
`patchMark` in [`src/store/pg-comments.ts`](../../src/store/pg-comments.ts), and
`PATCH /api/comments/:slug/:id/mark` in [`src/routes.ts`](../../src/routes.ts). Both fields always,
each a value or `null`; a body naming only one is a 400 with `[cmt-mark-pair]`.

**One validator, two shapes.** `tidyMark` now returns `MarkPatch` — `{ criterionId: string | null,
valence: number | null }`, declared next to `NewComment` — and a three-line `asNewComment` adapts it
to the absent-key shape `create` takes. The rules stayed in one place, which was the point: a second
copy of `markProblem`'s conditions is the thing that drifts. `null` rather than absent on the patch
side is not cosmetic — an absent key cannot say *clear this*, and `exactOptionalPropertyTypes` plus
the structural store comparison make a stray `null` in `NewComment` a real failure.

Tests, each watched red first: eleven cases in
[`tests/comment-referee-mark.test.ts`](../../tests/comment-referee-mark.test.ts) through the real
route against Postgres — including **+50 → −70 read back as −70**, the assertion the whole feature
exists for — and a step-by-step parity script in
[`tests/store-parity-referee.test.ts`](../../tests/store-parity-referee.test.ts) that drives create,
two edits, a clear and a re-place through **both** stores. That file had no comment-store coverage
at all before, which is exactly the gap the Stage 4 survey below names.

**And one bug found next door, fixed here.** `PATCH /api/comments/:slug/:id` deleted the reader's
prose when the request carried no `body` key — bug 1 of the survey below, proven with a test that
first showed `200` and a body of `undefined`. The fix is `"body" in raw`: `{ body: null }` is still
a reader clearing their words, and a request that never says what the body is is a 400 with
`[cmt-body-missing]`. Unknown keys are still ignored rather than refused, deliberately — with the
body required, a field the route does not act on can now only do nothing, and a no-op is visible
where a wipe was not.

### Stage 2 — placing a passage

[`src/web/PlaceOnCriterion.tsx`](../../src/web/PlaceOnCriterion.tsx) is the new module: the `Mark`
wire type, the five-position table, the label function, and the section itself. `AnnotateDialog` and
`CommentDialog` both mount it — the first with a local draft, the second controlled by the stored
comment — and `useComments` grew `place(id, mark)` on `PATCH …/:id/mark` plus the placement fields on
`create`. `tests/referee-placement.test.tsx` drives the real hook through the real dialogs and reads
the JSON that left, because the failure this feature exists to prevent is a negative arriving as `0`
with nothing erroring.

Four decisions worth a second look, each of which went against a plausible alternative:

- **The picker fires a write on its own.** In `CommentDialog`, naming a criterion sends
  `{ criterionId, valence: null }` before any position is pressed. That is a legal and ordinary
  state — a note answering a criterion without a score — and it is what makes the instrument
  controlled by the stored comment rather than by state of its own. The cost is two round trips to
  place a note that had no criterion. The alternative, holding the chosen criterion locally until a
  position is pressed, buys one fewer request and puts a copy of the placement back in the component,
  which is the thing the failure rule below depends on there not being.
- **`place` is not optimistic**, unlike `create` and unlike `recolour` in `useCriteria`. A colour
  that flicks back reads as the app arguing with the referee; a *judgement* that flicks back is the
  app telling the truth. The screen keeps the old placement until the server has the new one, which
  is how a failed `PATCH` cannot look like a success.
- **The plan's "default the picker to the criterion currently expanded in the panel" was not
  built.** It needs state out of `CriteriaPanel`, which is Stage 3's file, and a default criterion is
  a placement on the wrong one if the referee does not notice it. Deferred rather than dropped.
- **Outside Referee mode the section is not drawn at all**, including on a comment that already
  carries a placement. Printing the pole words needs the criteria fetched anyway, so a read-only line
  would buy a branch and nothing else. Named in the prop's own comment so it can be reopened if a
  referee is surprised by the absence.

### Stage 3 — where the gap becomes visible

[`src/web/CriteriaPanel.tsx`](../../src/web/CriteriaPanel.tsx) reads the placement back in two
places. `RefereeGap` is the second line on a result row the referee also placed — *"You: leans
underpowered · −50 — Model: counts against — underpowered — −64"*, their judgement first, plus
*"You and the model disagree here."* when the two point opposite ways. `Yours` draws the sub-lists
under the results — **"Yours, that the model did not turn up"** and, since the finding-4 fix below,
**"Yours, in a paragraph the model also answered on"** — each with a jump into the passage.
`CriteriaBand` grew a `comments` prop, threaded from `Reader` through `RefereeBand` and
`RefereeSubMode`; the panel only reads it, because a placement is made from the prose and nowhere
else. Two wording functions were exported rather than copied — `placementWords` out of
`PlaceOnCriterion.tsx`, and `valenceSentence` pulled out of `valenceLabel` in
[`src/web/valence.ts`](../../src/web/valence.ts) — so the label the referee pressed and the label
they are shown cannot drift apart, which is the failure
`tests/referee-criteria-panel.test.tsx` exists to catch.

[`tests/referee-gap.test.tsx`](../../tests/referee-gap.test.tsx), ten cases, all watched red first
over the real band. The one that matters most is not "both numbers are there" but **every digit
inside the gap line collected and compared against the two that went in** — a mean, a difference or
a rounded midpoint reads perfectly well and would pass a test that only looked for the strings it
expected. The others: an ordinary reading note on the same block appears in neither list, a comment
on another criterion appears under neither, and the referee's line survives `put(done)` replacing
the row wholesale — which it does because it is drawn from the comments rather than from the run.

Four decisions worth a second look:

- **`valenceGap` still has no caller, and that is deliberate** — though the reason first written
  down here was wrong, and Sol's finding 7 was right about it. The claim was that −100 against −5 is
  "a wide gap and the same answer". It is not the same answer: the five-position instrument records
  **strength** on purpose, and a referee saying *clearly* against a model saying *barely* is a real
  difference. The same paragraph gave zero the wrong semantics too — *"counts neither way"* is one of
  the five positions and a real answer, not a refusal to give one.

  What survived is the predicate, and the honest version of its justification. `directionsDiffer`
  asks one question and its name is the whole claim; the strength both sides gave is not lost,
  because the line above prints both judgements in words with both numbers beside them. And the
  reason not to reach for `valenceGap` is Sol's finding 6, not the old sentence: a referee's −50 is
  one of five pressed words and a model's −50 is a continuous estimate, so subtracting them asserts
  an interval scale the two do not share. A gap-*sorted* list needs shared bins, or the instrument
  recorded beside each number, before it can rank by that distance. Corrected in the comment on
  `directionsDiffer` on 2026-09-01, with the predicate left alone.
- **"The model did not turn up" is said only when `status === "done"`.** A criterion still streaming,
  or one that failed, gets *"Yours, and the model has not answered this criterion yet"* — the referee
  may place passages before ever asking the model, which is the anchoring-friendly order, and calling
  those misses would claim a search came back empty when it never ran.
- **The misses list is placements only** — a comment naming a criterion with no number stays in the
  gutter. Including the unscored ones is equally defensible and was passed over because the list is
  read as *the referee's other judgement*; named at the point of the decision so it can be reopened.
- **No swatch on either new line, and no colour anywhere in the block.** Both sides are already the
  direction in words, so colour would be a fifth carrier of something four words say. A single hue
  running between the two halves would also be the one number the feature refuses, drawn rather than
  printed.

Not built, and not cheap enough to sneak in: the **gap-sorted disagreement list across all
criteria** stays deferred. Threading the comments through does not make it cheap — the sort is one
line, and the question it begs (a ranking of the referee's own work, across criteria whose poles say
different things) is the part the plan wanted thought about first.

Stage 2's deferred **"default the picker to the criterion currently expanded in the panel"** is
still deferred, and threading `comments` did **not** make it natural: it moves data the other way.
The default needs the panel's *expanded criterion* — state `CriteriaPanel` does not lift and
`AnnotateDialog` cannot see — and a defaulted criterion is a placement on the wrong one if the
referee does not notice.

### Stage 5 — findings 4 and 7, and the two tests that did not prove their claim

**Finding 4, the matching.** `placementByBlock` kept the first placement on each block and handed it
to *every* model result on that block, and sent every other placement on that block to
**"Yours, that the model did not turn up"**. Both halves were false statements about the referee's
work — one judgement drawn twice as though they had made two, and a placement on a paragraph the
model *had* answered on labelled a miss, in words rather than in a number.

`pairPlacements` replaces it and **pairs only where a paragraph holds one of each**. Anything else on
a paragraph the model answered goes to a third sub-list, *"Yours, in a paragraph the model also
answered on"*, which says on screen that there is more than one passage here and the panel cannot
say which is which. Every placement appears exactly once, in exactly one of the three. The
alternative passed over was **pairing one-to-one in order**: cheap, and it invents an attribution
out of two unrelated sort orders — the model's ranking of its own answers against the order the
referee happened to write in — printed with the same confidence as a real match. Ambiguity that says
it is ambiguous is the smaller lie, and it is the shape that stops being needed the day span-overlap
matching lands. This needed no span arithmetic, which is what made it a fix rather than a deferral.

Sol's reproduction ran first: with the old semantics restored by hand, the five new cases in
`tests/referee-gap.test.tsx` go red, one of them showing the exact false attribution — *"one
placement was drawn as though it matched a passage: expected 2 to be 0"*.

**Finding 7** changed the comment and not the predicate — see the `valenceGap` bullet under Stage 3
above, now rewritten.

**The two tests.** *"No third number"* scanned only `.crit-gap`, so adding
`Gap: {Math.abs(referee − model)}` to the disagreement paragraph one element away left it green.
There is now a second case over the whole `.crit-result` row, with the two judgements pointing
opposite ways so the paragraph the mutation lands in is actually drawn; it compares the row's
distinct digit-runs against the rank, the referee's number and the model's, and the mutation gives
`['1','114','50','64']`. The fixture's model quotes had to lose their index digits to make that
assertion sharp.

*"The model's judgement is nowhere near the referee's instrument"* mounted `AnnotateDialog` alone.
It is not quite theatre — a `PlaceOnCriterion` that printed `chosen.results[0].valence` would trip
it — but it cannot speak to the claim in its name, because in the real reader the panel is mounted
beside it. [`tests/referee-anchoring.test.tsx`](../../tests/referee-anchoring.test.tsx) mounts the
band and the dialog **together** over one stubbed network, asserts first that the panel really does
print −87 and +93 (a `not.toContain` over a fixture that never renders is how the old one became
theatre), then that the instrument prints no number at all, that the picker names criteria by their
own words and poles and nothing of their answers, and the same over `CommentDialog`'s edit path —
where the one number allowed is the referee's own −50.

**And it says what it cannot prove.** Both halves are on one screen; a referee may read the model's
number and then place the passage, and nothing records which came first. So *"independent"* currently
means *"made in a control that does not itself show the model's number"*. The file's last test pins
that gap where it runs, with a note that when it goes red the fix is to delete it and write the test
for whatever replaced it. **Sol's one change — a sealed-envelope state for the first placement, or
dropping the word "independent" — is a product decision and is Greg's**, and is not built.

### Stage 5 — findings 2 and 3, and the five-position test that moved with the code

**Finding 3, the fabricated judgement.** Changing the criterion of a placed comment carried the old
number across, so *"leans underpowered"* on *Is the study adequately powered?* silently became
*"leans the statistics are wrong"* on the next criterion — a judgement the referee never made, about
poles they never saw, printed by `RefereeGap` beside the model's as the independent human half. It
now clears: a criterion that is not the one already chosen arrives with `valence: null`, which is
the state the route has always called legal, and the five positions come back up blank in the new
criterion's own words. The `id === value.criterionId` arm is unreachable with a mouse — a browser
fires `change` only when the value moves — and is kept because *"the criterion changed"* is a fact
about two values rather than about how the event arrived. Red first:
`expected { criterionId: 'spya-crt2dd', valence: null } … + "valence": -50`.

**Finding 2, the races.** Both PATCHes now go through one **per-comment chain** in `useComments` —
the ref `useCriteria.recolour` and `useSearch` already keep, deliberately not a third invention of
it — so there is never more than one write out for a comment. That one change answers both halves,
which is why the merge-only-the-fields-you-own alternative was not built: with the writes ordered,
every answer is a snapshot taken after every write this client has made, so replacing the whole row
is correct again, and a merge would have to be maintained field by field beside a store allowlist
that already exists. `send` is deliberately **not** on the chain — it streams for 15-25 seconds and
putting an edit behind it would freeze the reader's own note for the length of a model call — and
nor is the DELETE, which the tombstone already makes win.

The buttons stay enabled through the wait. With the queue there is no order left to get wrong, and
disabling them needs local state in an instrument whose whole design is that it has none.

Four cases in `tests/referee-placement.test.tsx`, each watched red with the chain bypassed by hand.
The fake server grew two moments where it had one — `process`, which changes the row and composes
the answer out of what it holds *then*, and `deliver`, which hands that answer over — because the
two reorderings are different and only one of them is visible with a single moment:

- two placements whose requests reach the server backwards — `expected -100 to be 100`, the *first*
  click stored and shown;
- a note and a placement whose **answers** cross on the way back, each carrying the whole comment as
  it stood when its own write ran — `expected -50 to be 100` one way round (the late note answer put
  the old placement back) and `expected 'the arms are too small for this' to be 'a much better note'`
  the other (the late placement answer put the old note back). Nothing is lost on disk here: the
  columns are disjoint, and it is the browser that ends up disagreeing with Postgres;
- and the invariant itself, that only one write is ever in flight — `expected [ …, … ] to have a
  length of 1 but got 2`.

**Server-side last-arrival-wins is left alone**, as Greg asked. It is defensible: the client can no
longer produce the race on its own, and what is left is two tabs, where compare-and-set would have
to answer *"somebody else changed this"* to a referee who cannot see the other tab and has no way to
merge two five-position labels. A `valence_first` write-once column — already named in this plan —
is the cheaper thing to reach for if that ever matters.

**The five-position test.** It took its clicks *and* its expected numbers from the exported
`PLACEMENT_STEPS`, so changing the production −50 to −40 left all five green. (Not the whole file:
two neighbouring tests with literal −50 fixtures did redden, which is luck rather than design.)
There is now a literal `EXPECTED_POSITIONS` table in the test — the numbers asserted against
something the production code cannot move — plus one case checking that the labels
`PLACEMENT_STEPS` actually draws are exactly those five, in that order, so a sixth position reddens
rather than being skipped by a table that has never heard of it. Both properties, and they were
never in conflict. With the mutation back in, the parameterised case now fails: `× sends -50 for
"leans underpowered"`.

## The survey behind Stage 4

A read-only sweep of the Referee area on 2026-09-01, looking for one shape: **a check that reports
success while sharing an assumption with the code it checks**
([silent-success.md](../reusable/silent-success.md)). It found two real bugs and a set of tests
that cannot fail.

### The two bugs

**1. `PATCH /api/comments/:slug/:id` deletes the reader's prose when the request carries no `body`
key.** `tidyBody(undefined)` returns `null`, and both stores' `patchBody` then set `body` to it
unconditionally. So `PATCH {}` answers **200** and wipes the comment. Latent only because
`useComments.ts` is the sole caller and always sends `{ body }` — and it stops being latent the
moment a second field is added to that route, **which is what a less careful version of this plan
would have done.** Independent evidence for putting the placement on a path of its own. Folded into
Stage 1.

**2. `if ("sourceHash" in body)` can never be true for the state it was written for**, in
[`src/web/useCriteria.ts`](../../src/web/useCriteria.ts) and
[`src/web/useClaims.ts`](../../src/web/useClaims.ts), with the same comment above both:

> `in`, not truthiness: the server sends `sourceHash: undefined` — which JSON drops — for a paper
> whose blocks it could not read, and that is a real answer meaning "we checked and cannot tell".

The comment states the problem correctly and then reaches for the operator that cannot see it: a
key JSON dropped is a key that is **absent**, so `in` is false, `fingerprint` stays `null`, and
every row is reported `stale: false`. [`src/search-stale.ts`](../../src/search-stale.ts) is explicit
that this is the wrong way round to be wrong — *"being wrong the other way is the bug this exists
to fix, and it is silent"* — so a referee whose paper cannot be fingerprinted is quietly told
nothing has moved. `tests/referee-criteria-routes.test.ts` asserts the wire shape and then
*reasons*, in a comment, about what the client concludes from it — the shared assumption, written
down.

### The tests that cannot fail

- **No parity test for the comment store at all**, so the *filesystem* half of a placement is
  uncovered: dropping the `criterionId`/`valence` spreads from `createComment` or from
  `beginAnswer`, or making `sameMark` return `true`, all leave the suite green.
- **`CriteriaPanel` is never rendered by any test and `useCriteria` has no test file**, so swapping
  the two poles in `CriterionResult` compiles clean, stays green, and labels a passage *"counts
  against — the controls are adequate"*. `tests/valence.test.ts` calls itself *"the condition under
  which `rg` is allowed at all"* and only ever tests the formatter.
- **Nothing joins `valenceToken`'s emitted custom property to the stylesheet that must define it.**
  An undefined property is an element with no background and no error anywhere.
- **Mirror's placement pipeline is never driven end to end** — `tests/referee-mirror-route.test.ts`
  contains the word `valence` zero times — so the branch where a referee's comments are *all* bare
  placements is unreachable from any test.
- `expect(DEFAULT_DIVERGING_SCALE).toBe("rg")` restates a constant and names a rule it does not
  check. `expect(placementNote(v)).toContain(signedValence(v))` is vacuous at `v = 0`.
- `REFEREE_SURFACES` is a hand-maintained list beside the data, in the one test whose job is to
  catch copy drift across referee panels — and a sixth panel is landing this week.

The through-line, and the reason this belongs in *this* plan: **every one of these is a green check
standing between two things that were never connected.** A validator no client calls. A count no
store persists. A rule and the configuration nobody deploys. A formatter and the screen that has to
print its words. The placement feature was itself the largest instance — storage, route, validator,
export and eleven tests, with nothing on screen ever able to make one.
