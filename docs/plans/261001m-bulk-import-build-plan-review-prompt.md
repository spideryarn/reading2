# Review: the bulk import build plan, after Greg's answers (261001m)

You are reviewing a plan, read-only. Do not change any file.

The plan is `docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md`. Read § Greg's
answers and § The build closely. The older sections below them are the plan you (GPT Sol) reviewed
earlier today as *rethink* (`docs/plans/261001m-review-plan-sol.md`); § The build is meant to answer
your findings F1–F8 under Greg's new product decisions.

Greg's decisions are fixed — do not argue them: a minimal paper costs 0.01 of a slot; it is an
ordinary shelf entry marked "not AI-processed yet"; bulk upload does only the minimal step; the
model is DeepSeek v4.1 Flash through a ZDR provider. Your job is to find what will go wrong building
it as planned.

**Billing is a defence** (`docs/project/billing.md` § *The quota, and the one thing it has to
survive* through § *Known limit*; `src/billing/half-units.ts`; `src/store/pg-billing.ts`;
`src/billing/admission.ts`). Check above all:

1. The `Points` unit (200 per slot) at the wall only, beside the existing `HalfUnits`. Does any
   existing surface or check (`atTheWall`, `switchOnHighPower`, `privateHeadroom`,
   `sharingWouldMakeRoom`/`articlesToShare`, `pg-vouchers.ts`, `pg-admin.ts`,
   `src/web/admin-columns.tsx`, `describePlan`'s ratio guard) break or become gameable?
2. The three admission rules in the table. Is `used + 200 <= budget + 100` exactly today's rule when
   used is a multiple of 100? Can a script get more than its share: e.g. many concurrent minimal
   reservations, a minimal reservation racing a Read-this, Read-this twice on one paper, a
   Read-this whose job fails, sharing/unsharing around a supersession, deleting an article?
3. The "0.99 as supersession" reading: *Read this* reserves an ordinary ingest row, and the
   publication that charges it stamps `superseded_at` on the article's minimal row. Does any path
   charge the ingest without superseding, or supersede without charging (a cancel racing the final
   publish, the seven settlement sites, retry of a failed Read-this, a re-added URL adopting an
   article)? Is there a simpler correct reading?
4. The in-flight split by kind.

**The thin article.** `articles.processing`, a published revision with no blocks/tree,
`loadArticle` throwing a typed 409, `enqueue` refusing slug jobs on a minimal article, the guards on
visibility, high power and reset. Look for any route or job that would spend AI on a minimal
article without the admitted *Read this* (grep for callers of `loadArticle`, `currentRevision`,
`enqueue`, `articleExists`), and any reader of articles that would crash on no tree/blocks
(`listArticles`, `describeArticle`, admin pages, shelf topics, export, the reader profile, public
library).

**Idempotency** under the billing lock, with the upload claimed in the same transaction. Does it
close F1 for the minimal path? Is the "claimed and its job has not failed" definition sound
(`src/upload-records.ts`, `src/routes.ts` § `resolveExistingUpload`/`queueAnUpload`)?

**The browser batch** (F2, F3, F7): three in flight per tab, the terminal-state seam in
`src/web/jobEngine.ts`.

Also say whether the stages are in the right order and whether anything in the plan is more
machinery than it needs.

Answer with numbered findings, each with severity (P0 blocks, P1 should change before build, P2
nice to have), the file:line evidence, and the concrete change you recommend. End with a one-line
verdict: *build as planned*, *build with changes*, or *rethink*.
