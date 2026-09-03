# Review this sweep plan before it is built

You are reviewing `docs/plans/260903d-improve-the-codebase-second-sweep.md` in the Spideryarn
repo (`reading2`). Read that plan in full, then read the code it cites. **Check the claims against
the tree, not against the prose.**

This is the *second* whole-tree improvement sweep in one night. The first is
`docs/plans/260903a-improve-the-codebase-sweep.md` — read its "What the next sweep should know",
"Not doing, and why", and "What the review changed" sections, because this plan is supposed to start
where that one stopped and not re-open what it settled. The method both follow is
`docs/reusable/improve-the-codebase.md`.

The run is **unattended** — Greg is asleep — so anything needing a decision is deferred rather than
guessed. Judge the plan on that basis.

## What I most want you to attack

1. **T2.1 is the load-bearing item and it is a rejection.** I claim five of six `routes.ts`
   registries (`answering`, `streaming`, `searching`, `refereeing`, `pullingClaims`) are *not*
   defects, because each is deliberately the process-local `keep` half of a two-part fence whose
   durable half lives in the store (`SweepOptions`, `src/store/contracts.ts:648`;
   `routes.ts:862-871`). And I claim the sixth, `turnOrder` (`routes.ts:1775`), *is* a genuine
   unprotected lock because it has no durable counterpart.
   **Is that distinction real?** Read each of the six. If any of the five actually does need
   `processSingleton` — or if `turnOrder` does *not* — say so. A wrong rejection here means a live
   money bug stays in, which is worse than the extra machinery I declined.
   Also: is wrapping `turnOrder` actually correct, or does its `Map<string, Promise<void>>` need
   something else entirely (the promise chain crosses a restart boundary — does preserving the map
   even help, or does it preserve a promise from a dead module copy that will never settle)?
   **That last question is the one I am least sure of.**

2. **T1.3.** I claim scoping `settleExpired()` at `src/jobs.ts:1485` to the calling owner would leak
   a global concurrency slot for ever, because a departed owner never makes another request and this
   is the only door that reaches their job. Check `CONCURRENCY_ENV` (`src/jobs.ts:217`), `claim`'s
   `queue_state` lock, and `listJobs` (`src/jobs.ts:2732`). **Is my reasoning right?** If scoping is
   in fact safe, the whole item inverts and there is a cheap fix I talked myself out of.

3. **T1.1 — the count.** I claim 4 false "not wired up yet" sites in 3 files, out of 43 grep hits,
   and that `docs/project/billing.md:291` is a true statement of the same shape that must NOT be
   changed, and that two review-prompt docs must not be edited because a review prompt is a record.
   **Re-run the grep and check my triage.** Did I miss a live one, or propose changing a true one?

4. **The staging.** Stage 1a (prose) and 1b (code) run in parallel. Check no file appears in both
   lanes and that neither reaches a file the other owns. The previous sweep's review caught exactly
   this failure — a file in two lanes and a `tests/*` wildcard — so it is worth re-checking.

5. **Anything I declined that I should not have**, especially the `httpError` five copies (T "Not
   doing") and the module-scope meta-test (T2.2). I declined both on "no drift yet" and "the
   heuristic's false positives are the five correct registries" respectively. Push back if either is
   wrong.

6. **Anything I asserted more strongly than the evidence supports.** Every finding carries an
   evidence state — *reproduced*, *proved from the code*, or *hypothesis*. Check the words match what
   is actually behind them. A quantifier means I counted; tell me if I did not.

## What is already done and not up for review

T0.1 is committed and pushed (`b64c7b7c`) — a red gate on `dev` at the start of the run, three
`isolationLevel` literals in `src/store/pg-jobs.ts` replaced with the shared `READ_COMMITTED`. Another
session fixed it concurrently and both converged. Not asking about that.

## Answer with

- **A verdict: ready to build, or not ready.** Say which, plainly, at the top.
- Each finding you dispute, with the file:line that disproves it.
- Anything the plan misses that a sweep of this tree should have caught — you have the whole repo.

Be blunt. The previous plan came back "not ready" on two counts and both were right; that review was
worth more than any single finding in the plan.
