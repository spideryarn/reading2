# Review: a plan for the permalink, and sharing, while an article is importing (plan only)

Repo: this worktree. TypeScript, ESM, React client in `src/web`, routes in `src/routes.ts`,
Postgres stores in `src/store`. You are read-only: report findings, change nothing.

## The candidate

`docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md`. Nothing is built.

## What it is meant to do

Greg (the product owner, an admin) filed two feedback reports, quoted at the top of the plan: he
wants the article's eventual link while it imports, and to make it public while it imports. He
asked for the simplest version that gets most of the value. The plan claims this can be done in
the browser only, with no server change.

## What I want from you

An independent pass first. Then in particular:

1. **Is each claim under "What is already true" accurate?** Check the source, not the prose:
   `src/jobs.ts` (`enqueue`, where the slug is minted, when the `articles` row is created),
   `src/store/pg-visibility.ts`, `src/store/public-reader.ts`, `src/store/public-library.ts`,
   `src/public/page.ts`, `src/web/article/access.ts`, `src/web/article/ArticlePage.tsx`,
   `src/web/add-high-power.ts`, `src/web/AddPage.tsx`, `src/web/AddArticle.tsx` (`JobCard`),
   `src/web/jobEngine.ts`, `src/types.ts` (`Job`).
2. **Is "a public article that has not published is invisible everywhere" true for every public
   surface?** Assets, comments, searches, link previews, the page head, "cited in Spideryarn",
   anything keyed on `visibility = 'public'` that does not also require a current revision. Also
   the first, provisional publication (`openEarly`, docs/project/ingest-queue.md § A first import
   opens before its structure): is anything wrong with a visitor reading that?
3. **Can the slug the job card hands out stop being the article's address?** A retry
   (`slugForRetry`), an adoption of an article already on the shelf (`freeSlug`), a cancelled job.
4. **Does switching visibility before the import is charged change what the import costs, or break
   admission or settlement?** `src/store/pg-billing.ts`, `src/billing/points.ts`,
   `src/store/pg-session.ts` § `settleIn`. A public article counts half.
5. **Part 2 (the redirect from `/read/<slug>` to the add page):** does the job the browser holds
   carry `url` / `upload.id`, and is there a loop or a wrong redirect to worry about (a mode job on
   an article that 404s for another reason; the add page opening the article, which 404s, which
   redirects back)?
6. **Is the rights confirmation still a statement the owner makes?** The request with
   `rightsConfirmed: true` may be sent seconds after the press, by a retry loop.
7. Anything simpler that gets most of the value, or anything here that is more than it needs to be.

For each finding: severity (P0-P3), the file and line that shows it, and what you would do. Say
plainly which claims you checked and found true. End with a verdict line.
