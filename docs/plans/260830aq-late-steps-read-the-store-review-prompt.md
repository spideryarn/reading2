# Review: late pipeline steps read a path where they should read the store

You are reviewing a **plan, before it is built**, plus one failing test that is already in the
tree. Repository root: `/Users/greg/Dropbox/dev/experim/spideryarn2`. Read whatever you need; do
not change anything.

## Read these, in this order

1. `docs/plans/260830aq-late-steps-read-the-store.md` — the plan itself. It states the bug, the production
   evidence, the proposed fix in two halves, and five specific questions at the end.
2. `tests/late-step-on-a-cold-instance.test.ts` — the failing test. Run it if you like:
   `npx vitest run tests/late-step-on-a-cold-instance.test.ts`. It is red on `tweets` and `arc`
   with the production ENOENT.
3. `src/store/data-root.ts` — why the deployed root is scoped to one job. This is the constraint
   everything else hangs off.
4. `src/jobs.ts` around `claimSession` (~line 1000) and `runStep` (~line 400) — where the session
   and the step context are built.
5. `src/store/publish-session.ts` — `reads: inner.reads`, the lazy draft, and the
   *refuse a copy that moved nothing* guard.
6. `src/store/artifacts-pg.ts` — `readsPgArtifacts`, `readOnlyPgArtifacts`, `pgArtifactsIn`,
   `JobDraftRef`.
7. `src/store/artifacts.ts` — the `ArtifactReads` interface, `readBaseline`, `hasEarlierBlocks`.
8. `src/pipeline.ts` — `StepContext`, the step interface (`stamp`, `isDone`, `run`), and the six
   late steps' definitions from `arc` (~1600) to `ideas` (~1860).
9. `src/tweets.ts` (`generateTweets`, ~line 390) and `src/arc.ts` (`generateArc`, ~line 350) — the
   two stages with production failures against them. `src/glossary.ts`, `src/summarise.ts`,
   `src/ideas.ts`, `src/sketch.ts` have the same read.
10. `docs/plans/260827aa-delete-the-importer.md` — the migration this sits inside. D3–D5 is the planned
    conversion of the stages; this plan does the read half only.

## The production evidence

Vercel runtime log, deployment `dpl_2ydtHC76pndcgjsAnucrCXgvQsdE`, commit `1ed4407`,
2026-08-30. Three single-step jobs against already-published articles, all dead within seconds:

```
18:39:09  POST /api/jobs 202  {"jobId":"spya-bpcjus","slug":"nagel-bat","steps":["tweets"],
                               "msg":"job queued: nagel-bat — tweets"}
18:39:11  POST /api/jobs/spya-bpcjus/advance 200
  {"level":"error","jobId":"spya-bpcjus","slug":"nagel-bat","step":"tweets",
   "err":{"message":"ENOENT: no such file or directory, open
     '/tmp/spideryarn/001bb7a0-7720-4f1b-8b9d-1ee6e63d132a/spya-bpcjus/data/nagel-bat/blocks.json'",
   "stack":"... at async generateTweets ... at async Object.run ... at async runStep
            ... at async walkClaim ... at async advanceJobWith ... at async serveAuthenticatedApi"},
   "msg":"step failed: tweets — nagel-bat"}
```

Two more of the same shape at 18:25:43 and 18:47:22, both `steps: ["arc"]`, one on a different
slug. Full-pipeline ingest jobs in the same window succeeded. The failure is caught and the
request answers 200, so `get_runtime_errors` and Sentry's uncaught view show nothing — the
runtime log is the only record.

## What I want from you

Answer the five questions at the end of the plan, and then anything else you find. In particular:

- **Is the layered read (scratch first, Postgres behind) safe?** The whole argument rests on
  `/tmp` being scoped to one job, so the scratch can only ever hold what this claim wrote. Find me
  a path where that is false: a retry, a resumed claim, a warm instance serving a second
  `advance` of the same job, a forced step, `stillForced`, a cancelled-then-restarted job.
- **A1 (open the job's draft eagerly) vs A2 (bind to the current published revision).** A1
  reverses a decision made on purpose; A2 needs semantics for `readBaseline` and
  `hasEarlierBlocks` that I have not worked out. Tell me which is right, or that both are wrong.
- **Second-order effects of B.** Under A, `glossary` would start finding the published glossary
  through `previousGlossaryFrom` where today it finds nothing — turning "find more terms" from a
  silent replace into a real append on the deployed path. What else changes behaviour the moment
  the reads start succeeding? `blocks`'s `readBaseline`, `htmlCarriesItsIds`, `stepIsDone`,
  `assertProduced`, `freeSlug`, `articleExists` are the places I would look.
- **Is the failing test testing the right thing?** It asserts a step run against a store that
  holds the article and a directory that does not. Is that the invariant, or is it a test of the
  fix rather than of the behaviour? Would it stay green under a wrong fix — hydrating the scratch,
  say?
- **Anything the plan gets factually wrong** about how the session, the store, the draft or the
  job walk actually behave. I traced this by reading; correct me.

Please be specific: file and line, what fails, and what concrete state produces the failure. Say
clearly when you are uncertain rather than hedging everything.
