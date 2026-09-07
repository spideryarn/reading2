# Ship Socratic V4, repair the eval gate, and answer Q7

The follow-on to
[260905f](260905f-socratic-summaries-eval-admin-page-gating-short-selections.md), which built the
eval, spent $2.59, and — by design — reported **no ranking**. Greg answered on 2026-09-06 what to do
about that, and this is the work.

**Status:** planning, then building. Written before the work, per
[engineering-manager.md](../reusable/engineering-manager.md).

## What Greg said, verbatim

> Ship v4, then fix the eval, and consider tweaks if you learn something useful from it
>
> — Greg, 2026-09-06, answering report
> [24](../user-feedback/260905_1803-only-the-socratic-question.md)

The order is load-bearing and is the reason this is one session rather than two: **the wording ships
on the evidence already gathered**, and the eval's inability to rank is treated as a separate defect
that is not allowed to hold the wording hostage.

## Why V4 ships without waiting for a ranking

Three facts, all from 260905f, none of which needed the judge:

- **V4 reproduced Greg's own example almost verbatim.** He wrote *"Computational functionalism — why
  isn't computation sufficient for consciousness? (4 arguments)"*. V4 produced, unprompted, for that
  exact node: *"Computational functionalism — why might computation not be sufficient for
  consciousness? (four arguments)"* (260905f § *What the run does say, without the judge*).
- **V3 is out on its own evidence** — 39% of its questions are yes/no against 13–20% elsewhere — so
  the plan's central bet was not falsified.
- **The incumbent questions are the diagnosed failure in production right now.** `antikythera`
  carries ten in the wild and they are lookups, yes/no questions and the gist re-asked.

V1 and V4 differ in reading order alone. Greg drew the order himself, in the brief, and V4 is it.

### The known cost, named here rather than discovered later

**V4's questions are nearly twice the length of the incumbent's.** Median 18 words against 10; V1 is
16. Greg's same brief also asked for *simpler language* and a *briefer top-level line*, and the
variants that hit his shape are the longest lines on the page. That tension is **real and
unresolved**, and it is not resolved by this stage.

The temptation is to hand-edit V4's wording down while shipping it. That is refused: **a hand-tuned
V4 is neither V4 nor measured**, and the whole point of shipping V4 is that it is the thing the
comparison was actually run on. Stage 4 is where a tuned variant may be proposed, and only on
evidence.

The row that shows the gain and the row that shows the cost, both from the noema run:

| | incumbent | V4 |
|---|---|---|
| **n0048 — the gain** | Why might computation alone never be enough to produce consciousness? | Computational functionalism — why might computation not be sufficient for consciousness? (four arguments) |
| **n0155 — the cost** | What should we learn about ourselves from the myth of conscious AI? | Conscious AI's implications — what does the pursuit of machine consciousness reveal about what we value in being human? (a closing reflection) |

Greg's own instruction stands over this: *"Don't push tooooo hard towards this Socratic-question
approach if it's going to make things less valuable for the user."* n0155 is what that sentence was
about. It ships anyway, because the brief says so and because the gain at n0048 is the shape he
asked for.

---

## Stages

Five, in order, each ending green and committed with a GPT Sol review. **The order matters**: stage 2
changes what stage 3's gap looks like, and stage 1 changes what the eval's control *is*.

| | what | ends when |
|---|---|---|
| 1 | V4 ships: the QUESTIONS block, the `questionFor` patch, `toc/7` | production writes V4's shape; the eval keeps a pre-V4 control |
| 2 | `EXPAND_SYSTEM` gains a question for top-level parts | a cascade-built depth-1 node has a question, or a logged omission |
| 3 | the calibration gate is repaired and the eval can rank again | a run reports a ranking, or says why it still cannot |
| 4 | tweaks, **only** if stage 3 taught something solid | a change with evidence, or a written "nothing solid" |
| 5 | Q7 — the cost of a tree, from one real local ingest | the table is in `open-questions.md` § Q7 |

---

## Stage 1 — ship V4

### What changes in `src/`

1. **`src/hierarchy.ts` § `SYSTEM`, the QUESTIONS block** ← V4's block from
   [`evals/summaries/variants.md`](../../evals/summaries/variants.md) § *V4*, **verbatim**. Not
   re-typed, not adjusted: the eval's `v4` arm reads that same section out of the same file, so any
   drift makes the shipped prompt something nobody measured.
2. **`src/hierarchy.ts` § `questionFor`** — the two-line patch `variants.md` § *The code change V4
   needs* specifies. `if (q.endsWith("?")) return q;` becomes a regex that also accepts a `?`
   followed by one short bracketed hint, so V4's `…consciousness? (4 arguments)` is a finished line
   rather than one wanting a second `?`.
3. **`src/hierarchy.ts` § `bareWords`** — strip a trailing bracket **before** the terminal
   punctuation, so the gist-echo check still catches `<gist>? (4 arguments)`. Without this hunk,
   anchor 5 in V4's shape sails through the one check in that function that means what it says.
4. **`src/hierarchy-prompt.ts` § `PROMPT_VERSION`** — `toc/6` → `toc/7`, with the paragraph the
   other bumps in that file all carry.

### The test to make green, rather than a new one

`tests/summaries-eval.test.ts` § *V4 is the only arm that needs a change to production code* holds
GPT Sol's P1-4 **as an executable assertion that production mangles V4's shape**:

```ts
expect(questionFor({ …, question: V4_LINE }, 1)).toBe(`${V4_LINE}?`);
```

That test is the defect written down. Shipping the patch makes it false, and the right move is to
**invert it** — production must now *keep* V4's line — exactly the way `summary-expand.test.tsx` was
inverted rather than relaxed when the question replaced the gist
([260905_1803](../user-feedback/260905_1803-only-the-socratic-question.md) § *The test that caught
it*). "Either would do" is how a rule stops holding anything.

### The consequence nobody had written down: the eval loses its control

This is the one design call in stage 1 that is mine rather than Greg's, and it is the same problem
`toc/6` already solved once for gists. **It was got wrong in the first draft of this plan and GPT Sol
found it (F1) — the corrected version is what follows.**

`evals/summaries/arms.ts` § `incumbent` **slices the live `SYSTEM`**. From the moment V4 lands,
`incumbent` carries V4's questions — so the eval has no pre-V4 control and cannot return the answer
*"the control was better all along"*, which stage 4 is explicitly allowed to reach.

`arms.ts` already says this in so many words about the gists:

> `incumbent` **is deliberately not the comparison.** It slices the *live* SYSTEM, so from the moment
> a bump lands it **is** the new prompt: byte for byte `gists-toc6`.

and solves it with `shippedGists` — a **pinned** copy of the old block, living in `variants.md` under
its version name. The questions get the same treatment:

- `variants.md` gains **§ *The shipped QUESTIONS block, toc/6*** — the pre-V4 block, copied out of
  `src/hierarchy.ts` before the edit, verbatim.
- `ArmSpec` gains `shippedQuestions?: string`, mirroring `shippedGists`, and an arm naming both a
  `variant` and a `shippedQuestions` throws rather than quietly preferring one.
- A new arm **`questions-toc6`** carries **both** pinned blocks: `shippedGists: "toc/6"` +
  `shippedQuestions: "toc/6"` — immediate pre-V4 production.

**Its partner is `gists-toc6`, not `incumbent`, and that is the whole design.** `gists-toc6` is
pinned toc/6 gists with production's live (now V4's) questions. So the pair differs in **exactly one
block**, both halves stay put when `src/hierarchy.ts` moves again, and the comparison is *V4's
wording against the wording it replaced* rather than a bakeoff of two recipes. `incumbent` cannot
play that part: its gists follow the live SYSTEM, so the day the GISTS block moves the pair is two
variables and nothing says so.

#### What the first draft got wrong, since the error is instructive

It said `incumbent` becomes another name for `v4`. **It does not**: `v4` sets `newGists: true` and so
carries `variants.md`'s replacement GISTS block, while `incumbent` slices production's. Those blocks
are 1,034 and 1,947 characters. What actually collided was different and worse — `v4` became
byte-identical to **`gists-only`** (replacement gists + production's questions), because
`productionQuestions()` now returns V4's block. Two arms with one recipe and no `noise-floor` label
report the model's own wobble as an effect.

**So `v4` is removed from `ARMS`**, and the reading-order comparison that was `v1` against `v4` is now
`v1` against `gists-only` — the same bytes under the arm that already carried production's questions.
`tests/summaries-eval.test.ts` gained a test that enumerates every set of arms sharing a recipe and
pins that list exactly, so the next such collision is a red test rather than a null result.

That test immediately found a **third** member of the existing group: `gists-toc6` pins the toc/6
GISTS block, `incumbent` slices the live one, they are the same block, and so `gists-toc6` has been
buying a third sample of the incumbent recipe all along. That predates this work, `arms.ts` states
the identity outright, and it stays — it is the named *after* half of two pinned pairs.

#### The normaliser is production's, and the difference is measured at zero

Sol's F1 also asked for a *fully* pinned pre-V4 snapshot, including the pre-V4 `questionFor`, on the
contract that an arm is GISTS + QUESTIONS + the rule the line survives. **Overruled, with the
number.** The two rules differ on exactly one input: a line ending in `?` followed by a short
bracket. The toc/6 block never asks for one, and the 2026-09-05 run measured **0% bracketed hints
across 183 questions** from the three arms carrying that block (`incumbent`, `incumbent-repeat`,
`gists-only` — the shape-facts table in
[the promoted results](../../evals/results/summaries/2026-09-05T18-04-46-socratic-questions.md)).
Pinning a second normaliser adds a branch that cannot fire.

`questionForTrailingHint` — the reimplementation that let V4's cost stay visible — is deleted for the
same reason: production has the rule now, and a copy is worth keeping only while there is something
for it to differ from. `armsNeedingCodeChange()` returns nothing, and the test that named `v4` as
needing a code change becomes the test that says **nothing does, because V4 shipped**.

**The simpler option passed over:** leave `arms.ts` alone and accept that `incumbent` follows
production. Rejected because it silently deletes the before half of the only comparison stage 4 has,
and the failure would show up as a null result rather than an error — the class
[silent-success.md](../reusable/silent-success.md) exists for.

### What the bump does and does not do — and the brief's premise here was wrong

Existing articles keep their trees and their `toc/6` questions until somebody re-runs the stage.
That is the accepted behaviour, decided on 2026-09-06 for `toc/6` itself and recorded in
[hierarchy.md § A new prompt reaches new articles only](../project/hierarchy.md#prompt-versions).
Nothing backfills, and no backfill is proposed here.

**The brief for this work said to bump `PROMPT_VERSION` "so existing articles show the quiet *chosen
by an earlier version of the prompt* banner rather than the alarming `stale` one". There is no such
banner for the tree.** Checked: `outdated` exists in `DebatePanel`, `QuizPanel`, `QuotesPanel`,
`TimelinePanel`, `IdeasPanel` and `GlossaryPanel`, and in **neither** `SummaryPanel` nor
`OutlinePanel` — the two that draw the tree. `hierarchy.md` says so outright (*"the tree has no
`outdated` mechanism of the kind glossary, quotes and ideas each have; and the tree-version chip came
off the reading view on 2026-09-05"*), and `SummaryPanel.tsx` says it about itself.

So a reader whose article was built under `toc/6` sees **nothing**: the old-shaped questions render
exactly as stored. The bump is still right and still necessary — it keys the structure checkpoint, so
an article part-way through the stage cannot resume onto a prompt asking for a differently shaped
line — but it buys no reader-facing signal, and this plan does not claim one. The per-article re-run
control that would give a reader the escape is **listed but not built**: `src/web/Metadata.tsx` has
it as a dimmed "Not built yet" row.

### Done looks like

- `npm test`, `npm run typecheck`, `npm run check` green.
- The inverted P1-4 test **seen red first** against the unpatched `questionFor`.
- **The byte-identity gate** (Sol F2), seen red under a one-word mutation of either side:
  `expect(productionQuestions()).toBe(readVariants().questions.get("V4"))`. Every other gate in this
  stage passes just as happily if a word drifted while the shape held; this one does not.
- A real `npm run hierarchy -- <slug> --force` on one local article showing V4 shapes in the stored
  tree.

### Done, and the evidence

All four, on 2026-09-07:

- **Red first, twice.** The inverted P1-4 assertion and the gist-echo-with-a-hint assertion both went
  red against the pre-patch `questionFor`/`bareWords` (*"expected 'Computational functionalism — why
  isn…' to be 'Computational functionalism — why isn…'"* and *"expected 'Four independent arguments
  undermine …' to be undefined"*), and green after. The byte-identity gate went red when *"four
  arguments"* in `variants.md` § V4 was changed to *"4 arguments"* and nowhere else.
- **The real run**, `what-if-we-had-bigger-brains-imagining-minds-beyond-ours`, 172 blocks, against
  the local database (`127.0.0.1:54362`), stored `version: toc/7`. The structure checkpoint reported
  `found: 0, usable: false` — the key moved, as designed. Nine of nine questions are V4-shaped and
  none has a doubled `?`:

  > bigger brains — what would minds far larger than ours actually be able to do? (a framework, not a
  > forecast)
  >
  > abstraction — how far could bigger brains climb the tower of abstraction, and what limits remain?
  > (a historical argument)

  **A non-corpus article on purpose.** `evals/summaries/corpus.ts` pins ten slugs by sha256 on
  *both* `blocks.json` and `tree.json`, because the tree is an input to the eval; re-running the
  hierarchy on any of them would silently re-carve a measurement everybody else is standing on.

**Two observations from that run, banked for stage 4 rather than acted on here.** Neither is a
defect, and both are about the shipped wording rather than the patch:

- **The topic prefix mostly repeats the title.** *"abstraction — …"* sits under a row titled
  *"Abstraction"*, and the root's topic and its first child's topic were both *"bigger brains"*. The
  panel already shows the title, so on this article the prefix bought little and cost words.
- **The hint is rarely a count.** Eight of nine are kinds — *"(a synthesis)"*, *"(a speculative
  extension)"*, *"(a reasoned exploration)"* — because the article does not count anything. That is
  the rule working (a count *only* when the section itself counts), but it means the hint on a
  non-enumerating article carries less than Greg's worked example suggested it would.

---

## Stage 2 — the depth-1 node with no question

GPT Sol found this as **P1-5** during the review of report 24. It was **recorded, not fixed**:

> A depth-1 node built by the deepening cascade has no question at all, because `EXPAND_SYSTEM` has
> no such field, so the panel can draw a question on one part and a gist on its neighbour. That was
> invisible while the question was a faint second line and is not now.
>
> — [260905_1803](../user-feedback/260905_1803-only-the-socratic-question.md) § *Two things this does
> not fix*

Since report 24 shipped `question ?? gist`, the panel shows **one** line per row. So a reader looking
at a cascade-built article sees a question on one part and a bare claim on the next, with nothing to
explain the difference.

### Fixed at generation, not in the UI

`EXPAND_SYSTEM` divides one section into its immediate children. The children of the **root** are the
depth-1 parts — the only ones `MAX_QUESTION_DEPTH` allows a question on. So:

- `EXPAND_SYSTEM` gains a **QUESTIONS** block asking for exactly one question **on the children of
  the whole work itself, and on nothing else**, carrying V4's content rules so the two paths write
  the same kind of line.
- **The request marks each target independently** — `ASK QUESTION ON CHILDREN` or `OMIT QUESTION`,
  derived from that target's own ancestor chain — rather than the model inferring depth. One call
  batches several sections and they need not be at the same depth, so a single global instruction
  would be wrong for some of them. Sol's F4: without stating this seam, a convenient inferred depth
  disagrees with the real one in a mixed-depth batch.
- The parser keeps an optional returned `question`; attachment puts it through the same `questionFor`
  production uses, at **`candidate.depth + 1`** — the child's real depth, which is where the cascade
  already recovers it (`hierarchy-deepen.ts` § `Candidate.depth`). `ExpansionTarget` itself carries
  no depth, so this is the seam, not `readExpansion`.
- **The validator names the parts that came back without one.** A gap becomes a logged omission
  instead of a silent hole, which is the whole difference between this and doing nothing.

### Three constraints, each of which an agent gets wrong by default

1. **A missing question stays non-fatal.** The validator logs it and the panel still renders. It does
   not throw and it does not retry. Absence has always been ordinary here — every tree built before
   the field existed has none, and `SummaryPanel` draws the row exactly as it did
   (`src/hierarchy.ts` § `MAX_QUESTION_DEPTH`).
2. **No second model call** to fill gaps left by a first one.
3. **No library-wide backfill.** Existing articles pick it up when a stage is re-run — the same
   answer Greg gave for the `toc/6` question.

And explicitly **not** the fix: hiding the sibling's gist in the client so the inconsistency stops
showing. That trades a visible inconsistency for an invisible one.

### The stamp — and stage 1 already moved it, which is not enough

`EXPANSION_PROMPT_STAMP` is **derived from both prompt versions**, so stage 1's `toc/7` already moved
it to `toc/7+expand/3` before stage 2 begins. Saying merely "the stamp moves" is therefore satisfied
by doing nothing — Sol's F5.

So stage 2 **explicitly bumps `EXPAND_PROMPT_VERSION` from `expand/3` to `expand/4`**, and asserts
the stamp is `toc/7+expand/3` before and `toc/7+expand/4` after. Note the correction to the reason
as well: a stale replay was never the risk, because the expansion checkpoint key includes the exact
wire request, `EXPAND_SYSTEM` and the target briefing included, so a changed prompt already misses.
What the explicit bump buys is **honest provenance** — a record that says which semantic protocol
wrote it.

### Done looks like

Tests, each seen red first:

- a **mixed-depth batch** carries the correct per-target policy — the root's target marked to ask, a
  depth-1 target in the same call marked to omit;
- a returned root-child question **survives into the final tree**;
- a question returned for a deeper child is **dropped**, by `questionFor` at `candidate.depth + 1`
  rather than by a second rule;
- an omitted root-child question is **recorded without throwing or retrying**;
- the stamp assertions above.

Plus one real cascade run on a local article — and, per Sol's F4, **a live run in which every question
came back omitted is a successful ingest and not a completed stage.** The acceptance condition is not
"a question or a logged omission": that is satisfiable by a perfect logger over a prompt nobody
obeys, leaving the reader-visible inconsistency exactly as it was. If the run comes back empty, the
stage stays open and the prompt gets revised. What it does **not** get is a second model call.

---

## Stage 3 — the calibration gate

### What actually happened, before any repair is proposed

The gate is `MAX_ANCHOR_INVERSIONS = 0`, declared before the run. The run produced **fifteen
inversions across three repeats, and fourteen of the fifteen are one anchor**:

| anchor | its designed defect | where the judge put it (r1 / r2 / r3 of 12) |
|---|---|---|
| 1 | fabricated count | 12th / 12th / 12th |
| 3 | answer-leaking | 10th / 10th / 10th |
| 5 | the gist with a `?` on it | 11th / 11th / 11th |
| 4 | title-only | 8th / 9th / 9th |
| **2** | *"neutral lookup question"* | **4th / 2nd / 4th** |

**What that establishes, stated no more strongly than it can be.** Anchors 1, 3 and 5 landed on the
identical rank in all three repeats, so the judge consistently rejects a fabricated count, an
answer-leaking line, and the gist with a `?` on it — the two the eval cares most about being 3 and 5,
the most *informative* lines, which a judge measuring information rather than triage value would rate
highly.

**It does not establish that the judge is stable over the real arms**, and the first draft of this
plan said it did. Fixed anchors holding still in one lineup is not the same measurement as the arms'
rank table holding still, which is what `judgeInstability` (`score.ts` § `meanRankSpread`) computes
and what `separabilityThreshold` *is*. That number was never reported, because the gate suppressed
the whole ranking section. **The next run reports it separately, whatever the gate says.** ⟨Sol F3.⟩

What failed is **one anchor's premise**:

> `Computational functionalism: what four arguments does the section cover?`

The count is right, the topic is named, nothing leaks, and a reader can decide from it whether to
descend. It was labelled a wall at design time on a theory about lookup questions; the judge scores
it as a door, and **the judge is closer to right**.

### The repair, and why it is not loosening the gate

**The gate is not touched.** `MAX_ANCHOR_INVERSIONS` stays `0`, and the discarded run is not
re-scored. `anchors.ts` says the tolerance is *"declared before any run rather than argued after
one"*, and reclassifying an anchor after seeing where it landed is exactly the argument that rule
forbids.

The legitimate repair, named by 260905f before this session existed, is to **fix the anchor before
the next run**: a genuine lookup question is one with no content in it at all. Anchor 2 has a named
theory and a correct count in it, so it was never the thing its label claimed.

This is the opposite of relaxing the gate. A gate that passes because it was relaxed is the same bug
as one that fails forever — 260905f calls the latter *"a wrong answer wearing the clothes of
caution"*, and the six P0s already fixed on this harness include *"the calibration gate passed over a
ranking with nothing real in it"*, so this gate has a history in **both** directions.

#### Three things the first draft of this stage missed

1. **Fixing anchor 2 is not sufficient.** The fifteenth inversion is not anchor 2 — it is
   `anchor-4 ranked above v1` in repeat 1. Anchor 4 is the title-only line, and it landed 8th / 9th /
   9th of 12. So a gate at `MAX_ANCHOR_INVERSIONS = 0` would still have failed with anchor 2 perfect.
   Read from the promoted results file rather than from the summary in 260905f, which says *"fourteen
   of the fifteen are one anchor"* and is right, but which leaves the fifteenth doing nothing.

2. **The rubric has no criterion for the failure anchor 2 is supposed to test.** ⟨Sol F3, the
   strongest finding of the review.⟩ `judge.ts`'s axes are fidelity, distinctiveness, triage,
   orientation, simplicity, leakage and shape-hint. There is **no "needs the argument rather than a
   fact to look up"** axis — which is why anchor 2 scored `5,5,5,5,5` with leakage 1. Replacing it
   with *"what does this section discuss?"* tests genericity, not lookup behaviour, and the gate
   could then pass while the judge went on preferring polished lookup questions — the exact failure
   the shipped prompt still forbids. So the rubric gains an **argument-demand criterion**, and anchor
   2 becomes a line that is faithful, distinctive, simple and low-leakage but answerable by
   retrieving one fact:

   > `Computational functionalism — how many arguments does the section give? (4 arguments)`

   Pre-registered here, before the run: **it must rank below every real line.** Adding the criterion
   is not rigging — it applies to every arm equally, and every variant's own prompt already forbids a
   lookup. If the judge still ranks it highly, then *"not a fact to look up"* is a rule we are asking
   for and cannot measure, which is a product question for Greg, not a licence to edit the anchor
   again.

3. **A failed gate sets no exit code.** `commandJudge` never touches `process.exitCode`, and
   `commandReport`'s comes from `exitCodeFor(coverage)` alone. So today a failed calibration is a
   printed sentence that a script or a wrapper reads as success — the repo's own recurring class.
   Stage 3 makes it non-zero. (Also found: `score.ts`'s header says the separability threshold is
   *"the larger of the two"*; the code uses `instability.ranks` alone, deliberately, and the header
   is stale. Fixed while I am in there.)

**What is written down before the run, not after:** the repaired anchor 2, the new rubric criterion,
and the prediction that anchors 2 and 4 both rank below every real line. If they do not, the gate
fails again and that is a result about the judge, not a reason to edit an anchor a second time.

### Then the run, and it can be much cheaper than the last one

Stage 1 changed the lineup — `questions-toc6` is the question-axis control, `v4` is gone — so this is
a new measurement, not a re-score.

**The `$2.5853 for 854 calls` figure in 260905f conflates two things**, and the correction matters
for budgeting: 854 is `coverageOf`'s count of requested gist+question *lines*. The API round-trips
were 7 arms × 7 documents generation plus 7 documents × 3 repeats judging = **70 calls**, and the
judging calls (GPT-5.6-sol at high effort) are the expensive half.

The gate lives entirely at one node of one document — `noema-mythology-of-conscious-ai` / `n0048` —
so a run narrowed to `--doc noema-mythology-of-conscious-ai` with four arms
(`incumbent`, `incumbent-repeat`, `questions-toc6`, `v1`) and `--repeats 3` is four generation calls
and three judging calls: roughly a tenth of the lineup. `--stub` and `--stub-judge` exercise the whole
pipeline, gate included, for nothing, and `plan` prints the token estimate before a penny is spent.
**Run the stub first, then the narrow real run.** The dollar figure comes from the ledger at the end,
and goes in this doc.

### Done looks like

Either a run whose gate passes and whose ranking is reported — with `judgeInstability` printed
separately — or a second gate failure with a written account of what it means. **Both are acceptable
endings.** What is not acceptable is a passing gate bought by moving the tolerance.

## Stage 3, as built

Four changes, none of them to `MAX_ANCHOR_INVERSIONS`, which is still `0`.

1. **Anchor 2 rewritten** (`variants.md`) to a line that is faithful, distinctive, simple and
   low-leakage and settled by retrieving one number:
   `Computational functionalism — how many arguments does the section give against it?`
   Sol's own draft ended `(4 arguments)`; the hint was dropped because a hint that answers the
   question makes the line *answer-leaking* as well, and an anchor carrying two defects measures
   neither.
2. **The rubric gains a `demand` axis** (`judge.ts`) — *does answering it require following the
   argument, or would one lookup settle it?* This is the substantive half. Without it the eval was
   asking the judge to reject a failure it had never been told to look for, and any replacement
   anchor could have passed the gate over a judge still preferring polished lookups. It is written so
   as not to penalise a straight question, which would undo the guarantee V3 depends on.
3. **A failed gate now sets an exit code**, in both `judge` and `report`. It was a printed sentence
   that a wrapper, a cron or a `&&` read as success. Verified for free with `--stub-judge bad`
   (`REAL_EXIT=1`, no ranking) and `--stub-judge good` (`REAL_EXIT=0`, ranking with a threshold and
   per-repeat leaders) — and the exit code was read **without a pipe**, because a pipe reports
   `tail`'s status and reported `EXIT=0` on the failing run the first time it was asked.
4. **`judgeInstability` is printed whatever the gate says.** It measures the *instrument*, not the
   arms, so a gate failure is exactly when it is worth having — and it used to go down with the whole
   ranking section, which is why the 2026-09-05 run could say "the judge is measuring something else"
   while saying nothing about whether the judge was even repeatable.

### And one thing nobody was looking for: the corpus pin was measuring the wrong bytes

**Every one of the seven default documents reported drift at once**, on `blocks.json` only, with no
tree moved and every block count unchanged. That is not seven re-ingestions; it is one envelope
changing.

`blocks.json` is `{sanitizer, blocks}`, and `sanitizer` is a number about the **sanitiser**. Hashing
the whole file meant a `SANITIZER_VERSION` bump — one landed between 2026-09-05 and 2026-09-07 —
invalidated the entire pinned corpus for a reason that has nothing to do with any article.

**Established before anything was re-pinned**, because re-pinning to silence a warning is the same
move as relaxing a gate: the exported blocks for `noema-mythology-of-conscious-ai` were compared
field by field against the committed fixture cut, and **id, tag, kind, text, words, gistable and
`html` were identical on all 141**. Nothing about the article had changed.

So `loadDocument` hashes the **blocks array**, canonically re-serialised, and the ten manifest
entries are re-pinned to those hashes. `tree.json` is still hashed whole and deliberately —
everything in it, `version` included, is about the article. A test holds both halves: a sanitiser
bump must not move the hash, one changed word must. Seen red against the old hashing.

This matters more than its size. A drift signal that fires for a reason unrelated to the articles is
one somebody explains away every time — until the day it means something.

### The result: the gate passed, and the arms are measurably not separable

Run `output/summaries-runs/2026-09-07T16-05-49`, promoted to
[`evals/results/summaries/2026-09-07T16-05-49-socratic-questions-after-the-gate-repair.md`](../../evals/results/summaries/2026-09-07T16-05-49-socratic-questions-after-the-gate-repair.md).
Five arms, one document, three judging repeats of which **two returned** — the third was cut off
part-way through at 9,225 characters, which the harness recorded as a failure rather than reading a
truncated answer.

**Calibration — PASSED**, over 2 lineups. The repair worked and the new axis is why. The anchors'
own scores say so directly:

| anchor | its defect | `demand` | `leakage` | `fidelity` |
|---|---|---|---|---|
| 1 | fabricated count | 4.00 | 3.00 | **1.00** |
| **2** | **the lookup** | **1.00** | 1.00 | 5.00 |
| 3 | answer-leaking | 4.00 | **4.50** | 3.50 |
| 4 | title-only | **1.50** | 1.00 | 5.00 |
| 5 | the gist re-asked | 3.50 | **5.00** | 5.00 |

Anchor 2 scored `5,5,5,5,5` on 2026-09-05 and inverted fourteen times. It now scores **1.00 on
`demand`** and sits below every real line. Anchor 4 — the fifteenth inversion, the one the earlier
summary left doing nothing — scores 1.50 and is also below. Every real arm scores 4.25–4.42 on
`demand`. **The axis separates exactly what it was added to separate**, and each of the other four
anchors is still caught by the axis it was designed for.

**No leader is named** — and the reason is simple and sufficient: on the questions lineup the two
completed repeats have **different leaders** (repeat 1 `incumbent`, repeat 3 `questions-toc6`), so
this run can never satisfy `separate`'s requirement that one arm lead every repeat.

*(Said precisely, because the same sentence was **not** true of the gists table and I nearly wrote it
of both. There, repeat 3 is an exact tie between `questions-toc6` and `incumbent` at 1.6667, which
the old `perRepeatLeaders` silently resolved by insertion order and printed as a flip. GPT Sol's F25;
the report now prints `questions-toc6 = incumbent tied` and the leader must be the **sole** leader of
every repeat. The promoted results file is the regenerated one.)*

| arm | recipe | mean rank (questions) |
|---|---|---|
| `questions-toc6` — the pre-V4 control | the toc/6 QUESTIONS block | **0.83** |
| `incumbent` | **V4** | 1.42 |
| `incumbent-repeat` | **V4** (identical to `incumbent`) | 2.08 |
| `v1` | V1 | 2.58 |
| `gists-toc6` | **V4** (identical to `incumbent`) | 3.08 |

**The control is ahead of all three V4 samples, and that is directional evidence rather than noise.**
Three of the five arms are byte-identical recipes — the duplicate-recipe test in
`tests/summaries-eval.test.ts` says so — so this run carries **one control generation against three
V4 generations**, and the control ranks above every one of them. Head-to-head it beats them in 9/12,
8/12 and 11/12 lineups, and its 2.25 mean-rank gap over `gists-toc6` is against the comparator
`arms.ts` actually registers for it.

**This paragraph replaces one that explained that away**, and the correction is GPT Sol's ⟨F21, F22⟩:

- I wrote that the gap was *"about a third of the model's own wobble"*, comparing 0.59 (a difference
  of **aggregate mean ranks**) against 1.83 (a **mean absolute paired distance within lineups**).
  `score.ts` says outright that those are on different sampling scales and that 1.83 is not a
  separability threshold. The comparison was wrong, and so was every sentence resting on it —
  including *"a third repeat could not move a factor-of-three margin"*. Gone.
- I wrote that the nominal lead *"means nothing"*. That explains away more than the run supports.

**So the honest reading, which is the one to act on:** *the run did not license a winner, but all
three V4 generations trailed the control. Confirm or refute that with balanced generation replicates
over more documents before changing anything.* One control generation on one document is not enough
to act on, and it is too much to dismiss.

What the axes add, and this survives whatever the ranking does because it does not come from an
ordering: `questions-toc6` scores `leakage 1.00` and `shapeHint: none` on all twelve judgements; V4
scores `leakage 2.42` and claims a shape on eight of twelve. V4 tells the reader more about what is
coming and gives away a little more in doing it. **That is the trade Greg drew, behaving as drawn** —
and if the control really is preferred, that trade is the first place to look for why.

### What it cost

| | |
|---|---|
| generation, 5 arms × 1 document, 60/60 lines | **$0.2471** over 5 model calls, from the ledger |
| judging, 3 repeats at GPT-5.6-sol high effort | **no metered cost** — `codex exec` runs on the ChatGPT subscription, so the ledger has nothing to report |

**And that corrects the 2026-09-05 headline twice over.** *"$2.5853 all in"* over *"854 calls"* is
two conflations: 854 is `coverageOf`'s count of requested gist and question **lines**, not API calls
(there were 49 generation calls and 21 judging ones), and the dollars are the **generation half
only**, because judging has never been metered. At $0.049 per generation call then and $0.049 now,
the two runs agree exactly — which is the check that this reading is right rather than convenient.

The narrowing is the rest of the saving: the gate lives entirely at one node of one document, so five
arms over `--doc noema-mythology-of-conscious-ai` is five generation calls against forty-nine.

### Two things recorded for whoever runs this next

- **A judging answer was truncated at 9,225 characters** and lost a whole repeat. The harness caught
  it — *"it ends part-way through"*, the same diagnosis `variants.md` gives for a cut-off generation
  — and refused to read it, which is right. But it means a 3-repeat run silently became a 2-repeat
  one, and two is the minimum `judgeInstability` will measure at all. A fourth repeat would be
  cheap insurance.
- **The no-leader outcome is robust to that loss**, though not for the reason I first gave: the two
  repeats that did land already have different leaders, so no third repeat could make one arm lead
  every repeat. What a third repeat *would* have improved is the control-favouring signal below,
  which is exactly what the next run should be designed to settle.

---

## Stage 4 — tweaks, and only on evidence

> consider tweaks if you learn something useful from it
>
> — Greg, 2026-09-06

If stage 3 says something solid — that hint placement matters, that the control was better all along
— act on it and say so here.

**If it says nothing solid, change nothing and write that down.** *"The eval still cannot separate
these"* is a real and useful result. Inventing a tweak to justify the stage is the failure mode, and
it is named here so that a later reader can tell a decision from a flourish.

### And "solid" is given a mechanical meaning, because otherwise it has none

⟨Sol F7.⟩ **Stage 4 may ship only exact prompt text that was an arm in stage 3's run**, and only when
that run's coverage was clean, its calibration passed, and `separate` named a leader. Anything else is
no prompt change and a written record of the gated numbers that prevented one.

This closes a hole the stage brief opened. *"A shorter V4 scores as well"* is not an outcome stage 3
can produce, because **no planned arm is a shorter V4**. Writing one by hand in stage 4 and shipping
it would be exactly the move stage 1 refuses — a hand-tuned V4 is neither V4 nor measured. If a
shorter V4 is worth knowing about, it is worth adding as an arm *before* the paid run.

The two observations banked from stage 1's real run — the topic prefix mostly repeating the title, and
the hint rarely being a count on a non-enumerating article — are candidate arms under that rule, not
candidate edits.

## Stage 4 — nothing is changed, and here is the evidence for not changing it

**The eval now works, and it produced a signal it is not powered to confirm.** That is a real
outcome, and reaching it on numbers rather than on a gate failure is the whole difference stage 3
bought.

Against the rule set above, one condition at a time:

- **Coverage clean?** Yes — 60 of 60 lines.
- **Calibration passed?** Yes, for the first time.
- **Did `separate` name a leader?** **No.** The two completed repeats have different leaders, so no
  arm led every repeat.

So no prompt text may ship, and none does. Concretely, the three things stage 4 was allowed to act on
and what the run actually says about each:

| the tweak it might have licensed | what the run says |
|---|---|
| *"a shorter V4 scores as well"* | **Unanswerable, by construction** — no arm was a shorter V4, and writing one now and shipping it is the move stage 1 refused. It is a candidate arm for a future run, not an edit |
| *"hint placement matters"* | `v1` (hint before the colon) sits at 2.58 against V4's 1.42, and behind the control at 0.83. Nominally worse, on one document, with no leader named. **Not settled** |
| *"the control was better all along"* | **The nearest thing to a real finding here, and still not enough to act on.** All three V4 generations trailed the single control generation, head-to-head 9/12, 8/12 and 11/12. One control generation on one document is directional, not dispositive |

**So: no change to the prompt, no change to the code, and this paragraph is the deliverable.**
Inventing a tweak to justify the stage was named as the failure mode before the run — and note that
the *other* failure mode nearly happened instead: my first write-up dismissed the control's lead as
noise, on a comparison of two statistics that are not on the same scale. GPT Sol caught it ⟨F21,
F22⟩. **Explaining a result away is as much a way of not doing the stage as inventing one.**

### But two things were learned, and they are worth more than a tweak

1. **The wordings differ where Greg said they would, and the axes show it rather than the ranking.**
   The pre-V4 control scores `leakage 1.00` and makes no shape claim on any of twelve judgements; V4
   scores `leakage 2.42` and claims a shape on eight. V4 tells the reader more about what is coming
   and gives away marginally more in doing so. **That is the trade he drew, behaving as drawn** — and
   it is a fact about the two prompts that survives the arms being inseparable, because it comes from
   the axes rather than from an ordering.
2. **The instrument is now worth re-using, which it was not on 2026-09-05.** A repaired gate, an axis
   that measures the failure the prompt actually forbids, an exit code, a corpus pin that fires on
   the article rather than on the sanitiser, and a run that costs $0.25. The next question about this
   prompt can be asked cheaply, which was not true this morning.

**What would settle it, and it is now a specific experiment rather than a wish.** Balanced generation
replicates — the same number of independent generations per recipe, not one control against three
accidental V4 twins — over several documents rather than one, with the aggregate-mean uncertainty
bootstrapped by document and node instead of read off a per-lineup distance. That design would either
confirm the control's lead or dissolve it, and at $0.049 a generation call it is affordable. **It is
the thing to run next, and it is a decision for Greg** — because a confirmed result would mean
reverting a wording he chose this morning.

---

## Stage 5 — Q7, and it is one run and a table

[open-questions.md](../project/open-questions.md) § **Q7** — *"Which model, and how much does a tree
cost?"* — has been open since 2026-08-24. Its own *What is left* paragraph says the experiment is
already built: `src/pipeline.ts` logs `inputTokens`, `outputTokens`, `cacheReadTokens` and
`cacheWriteTokens` per step, so the number falls out of one ingest.

- **One real ingest, end to end, against the local database.** Never production.
- **A newly minted slug, not `--force` on an article we have.** ⟨Sol F6.⟩ `--force` re-runs the stage
  but the structure and label **checkpoints survive**, so two consecutive forced runs can buy zero
  model calls while both report success — a cached zero reported as a price. The run must show
  `structureResumed: false` and a non-zero label-call count, or it has not measured a cold tree.
- **Dollars come from the ledger, not from my arithmetic.** `src/pricing.ts` says OpenRouter's
  settled `usage.cost` is authoritative and manual token pricing is a **cross-check only** — partly
  because OpenRouter and Anthropic token fields need opposite cache arithmetic, which is precisely
  the mistake an agent multiplying four counters by four rates would make. So: the ingest's stored
  AI-spend rows for the money, the per-step token counts to explain and check it.
- Report hierarchy, deepening and labels **separately**, then the whole ingest, and record the
  article's block and word count, the date, the model, the cache state and the exact command.
- **One article is a dated example, not a universal price**, and the write-up says so.
- **Do not delete Q7, Q2, Q3 or Q9.** Q2/Q3/Q9 are deliberately collapsed to anchor stubs holding
  about eight inbound deep links each; Q7's anchor has eight of its own.
- The **costed method and the measurement** go in the doc that owns the subject —
  [ai-gateway.md](../project/ai-gateway.md), cross-linked from
  [billing.md](../project/billing.md) — and **Q7 keeps its anchor and carries the headline number and
  the link**, beside the 2026-08-26 caching numbers already there.

**Last and alone.** It is the only heavy thing in this brief, and the box is shared.

### Stage 5, as run

Two fresh ingests against the local database (`127.0.0.1:54362` — read off the `Target:` line, not
assumed), both on newly minted slugs so no checkpoint could hand back a cached zero. Both recorded
`structureResumed: false`; the labels passes recorded `labelCalls` of 2, 5 and 4.

```
npm run ingest -- https://paulgraham.com/hwh.html          → hwh-spya-ara60g
npm run ingest -- https://paulgraham.com/greatwork.html    → greatwork-spya-yw4d3t
npm run labels -- <slug>
```

| | blocks | words | hierarchy | labels | total |
|---|---:|---:|---:|---:|---:|
| *How to Work Hard* | 96 | 3,341 | **$0.0620** (1 call) | $0.0437 (2 calls) | **$0.1057** |
| *How to Do Great Work* | 330 | 11,890 | **$0.1671** (1 call) | $0.2144 (9 calls) | **$0.3815** |

Dollars from `ai_calls.credits_used_nanos` with `cost_source = 'provider'` — OpenRouter's settled
figure, which `src/pricing.ts` makes authoritative and against which per-token arithmetic is a
cross-check only. **That is Sol's F6 taken in full**: a hand-multiplication of the four counters was
the mistake waiting to be made, and the two providers need opposite cache arithmetic.

**What the run cost in total: $0.4872.** Plus the eval's $0.2471 in stage 3 and the stage-2 pilot's
one call, this whole night's model spend is under a dollar.

**The labels pass failed once, and the long article's figure includes the failure.** The first attempt
died on `Nav labels: expected [number, string] pairs` after spending $0.1427 and landing 3 of 6
batches; the retry resumed those three, cost $0.0717 and finished. Recorded rather than re-run
clean, because a figure that quietly excludes the retry is not what an article costs. Per-batch
checkpointing is what stopped the first attempt being paid for twice.

**Two of Q7's own premises were wrong**, which is most of why it stayed open since 2026-08-24:
its estimate of *"one call per node plus one per leaf batch"* would have been an order of magnitude
out — the tree is **one long-context call** whatever the size — and *"still unmeasured"* understated
what was already there, since the counters and the ledger between them needed only two ingests and a
query.

**Where it is written.** The measurement and the method go in
[ai-gateway.md § What an article costs to arrive](../project/ai-gateway.md#what-an-article-costs),
which owns the cost subject; Q7 keeps its anchor and carries the headline table and the link, beside
the 2026-08-26 caching numbers, which answer a different question and stay.

**Sol's F8, half taken.** It objected that `open-questions.md` is one of the seven entry-point docs
whose wording needs approval, and that a resolved question should collapse to a stub. The first half
is **wrong on the facts**: the seven entry points are `vision.md`, `architecture.md`,
`reading-view-overview.md`, `design-css-overview.md`, `security-map.md`,
`code-quality-overview.md` and `dev-and-deployment-overview.md`; `open-questions.md` is a doc listed
*beneath* the first of them. The second half is right about where knowledge belongs, and is why the
substance goes to `ai-gateway.md` — but Q7's anchor stays, because eight inbound links point at it
and the brief says so explicitly. Sol also proposed blocking the stage on approval; overruled, since
the brief commissions it and Greg is unreachable for the duration.

---

## The plan review, and what it changed

GPT Sol on the plan as first written, 2026-09-07, round 1 — prompt and answer at
[`260907d-review-1-plan-prompt.md`](260907d-review-1-plan-prompt.md) /
[`260907d-review-1-plan-answer.md`](260907d-review-1-plan-answer.md). Verdict: **refuse the plan as
written**, five established P1s.

It earned that. Two of the five were plain factual errors about code I had read, and one — F3 — found
a hole nobody had noticed in two days of work on this harness.

| ID | sev | finding, in one line | disposition |
|---|---|---|---|
| F1 | P1 | `incumbent` does not become another name for `v4`; the arms differ in their GISTS block, and the proposed control was not pinned | **fixed**, and the real collision was worse — see § *What the first draft got wrong*. The pinned-normaliser half is **overruled with a measured zero** |
| F2 | P1 | byte identity between the shipped block and the measured one was an invariant with no gate | **fixed** — the assertion Sol wrote, seen red under a one-word mutation |
| F3 | P1 | the rubric has no argument-demand criterion, so the eval cannot detect the lookup failure the prompt forbids; and "the judge is stable" was unsupported | **fixed** — new criterion, new anchor 2, `judgeInstability` reported separately, and the claim about stability narrowed to what the anchors actually show |
| F4 | P1 | stage 2 could end green with every question omitted and a perfect logger | **fixed** — acceptance condition rewritten, plus the per-target marking and the `candidate.depth + 1` seam |
| F5 | P2 | `EXPANSION_PROMPT_STAMP` already moves with stage 1, so "the stamp moves" is satisfiable by doing nothing; and the stale-replay reasoning was wrong | **fixed** — explicit `expand/3` → `expand/4` bump, with the reason corrected to provenance |
| F6 | P1 | `--force` reuses checkpoints, so stage 5 could report a cached zero; and pricing by hand contradicts `pricing.ts` | **fixed** — newly minted slug, `structureResumed: false`, ledger dollars |
| F7 | P2 | stage 4's evidence rule was unfalsifiable, and no arm is a "shorter V4" | **fixed** — stage 4 may ship only exact text that was an arm |
| F8 | P2 | stage 5 conflicts with the important-doc and open-question contracts | **half taken**: `open-questions.md` is not one of the seven entry points, and the stage is not blocked on approval; the substance does move to the owning doc |

**Two things it could not see, and one it got wrong about itself.** The review ran against the base
commit while stage 1 was being written in the same tree, so it read a moving target and rightly
discarded its own test run. That is a process fault of mine, not Sol's: a live pre-commit candidate
names a tree, not bytes, and I kept editing the tree. **The next review in this plan goes out against
a commit.**

## The stage-1 code review, and the three P1s in the shipped patch

GPT Sol on commit `334988ad`, 2026-09-07, round 2 — prompt and answer at
[`260907d-review-2-stage1-prompt.md`](260907d-review-2-stage1-prompt.md) /
[`260907d-review-2-stage1-answer.md`](260907d-review-2-stage1-answer.md). Verdict: **refuse as-is**,
three established P1s. This is the review engineering-manager says to weight above the plan review,
and it earned that too: **all three P1s were in code that had passed 14,864 green tests**, and two of
them were in the two lines the whole stage was about.

| ID | sev | finding | disposition |
|---|---|---|---|
| F9 | P1 | the `{1,40}` bound rejected hints the prompt permits, and the test that claimed to hold it tested nothing | **fixed** — bound removed |
| F10 | P1 | the gist-echo check no longer catches a gist re-asked **in V4's own shape** | **fixed** — `bareQuestionWords` |
| F11 | P1 | `bareWords` stripping a bracket changed unrelated inputs, in both directions | **fixed** — reverted; the unwrapping is the question's business |
| F12 | P2 | the stub's V4 branch became unreachable when the `v4` arm was removed | **fixed** — keyed on the block, not the arm |
| F13 | P2 | the control's comparator resolved its questions live, so "both halves stay put" was false | **fixed** — both length-pair arms pin `variant: "V4"` |
| F14 | P2 | a duplicated `## …` section parses silently and the **first** copy wins | **fixed** — `refuseDuplicate` on all three discovery loops |
| F15 | P3 | the parser's header promised to throw on a lost fence language tag; every fence is untagged | **fixed** — sentence corrected |
| F16 | P3 | three comments still described the retired `v4` arrangement | **fixed** |

### The two that matter, and why the tests did not catch them

**F9 — a number I made up.** `[^()]{1,40}` was meant to separate "a shape hint" from "a parenthetical
sentence". It rejected *"Evidence — how should we compare these accounts? (a comparison across
historical and modern cases)"* — fifteen words, a shape rather than an answer, every stated rule
satisfied — and stored it with a second `?`. Worse, **the test I wrote to hold the bound did not test
it**: its input had no `?` before the bracket, so the bounded and unbounded regexes both rejected it
and the test passed either way. A test that cannot distinguish the thing it names is not evidence,
which is the whole of [silent-success.md](../reusable/silent-success.md) in one assertion.

**F10 — the check stopped catching the failure its own prompt names.** The gist re-asked is what
anchor 5 of the eval is built out of and what the QUESTIONS block forbids in so many words. In V4's
shape that echo is `<topic> — <gist>? (<hint>)`, and the topic prefix alone defeats the equality
check. So the one rule in `questionFor` that means exactly what it says had, from the moment V4
shipped, stopped meaning it — **in precisely the shape production now asks for**. And because the
panel draws `question ?? gist`, the reader gets the wall instead of the door with nothing anywhere
recording it.

Both are now `bareQuestionWords`: unwrap the hint, then the topic, then compare. `bareWords` is back
to what it was, because it is applied to the **gist**, which is an ordinary sentence that may
legitimately end in a parenthetical — F11, established by Sol with a pair I would not have thought
of.

All five new or rewritten assertions were **seen red against `334988ad`** before the fix, each
reproducing its finding.

## Stage 2, as built

Built by an Opus subagent against the brief above; `expand/4`, and green.

**What landed:** `EXPAND_SYSTEM` gains a QUESTIONS block carrying V4's rules in the expansion
prompt's voice; `renderTargetBriefing` prints `ASK QUESTION ON CHILDREN` or `OMIT QUESTION` per
target, derived from that target's own ancestor chain; `ProposedChild` gains `question?`;
`DeepenStats.missingQuestions` names the parts that were asked and did not answer, with a `warn` that
is silent at zero; `EXPAND_PROMPT_VERSION` `expand/3` → `expand/4`.

### Two things this plan got wrong about the code

1. **`questionFor` cannot be imported into the cascade.** `hierarchy-expand`/`-deepen`/`-cascade` are
   imported *by* `src/hierarchy.ts` and take **types only** from it; a value import closes a cycle
   `npm run cycles` refuses. So *"attachment puts it through `questionFor`, imported, at
   `candidate.depth + 1`"* is not buildable as written.

   **What replaced it is better, not merely different.** The expansion carries the model's question
   onto the node **unjudged**, and `buildTree`'s existing `questionFor` call keeps or drops it at the
   node's **real depth in the finished tree**. Every deepened article is rebuilt through `buildTree`,
   and `proposalFromTree` already carries `question` for exactly this reason. Drops land in
   `BuildReport.droppedQuestions` with no second rule and no widened signature — and it is *more*
   correct than `candidate.depth + 1`, which would be wrong wherever `collapseRestatedRungs` promotes
   a rung. Rejected on the way: hoisting `questionFor` into `hierarchy-prompt.ts` (bigger blast
   radius), and duplicating `MAX_QUESTION_DEPTH` in the cascade (a second rule).

2. **The new counter could not go on `BuildReport`**, which lives in `src/hierarchy.ts`. It is
   `DeepenStats.missingQuestions`, named by position in `BuildReport`'s style, reaching the log
   through `deepen: run.deepen` in `pipeline.ts`.

### The scope of the fix, stated honestly — it is narrower than the symptom

**`asksChildQuestions` is true only when wave 1 returned a root with no children at all.**
`deepenTree`'s `walk` makes a candidate only of a *childless* node, so on any article whose wave-1
answer divided the root, every target is at depth ≥ 1 and every section is marked `OMIT QUESTION`.
Verified in `src/hierarchy-deepen.ts` § `walk` rather than taken from the subagent's report.

That is the right scope — it is the second of the two cases
[summaries.md](../project/summaries.md) already named — but it means the fix covers **one** of the
two ways a part ends up with no question:

| how a part loses its question | fixed here? |
|---|---|
| a **flat article** deepened through stage 5: its parts come from the expansion call, whose prompt did not ask | **yes**, this is `expand/4` |
| a **rung that restated its parent** is spliced away and its children come up in its place, carrying none — they were depth 2 when the model wrote them, and nothing asks a question at depth 2 | **no** |

The second is not fixable inside this stage's constraints: it would need questions at depth 2 (which
the whole feature exists to avoid — one per section on a fifty-section article is the noise
`MAX_QUESTION_DEPTH` is there to prevent) or a second model call (forbidden). It is already
**counted** — `src/hierarchy.ts` pushes it into `droppedQuestions` rather than letting it read zero —
and it stays that way, named here so nobody reads this stage as having removed the symptom entirely.

### The live acceptance run, which I had wrongly called impossible

**I narrowed this stage's acceptance condition and GPT Sol refused the narrowing (F18), correctly.**
My argument was that a live run needs an article whose wave-1 answer is a childless root, that this
is a model outcome rather than a flag, and that forcing it would mean lying to the model about the
article. The first two are true. **The third is not**, and the difference matters: building a
root-only `Tree` over a real article's full range falsifies nothing about the article — it controls
only the *upstream* model outcome, and hands the expansion call the exact production request for the
case in question. The fixture that does it already existed.

So the pilot was run, and it is the acceptance evidence this stage was supposed to have:

```ts
const rootOnly = buildTree({ title, gist, range: [first.id, last.id] }, {}, blocks, slug, emptyReport);
await deepenTree({ tree: rootOnly, blocks, slug, checkpoints: nullCheckpointStore(), execute: liveExpansionExecutor() });
```

`noema-mythology-of-conscious-ai`, 141 real blocks, stamp `toc/7+expand/4`, one call, nothing written
anywhere. **Five depth-1 parts came back, and all five carry a question:**

> Introduction and Credits — Why does the question of conscious AI matter now? (an argument from stakes)
>
> The Temptations Of Conscious AI — Why do people think AI could be conscious? (three biases plus two further temptations)
>
> **Consciousness & Computation — Why might computation not be sufficient for consciousness? (four arguments)**
>
> What (Not) To Do? — What should we do given this uncertainty about conscious AI? (a recommendation and a distinction)
>
> Soul Machine — What ultimately matters once conscious AI myths are dispelled? (a closing reflection)

`missingQuestions: []`, `droppedQuestions: []`. Usage: 18,730 input, 1,795 output, 2,267 cache-write
on the one call.

**The bolded row is the point.** That is Greg's own worked example — *"Computational functionalism —
why isn't computation sufficient for consciousness? (4 arguments)"* — reproduced on the same node, by
the **cascade** path this time rather than by stage 4. The two paths now write the same kind of line,
which is what copying V4's rules into `EXPAND_SYSTEM` was for.

**What is still unmeasured**, and it is much smaller than what I claimed before: nobody has seen the
new block on a *naturally* flat article, only on a synthetically flat one. The prompt and the request
are byte-identical between the two; what differs is only how the root came to be childless.

## The stage-2 code review

GPT Sol on commit `6bcb0b6e`, 2026-09-07, round 3 —
[prompt](260907d-review-3-stage2-prompt.md) / [answer](260907d-review-3-stage2-answer.md). Verdict:
**refuse as-is**, two established P1s. It ran its own harness against an extracted snapshot of the
commit for three of the four findings, which is why they are established rather than reasoned.

| ID | sev | finding | disposition |
|---|---|---|---|
| F17 | P1 | `DeepenStats.missingQuestions` is serialised inside `DeepenRecordsFile`, but the writer still emits `deepen-records/3`, whose contract requires a bump when the shape changes — so an old `/3` file is accepted as the new TypeScript shape | **fixed** — `deepen-records/4`, with a parser regression refusing `/3` |
| F18 | P1 | the live acceptance gate was waived on a false impossibility claim | **fixed** — the pilot above, and the claim retracted in place |
| F19 | P3 | `summaries.md` says a mixed panel now has only one remaining cause; an accepted expansion omission and a wave-1 omission also produce one | **fixed** — all three named, with what counts each and which is uncounted |
| F20 | P3 | the cache-arithmetic comment still said 1,150–1,400 tokens; `EXPAND_SYSTEM` is now 1,631 | **fixed** |

**And it confirmed the three things I most wanted checked**, by induction through `walk` rather than
by agreeing with me: ancestor length does equal depth; the production ASK case really is only a
childless root; carrying the question through to `buildTree` is cleaner than duplicating
`questionFor`, and deeper questions are dropped there. No import cycle, no article-adjacent logging.
`DeepenStats` is the right home for an answer omission — subject to F17, which is the artefact-version
half I had missed entirely.

## The stage 3/4 review, which did not refuse and changed the answer anyway

GPT Sol on commit `764e9c57`, 2026-09-07, round 4 —
[prompt](260907d-review-4-stage34-prompt.md) / [answer](260907d-review-4-stage34-answer.md).
**No established P0 or P1, so no refusal** — and it is the most useful review of the four, because
two of its six P2s are about the *conclusion*, which is the deliverable.

| ID | sev | finding | disposition |
|---|---|---|---|
| F21 | P2 | the conclusion ignores the registered comparator and two further V4 replicates; the control beats all three head-to-head | **taken** — conclusion rewritten, § *The result* |
| F22 | P2 | the factor-of-three comparison puts two statistics on different sampling scales against each other | **taken** — the language is deleted; the no-leader outcome now rests on the flip alone |
| F23 | P2 | the rubric's `demand` examples are lexically anchor 2 and V3's worked line, so the judge can pattern-match instead of applying the criterion | **taken** — the examples moved to a different domain entirely, and the doc says the 2026-09-07 result was produced under the coached wording |
| F24 | P2 | a partially failed judging pass exits 0 **and** could still name a leader | **taken** — non-zero exit, and `judgingComplete` threaded into `separate`; the second half is the load-bearing one |
| F25 | P2 | `perRepeatLeaders` takes `[0]`, so a tie becomes a leader by insertion order | **taken** — the whole leading set, uniqueness required, ties printed as ties |
| F26 | P2 | the `demand` axis is requested and never validated; an answer with no axes at all passes | **taken** — `validateAnswer` at the seam where the answer arrives, sharing only `permutationOf` with the gate |

**F21 and F22 are the ones worth reading.** I had written that the two wordings were *"not
separable"* and that the control's lead *"means nothing"*, and both were too strong — one on a
statistics error, the other on not noticing that three of the five arms were the same recipe. The
corrected reading is in § *The result*: the run licensed no winner, and every V4 generation trailed
the control.

**What that means about this stage's own failure mode.** Stage 4 was written expecting the temptation
to be *inventing* a tweak. The temptation that actually arrived was the opposite — explaining away a
result that pointed at work I had done that morning. Both are ways of not doing the stage, and only
one of them was written down in advance.

**One consequence of F24 and F25 together, recorded because a reader of the old file would be
confused:** `separate` is now stricter in two ways at once, so the run's `results.md` was
**regenerated and re-promoted** under the new code. Its stated outcome is unchanged — it named no
leader before and names none now — but it refuses for more reasons, and its gists repeat 3 prints as
a tie rather than as a flip.

## Decisions and assumptions taken without asking

Greg cannot be reached during this run, so these are recorded rather than asked.

1. **A new plan doc rather than an appendix to 260905f.** 260905f is finished and its narrative ends
   at a declared no-result. This is a different job with a different brief.
2. **The pinned `questions-toc6` arm, and the removal of `v4`** (§ *the eval loses its control*). The
   alternative — letting `incumbent` follow production — is cheaper and destroys the comparison.
   Taken as a technical fork, which engineering-manager says is mine to settle.
3. **The QUESTIONS block is copied byte-for-byte from `variants.md`, and `variants.md` is not
   edited to improve it.** Any improvement is stage 4's, on evidence.
4. **`EXPANSION_PROMPT_STAMP` moves in stage 2.** A new requested field is a prompt change, and the
   checkpoint is keyed on the stamp.
5. **Stage 2 asks for the question only on the root's children**, not on every child with a note that
   deeper ones will be discarded. Asking for output that code then throws away spends tokens to
   produce a line nobody sees.

## Bookkeeping this closes

Stages 1, 3 and 4 together answer the decision parked in
[awaiting-approval.md](../user-feedback/awaiting-approval.md) — *"which Socratic wording"*, report
24. When they land:

- [260905_0954](../user-feedback/260905_0954-socratic-questions-in-summary-mode.md) and
  [260905_1803](../user-feedback/260905_1803-only-the-socratic-question.md) record what shipped and
  why.
- Report 24's row comes off `awaiting-approval.md`. **That file only shrinks when somebody does
  this.**
