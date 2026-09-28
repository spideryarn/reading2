# Plan review, round 2: reset and regenerate an article (260928a)

Read-only. Repo root is the current directory. Candidate: the untracked file
`docs/plans/260928a-reset-and-regenerate-article.md`, revised after your round-1 review, which is
`docs/plans/260928a-reset-and-regenerate-article-review-sol.md` (F1–F5). Read both.

1. For each of F1–F5: is the revision an adequate answer? Check against the code, especially
   `publishRevisionIn` (src/store/pg-revisions.ts ~2100-2215), `enqueueSuccessorIn` and
   `activeHolder` (src/store/pg-successor.ts), `workKeyFor` (src/store/jobs.ts) and `sameWork`
   (src/jobs.ts), `retryJob` (src/jobs.ts), and how `POST /api/jobs` resolves the profile
   (src/routes.ts ~8700-8740).
2. Anything new the revision introduces — e.g. does `publishRevisionIn` have access to the
   publishing job's row (it takes `opts.job` with id/attemptId); does queueing N successors in the
   publication transaction interact badly with the labels successor, the article lock, or the
   `boundToOlderBase` branch; does a profile on a successor break its dedupe or `activeHolder`
   lookup; is there a path where the reset job publishes more than once (retry, requeue) and so
   queues regeneration twice?

Severity: P0 data loss/security/charging/unusable; P1 user-visible wrong behaviour or contract
violated; P2 design risk; P3 prose. Refuse only on an established P0/P1 with file:line evidence.
Keep IDs stable: reuse F1–F5 for the same findings, new ones from F6. End with a verdict.
