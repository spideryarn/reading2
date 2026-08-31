# Review request: a v1 that makes article imports work on Vercel

Review a **plan, before it is built**. Be adversarial. You returned NO-SHIP on my previous plan for
this same problem and were right on every critical, so please apply the same standard.

Project: Spideryarn (TypeScript + ESM, Vercel Pro, Supabase Postgres + Storage). Repo root is the
working directory.

## Read these

- `docs/plans/260830d-v1-imports-on-vercel.md` — the plan under review.
- `docs/plans/260829k-durable-artefacts-review-sol.md` — your own NO-SHIP on the previous attempt. Your
  criticals there (all ten stages write their own files; a green job publishes nothing; the blob seam
  has the wrong semantics) shaped this plan, so check I have actually answered them rather than
  routed around them.
- `docs/plans/260827aa-delete-the-importer.md` — the long-term end state this must be a stepping stone toward,
  not a detour. Owned by another agent, D1b unstarted.

Then the code: `src/pipeline.ts`, `src/jobs.ts`, `src/routes.ts`, `src/store/import.ts`,
`src/store/export.ts`, `src/store/artifacts-fs.ts`, `src/web/useJobs.ts`, `vercel.json`.

## The short version

Production imports fail 100% at step 1 (`ENOENT ... mkdir '/var/data'`). Rather than converting the
pipeline to Postgres artefacts (the 2–3 week D-series, gated on an unstarted D1b), this plan:

0. raises `LEASE_MS` and `maxDuration`, because a measured `toc` step totals 324s against a 220s
   per-step self-abort — a live bug that predates this plan;
1. injects one writable filesystem root (`/tmp/spideryarn/<ownerId>` on Vercel), replacing two
   `import.meta.dirname`-derived constants;
2. moves slug-identity checks off the filesystem onto Postgres;
3. loops `advanceJob` at the route so one invocation runs the whole job;
4. adds a `publish` pipeline step calling the existing `importArticle`, guarded to first ingests —
   **this is v1**;
5. hydrates `data/<slug>/` from Postgres via `exportArticle` and lifts that guard.

## Answer these specifically

1. **Does this actually produce a readable article on the production shelf?** Trace it end to end and
   name the first place it breaks. That is the question the previous plan failed.

2. **Is the ordering right?** Stage 0 first because the 220s deadline already fails a real article.
   Stage 5 last because it is the biggest. Is there a stage that must move, or one that cannot be
   committed independently with the suite green?

3. **The `/tmp` and warm-instance reasoning is the part I trust least.** The claim is that
   `stepIsDone` derives doneness rather than remembering it — `store.interrupted` first, `has()`
   parsing rather than stat-ing, stamps on late stages — so a cold `/tmp` re-runs honestly and a warm
   one resumes real work. **Verify that against the code.** Where does a warm, partial, or
   stale `/tmp` make a step wrongly believe it is done? Consider concurrent jobs sharing an instance,
   the owner-scoped root, and a retry after a mid-step kill.

3b. Specifically: is `/tmp/spideryarn/<ownerId>` sufficient isolation, or can two jobs for the *same*
    owner on the *same* instance collide?

4. **The publish step.** Is calling `importArticle` from inside a pipeline step sound? It runs its own
   transaction, does delete-then-reinsert by `articleId` for reader-state tables, and now refuses a
   slug with an active job (committed at `4594bd7`) — which the publishing job itself would trip, so
   the plan passes the job id through as an exemption. Is that exemption safe, or does it reopen the
   race the guard closes? What happens if publish fails after five expensive steps?

5. **The first-ingest-only guard.** v1 refuses to publish over an existing article, because
   `importArticle` treats "the files win" and would delete reader state a hydration stage has not yet
   restored. Is that guard sufficient, and is it enforced somewhere a retry or a `{steps:["arc"]}` job
   cannot slip past?

6. **Time budget.** Worst case is costed at ~405s against 800s. `toc` alone measured 324s. Is
   `maxDuration: 800` allowed on Pro, what should `LEASE_MS` become, and does a longer lease break
   `failExpired`'s reclamation or the browser's advance/backoff loop? Should the route loop enforce a
   deadline rather than hope, and if it hands back mid-job, what happens to `/tmp`?

7. **Stepping stone or detour.** The plan claims the slug checks, the injected root, the end-to-end
   contract tests and the *position* of publish all survive into D1b, and only the route loop and the
   `importArticle` call get discarded. Is that honest?

8. **What have I not thought of.** Concurrency between the browser's loop and the lease; two tabs;
   Sentry/logging; the 4.5MB body limit; PDF memory in one invocation; `assets` fetching images
   inside the same budget.

Give a verdict — SHIP / SHIP WITH CHANGES / NO-SHIP — with findings ranked, criticals first, each
citing file and line and saying concretely what to do instead. If the whole shape is wrong, say so
plainly and say what you would do.
