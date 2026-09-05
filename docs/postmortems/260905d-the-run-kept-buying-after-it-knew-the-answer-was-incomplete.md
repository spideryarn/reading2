# The run kept buying after it knew the answer was incomplete

**2026-09-05, all day.** The stage 5b harness — the thing that spends $40.90 to answer five questions
about deepening ([260904d](../plans/260904d-deepen-fat-sections.md)) — went through **seven review
rounds** before it was allowed to spend. The same class of defect was found in the **last five of
them, six times**, each time one level lower in the machine than the round before.

No money was lost. Every instance was found before `--spend`. The reason to write it up is not any
one of the findings: it is that six correct fixes in a row each left the level beneath them open, and
that naming the invariant did not stop it happening again.

## The class

**Named: *the run keeps buying after it already knows the answer will be incomplete.***

The harness exists to answer five questions. Each question has evidence it needs. The moment that
evidence is lost — a job that failed, a records file that was never written, three windows that
cannot now overlap — every later purchase buys an answer the report will refuse to quote. Money after
that point is money for nothing.

The class is not "it failed to notice". In every instance the harness **noticed**. It recorded the
failure, wrote it to `run.json`, and printed it. What it did not do was *stop*, because the noticing
and the stopping were at different levels of the machine.

## The six instances, and the descent

Verified from the review answers in the session scratchpad (`dfs-review*-answer.md`) rather than from
anybody's summary.

| # | Round | Finding | The level it was found at | Fixed in |
|---|---|---|---|---|
| 1 | 3 | DPN-06-R | **between phases** — phase A's evidence is lost, phases B, C and D are bought anyway | `a5aecf76` |
| 2 | 4 | DPN-18 | **a fact that never became a finding** — job ends `error`, the phase guard reads only findings, next phase bought | `6deff942` |
| 3 | 4 | DPN-19 | the same, for a `done` job whose records file was lost | `6deff942` |
| 4 | 5 | DPN-23 | **within a phase, between jobs** — the load jobs never lined up, the paid book was driven anyway | `921225e6` |
| 5 | 6 | DPN-26 | **between concurrent jobs** — one sibling fails, the other two keep claiming | `9d1cf057` |
| 6 | 7 | DPN-30 | **inside one claimed step** — one claim runs a structure call, an expansion wave *and* a full label pass | `2630b1d7` |

⟨**Correcting the framing I was given**, which is the habit this postmortem is partly about. It was
put to me as "six of seven rounds". By the answer files the class appears in rounds **3 through 7** —
five consecutive rounds, six instances, because DPN-18 and DPN-19 landed together. Rounds 1 and 2
found adjacent things (DPN-06 races the levers against running siblings; DPN-07 re-buys a wave it has
already paid for) but neither is a case of spending *after knowing*.⟩

Read the level column downwards. Phase → job → concurrent sibling → claim → call. Each fix was
correct, each was tested, and each was written at the granularity the author could see from where he
was standing.

## Layer 1 — the breakage, at the bottom of the descent

`generateHierarchy` in [`src/hierarchy.ts`](../../src/hierarchy.ts) catches a deepening wave that
failed, saves the failed records, logs a warning — and then falls through to `generateLabels`
unconditionally. That is correct production behaviour: a reader whose deepening failed should still
get a labelled tree from wave 1.

The harness's shared fate (`startPhaseFate`) refused the **next claim**. But one claim walks a whole
step, and `hierarchy` is a step that buys a structure call, an expansion wave and a whole pass of
labels. So after question 5 was known unanswerable, a sibling still inside its claim could *begin* an
entire label pass. GPT Sol, round 7:

> Thus the exact DPN-26 scenario remains: after Q5 is known incomplete, more provider calls can
> begin. "A call already in flight finishes" does not cover later calls started inside an
> already-claimed pipeline step.

The exposure was roughly **$10.80 of phase D's $14.20** — the book's $7.40 pass plus whatever of the
other load article's ~$3.40 had not yet been spent.

## Layer 2 — the root cause: the unit of control is not the unit of spending

This is the part worth carrying to the next eval.

**The harness's unit of control is the claim. The unit of spending is the call.** Everything the eval
can hold is claim-shaped:

- `driveToDone` decides whether to claim again — before a claim.
- `requeueVerdict` decides whether a handed-back job is re-driven — between claims.
- `announcing` wraps `step.run` — at the boundary of a claim's step.

And the job layer **deliberately hides calls inside claims**. That is not a bug in `src/jobs.ts`; it
is its design, stated in its own docblocks:

- `advanceJobWith` builds its `AbortController` privately and never hands it out. A claim's lifetime
  is the queue's business.
- `AdvanceParts.onStepSpend` is *"an observer: it is handed the report and its return value is
  ignored, so it cannot change what it watches"* — the eval learns what a step bought **after** the
  step is over.
- `StepContext.deadlineAt` exists precisely so a step can *itself* decline to start work it cannot
  finish. The decision is inside the step, by design.

So the eval could see spending only in arrears and control only claims. Between those two facts sits
a gap exactly one pipeline step wide, and every instance of the class lived somewhere in it. Each
round pushed the guard one level deeper into the gap; round 7 reached the bottom.

**The one seam that does cross the gap** is `ctx.signal`. The registry overlay already replaces
`step.run`, and `StepContext` is plain data whose `report` is an arrow closing over the step, so the
overlay can hand the step a context whose signal is `AbortSignal.any([ctx.signal, fate.signal])`.
That is what closed DPN-30 without touching `src/`. It works because `src/` already threads that
signal to the places that spend — label batches are queued *with* it
([`src/labels.ts`](../../src/labels.ts) § `queue.add(…, { signal })`), and
[`tests/labels-batching.test.ts`](../../tests/labels-batching.test.ts) already pins the consequence:

> the callback must never run either, or the "stop paying" half of fail-fast buys nothing

**For the next eval written against this queue:** you get three levers and no more — the step
registry, the claim loop, and `ctx.signal`. Reach for the third one *first* if what you are
controlling is money, because the first two are too coarse to hold a call. And write down which of
the three each guard uses, because a guard whose lever is claim-shaped cannot make a promise about
calls however carefully it is worded.

## Layer 3 — what the invariant bought, and what it did not

Four guards were fitted before anybody wrote the rule down: `stopIfCompromised` (phases),
`jobIntegrityFindings` (facts into findings), `loadReadiness` (before driving the book),
`abandonStep` (at a step's entry). Round 6 asked for the rule instead of a fifth guard, and got it:

> **The three measured jobs share one fate, and none of them starts more paid work after any of them
> has lost it.**

Round 7 then found DPN-30 anyway. So, honestly:

**What the invariant bought.** It turned the next instance from a discovery into a diagnosis. Sol did
not have to reason out a new failure mode; he checked the stated rule against the code and found the
noun was wrong. The fix was correspondingly small — the fate object already existed, and needed a
signal beside its reason. And it produced one place to correct rather than five: when the claim
changed, there was a single sentence to rewrite rather than a scatter of implications.

**What it did not buy.** The invariant was *stated at the level the author could see*. "None of them
**starts** more paid work" — "starts" silently meant "starts a claim", because claims were the only
thing in reach. An invariant inherits the blind spot of whoever writes it; naming a rule does not
widen the aperture it was written through. What would have widened it is the inventory in the next
section, which is a question about the *system* rather than about the rule.

## What would have caught the class

Ranked by ease against value. "More review rounds" is not on the list: seven is what we did, and
round seven still found one.

1. **An inventory of the spending points, written before the first guard.** One table: *where does
   money leave this run, and what can stop it there?* Rows for phase boundary, job start, claim
   start, step start, call. The claim/call gap is visible in that table in about ten minutes, because
   the "what can stop it" column is empty for the last row. **Cheapest thing here, and it would have
   caught all six at once** — not by fixing them, but by showing that a guard at any higher row could
   not be complete. This is the one to do next time.
2. **A detector for the class, rather than a guard per instance.** The harness already receives
   `onStepSpend` reports naming how many calls each step made, and the fate now knows *when* it was
   lost. Comparing the two — *"N calls were recorded after the phase was already lost"* — is a
   finding the harness can raise about itself, at every level at once, without knowing which level
   the leak is at. It would have gone red on DPN-26 and DPN-30 without anybody predicting either.
   Cheap, and it is the only item here that keeps working on the instance nobody has thought of yet.
3. **Test an invariant at every level it claims to hold, not at the level it was fixed at.** Every
   test written for guards 1–5 exercised the guard. None asked "and what else spends money between
   this check and the next one?" The DPN-30 test that matters is not "the fate refuses a claim" but
   "after the fate is lost, no further call begins" — which is a different sentence and would not
   have passed.
4. **Make the granularity explicit in the type.** A `PhaseFate` that offered only `lost()` could only
   ever gate claims. The version that also carries `signal` can gate calls. Had the type carried both
   from the start — or had it been named `ClaimGate` so that its reach was in its name — the missing
   half would have been visible at every call site rather than in one docblock's wording.
5. **Cross-family review.** It found every one of these. It is essential and it is not sufficient,
   which is what rounds 1–7 demonstrate; it belongs last on a list of things that would have caught
   the *class* because it caught the instances one at a time.

## The cost of finding it late

Rounds 3–5 were cheap. Nothing had been built on the findings, and each fix was an addition: a new
check, a new pure function, a handful of tests. `stopIfCompromised` is fifteen lines.

Round 7 was not. The fix had to reach **inside a running claim**, which meant:

- establishing that `StepContext` survives a shallow spread — that `report` is an arrow and not a
  `this`-bound method, verified in a live run rather than by reading;
- composing an `AbortSignal` and proving the composition propagates an abort that happens *after*
  composition, which took a forced probe against a real `--dry-run`;
- reading three files in `src/` to establish that the signal is honoured where it matters, and
  finding the existing test that pins it — because a threaded-but-ignored signal looks exactly like a
  working one ([silent-success.md](../reusable/silent-success.md));
- and retracting a claim in five places at once.

That last cost is the one that compounds. By round 7 the harness's docblocks, `evals/README.md`, the
plan and the preflight output all asserted what the guard did. Every fix after round 5 was as much a
documentation change as a code change, because the run *tells you* what it protects you from — and a
protective claim that has quietly become false is worse than no claim, since it is exactly what a
reader leans on when deciding to type `--spend`.

## The review process, and the failure mode it did not catch

**It worked.** All seven rounds found something material; none was a formality. The two findings that
mattered most — DPN-20-R, that a "rendezvous" holding two of three parties is not a rendezvous, and
DPN-30 — were both found by the cross-family reviewer rather than by the author or the coordinator.
Neither was reachable by staring harder at one's own diff.

**And here is what it did not catch.** A false claim — *"another agent's job can serialise the three
measured steps"* — was asserted three times across three rounds before it was contradicted. It is
wrong for a simple reason: after a successful gate all three jobs hold claims, and that is all three
of `DEFAULT_JOB_CONCURRENCY`'s slots, so nothing can get between them. It survived because **each
round reviewed the diff, and the claim was not in the diff.** It had been written once, in a
docblock, and thereafter only copied.

The lesson is narrow and worth keeping: a review of changes will not audit the claims that stopped
changing. Where a run's own output makes promises to the person about to spend money, those promises
need a pass of their own — read as a list, against the code as it now is, not as a side effect of
reviewing what moved this week.

## What is true now

Stated at the level it actually holds, which is the standard this whole episode is about:

1. If the three measured steps run at all, they started together, and nothing re-runs one outside
   that release.
2. On a paid run, if they did not start together, none of them ran and none of them was bought.
3. Once any of the three has lost the phase, the other two stop before their next claim **and cancel
   the calls their running step has not yet made**. What remains uncancelled is the single request
   already in flight, which the provider may still bill. That is the honest bound.
4. Whether the three windows stayed open together long enough to measure is not guaranteed and is
   measured — by `fullConcurrencyMs` against a floor declared before the run spends.

## Sources

- The seven review answers, in the session scratchpad as `dfs-review*-answer.md` (ordered `5b`,
  `5bh`, `2`, `3b`, `4`, `5`, `7` by timestamp).
- [260904d](../plans/260904d-deepen-fat-sections.md) § "What the pre-spend review refused", which
  carries the per-round narrative and the retracted claims.
- The commit chain: `34de961d` (the split between knowing and stopping), `a5aecf76`, `6deff942`,
  `921225e6`, `9d1cf057`, `2630b1d7`.

### The commit that introduced the class

`34de961d` — *"Close thirteen findings the pre-spend review of the 5b harness raised"*. It made
`driveJob` **report rather than throw**, which was the right fix for DPN-06: a throw took the
environment levers down under two jobs that were still running. But it is the commit that separated
*knowing* from *stopping*. Before it, a failure stopped the run by taking it down; after it, a
failure was recorded and the run carried on. Nothing acted on the record until `a5aecf76` added
`stopIfCompromised` — and then only at the level of phases.

That is not an argument for the throw. It is the observation that **the moment you convert a failure
into a value, you owe every level below you a decision about that value**, and the debt is easy to
miss because the code now looks careful: it has a finding, a message, a fatal flag and a test.
