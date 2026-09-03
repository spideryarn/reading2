# Second pass on a revised plan

You reviewed `docs/plans/260903e-glossary-delete-in-postgres.md` and returned **not ready**. Your
review is saved at `docs/plans/260903e-glossary-delete-in-postgres-review-sol.md`. The plan has been
rewritten. This is a focused second pass: **is it ready to build now?**

## What I verified of your findings, and accepted

- **Finding 1 (the draft race): confirmed, and it is the reason the plan changed.** I traced
  `openOrBeginJobDraft` -> `beginDraftIn` -> `publishRevisionIn`, and the `sameWork` hand-back in
  `src/jobs.ts:2441`. The plan now has a section "The race that makes this more than one UPDATE".
- **Finding 2 (no runtime precedent): confirmed, and it was the plan's worst error.** Every job
  drafts and publishes; `writeArtefacts` writes the draft, not the published revision. The plan now
  says the delete is a deliberate new exception, and `src/db/schema.ts:390` is corrected as part of
  the work rather than cited as support.
- **Findings 3, 4, 5, 6:** all folded in — the integration test through the real claim/session path,
  the `FOR UPDATE` SQL assertion, `requireSlug` extracted to its own leaf plus the slug-guard family
  entry, and the three extra docs (`deployment.md:926`, `260827am`, `260903a`).

Your note that `pgReady` skipped `store-carry-forward.test.ts` for you is fair. The spike recorded in
the plan did run against a reachable Postgres, but you were right not to take it on trust.

## What I want you to check now

1. **The chosen fix for the race.** The plan refuses with **409** when a live queued/running job
   holds a draft for this article, checked while holding the article lock that
   `openOrBeginJobDraft` also takes. Is that actually race-closed? Name the exact query you would
   write for "a live job holds a draft for this article" — I want to be sure it cannot miss a job
   that is between claiming and opening its draft, or catch one whose lease has expired but which
   nothing has swept yet. `liveAttempt` and `settleExpired` in `src/store/pg-jobs.ts` are relevant.

2. **Is 409 the right answer, or should the delete queue behind the job?** The plan says queueing is
   a bigger change and a separate plan. Push back if you disagree.

3. **Did I over-correct on the schema comment?** The plan keeps the in-place UPDATE, arguing the
   comment's *reasoning* survives its stale example — minting a revision to remove one value copies
   every block row and buys nothing, and `publishRevision` refuses a revision with no tree or
   blocks. Is that sound, or does "no runtime precedent" argue for minting a revision after all?

4. **The extra find.** `pgVisibilityStore.set` never calls `requireSlug`, so a malformed slug 404s
   where it should 400. The plan folds the one-line fix into Stage 1 since `requireSlug` is being
   extracted anyway. Is that right, or is it scope creep that belongs in its own change?

5. **Anything still missing** that will break, or anything now over-engineered.

## What I want back

**Ready to build**, or **not ready** with what must change. Short. Only the parts that changed need
re-reviewing; do not re-litigate what we already agree on.
