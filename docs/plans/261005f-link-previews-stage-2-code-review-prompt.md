# Code review: stage 2 of link previews and SEO

You are reviewing built code, and you may fix what you find. Work only in this worktree. Do not
commit, do not push, do not run `git` commands that change anything.

## What was built, and why

Read `docs/plans/261005f-link-previews-and-seo-for-shared-links.md`, the section "Stage 2: what
Greg's five answers build" and "What the plan review changed". Greg's five decisions are under
"Questions for Greg" and are not up for review. In short:

1. Search engines may list nine pages of our own (`src/site-pages.ts`), and nothing a reader put
   here: no article, shelf, profile, admin page or API path.
2. A shared article is never listed.
3. A shared article's card shows the article's own first picture when we host a copy of it.
4. The link-preview robots are let in to our own pages.

## The evidence

- The diff: `docs/plans/261005f-link-previews-stage-2-code-review.diff` (everything this stage
  changed, against `origin/dev`).
- The plan review you gave earlier: `docs/plans/261005f-link-previews-stage-2-plan-review-sol.md`.
- New files: `src/site-pages.ts`, `scripts/build-site-pages.ts`, `tests/site-pages.test.ts`,
  `tests/lead-image.test.ts`.
- Changed: `src/public/page-head.ts`, `src/asset-delivery.ts`, `src/store/public-reader.ts`,
  `scripts/client-shell.ts`, `scripts/check-public-shell.ts`, `vercel.json`, `public/robots.txt`,
  `index.html`, `package.json`, `src/web/PublicReadableSharingPage.tsx`, and their tests and docs.

## What I most want checked

Weight these above style. For each, say what you ran or read to reach your answer.

1. **Can anything that must stay out be listed or crawled?** Work through `vercel.json`'s header
   rule, `public/robots.txt` and the built heads together, for: a shared article, a private
   article, `/read/public`, `/profile`, `/login`, `/admin/*`, `/api/*`, and the build's own files
   (`/index.html`, `/shell.html`, `/_pages/*.html`).
2. **The shell swap.** `dist/index.html` is now the homepage's head and `dist/shell.html` is the
   default shell. Is there any reader of the built `index.html` that still treats it as the default
   shell and now goes wrong? Is `scripts/build-site-pages.ts` safe to run in the real build
   (`npm run build`: `vite build && tsx scripts/build-site-pages.ts`, then the API build)? **Do not
   run a build**: `dist/` and `api-dist/` already hold a build of this code, and another session is
   reading them. Inspect them as they are.
3. **The lead picture.** Can a publisher's URL, another article's picture, or a malformed manifest
   value reach `og:image`? Can a private article's picture be fetched through the address?
4. **Do the tests answer the question they claim to?** Try mutations: remove a page from
   `SITE_PAGES`; widen the header lookahead; drop the `$` from an `Allow`; make `leadImageOf` return
   the first entry regardless of status; make `composeSitePage` emit the robots meta. Each should go
   red somewhere. Report any that does not, and add the missing test.
5. **The sentences on `/features/public-readable-sharing`** (`PublicReadableSharingPage.tsx`, the
   section "It is kept out of search engines"). Each is a claim to an author about what the code
   does. Is each true of the code as it now is?
6. **`scripts/check-public-shell.ts`**: would it pass against a correct deployment of this, and
   fail against the mistakes it says it catches? `npx tsx scripts/check-public-shell.ts --self-test`
   runs its own fixtures.

## Rules for this box, today

The box is short of memory. Run targeted test files only, never the full suite, and no build. For
example:

```
npx vitest run tests/site-pages.test.ts tests/lead-image.test.ts
```

If vitest answers `REFUSING TO START: not enough memory`, nothing ran: wait a minute and try again.
Do not switch the refusal off. A server is listening on port 5390; leave it alone.

`docs/plans/261005f-link-previews-and-seo-for-shared-links.md` § "Checked against the real build,
locally" has what was fetched from that build and what came back.

## House rules for edits

- Fix what is inside this stage. Report anything wider for me to decide.
- Do not write a quotation and attribute it to Greg. Quote him only from text already in the repo.
- Plain words in comments and docs. No new dependency.

## Your answer

Findings ordered by severity (P0 to P3). For each: what was wrong, the evidence, and whether you
fixed it (name the files) or are reporting it. Then the mutations you tried and what each did. End
with one line: `VERDICT: approve`, `VERDICT: approve with changes` or `VERDICT: reject`.
