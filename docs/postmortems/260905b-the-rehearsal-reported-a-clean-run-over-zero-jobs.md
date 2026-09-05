# The rehearsal reported a clean run over zero jobs

**2026-09-05, late morning.** `npm run eval:deepen -- … --dry-run` — the free rehearsal that
[evals/README.md](../../evals/README.md) and [260904d](../plans/260904d-deepen-fat-sections.md) both
tell you to run before the $40.90 paid one — died at its very first `enqueue`, created nothing, and
then printed its entire closing report: an empty driving table under a paragraph explaining why the
emptiness was expected, `Findings: none`, `Cleaned up 0 article(s) and 0 job(s)`, and a written
`run.json`. The error appeared on the last line of all, after `Wrote evals/results/…/run.json`.

No money was lost. This was caught before `--spend`. The reason to write it up is that the rehearsal
exists to be *believed* — you read it, conclude the shape is proved, and then type `--spend`.

## Layer 1 — the breakage

`stepsFor(dryRun)` in [`evals/deepen/run.ts`](../../evals/deepen/run.ts) swaps the paid step lists
for free ones: `ingest: ["fetch","extract","blocks"]`, `rerun`/`force` of `["blocks"]`. `blocks`
re-runs the splitter, which costs nothing, and driving it exercises the same enqueue → force →
serial-repeat → concurrent-load machinery the paid run uses.

`unrunnableStepPlan` in [`src/jobs.ts`](../../src/jobs.ts) refuses any step list containing `blocks`
without `hierarchy`, and `enqueue` throws a 400 on it — before the owner check and before anything is
reserved. The rule is right: such a job runs, succeeds, and then cannot be published, because the
`hierarchy` step-run's `input_hash` no longer matches the blocks beside it.

So once `dev` merged in, phase A's first `enqueueJob` threw and the run was over before a single job
row existed. It is a two-function proof, and `git diff 34de961d 4c3010d3 -- src/jobs.ts` shows this
is the **only** new throw the merge added to `enqueue`.

### Neither commit was wrong, and the merge is the occasion rather than the cause

- **`aa941484`, 03:00 BST** — stage A of
  [260904e](../plans/260904e-extraction-repair-evals-and-llm-post-processing.md) added both
  `unrunnableStepPlan` and its call in `enqueue`. ⟨Correcting a plausible attribution: `cbb903d0`
  *"Stage E: the six stage CLIs go through the queue"*, 06:14, is a sibling that also tightened
  `enqueue`'s refusals, and is the plan the missing test got filed under — but
  `git log -S unrunnableStepPlan -- src/jobs.ts` returns `aa941484` and nothing else.⟩
- **`3693a6ce`, 09:18 BST** — *"Add the harness for stage 5b, so the paid run cannot succeed at
  nothing"* wrote `evals/deepen/run.ts`, six hours after the rule existed on `dev` and before this
  branch had merged it. Its dry runs at 09:05 and 09:14 drove eight jobs each, and were green.
- **`4c3010d3`, 11:43 BST** — the merge. `84056d51` at 11:46 and `fd605010` at 11:49 are somebody
  writing the gap up three and six minutes later, which is how fast this was diagnosed once seen.

Neither change is a defect on its own. There was no textual conflict, `npm test` was green, and
`npm run typecheck` cannot see a step list. The only thing in the repo that runs the combination is a
command needing local Postgres and two untracked fixture files, so nothing ran it until a person did.

**There is no second class here, and the first draft of this postmortem said there was.** It claimed
*a rule enforced at a seam, with a test only for the predicate behind it*, and that the door was
untested. That is false: `tests/jobs.test.ts` "refuses a blocks-only job at the door rather than
stranding the article" drives `enqueue` and expects a 400, about 980 lines below the pure-function
block, and 260904e says in its own text that the rule and its wiring are asserted separately
*"because a guard nothing calls is the shape of half the bugs in this repo"*. The rule is right, both
halves are tested, and **the whole of layer 1 is a bug in the caller**: the dry run asked for a step
combination the queue refuses by design.

**Why three agents believed otherwise is worth more than the claim was.** The search that established
the "gap" was a grep across `tests/` that excluded `tests/jobs.test.ts` — the file being annotated —
on the assumption that the block already read was all it had to say. The wiring test does not name
`unrunnableStepPlan` in its title, so nothing else surfaced it, and a clean grep result was taken as
evidence of absence. Two peer sessions were told the gap was real, and a retraction now stands where
the claim was
([260903f](../plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md#stage-e-unrunnable-untested)).
The transferable rule: **a search that excludes the file you are writing about cannot return the
thing that would change your mind**, and "I grepped and found nothing" is only evidence if the grep
could have found it.

**Two of the three agents were wrong by different routes, and they are not the same size.** The
load-bearing error was mine: asserted in my own voice, off my own grep, into three places including a
doc already on `dev`. The other made it easier to believe and is worth naming for a different reason
-- how such a fact travels, not how much of the blame it carries. The provenance -- that the rule
came from Stage E -- entered this branch as a stated
finding from `spideryarn2-ba`, a peer session with no stake in the outcome, which had genuinely
checked the *count* (nine `describe`s at the merge base, ten on `dev`) and then attributed the
difference to the recent commit whose subject sounded like it fitted, without running the one command
that would have refuted it. `cbb903d0` adds 26 lines to that file and no `describe` at all. Named
specifically rather than folded into "a shared confusion", at that session's own request: a
disinterested peer reporting something as checked is exactly the input a reader does not re-derive,
so it propagates further and faster than a guess made in one's own voice. ⟨`spideryarn2-ba`,
2026-09-05, correcting itself unprompted after verifying the retraction from the primary checkout.⟩

The two mistakes are siblings: **a check whose scope quietly excludes the case that would fail it.**
One excluded a file, the other excluded a command. That is the same shape as layer 2 below, reached
from a third direction, which is the argument for treating it as this postmortem's real subject.

**And there was a third instance, older than both, sitting inside the same red.** The registry entry
for `tests/jobs.test.ts` read *"eight of its ten blocks are pure functions"* -- a count written when
ten was the total, restated as current long after a new block had arrived. That sentence is the same
move in miniature: **a fact reached for rather than re-derived.** So the shape was already present in
the record of the very guard that went red, and then produced a false gap and a false provenance on
top of it, all within one afternoon and all on one red. ⟨`spideryarn2-dd`, 2026-09-05, which made the
connection and fixed the sentence in `c7bb7266` with a dated count and a scope, per CLAUDE.md on
inventories.⟩ Three agents, three routes, one shape -- which is better evidence for the class than any
of the three fixes.

**And the retraction is better evidence for that subject than the original claim would have been.**
An absent test is at least legible -- a gap somebody can see. What actually happened is worse and
commoner: a test that exists, passes, sits in the same file as the thing it guards, and is still not
found by a competent search. ⟨The point is `spideryarn2-ba`'s.⟩ The check and the thing it checks do
not have to drift far apart to stop being connected in anybody's head.

## Layer 2 — the report that could not tell *nothing happened* from *nothing was wrong*

This is the half worth the write-up. Layer 1 is a merge accident; layer 2 is a design that will keep
producing them.

`main` drives the phases inside a `try` and calls `reportRun` from a `finally`. The comment on
`reportRun` gives the reason, and the reason is correct:

> **Everything the run has to say once the jobs have stopped**, in a `finally` so a run that died
> three jobs in still reports the three it paid for.

Right at three jobs. Wrong at zero — and the reporting path cannot tell the difference, because
**every judgement it makes is a loop or a filter over `runFile.jobs`**. `reconcileLedgerAgain` is a
`for` over that array. `checkDriving` in [`evals/deepen/report.ts`](../../evals/deepen/report.ts) is
four filters over it — `notFixture`, phase B's overlap pairs, phase D's `d.length > 1`, and a
concurrency comparison that passes when the runtime cap is what was planned. The per-job findings are
a `flatMap`. At `jobs.length === 0` every one returns `[]`, not by accident but *because* the failure
emptied the collection the checks are computed over. So:

```
console.log(findings.length === 0 ? "  none" : formatFindings(findings));
```

printed `none`.

Worse than empty. `formatDriving([])` maps zero rows and then unconditionally pushes an explanatory
footer:

> A dry-run ingest stops at its last free step and FAILS: publishing needs a tree and a tree needs a
> model call. That is expected. What this phase proves is the driving — the fixture ingress, the
> force, the serial repeats, the concurrent load phase — and nothing about the wave …

The only prose in that section is a pre-written explanation of a failure, printed over a run in which
nothing was driven at all. Below it the `--dry-run` branch adds a second reassurance — that questions
1–5 are *"deliberately absent rather than printed as zeroes"* — which reads as a run that chose not
to answer rather than one with nothing to answer from. Then `fatal.length > 0` is false, so
`process.exitCode` is left alone; `cleanup([])` announces it removed 0 articles and 0 jobs; `run.json`
is written and announced. Only when the exception finally escapes `main` does the edge handler print
it and set exit 1.

### The evidence, and the thing the evidence cannot tell you

Nine `run.json` files from that morning survive under `evals/results/`. Two of them are the shape;
here they are with two healthy ones above for contrast:

| run | started (BST, as the commits above) | commit | jobs | findings |
|---|---|---|---|---|
| `deepen-5b-2026-09-05-gjig6yop` | 09:05:17 | `3693a6ce` | 8 | 0 |
| `deepen-5b-2026-09-05-45xegg7e` | 09:58:54 | `3693a6ce` | 8 | 1 |
| **`deepen-5b-2026-09-05-32m6uzhm`** | **11:28:30** | `34de961d` | **0** | **0** |
| **`deepen-5b-2026-09-05-5uq5vf5e`** | **11:29:00** | `34de961d` | **0** | **0** |

Thirty seconds apart, which is what somebody seeing an odd result and running it again looks like.
Both have an empty `records/` directory and both were over in under a minute.

**These two are not the `unrunnableStepPlan` runs.** They ran on `34de961d`, which was committed at
10:52 and predates the merge, and that commit's `src/jobs.ts` contains no `unrunnableStepPlan`
at all — `git show 34de961d:src/jobs.ts | grep -c unrunnableStepPlan` is `0`. The runs' own
`srcPatchSha256: null` says `src` and `evals` were clean against that commit, and this worktree's
reflog has HEAD at `34de961d` from 10:52 until the merge at 11:43. So the same total-failure-with-a-
clean-report happened **at least twice that morning, from at least two different causes** — and the
second cause is the one nobody can name now, because:

> `run.json` has no field that records that the run died. `"jobs": []` and `"findings": []` are the
> whole trace, and `"findings"` is written only by the closing report — a `--preflight` run returns
> before the phases and has no such key — so its presence proves the full report ran, and nothing in
> the file says why there was nothing to report on.

That is not an aside. **The reason this postmortem cannot tell you why the 11:28 pair failed is the
bug it is about.** Recommendation 2 below is the fix for exactly that.

### The class, named

**A clean bill computed over the collection the failure emptied.**

Not the same as layer 1's class, and worth separating because the fixes differ. That one is a door
nobody knocked on. This one is a *reporter* whose entire input is the output of the thing that
failed, so its healthiest possible answer and its worst possible outcome are the same bytes.
[silent-success.md](../reusable/silent-success.md) has the family under *"Success is the absence of
something"* and its **empty list** row — *which of the three states is it: none, not asked yet, or
asked and failed* — and this is that row at the scale of a whole run rather than one widget.

The two compose rather than duplicate: the first is why it broke, the second is why the breakage
arrived wearing a green shirt. With only the first, the run would have exited 1 with a 400 in it and
cost five minutes.

### Why this one is embarrassing, specifically

The commit that introduced the report is called *"Add the harness for stage 5b, so the paid run
cannot succeed at nothing."* The header of
[`tests/deepen-eval.test.ts`](../../tests/deepen-eval.test.ts) says every case in it is *"a way the
harness could report a clean result while having measured nothing, which is the failure mode
`docs/reusable/silent-success.md` is about"*. Among them:

- `it("refuses an empty table rather than printing a bill of nothing")`
- `it("refuses to call a phase where nothing ran a clean bill")` — added **that same morning**, with
  a comment citing `silent-success.md`, after `budgetReport` printed *"every hierarchy step finished
  inside the budget"* over a phase where none of them ran
- `it("refuses a stability figure over fewer passes than the run set out to make")`
- `it("says nothing at all from one pass, rather than saying everything is stable")`

Every one of those guards lives inside `answerTheQuestions`, `costReport` or `budgetReport` — which
`--dry-run` skips by design. The driving report, which is the *only* thing a dry run produces and
therefore the only thing the rehearsal can be believed on, has none of them.

There is a reason, and it is the generalisable part. **Every partial failure the author had actually
seen was guarded; total failure was not, because it had never happened.** Had phase B alone thrown,
`jobs` would have had rows, the driving table would have had lines, and on the paid path
`expectedBookPasses` would have refused a stability figure over a short population. The one shape
with no guard is the empty one — which is `silent-success.md`'s *enumerate both failure directions*
rule: the noisy direction is the one somebody got bitten by and wrote a test for.

## A green `npm test` over a broken eval is itself the finding

`evals/deepen/run.ts` is imported by nothing. `tests/deepen-eval.test.ts` covers `report.ts` and
`harness.ts` — the arithmetic — by building `JobRecord`s and `RecordsPass`es by hand and asserting
what the report says about them. That is the right split for the money half, and it is untouchable by
this bug **by construction**: hand-built records are never empty, and nothing in the suite ever calls
`enqueue`, `stepsFor` or `runPhases`.

So the suite being green is not a gap one missing assertion would close. It is a statement about what
the suite is: a check on the report's reasoning, not on the run's existence.

## What would have caught it, ranked by ease and value

**Built on 2026-09-05, in the round that closed the pre-spend review** — 1, 2, 3 and 4 are all in
`evals/deepen/` now, each marked below; 5 is still owed by its own plan, and 6 is still the
instruction that already failed. The numbering and the original wording are kept so the reasoning
still reads as it was written, when `evals/` was another agent's in-flight work.

The `--dry-run` that proved them also found, for free, the thing no amount of analysis had: **the
ingest cannot be split across two jobs.** A job that stops short of a publishable article fails, and
a failed job's draft revision is rolled back — so the next job on that slug opens on an article with
no fetched document at all. That is why phase D lines its three measured windows up with a start
barrier rather than by pre-ingesting the load articles.

1. **Refuse a report over zero jobs, in `reportRun`.** Four lines at the top: if
   `ctx.runFile.jobs.length === 0`, push a fatal finding saying no job was ever created and that
   nothing below describes a run, and set `process.exitCode = 1`. It is the guard `budgetReport` was
   given the same morning, one function away, and it converts every future way the phases can die
   before creating anything into a loud one. Trivial; highest value.
   **Built** — `reportRun` says `NO JOBS WERE CREATED AT ALL` in a banner, the findings block
   prints the population its `none` is over, and `formatDriving([])` refuses to explain a run
   that did not happen.

2. **Record in `run.json` that the run died, and with what.** `reportRun` is called from a `finally`
   and is told nothing about what reached it. Catch, stash the error on `runFile`, rethrow. Then the
   artefact distinguishes *ran and found nothing* from *never ran* — the distinction the 11:28 pair
   above cannot make, six hours later, to somebody holding both files. Cheap, and it repairs the
   artefact rather than only the console.
   **Built** — `main` catches, hands the error to `reportRun` as `died`, and rethrows; a run
   that died opens with `THE RUN DIED` and carries a fatal finding into `run.json`. Where the
   reporting throws as well, both errors travel in an `AggregateError` rather than the second
   replacing the first.

3. **Assert the job count the run set out to create, not merely that it is non-zero.** The run knows
   it: one phase-A ingest, `repeats - 1` phase-B repeats, two phase-C passes, three phase-D jobs. A
   driving report over fewer is not answerable — the discipline `answerTheQuestions` already applies
   to passes (`expectedBookPasses`) and `budgetReport` to clocks (`expected: 3`). Small; it subsumes
   1 and also covers partial failure, which is the likelier shape.
   **Built** — `reportRun` takes `expectedJobs` (`repeats + 5`) and goes fatal on a short run
   that neither stopped on purpose nor threw. Kept beside 1 rather than replacing it, because
   zero has a louder thing to say than "short".

4. **Never print a pre-written explanation of an expected failure without checking it happened.**
   `formatDriving`'s footer is unconditional, so the reader is told why the failures below are fine
   before anything establishes there are any. One `if`; the habit generalises past this file.
   **Built** — the footer is behind a `jobs.length === 0` guard, and the phase-C block stopped
   printing `tree … identical` over two digests that were both the literal string `"dry-run"`.

5. **The seam test for `enqueue`'s refusal** — owed and specified in
   [260903f](../plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md#stage-e-unrunnable-untested).
   Ranked below the four above deliberately: it prevents *this* instance and none of the class. A
   different rule at a different seam next month reproduces the whole incident with 1–4 unbuilt, and
   cannot with them built.

6. **Re-run the rehearsal after a merge.** Honest but weak: it needs local Postgres and two untracked
   fixture files, so it cannot be a gate, and "remember to re-run it" is the instruction that already
   failed. Named only so nobody offers it as the answer.

## The same shape elsewhere in the repo

Swept 2026-09-05 across `evals/`, `scripts/` and the CLI entry points in `src/`. **Reported, not
fixed** — none of it was touched.

`scripts/` is in good shape: most of it carries an explicit zero-guard with `silent-success.md` cited
at it. The genuine instances cluster in `evals/`, and they are one family — a markdown or stdout
report built from counters incremented only on the success path, printed unconditionally, with no
exit code.

| where | shape | state |
|---|---|---|
| `evals/remember-stances.ts` § the summary block | prints `answers: ${CASES.length * REMEMBER_STANCES.length}` — the **planned** count — plus `flagged 0 / uncited 0 / truncated 0 (should be 0)` even if every call threw | a failed call does print its own `### stance — FAILED` section, but the Counts block still uses the planned total, there is no `failed` counter, and no `process.exitCode` anywhere in the file |
| `evals/hierarchy-structure/floor.ts` | reads a run's `run.json` and reports per-arm stability without checking `completedAt`, so it quotes the surviving arms of a partial panel; a trailing advice paragraph prints even when the loop emitted nothing | unmitigated — and its two siblings, `verify-zdr.ts` and `verify-costs.ts`, both refuse exactly this, one of them saying *"the dangerous reading of a partial panel is the one where the arms that failed hardest are simply absent and the survivors get quoted as the result"* |
| `evals/referee-mirror.ts` | Counts block prints `cases whose remarks contain a possible verdict: 0 (should be 0)` when zero cases produced remarks | lightly mitigated: failed cases get a `FAILED` table row; the only other tell is an empty `- model:` line |
| `evals/dictation/bench-models.ts` | `clean` starts `true` and is falsified only by `odd.length`, so an arm whose every call was lost has an empty `seen` map and still prints *"every call named the model it was sent to"* | partly mitigated by a `lost N calls` line — **and the comment immediately above it is the fix for the previous version of this same bug**, in its own words *"a clean bill of health from a test that had not run"*, GPT Sol's item 4. See below |
| `evals/dictation/bench-vocabulary-sources.ts` | prints `none — and read that as "no exact vocabulary term was inserted"` over a possibly empty set, and writes a **planned** `calls:` count into the results JSON people paste into plans | mitigated by `lost` printed and written beside it |
| `evals/referee-claims.ts` | Counts block reads `0 (should be 0)` over a run where nothing came back, beside held-out figures computed from static fixtures — which makes the block look like a live measurement | per-case `_Not run._` and `**FAILED**` are printed, so it is the weakest instance |

**One cross-cutting fact, and it cuts the encouraging way.** None of those six ever touches
`process.exitCode` -- across the six there is a single `process.exit`, and it is a usage error. They
exit 0 whatever happened, so `&&`-chaining one, or reading `$?`, cannot tell a full run from a run in
which every model call 502'd. **But the practice is not missing from `evals/`, only uneven**:
`grep -rn "process.exitCode" evals/` returns seven hits across five files -- `quiz.ts`,
`deepen/run.ts`, `extraction/probe.mts`, `cost/interactions.ts`, `cost/run.ts` (run 2026-09-05; a
dated example, not a standing count). That is the more useful framing, because it makes each of the
six a local omission with a working neighbour rather than a directory-wide absence needing a policy.
⟨`spideryarn2-dd`, 2026-09-05, correcting a looser phrasing of this that would have read as "one hit
in `evals/`".⟩
`evals/quiz.ts` is the only member of the family that sets one — and it is the canonical fixed form
worth copying: `marked` (obtained) against `CASES.length` (attempted), an explicit *"Nothing was
measured … which is not the same thing as clean"*, and `exitCode = 1` on total failure. Its own header
records that this bug shipped there first.

**The strongest single piece of evidence in this whole write-up is in that row.** In
`bench-models.ts` a fix for this exact class and its relapse sit adjacent in one file: a comment
recording that the summary once *"ended by announcing that every call was answered by the model it
was sent to — a clean bill of health from a test that had not run"*, and directly beneath it a
`clean` flag that does the same thing one level up. Somebody understood the class well enough to
write it down and reintroduced it in the next block. That is better evidence than another instance
would be, because it shows the failure is not ignorance of the pattern.
⟨`spideryarn2-dd`, 2026-09-05, reading the code rather than taking the finding on report.⟩

Other fixed forms worth citing rather than re-deriving: `scripts/check.ts` § `verdict()`, which
separates `clean` from `broke` (`findings === 0` **and** `code !== 0` → *DID NOT RUN*);
`src/db/schema-drift.ts`, where `declaredTables === 0` is a warning so `✓ no schema drift` cannot
print over a broken discovery; `scripts/deploy.ts`, whose top-level `catch` pushes *"the deploy script
itself"* into `failures` **before** summarising, so the report path cannot launder the exit code; and
`evals/cost/interactions.ts`, a `finally`-report that sets `exitCode = 1` from inside the `finally`.
`evals/cost/run.ts` returns early from `summarise` on zero draws — the direct analogue of
recommendation 1, already built one directory away.

No test suite was found that passes vacuously over an empty collection.

## What it cost

Two dry runs, some minutes, and no money — the paid run had not started. The counterfactual is the
point. A rehearsal that reports a clean shape over zero jobs is not a neutral failure; it is a false
green immediately upstream of the only irreversible step in the plan. The harness was built to stop a
paid run succeeding at nothing, and its free rehearsal succeeded at nothing and said so in the words
it would have used for success.
