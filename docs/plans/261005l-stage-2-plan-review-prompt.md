# Review: stage 2 of the import-sharing plan (plan only, nothing built)

Repo: this worktree. Read-only: report findings, change nothing.

## The candidate

`docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md`, **only** the section
"Stage 2: one sharing section with both controls, a visitor's 'still being added', and the card
that never appears" and "Greg's answers, 2026-10-06" above it. Stage 1 is built and on dev; you
reviewed it three times (the `261005l-*-sol.md` files beside the plan).

## What it is meant to do

Greg, the product owner, answered three questions (quoted in the plan): put a private link beside
the public switch on the add page, in one section collapsed by default; build a "still being
added" page for a visitor who arrives before publication, accepting that a link holder learns an
unpublished article exists; and do NOT build a pre-publication visibility read. He asked that you
check nothing else leaks.

## What I want from you

An independent pass first. Then:

1. **2c is the security question.** The plan adds one arm to `pgPublicReader.loadArticle`
   (`src/store/public-reader.ts`): 409 `still-being-added` when a row matches
   `publicAccessWhere(slug, access)`, has no current revision, and has a queued or running job.
   - Does that disclose anything beyond "a shared, unpublished article with a live import exists
     at this slug" to a requester who could not already read it once published? Think about: a
     private article (no key, wrong key, a turned-off key), another owner's slug, an archived
     article, a minimal paper, timing differences between the 404 and the 409 paths, the page
     head (`src/public/page.ts`), caching headers on the public namespace, the offline cache in
     `src/web/lib/api.ts`, and anything that logs or reports a 409.
   - How should "a queued or running job for that article" be asked from the public reader, which
     must not reach `currentOwnerId` (tests/owner-isolation.test.ts, tests/public-imports.test.ts)?
     Jobs are in `src/store/jobs.ts`; say which columns join safely and whether a mode job on an
     already-published article could ever make this arm fire (it should not: there is a current
     revision then).
   - The first, provisional publication of an `openEarly` import has a current revision, so this
     arm is not reached. Confirm.
   - Is 409 with a `code` the right shape here, given how `NotProcessed` is declared and how
     `src/public/routes.ts` maps errors? Would the public dispatcher's catch turn it into
     something else?
2. **2b:** is `GET /api/article/:slug/share-link` really readable before publication, and are the
   create and turn-off routes what the plan says? Does a private link created before publication
   count against anything, or get refused for a reason the plan misses? Any path where the link's
   key reaches a place it should not (logs, the offline cache, `sessionStorage`, a URL)?
3. **2a:** is holding the POST's returned job safe against the cases stage 1 took care over (a
   Retry's new id, a slug change, StrictMode, the upload engine's own POST)?
4. Anything simpler that loses nothing, and anything missing from "Done looks like".

Severity (P0-P3), file and line, and what you would do, for each finding. Say which claims you
checked and found true. End with a verdict line.
