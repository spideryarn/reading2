# Review: a design for sharing an article with some people (plan only, nothing built)

Repo: this worktree, branch `worktree-fb-hwdefp-share-with-some-people`. TypeScript, ESM, Postgres
through drizzle, a Vercel function. You are read-only: report findings, change nothing.

## The candidate

Committed: the one commit that adds
`docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md`
(`git log -1 -- docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md`).
Changed paths: that file, and this prompt.

Start with the plan, then the code it makes claims about. That is where to begin, not the limit.

## What it is meant to do

Greg (the product owner) filed two feedback reports, quoted in full at the top of the plan. He wants
to share an article with a subset of people, named two designs himself (a secret link; a list of
email addresses with sign-in), and said: stop and discuss if it adds substantial complexity, or do
the simpler version first.

The plan is a design to put to him, not a build. It must:

1. describe truthfully what exists today (§ What exists today, measured);
2. propose a stage 1 (a private link) that is small, safe, and reuses the existing public read path
   rather than adding a third way to read an article;
3. size stages 2 and 3 honestly without designing them;
4. end in at most three questions Greg can answer without having read the code.

Out of scope: writing code; designing stage 2 or 3 in detail.

## What I want from you

An independent pass first. In particular:

- **Is each factual claim in "What exists today" accurate?** Check against the source, not the
  prose. Files: `src/db/schema.ts` (articles, article_visibility_changes, comments, ai_calls),
  `src/store/public-slug.ts`, `src/store/public-reader.ts`, `src/store/public-library.ts`,
  `src/public/routes.ts`, `src/public/page.ts`, `src/public/page-head.ts`, `src/asset-delivery.ts`,
  `src/routes.ts` (`handleApi`, `serveApi`, the visibility route), `src/ids.ts`, `src/ingest.ts`,
  `src/web/visitor.ts`, `src/web/article/access.ts`, `src/store/pg-comments.ts`,
  `src/store/ai-calls-pg.ts`, `src/store/pg-billing.ts`, `src/email.ts`, `src/web/auth-return.ts`,
  `src/web/monitoring.ts`, `vercel.json`.
- **Is stage 1's security design right, and is anything missing from it?** It adds a second
  ownerless lookup (`slug = ? and share_token = ?`), carries a secret in a query string, and widens
  what a public handler is told about the request. Read `docs/project/security-map.md` § The
  unauthenticated namespace and say which of its guarantees the design would weaken, if any. Where
  could the key leak that the plan does not name? Is "stored in the clear" defensible? Is the query
  string the right carrier, against a path segment or a URL fragment? Does anything in the client
  (`src/web/article/access.ts`, the router, `src/web/last-view.ts`, anything that stores or copies a
  URL) persist or re-emit the query in a way that would leak or lose the key?
- **Is the table of tests complete?** Name any guard test the build would have to move that the
  plan does not list, or one it lists wrongly (it claims `tests/public-imports.test.ts` needs no
  change).
- **Is the simpler option really simpler?** The plan keeps `visibility` at two values and adds a
  nullable token column, passing over a third `visibility` value. Argue the other side if it is
  better.
- **Are the sizes of stages 2 and 3 honest**, and is anything large missing from the stage 3 list?
- **Can Greg answer the three questions as written?** He has said he often cannot tell what a
  question is asking or how to choose. Say where a question is unclear, loaded, or missing an
  option, and whether a more important question is not asked at all.

You cannot reach Postgres or the network. Running `npx vitest run tests/doc-links.test.ts` is
possible and worth doing, since the plan adds links.

## Severity and findings

Grade by consequence if the plan were built as written, or if Greg decided on a false statement:

| | |
|---|---|
| P0 | data loss, exploitable security, incorrect charging |
| P1 | user-visible wrong behaviour, an authoritative contract violated, or a factual claim that would change Greg's decision |
| P2 | design or maintainability risk with no wrong behaviour |
| P3 | prose defect |

Give every finding a stable id (F1, F2, …), say for each whether it is *established* (direct
evidence, file and line) or *reasoned*, and end with a one-line verdict: sound to put to Greg as
written, sound with the listed changes, or not sound.

## My own suspicions, worth less than your pass

- The asset route is the one I am least sure of: `storedAssetFor` and the public asset reader may
  not thread an access union as easily as the article read.
- Whether the client keeps `?key=` through every navigation (mode switches, the metadata page).
- Whether a link-shared article that is *also* public should behave as public (it should), and
  whether the notice then says the wrong thing.
