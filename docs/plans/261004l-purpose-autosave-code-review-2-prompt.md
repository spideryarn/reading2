# Code review, round 2, narrow: the shelf PATCH for an article that is not published yet

Repo: this worktree. You may edit the worktree to fix what is inside this change, red-first; report
anything wider. Do not commit. Do not edit anything under docs/. Never write or alter a quotation
attributed to a person.

## The candidate

Committed: the commit whose subject is "261004l: a purpose saved mid-import is no longer answered
with 404" (the parent of the commit that added this prompt; `git show HEAD~1`). Changed paths:
src/store/pg-shelf.ts, src/store/contracts.ts, src/routes.ts, tests/store-shelf-pg.test.ts, a
postmortem and the plan.

Also in scope as unreviewed code by someone else: your own round-1 fixes, committed as
"261004l: GPT Sol's code-review fixes, its own diff" (`git show HEAD~2`).

## What it is meant to do

The browser check found that the add page's purpose PATCH, sent while the import runs, wrote
articles.purpose and was then answered 404, because `ShelfStore.patch` built its answer from
`listArticles`, which lists only published articles. Now `patch` returns `LibraryEntry | null`,
null meaning written and not on the shelf yet. The postmortem is
docs/postmortems/261005a-a-write-that-answers-with-a-view-fails-where-the-view-is-empty.md.

## The questions, each with a floor

1. Is this statement accurate: "every caller of `shelfStore.patch` and every client of
   `PATCH /api/library/:slug` handles a null `entry` without wrong behaviour"? Find them all
   (src/routes.ts patchShelf, src/web/useArchive.ts, src/web/purpose.ts, anything else), and name
   any that would now do something wrong where it used to get a 404.
2. Is there another write in src/store or src/routes.ts that the add page's purpose flow reaches
   before publication and that has the same shape (a write, then an answer read through a view that
   leaves out unpublished articles)? In particular `GET /api/reader?slug=` and `shelfStore.read`
   for an unpublished row, and `leavePurpose`'s keepalive PATCH.
3. A PATCH to an article row that exists but belongs to an import that later fails or is
   cancelled: is the purpose left on a row that is later reused or adopted by a different article
   (see slug reservation in src/jobs.ts and the draft opened in src/store/pg-revisions.ts)? State
   what happens to that row.
4. Anything in your own round-1 fixes that this change interacts with.

Findings numbered from F20, P0 to P3 by consequence, established or reasoned, each with (a) the
input that shows it and (b) the fix made or proposed. One line at the end: SHIP / SHIP WITH CHANGES
/ DO NOT SHIP; refuse only on an established P0 or P1.

You can run one test file at a time. No network, no Postgres: tests/store-shelf-pg.test.ts passes
on my side, 40 of 40, and the new case was red before the change with the 404 above.
