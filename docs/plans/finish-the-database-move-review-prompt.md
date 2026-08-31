# Review: the staging plan for finishing a files→Postgres migration

You are reviewing an **execution plan before any of it is built**. Repository root:
`/Users/greg/Dropbox/dev/experim/spideryarn2`. Read what you need; change nothing.

You reviewed an earlier, much smaller version of this work a few hours ago and returned **NO-SHIP** —
`docs/plans/late-steps-read-the-store-review-sol.md`. That verdict was accepted in full. The scope
has since widened from "fix the late steps' reads" to "finish the whole move", and the constraints
have changed underneath it. This is the new plan.

## Read these

1. **`docs/plans/finish-the-database-move.md`** — the plan under review.
2. **`docs/plans/late-steps-read-the-store-review-sol.md`** — your own earlier review. Check the plan
   has actually absorbed it rather than merely citing it.
3. **`docs/plans/late-steps-read-the-store.md`** — the narrow predecessor, kept for the fault
   analysis and the block-id chain.
4. **`docs/plans/delete-the-importer.md`** — the original migration plan and the authority on *why*.
   ~3000 lines; § "The order", § "D — the stages", § "The demolition", § "The switchover", § "What
   has to be true before this is believable" are the relevant parts. Note § "Trigger 5", added
   yesterday, and § "Parked after D1b".
5. **`tests/late-step-on-a-cold-instance.test.ts`** — the red repro, still red.
6. Code: `src/jobs.ts` (`claimSession` ~1000, `runStep` ~400, `retryJob` ~2000), `src/store/`
   (`data-root.ts`, `artifacts-fs.ts`, `artifacts-pg.ts`, `pg-session.ts`, `publish-session.ts`,
   `session.ts`, `checkpoints.ts`, `index.ts`), `src/pipeline.ts` (`STEP_ORDER`,
   `LEGACY_UNCONVERTED_STEPS`, `htmlCarriesItsIds`, the eleven step definitions), `src/blocks.ts`
   (`previousBlocksFrom`, `assertIdsCarried`).

## What changed since your last review

Five decisions from the project owner, and the fourth reshapes everything:

1. Full end state — filesystem store and importer deleted, local dev on Postgres.
2. `assertIdsCarried` refuses loudly; no exemption, no override.
3. Deploy at the end, but **every stage must be independently deployable**, with the value front-loaded
   rather than the payoff deferred to the last stage.
4. **The data is not precious — local *or* production.** Alpha, no users. Anything may be refetched;
   losing data is acceptable.
5. Migrations and deploys are authorised, including with tests or typechecking blocked.

Decision 4 is used to justify collapsing the original five-step demolition, dropping the `raw_bytes`
compatibility release, discarding the corpus re-ingest hazard ("the event that orphans the anchors"),
and demoting `db:export` from prerequisite to ordinary correctness fix.

## What I want from you

**1. Is the staging sound?** Five stages: (1) reads through the store, fixing three live production
faults; (2) all ten unconverted steps return `{ parts, stamp }`, still on the filesystem; (3) flip to
`pgStoreSession`; (4) implement three store methods that have no Postgres implementation; (5) delete
the files. Specifically:

- **Is each stage genuinely deployable on its own**, or is there a stage boundary where a deploy
  would leave the system worse than before it?
- **Is stage 1 really achievable without stage 2?** It makes the pipeline *read* Postgres while the
  stages still *write* files. Is that coherent, given `publishAndFinish` copies the scratch into a
  draft and the zero-copy guard refuses a copy that moved nothing?
- **Is the value ordering right**, or does something in stage 2 or 3 have to move earlier for stage 1
  to be safe?

**2. Has decision 4 been over-applied?** I have used "data is expendable" to delete a lot of caution.
Find where that reasoning does *not* hold — anything the original plan protected for a reason other
than preserving the corpus, that I have discarded along with the corpus protections. The demolition's
ordering and `db:export`'s demotion are the two I am least sure about.

**3. The stage-1 design.** Your last review killed scratch-first layering because `/tmp` carries the
job id, not the attempt id. The replacement binds reads to an explicit published revision resolved
once at claim time. Does that survive the same class of attack — claim handback, a resumed job
returning to a warm instance, a forced step, cancel-then-retry? And does it interact correctly with
`publishingSession`'s lazily opened draft and its carry-forward?

**4. The three "looks finished but isn't" items** — the never-executed Postgres write path,
`htmlCarriesItsIds` inverting when `extractedHtml`/`stampedHtml` become separate columns, and
`db:export` failing open. Are these correctly placed in the staging? Is there a fourth of the same
kind that neither I nor the two inventories found?

**5. Anything factually wrong** about how the session, the store, the draft, the job walk or the
publication path behave. Two inventory agents produced the map and I verified the load-bearing claims
myself, but I have not read every file.

Be specific: file and line, what fails, and the concrete state that produces it. Say plainly where
you are uncertain. If the staging is wrong, say what the stages should be instead.
