# Code review (write-capable): six reader-client defects

You are reviewing, and may fix, one committed stage in this worktree.

**The stage:** commit `02e4de13e` on branch `worktree-sweep7-client-tier0` (`git show --stat
02e4de13e`; its parent is the base). `65e7cdc6e` is a merge of `origin/dev` and `50aad16da` is the
plan doc. The plan: `docs/plans/261007a-seventh-sweep-client-tier-0-six-defects.md`. The umbrella it
belongs to: `docs/plans/261006m-seventh-codebase-sweep-depth-umbrella.md` (cluster C2, and § What
the review changed, U7 and U9). The findings it fixes are in
`docs/investigations/261006d-seventh-sweep-depth-reader-client-*` (WCO1, WCO2, WCO5, WCO7 from the
Opus read; WC2, WC4 from yours), with both cross-reviews.

**What it claims, item by item. Try to break each rather than confirm it:**

1. **WCO1** `useQuizRead` now calls `useStepFinished(slug, "quiz", refresh)`. Can it double-refresh,
   refresh a different slug, or fire for a quiz *marking* rather than a quiz *generation*? The
   umbrella's U7 asked for a guard naming the always-mounted artefact reads with explicit
   exclusions; the builder left `READS` in `tests/always-mounted-reads-refresh.test.tsx` a hand
   list. Is a derived check small enough to add here? If so add it; if not say why.
2. **WCO2** `useCrossrefs`: a failed re-read leaves same-slug links alone. Find a sequence (slug
   change mid-flight, a successful absence, a stale answer, a failure after an absence, offline
   copy) where links for the wrong article or a deleted artefact stay drawn. The hand-rolled
   completion wrapper was replaced with `useStepFinished`: are they really equivalent?
3. **WCO5** `Metadata.tsx` draws failures through `describeFetchFailure`, with one predicate. The
   builder says the predicate change is untestable once the sentence can never be empty; and it
   converted two `throw new Error(` to `ReaderFacingError` because `tests/describe-fetch-failure`
   forbids the former in such a file. Is each converted sentence really one a reader should see
   verbatim? Is "Still saving the last tag change — a moment." reachable? The builder also notes a
   cost: an unauthored exception is now reported to Sentry, and a failed first read retries four
   times, so one bad page load may report five times. Is that true, and if so is there a narrow
   fix inside this stage (report once), or is it wider?
4. **WCO7** `useIllustrated`'s re-ask key uses the failure message. The builder found the old key
   really did miss a re-ask after two refused starts, and that two refusals in identical words
   still do not re-ask (pinned by a test as today's behaviour). Is pinning that right, or is it a
   defect being enshrined? If a small correct key exists (a counter of failures?), say so; fix
   only if it is clearly inside this stage.
5. **WC2 / WC4** Debate's sub-mode joined two lists, each now a `Record<ModeWithSubModes, …>` so a
   new sub-mode fails to compile. Check the `selectProse` held-create path (shares the snapshot, has
   no Debate test of its own) and the visitor arm of `ModeBoundary`. Is the Record a real compile
   check (delete a key, run `npx tsc -p <the web project> --noEmit` if the sandbox allows; else
   reason from the type)?

Also: any comment the stage rewrote is a claim; check each against the code (the sixth sweep found
a third of rewritten comments false on review).

You may run `npx vitest run tests/<file>` for jsdom tests that need nothing outside the tree, and
`node --import tsx <script>`. A red inside your sandbox may be the sandbox: say so. No `npm test`.
No network, no database.

**Fix what is inside this stage**, narrowly, each finding red-first with the test that reproduces
it. **Report, do not fix, anything wider.** Do not touch `useIdeas.ts`, `IdeasPanel.tsx`,
`useSkim.ts`, `useComments.ts`, `src/routes.ts`. Do not commit. Do not write any new reader-facing
sentence: reuse an existing one or report the need. Do not attribute any decision to the product
owner in docs: the choices here were the orchestrator's (Claude's) and the builder's.

**Reply format.** Findings C1, C2, …; severity P0 (data loss) / P1 (a reader sees wrong behaviour)
/ P2 (correctness, not visible) / P3 (tidiness). For each: the input that shows it, reproduced or
not, fixed or not (and the test). Then: files changed; what you ran, raw counts; verdict (ship /
ship with these fixes applied / do not ship); wider notes.
