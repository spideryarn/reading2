Code review of one commit, in this worktree. You may fix what you find inside this stage; report
anything wider for me to decide rather than changing it.

The commit: `git show 3466cf9d2` (HEAD). The plan, with your plan review's findings and what was done
with each: docs/plans/261003g-earlier-tab-shows-the-page-each-report-was-filed-from.md.

What it does: the Feedback dialog's Earlier tab now shows which page each of the reader's own reports
was filed from. `src/feedback-page.ts` turns the stored address into a label (path only, only a path
`parseRoute` recognises, an import collapsed to `/add`); `listMine` in `src/store/pg-feedback.ts`
selects `url` and returns `page`; `GET /api/feedback` in `src/routes.ts` picks `page`;
`src/web/FeedbackEarlier.tsx` validates and prints it.

Please check, against the code and not the prose:
1. Can anything other than a router-recognised path of this app reach the response's `page`? Try
   percent-encoding, trailing slashes, `//`, case, `/read/<slug>/metadata`, `/add` variants, an
   off-origin address, `/auth/callback`, `/admin/<page>`. Does `parseRoute` accept any path that
   carries free text other than a slug or an `/add/` remainder?
2. `src/feedback-page.ts` imports `src/web/router.ts` into server code that the store uses. Does that
   pull anything browser-only into the server or the API bundle, or run a side effect at import?
   (`src/messages.ts` and `src/public/page.ts` already import it; check that is really the same.)
3. The client validator is strict: a row without `page` is the failed state. Client and server ship
   in one deployment, but is there any path (a cached shell, the offline/service-worker layer, a
   preview) where a new client reads an old server's answer, or the reverse, and the tab breaks?
4. The tests: is any of the new ones unable to go red? Is anything asserted in prose (comments, the
   plan, docs/project/feedback.md, the help text) that the code does not do?
5. Anything else wrong in the diff.

Run what you need (`npx vitest run tests/feedback-page.test.ts tests/feedback-dialog.test.tsx
tests/feedback-route.test.ts`; `tests/feedback-store.test.ts` needs the local Postgres and should be
run alone). Do not run the full suite or `npm run check`: the box is busy. Do not commit.

Report findings as P0/P1/P2 with file:line, say which you fixed, and finish with a one-line verdict.
