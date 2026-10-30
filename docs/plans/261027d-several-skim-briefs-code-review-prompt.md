# Code review: several Skim briefs, stage 2 (261027d)

You are reviewing and fixing committed code in the repo at the current directory (a worktree of Spideryarn). You may edit files.

Candidate: commit `2a56e2ea8` alone. Diff: `git show 2a56e2ea8`. Files: `git show --stat 2a56e2ea8`. Start with `src/jobs.ts` (`SkimBriefTarget`, `runStep`, `parseSkimBrief`, `kept-elsewhere`), `src/routes.ts` (the `/api/skim/:slug/briefs` routes and the `/api/jobs` handling of `skimBrief`), `src/store/pg-skim-briefs.ts`, `src/skim.ts` (`routeFreshness`, `skimResponseFor`), `src/store/pg.ts` (`loadSkim`), `src/store/pg-article-transfer.ts`, and the plan `docs/plans/261027d-several-skim-briefs-per-article-and-a-picker-between-them.md` (its Log explains the design). This list does not limit scope. The plan review you did earlier is `docs/plans/261027d-several-skim-briefs-plan-review-sol.md`; check its accepted findings F1–F8 are actually met by this code where they are in stage 2's scope (stage 2 is server only; F4's client half and F7 are stage 3).

## What I want

An independent attack: correctness of the job path (a brief's job must never write `article_revisions.skim`; a default job must behave exactly as before; dedupe, requeue, claim fencing, a brief deleted or an article transferred mid-run; Quotes/Ideas running earlier in the same job still publishing), security (owner-only on every route, no brief text leaking to a visitor, in logs, or in `publicJob`), data (migrations additive; FK cascade; export and transfer), and whether the default route's freshness changed behaviour through the `routeFreshness` extraction.

## Fix as well as find

Fix what is inside this stage, narrowly, and red-first: write or adjust a test that fails, then fix. Report, do not fix, anything wider. You have no network, so tests that need Postgres will not run for you; say which of your fixes you could not run, and I will run them. `npm run typecheck` you can run.

## Severity scale

P0 = would lose or corrupt reader data or open a security hole. P1 = would not work or would ship a visible bug. P2 = worth fixing, not blocking. P3 = nit. Give every finding an ID (C1, C2, …), a severity, the evidence (file:line), and whether you fixed it.

## My own suspicions (worth less; spend most of the run elsewhere)

- `publicJob` strips `skimBrief`, so the client cannot tell a brief's `skim` job from the default's: does anything in the existing client (useSkim's auto-run, the rewrite hold, Metadata's job list) now misread a brief job as the default's and, for example, release a hold or reload the wrong route?
- `GET /api/skim/:slug/briefs/:id` answers `200 null` for an unplanned brief regardless of header.
